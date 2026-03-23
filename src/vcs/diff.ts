import type { VirtualFS } from "../types.ts";
import type { TreeManifest, DiffEntry } from "./types.ts";
import { walkTree } from "./walk.ts";

/**
 * Compute diff entries between two tree manifests.
 */
export function diffManifests(
  before: TreeManifest,
  after: TreeManifest,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const path of allPaths) {
    const prev = before[path];
    const curr = after[path];

    if (!prev && curr) {
      entries.push({ type: "add", path, content: curr.content });
    } else if (prev && !curr) {
      entries.push({ type: "delete", path, previousContent: prev.content });
    } else if (prev && curr && prev.content !== curr.content) {
      entries.push({
        type: "modify",
        path,
        content: curr.content,
        previousContent: prev.content,
      });
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compute diff between a tree manifest and the current working tree.
 */
export async function diffWorkingTree(
  fs: VirtualFS,
  rootPath: string,
  manifest: TreeManifest,
  exclude: string[] = [],
): Promise<DiffEntry[]> {
  const entries: DiffEntry[] = [];
  const workingFiles = await walkTree(fs, rootPath, exclude);
  const manifestPaths = new Set(Object.keys(manifest));
  const seenPaths = new Set<string>();

  for (const relPath of workingFiles) {
    seenPaths.add(relPath);
    const fullPath = fs.resolve(rootPath, relPath);
    const content = await fs.readFile(fullPath);
    const b64 = Buffer.from(content).toString("base64");

    const prev = manifest[relPath];
    if (!prev) {
      entries.push({ type: "add", path: relPath, content: b64 });
    } else if (prev.content !== b64) {
      entries.push({
        type: "modify",
        path: relPath,
        content: b64,
        previousContent: prev.content,
      });
    }
  }

  for (const manifestPath of manifestPaths) {
    if (!seenPaths.has(manifestPath)) {
      entries.push({
        type: "delete",
        path: manifestPath,
        previousContent: manifest[manifestPath]!.content,
      });
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
