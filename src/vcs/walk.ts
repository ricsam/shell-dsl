import type { VirtualFS } from "../types.ts";

/**
 * Recursively walk a directory tree and return all file paths
 * relative to the given root. Excludes directories whose names
 * match the exclude list.
 */
export async function walkTree(
  fs: VirtualFS,
  root: string,
  exclude: string[] = [],
): Promise<string[]> {
  const results: string[] = [];
  await walkDir(fs, root, root, exclude, results);
  return results.sort();
}

async function walkDir(
  fs: VirtualFS,
  base: string,
  dir: string,
  exclude: string[],
  results: string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (exclude.includes(entry)) continue;

    const fullPath = fs.resolve(dir, entry);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      await walkDir(fs, base, fullPath, exclude, results);
    } else if (stat.isFile()) {
      // Compute relative path from base
      const relative = relativePath(base, fullPath);
      results.push(relative);
    }
  }
}

function relativePath(base: string, full: string): string {
  const normalizedBase = base.endsWith("/") ? base : base + "/";
  if (full.startsWith(normalizedBase)) {
    return full.slice(normalizedBase.length);
  }
  return full;
}
