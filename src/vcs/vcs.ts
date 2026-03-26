import type { VirtualFS } from "../types.ts";
import type {
  VCSConfig,
  Revision,
  DiffEntry,
  TreeManifest,
  CommitOptions,
  CheckoutOptions,
  LogOptions,
  LogEntry,
  BranchInfo,
  VCSIndexEntry,
} from "./types.ts";
import { VCSStorage } from "./storage.ts";
import { diffManifests } from "./diff.ts";
import { VCSObjectStore } from "./objects.ts";
import { matchVCSPath, VCSRules } from "./rules.ts";
import {
  buildTreeManifest,
  rebuildIndexForManifest,
  restoreTree,
  updateIndexForScopedPaths,
} from "./snapshot.ts";

export class VersionControlSystem {
  private readonly workFs: VirtualFS;
  private readonly workPath: string;
  private readonly storage: VCSStorage;
  private readonly objectStore: VCSObjectStore;
  private readonly vcsInternalPath: string;
  private readonly rules: VCSRules;

  constructor(config: VCSConfig) {
    this.workFs = config.fs;
    this.workPath = config.fs.resolve(config.path);

    const metaFs = config.vcsPath?.fs ?? config.fs;
    const metaPath = config.vcsPath?.path ?? metaFs.resolve(config.path, ".vcs");
    this.storage = new VCSStorage(metaFs, metaPath);
    this.objectStore = new VCSObjectStore(this.storage.fileSystem, this.storage.resolve());

    this.vcsInternalPath = resolveInternalPath(config.fs, metaFs, this.workPath, metaPath);

    this.rules = new VCSRules({
      internalPath: this.vcsInternalPath,
      ignore: config.ignore,
      attributes: config.attributes,
    });
  }

  /** Initialize the .vcs directory. Called automatically on first operation if needed. */
  async init(): Promise<void> {
    if (await this.storage.isInitialized()) {
      await this.storage.assertSupportedFormat();
      return;
    }
    await this.storage.initialize();
    await this.objectStore.initialize();
  }

  private async ensureInit(): Promise<void> {
    if (!(await this.storage.isInitialized())) {
      await this.init();
      return;
    }
    await this.storage.assertSupportedFormat();
  }

  /** Get the current HEAD revision number, or null if no commits yet. */
  private async resolveHead(): Promise<{ branch: string | null; revision: number | null }> {
    const head = await this.storage.readHead();
    if (head.revision !== undefined) {
      return { branch: null, revision: head.revision };
    }
    if (head.ref) {
      const branchName = head.ref.replace("refs/heads/", "");
      const branchRef = await this.storage.readBranch(branchName);
      return { branch: branchName, revision: branchRef?.revision ?? null };
    }
    return { branch: null, revision: null };
  }

  /** Get current HEAD manifest, or empty if no commits. */
  private async headManifest(): Promise<TreeManifest> {
    const { revision } = await this.resolveHead();
    if (revision === null) return {};
    const rev = await this.storage.readRevision(revision);
    return rev.tree;
  }

  private async currentIndex(): Promise<Record<string, VCSIndexEntry>> {
    return this.storage.readIndex();
  }

  /** Commit all pending changes, or selective changes if paths are provided. */
  async commit(message: string, opts?: CommitOptions): Promise<Revision> {
    await this.ensureInit();

    const { branch, revision: parentId } = await this.resolveHead();
    const parentManifest = parentId !== null
      ? (await this.storage.readRevision(parentId)).tree
      : {};
    const previousIndex = await this.currentIndex();
    const working = await buildTreeManifest(this.workFs, this.workPath, {
      objectStore: this.objectStore,
      rules: this.rules,
      trackedPaths: Object.keys(parentManifest),
      indexEntries: previousIndex,
    });

    let newTree: TreeManifest;
    let changes: DiffEntry[];

    if (opts?.paths && opts.paths.length > 0) {
      const matchedPaths = filterPathsByGlobs(Object.keys(working.manifest), opts.paths);
      const parentMatchedPaths = filterPathsByGlobs(Object.keys(parentManifest), opts.paths);
      newTree = { ...parentManifest };

      for (const path of parentMatchedPaths) {
        if (!working.manifest[path]) {
          delete newTree[path];
        }
      }
      for (const path of matchedPaths) {
        newTree[path] = working.manifest[path]!;
      }

      const relevantBefore: TreeManifest = {};
      const relevantAfter: TreeManifest = {};
      const allRelevant = new Set([...matchedPaths, ...parentMatchedPaths]);
      for (const path of allRelevant) {
        if (parentManifest[path]) relevantBefore[path] = parentManifest[path]!;
        if (newTree[path]) relevantAfter[path] = newTree[path]!;
      }
      changes = await diffManifests(relevantBefore, relevantAfter, {
        rules: this.rules,
        objectStore: this.objectStore,
        beforeIndex: previousIndex,
        afterIndex: working.indexEntries,
      });
    } else {
      newTree = working.manifest;
      changes = await diffManifests(parentManifest, newTree, {
        rules: this.rules,
        objectStore: this.objectStore,
        beforeIndex: previousIndex,
        afterIndex: working.indexEntries,
      });
    }

    if (changes.length === 0) {
      throw new Error("nothing to commit");
    }

    const id = await this.storage.nextRevisionId();
    const rev: Revision = {
      id,
      parent: parentId,
      branch: branch ?? "detached",
      message,
      timestamp: new Date().toISOString(),
      changes,
      tree: newTree,
    };

    await this.storage.writeRevision(rev);
    await this.storage.writeIndex(working.indexEntries);

    if (branch) {
      await this.storage.writeBranch(branch, { revision: id });
    } else {
      await this.storage.writeHead({ revision: id });
    }

    return rev;
  }

  /** Checkout a revision number or branch name. */
  async checkout(target: string | number, opts?: CheckoutOptions): Promise<void> {
    await this.ensureInit();

    const isPartial = opts?.paths && opts.paths.length > 0;

    let targetRevision: number;
    let targetBranch: string | null = null;

    if (typeof target === "string") {
      const branchRef = await this.storage.readBranch(target);
      if (branchRef) {
        targetBranch = target;
        targetRevision = branchRef.revision;
      } else {
        throw new Error(`unknown branch or revision: "${target}"`);
      }
    } else {
      targetRevision = target;
    }

    let rev: Revision;
    try {
      rev = await this.storage.readRevision(targetRevision);
    } catch {
      throw new Error(`revision ${targetRevision} not found`);
    }

    const currentManifest = await this.headManifest();

    if (isPartial) {
      await restoreTree(this.workFs, this.workPath, rev.tree, this.objectStore, {
        fullRestore: false,
        paths: opts!.paths!,
        rules: this.rules,
        trackedPaths: Object.keys(currentManifest),
      });

      const updatedIndex = await updateIndexForScopedPaths(
        this.workFs,
        this.workPath,
        rev.tree,
        this.objectStore,
        await this.currentIndex(),
        opts!.paths!,
      );
      await this.storage.writeIndex(updatedIndex);
      return;
    }

    if (!opts?.force) {
      const changes = await this.status();
      if (changes.length > 0) {
        throw new Error("working tree has uncommitted changes (use force to discard)");
      }
    }

    await restoreTree(this.workFs, this.workPath, rev.tree, this.objectStore, {
      fullRestore: true,
      rules: this.rules,
      trackedPaths: Object.keys(currentManifest),
    });

    await this.storage.writeIndex(
      await rebuildIndexForManifest(this.workFs, this.workPath, rev.tree, this.objectStore),
    );

    if (targetBranch) {
      await this.storage.writeHead({ ref: `refs/heads/${targetBranch}` });
    } else {
      await this.storage.writeHead({ revision: targetRevision });
    }
  }

  /** Create a new branch at HEAD. */
  async branch(name: string): Promise<void> {
    await this.ensureInit();

    const existing = await this.storage.readBranch(name);
    if (existing) {
      throw new Error(`branch "${name}" already exists`);
    }

    const { revision } = await this.resolveHead();
    if (revision === null) {
      throw new Error("cannot create branch: no commits yet");
    }

    await this.storage.writeBranch(name, { revision });
  }

  /** List all branches. */
  async branches(): Promise<BranchInfo[]> {
    await this.ensureInit();

    const names = await this.storage.listBranches();
    const head = await this.resolveHead();
    const result: BranchInfo[] = [];

    for (const name of names) {
      const ref = await this.storage.readBranch(name);
      if (ref) {
        result.push({
          name,
          revision: ref.revision,
          current: head.branch === name,
        });
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get revision history. */
  async log(opts?: LogOptions): Promise<LogEntry[]> {
    await this.ensureInit();

    let startRevision: number | null;

    if (opts?.branch) {
      const branchRef = await this.storage.readBranch(opts.branch);
      if (!branchRef) throw new Error(`branch "${opts.branch}" not found`);
      startRevision = branchRef.revision;
    } else {
      const { revision } = await this.resolveHead();
      startRevision = revision;
    }

    if (startRevision === null) return [];

    const entries: LogEntry[] = [];
    let currentId: number | null = startRevision;

    while (currentId !== null) {
      if (opts?.limit && entries.length >= opts.limit) break;

      let rev: Revision;
      try {
        rev = await this.storage.readRevision(currentId);
      } catch {
        break;
      }

      const changedPaths = rev.changes.map((change) => change.path);

      if (opts?.path) {
        const matchesPath = changedPaths.some((path) => matchVCSPath(opts.path!, path));
        if (!matchesPath) {
          currentId = rev.parent;
          continue;
        }
      }

      entries.push({
        id: rev.id,
        parent: rev.parent,
        branch: rev.branch,
        message: rev.message,
        timestamp: rev.timestamp,
        paths: changedPaths,
      });

      currentId = rev.parent;
    }

    return entries;
  }

  /** Get uncommitted changes as DiffEntry[]. */
  async status(): Promise<DiffEntry[]> {
    await this.ensureInit();
    const manifest = await this.headManifest();
    const previousIndex = await this.currentIndex();
    const working = await buildTreeManifest(this.workFs, this.workPath, {
      objectStore: this.objectStore,
      rules: this.rules,
      trackedPaths: Object.keys(manifest),
      indexEntries: previousIndex,
    });
    await this.storage.writeIndex(working.indexEntries);
    return diffManifests(manifest, working.manifest, {
      rules: this.rules,
      objectStore: this.objectStore,
      beforeIndex: previousIndex,
      afterIndex: working.indexEntries,
    });
  }

  /** Diff between two revisions. */
  async diff(revA: number, revB: number): Promise<DiffEntry[]> {
    await this.ensureInit();
    const a = await this.storage.readRevision(revA);
    const b = await this.storage.readRevision(revB);
    return diffManifests(a.tree, b.tree, {
      rules: this.rules,
      objectStore: this.objectStore,
    });
  }

  async readBlob(blobId: string): Promise<Buffer>;
  async readBlob(blobId: string, encoding: BufferEncoding): Promise<string>;
  async readBlob(blobId: string, encoding?: BufferEncoding): Promise<Buffer | string> {
    const content = await this.objectStore.readBlob(blobId);
    return encoding ? content.toString(encoding) : content;
  }

  async readRevisionFile(revisionId: number, path: string): Promise<Buffer>;
  async readRevisionFile(
    revisionId: number,
    path: string,
    encoding: BufferEncoding,
  ): Promise<string>;
  async readRevisionFile(
    revisionId: number,
    path: string,
    encoding?: BufferEncoding,
  ): Promise<Buffer | string> {
    const revision = await this.storage.readRevision(revisionId);
    const normalizedPath = path.replace(/^\/+/, "");
    const entry = revision.tree[normalizedPath];
    if (!entry || entry.kind === "directory") {
      throw new Error(`file "${path}" not found in revision ${revisionId}`);
    }
    return this.readBlob(entry.blobId, encoding as BufferEncoding);
  }

  /** Get current HEAD info. */
  async head(): Promise<{ branch: string | null; revision: number | null }> {
    await this.ensureInit();
    return this.resolveHead();
  }
}

function filterPathsByGlobs(paths: string[], patterns: string[]): string[] {
  return paths.filter((filePath) =>
    patterns.some((pattern) => matchVCSPath(pattern, filePath)),
  );
}

function resolveInternalPath(
  workFs: VirtualFS,
  metaFs: VirtualFS,
  workPath: string,
  metaPath: string,
): string {
  if (workFs !== metaFs) return "";

  const normalizedWork = normalizeFsPath(workPath);
  const normalizedMeta = normalizeFsPath(metaFs.resolve(metaPath));

  if (normalizedMeta === normalizedWork) return "";
  if (!normalizedMeta.startsWith(`${normalizedWork}/`)) return "";

  return normalizedMeta.slice(normalizedWork.length + 1);
}

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
