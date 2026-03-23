import type { VirtualFS } from "../types.ts";
import type { TreeManifest, FileEntry } from "./types.ts";
import { walkTree } from "./walk.ts";

/**
 * Build a TreeManifest from the current working tree.
 */
export async function buildTreeManifest(
  fs: VirtualFS,
  rootPath: string,
  exclude: string[] = [],
): Promise<TreeManifest> {
  const manifest: TreeManifest = {};
  const files = await walkTree(fs, rootPath, exclude);

  for (const relPath of files) {
    const fullPath = fs.resolve(rootPath, relPath);
    const content = await fs.readFile(fullPath);
    const buf = Buffer.from(content);
    manifest[relPath] = {
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
    if (!stat.isFile()) continue;

    const content = await fs.readFile(fullPath);
    const buf = Buffer.from(content);
    manifest[relPath] = {
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
  options?: { fullRestore?: boolean; paths?: string[] },
): Promise<void> {
  const fullRestore = options?.fullRestore ?? false;
  const filterPaths = options?.paths ? new Set(options.paths) : null;

  // Write files from manifest
  for (const [relPath, entry] of Object.entries(manifest)) {
    if (filterPaths && !filterPaths.has(relPath)) continue;
    await writeFileFromEntry(fs, rootPath, relPath, entry);
  }

  // Delete files not in manifest (full restore only)
  if (fullRestore) {
    const exclude = getVcsDirName(rootPath);
    const currentFiles = await walkTree(fs, rootPath, exclude ? [exclude] : []);

    for (const relPath of currentFiles) {
      if (!manifest[relPath]) {
        const fullPath = fs.resolve(rootPath, relPath);
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
  const dir = fs.dirname(fullPath);

  // Ensure parent directory exists
  if (!(await fs.exists(dir))) {
    await fs.mkdir(dir, { recursive: true });
  }

  const buf = Buffer.from(entry.content, "base64");
  await fs.writeFile(fullPath, buf);
}

function getVcsDirName(_rootPath: string): string | null {
  return ".vcs";
}
