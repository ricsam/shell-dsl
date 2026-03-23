import type { VirtualFS } from "../types.ts";

interface WalkTreeOptions {
  enterDirectory?: (relPath: string) => boolean | Promise<boolean>;
  includeFile?: (relPath: string) => boolean | Promise<boolean>;
  includeDirectory?: (
    relPath: string,
    info: { empty: boolean },
  ) => boolean | Promise<boolean>;
}

export interface WalkTreeEntry {
  path: string;
  kind: "file" | "directory";
}

/**
 * Recursively walk a directory tree and return all file paths
 * relative to the given root.
 */
export async function walkTree(
  fs: VirtualFS,
  root: string,
  options: WalkTreeOptions = {},
): Promise<string[]> {
  const results = await walkTreeEntries(fs, root, options);
  return results
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path);
}

export async function walkTreeEntries(
  fs: VirtualFS,
  root: string,
  options: WalkTreeOptions = {},
): Promise<WalkTreeEntry[]> {
  const results: WalkTreeEntry[] = [];
  await walkDir(fs, root, "", options, results);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function walkDir(
  fs: VirtualFS,
  dir: string,
  relativeDir: string,
  options: WalkTreeOptions,
  results: WalkTreeEntry[],
): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    const fullPath = fs.resolve(dir, entry);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    const relative = relativeDir ? `${relativeDir}/${entry}` : entry;

    if (stat.isDirectory()) {
      if (options.enterDirectory && !(await options.enterDirectory(relative))) {
        continue;
      }
      const empty = await walkDir(fs, fullPath, relative, options, results);
      if (options.includeDirectory && (await options.includeDirectory(relative, { empty }))) {
        results.push({ path: relative, kind: "directory" });
      }
    } else if (stat.isFile()) {
      if (options.includeFile && !(await options.includeFile(relative))) {
        continue;
      }
      results.push({ path: relative, kind: "file" });
    }
  }

  return entries.length === 0;
}
