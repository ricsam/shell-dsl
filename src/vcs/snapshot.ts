import type { VirtualFS } from "../types.ts";
import type { TreeManifest, FileEntry, TreeEntry, VCSIndexEntry } from "./types.ts";
import { hashSample, readStreamSample } from "./content.ts";
import { matchVCSPath, VCSRules } from "./rules.ts";
import { walkTreeEntries } from "./walk.ts";
import { VCSObjectStore } from "./objects.ts";

export interface BuildTreeManifestResult {
  manifest: TreeManifest;
  indexEntries: Record<string, VCSIndexEntry>;
}

/**
 * Build a TreeManifest from the current working tree.
 */
export async function buildTreeManifest(
  fs: VirtualFS,
  rootPath: string,
  options: {
    objectStore: VCSObjectStore;
    rules?: VCSRules;
    trackedPaths?: Iterable<string>;
    indexEntries?: Record<string, VCSIndexEntry>;
  },
): Promise<BuildTreeManifestResult> {
  const manifest: TreeManifest = {};
  const nextIndexEntries: Record<string, VCSIndexEntry> = {};
  const rules = options.rules ?? new VCSRules({ internalDirName: ".vcs" });
  const trackedPaths = new Set(options.trackedPaths ?? []);
  const entries = await walkTreeEntries(fs, rootPath, {
    enterDirectory: (relPath) => rules.shouldEnterDirectory(relPath, trackedPaths),
    includeFile: (relPath) => rules.shouldIncludeWorkingFile(relPath, trackedPaths),
    includeDirectory: (relPath, info) =>
      info.empty && rules.shouldIncludeEmptyDirectory(relPath, trackedPaths),
  });

  for (const entry of entries) {
    if (entry.kind === "directory") {
      manifest[entry.path] = { kind: "directory", size: 0 };
      continue;
    }

    const fullPath = fs.resolve(rootPath, entry.path);
    const stat = await fs.stat(fullPath);
    const cached = options.indexEntries?.[entry.path];

    if (
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs &&
      await options.objectStore.hasBlob(cached.blobId)
    ) {
      const sampleHash = hashSample(await readStreamSample(fs.readStream(fullPath)));
      if (sampleHash === cached.sampleHash) {
        manifest[entry.path] = {
          kind: "file",
          blobId: cached.blobId,
          size: cached.size,
        };
        nextIndexEntries[entry.path] = cached;
        continue;
      }
    }

    const stored = await options.objectStore.store(fs.readStream(fullPath));
    manifest[entry.path] = {
      kind: "file",
      blobId: stored.blobId,
      size: stored.size,
    };
    nextIndexEntries[entry.path] = {
      blobId: stored.blobId,
      size: stored.size,
      mtimeMs: stat.mtimeMs,
      binary: stored.binary,
      sampleHash: stored.sampleHash,
    };
  }

  return { manifest, indexEntries: nextIndexEntries };
}

/**
 * Restore a working tree from a TreeManifest.
 *
 * If `fullRestore` is true, deletes working tree files not in the manifest.
 * If `paths` is provided, only restores matching files.
 */
export async function restoreTree(
  fs: VirtualFS,
  rootPath: string,
  manifest: TreeManifest,
  objectStore: VCSObjectStore,
  options?: {
    fullRestore?: boolean;
    paths?: string[];
    rules?: VCSRules;
    trackedPaths?: Iterable<string>;
  },
): Promise<void> {
  const fullRestore = options?.fullRestore ?? false;
  const rules = options?.rules ?? new VCSRules({ internalDirName: ".vcs" });
  const trackedPaths = new Set(options?.trackedPaths ?? []);
  const scopePatterns = options?.paths ?? null;
  const scopedEntries = Object.entries(manifest)
    .filter(([relPath]) => isPathInScope(relPath, scopePatterns))
    .sort(([a], [b]) => a.localeCompare(b));
  const targetPaths = new Set(scopedEntries.map(([relPath]) => relPath));
  const requiredDirectories = collectRequiredDirectories(scopedEntries);
  const shouldDeleteExtras = fullRestore || scopePatterns !== null;

  if (shouldDeleteExtras) {
    const currentEntries = await walkTreeEntries(fs, rootPath, {
      enterDirectory: (relPath) => !rules.isInternalPath(relPath),
      includeFile: (relPath) => rules.shouldIncludeRestoreScanFile(relPath),
      includeDirectory: () => true,
    });

    for (const current of currentEntries) {
      if (current.kind !== "file") continue;
      if (!isPathInScope(current.path, scopePatterns)) continue;
      if (targetPaths.has(current.path)) continue;
      if (rules.shouldPreserveUntrackedIgnored(current.path, trackedPaths)) continue;
      await fs.rm(fs.resolve(rootPath, current.path));
    }
  }

  for (const directory of [...requiredDirectories].sort(comparePathDepth)) {
    await ensureDirectoryExists(fs, fs.resolve(rootPath, directory));
  }

  for (const [relPath, entry] of scopedEntries) {
    if (isDirectoryEntry(entry)) {
      await ensureDirectoryExists(fs, fs.resolve(rootPath, relPath));
      continue;
    }
    await writeFileFromEntry(fs, rootPath, relPath, entry, objectStore);
  }

  if (shouldDeleteExtras) {
    const currentEntries = await walkTreeEntries(fs, rootPath, {
      enterDirectory: (relPath) => !rules.isInternalPath(relPath),
      includeFile: () => true,
      includeDirectory: () => true,
    });

    const directories = currentEntries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path)
      .filter((relPath) => isPathInScope(relPath, scopePatterns))
      .sort((a, b) => comparePathDepth(b, a));

    for (const relPath of directories) {
      if (requiredDirectories.has(relPath)) continue;
      if (rules.shouldPreserveUntrackedIgnored(relPath, trackedPaths)) continue;
      const fullPath = fs.resolve(rootPath, relPath);
      if (await isEmptyDirectory(fs, fullPath)) {
        await fs.rm(fullPath);
      }
    }
  }
}

export async function rebuildIndexForManifest(
  fs: VirtualFS,
  rootPath: string,
  manifest: TreeManifest,
  objectStore: VCSObjectStore,
): Promise<Record<string, VCSIndexEntry>> {
  const entries: Record<string, VCSIndexEntry> = {};

  for (const [relPath, entry] of Object.entries(manifest)) {
    if (isDirectoryEntry(entry)) {
      continue;
    }

    const fullPath = fs.resolve(rootPath, relPath);
    const stat = await fs.stat(fullPath);
    entries[relPath] = {
      blobId: entry.blobId,
      size: entry.size,
      mtimeMs: stat.mtimeMs,
      binary: await objectStore.isBinaryBlob(entry.blobId),
      sampleHash: hashSample(await readStreamSample(fs.readStream(fullPath))),
    };
  }

  return entries;
}

export async function updateIndexForScopedPaths(
  fs: VirtualFS,
  rootPath: string,
  manifest: TreeManifest,
  objectStore: VCSObjectStore,
  existingIndex: Record<string, VCSIndexEntry>,
  patterns: string[],
): Promise<Record<string, VCSIndexEntry>> {
  const nextIndex = { ...existingIndex };

  for (const relPath of Object.keys(existingIndex)) {
    if (isPathInScope(relPath, patterns) && !manifest[relPath]) {
      delete nextIndex[relPath];
    }
  }

  for (const [relPath, entry] of Object.entries(manifest)) {
    if (!isPathInScope(relPath, patterns) || isDirectoryEntry(entry)) {
      continue;
    }

    const fullPath = fs.resolve(rootPath, relPath);
    if (!(await fs.exists(fullPath))) {
      delete nextIndex[relPath];
      continue;
    }
    const stat = await fs.stat(fullPath);
    nextIndex[relPath] = {
      blobId: entry.blobId,
      size: entry.size,
      mtimeMs: stat.mtimeMs,
      binary: await objectStore.isBinaryBlob(entry.blobId),
      sampleHash: hashSample(await readStreamSample(fs.readStream(fullPath))),
    };
  }

  return nextIndex;
}

async function writeFileFromEntry(
  fs: VirtualFS,
  rootPath: string,
  relPath: string,
  entry: FileEntry,
  objectStore: VCSObjectStore,
): Promise<void> {
  const fullPath = fs.resolve(rootPath, relPath);
  await ensureDirectoryExists(fs, fs.dirname(fullPath));
  await removeDirectoryAtPath(fs, fullPath);

  const writer = await fs.writeStream(fullPath);
  try {
    for await (const chunk of objectStore.readBlobStream(entry.blobId)) {
      await writer.write(chunk);
    }
    await writer.close();
  } catch (error) {
    await writer.abort?.(error);
    throw error;
  }
}

function isDirectoryEntry(entry: TreeEntry): entry is Extract<TreeEntry, { kind: "directory" }> {
  return entry.kind === "directory";
}

function isPathInScope(relPath: string, patterns: string[] | null): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => matchVCSPath(pattern, relPath));
}

function collectRequiredDirectories(entries: Array<[string, TreeEntry]>): Set<string> {
  const directories = new Set<string>();

  for (const [relPath, entry] of entries) {
    if (isDirectoryEntry(entry)) {
      directories.add(relPath);
    }
    for (const parent of parentDirectories(relPath)) {
      directories.add(parent);
    }
  }

  return directories;
}

function parentDirectories(relPath: string): string[] {
  const parts = relPath.split("/").filter(Boolean);
  const parents: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join("/"));
  }

  return parents;
}

function comparePathDepth(a: string, b: string): number {
  const depthA = a.split("/").filter(Boolean).length;
  const depthB = b.split("/").filter(Boolean).length;
  if (depthA !== depthB) return depthA - depthB;
  return a.localeCompare(b);
}

async function ensureDirectoryExists(fs: VirtualFS, dirPath: string): Promise<void> {
  const parent = fs.dirname(dirPath);
  if (parent !== dirPath) {
    await ensureDirectoryExists(fs, parent);
  }

  if (await fs.exists(dirPath)) {
    const stat = await fs.stat(dirPath);
    if (stat.isDirectory()) return;
    await fs.rm(dirPath, { recursive: true, force: true });
  }

  await fs.mkdir(dirPath, { recursive: true });
}

async function removeDirectoryAtPath(fs: VirtualFS, path: string): Promise<void> {
  if (!(await fs.exists(path))) return;
  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    await fs.rm(path, { recursive: true, force: true });
  }
}

async function isEmptyDirectory(fs: VirtualFS, dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}
