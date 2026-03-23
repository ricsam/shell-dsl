import type { VirtualFS } from "../types.ts";
import type { TreeManifest, FileEntry, TreeEntry } from "./types.ts";
import { matchVCSPath, VCSRules } from "./rules.ts";
import { walkTreeEntries } from "./walk.ts";

/**
 * Build a TreeManifest from the current working tree.
 */
export async function buildTreeManifest(
  fs: VirtualFS,
  rootPath: string,
  options?: {
    rules?: VCSRules;
    trackedPaths?: Iterable<string>;
  },
): Promise<TreeManifest> {
  const manifest: TreeManifest = {};
  const rules = options?.rules ?? new VCSRules({ internalDirName: ".vcs" });
  const trackedPaths = new Set(options?.trackedPaths ?? []);
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
    const content = await fs.readFile(fullPath);
    const buf = Buffer.from(content);
    manifest[entry.path] = {
      kind: "file",
      content: buf.toString("base64"),
      size: buf.length,
    };
  }

  return manifest;
}

/**
 * Build a TreeManifest for only the specified relative paths.
 */
export async function buildPartialManifest(
  fs: VirtualFS,
  rootPath: string,
  paths: string[],
): Promise<TreeManifest> {
  const manifest: TreeManifest = {};

  for (const relPath of paths) {
    const fullPath = fs.resolve(rootPath, relPath);
    if (!(await fs.exists(fullPath))) continue;
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(fullPath);
      if (entries.length === 0) {
        manifest[relPath] = { kind: "directory", size: 0 };
      }
      continue;
    }
    if (!stat.isFile()) continue;

    const content = await fs.readFile(fullPath);
    const buf = Buffer.from(content);
    manifest[relPath] = {
      kind: "file",
      content: buf.toString("base64"),
      size: buf.length,
    };
  }

  return manifest;
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
    await writeFileFromEntry(fs, rootPath, relPath, entry);
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

async function writeFileFromEntry(
  fs: VirtualFS,
  rootPath: string,
  relPath: string,
  entry: FileEntry,
): Promise<void> {
  const fullPath = fs.resolve(rootPath, relPath);
  await ensureDirectoryExists(fs, fs.dirname(fullPath));
  await removeDirectoryAtPath(fs, fullPath);

  const buf = Buffer.from(entry.content, "base64");
  await fs.writeFile(fullPath, buf);
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
