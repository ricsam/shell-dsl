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
} from "./types.ts";
import { VCSStorage } from "./storage.ts";
import { diffManifests, diffWorkingTree } from "./diff.ts";
import { matchVCSPath, VCSRules } from "./rules.ts";
import { buildTreeManifest, restoreTree } from "./snapshot.ts";

export class VersionControlSystem {
  private readonly workFs: VirtualFS;
  private readonly workPath: string;
  private readonly storage: VCSStorage;
  private readonly vcsInternalPath: string;
  private readonly rules: VCSRules;

  constructor(config: VCSConfig) {
    this.workFs = config.fs;
    this.workPath = config.fs.resolve(config.path);

    const metaFs = config.vcsPath?.fs ?? config.fs;
    const metaPath = config.vcsPath?.path ?? metaFs.resolve(config.path, ".vcs");
    this.storage = new VCSStorage(metaFs, metaPath);

    this.vcsInternalPath = resolveInternalPath(config.fs, metaFs, this.workPath, metaPath);

    this.rules = new VCSRules({
      internalPath: this.vcsInternalPath,
      ignore: config.ignore,
      attributes: config.attributes,
    });
  }

  /** Initialize the .vcs directory. Called automatically on first operation if needed. */
  async init(): Promise<void> {
    if (await this.storage.isInitialized()) return;
    await this.storage.initialize();
  }

  private async ensureInit(): Promise<void> {
    if (!(await this.storage.isInitialized())) {
      await this.init();
    }
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

  /** Commit all pending changes, or selective changes if paths are provided. */
  async commit(message: string, opts?: CommitOptions): Promise<Revision> {
    await this.ensureInit();

    const { branch, revision: parentId } = await this.resolveHead();
    const parentManifest = parentId !== null
      ? (await this.storage.readRevision(parentId)).tree
      : {};

    let newTree: TreeManifest;
    let changes: DiffEntry[];

    if (opts?.paths && opts.paths.length > 0) {
      // Selective commit: only include matching files
      const fullManifest = await buildTreeManifest(this.workFs, this.workPath, {
        rules: this.rules,
        trackedPaths: Object.keys(parentManifest),
      });
      const matchedPaths = filterPathsByGlobs(Object.keys(fullManifest), opts.paths);

      // Start with parent manifest, overlay matched files from working tree
      newTree = { ...parentManifest };

      // Also check for deletions: files in parent that match patterns but are gone from working tree
      const parentMatchedPaths = filterPathsByGlobs(Object.keys(parentManifest), opts.paths);
      for (const p of parentMatchedPaths) {
        if (!fullManifest[p]) {
          delete newTree[p]; // file was deleted
        }
      }

      for (const p of matchedPaths) {
        newTree[p] = fullManifest[p]!;
      }

      // Compute changes only for matched paths
      const relevantBefore: TreeManifest = {};
      const relevantAfter: TreeManifest = {};
      const allRelevant = new Set([...matchedPaths, ...parentMatchedPaths]);
      for (const p of allRelevant) {
        if (parentManifest[p]) relevantBefore[p] = parentManifest[p]!;
        if (newTree[p]) relevantAfter[p] = newTree[p]!;
      }
      changes = diffManifests(relevantBefore, relevantAfter, this.rules);
    } else {
      // Full commit
      newTree = await buildTreeManifest(this.workFs, this.workPath, {
        rules: this.rules,
        trackedPaths: Object.keys(parentManifest),
      });
      changes = diffManifests(parentManifest, newTree, this.rules);
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

    // Update branch ref or HEAD
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
      // Check if it's a branch name
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

    // Verify revision exists
    let rev: Revision;
    try {
      rev = await this.storage.readRevision(targetRevision);
    } catch {
      throw new Error(`revision ${targetRevision} not found`);
    }

    const currentManifest = await this.headManifest();

    if (isPartial) {
      // Partial checkout: restore specific files, don't update HEAD
      await restoreTree(this.workFs, this.workPath, rev.tree, {
        fullRestore: false,
        paths: opts!.paths!,
        rules: this.rules,
        trackedPaths: Object.keys(currentManifest),
      });
    } else {
      // Full checkout
      if (!opts?.force) {
        const changes = await this.status();
        if (changes.length > 0) {
          throw new Error("working tree has uncommitted changes (use force to discard)");
        }
      }

      await restoreTree(this.workFs, this.workPath, rev.tree, {
        fullRestore: true,
        rules: this.rules,
        trackedPaths: Object.keys(currentManifest),
      });

      // Update HEAD
      if (targetBranch) {
        await this.storage.writeHead({ ref: `refs/heads/${targetBranch}` });
      } else {
        await this.storage.writeHead({ revision: targetRevision });
      }
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

      const changedPaths = rev.changes.map((c) => c.path);

      if (opts?.path) {
        // Filter: only include if this revision touches the specified path
        const matchesPath = changedPaths.some((p) => matchVCSPath(opts.path!, p));
        if (matchesPath) {
          entries.push({
            id: rev.id,
            parent: rev.parent,
            branch: rev.branch,
            message: rev.message,
            timestamp: rev.timestamp,
            paths: changedPaths,
          });
        }
      } else {
        entries.push({
          id: rev.id,
          parent: rev.parent,
          branch: rev.branch,
          message: rev.message,
          timestamp: rev.timestamp,
          paths: changedPaths,
        });
      }

      currentId = rev.parent;
    }

    return entries;
  }

  /** Get uncommitted changes as DiffEntry[]. */
  async status(): Promise<DiffEntry[]> {
    await this.ensureInit();
    const manifest = await this.headManifest();
    return diffWorkingTree(this.workFs, this.workPath, manifest, this.rules);
  }

  /** Diff between two revisions. */
  async diff(revA: number, revB: number): Promise<DiffEntry[]> {
    await this.ensureInit();
    const a = await this.storage.readRevision(revA);
    const b = await this.storage.readRevision(revB);
    return diffManifests(a.tree, b.tree, this.rules);
  }

  /** Get current HEAD info. */
  async head(): Promise<{ branch: string | null; revision: number | null }> {
    await this.ensureInit();
    return this.resolveHead();
  }
}

/**
 * Filter a list of paths to only those matching any of the given glob patterns.
 * Patterns may start with `/` which is stripped before matching.
 */
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
