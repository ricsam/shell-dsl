import type { VirtualFS } from "../types.ts";
import { matchGlob } from "./match-glob.ts";

export type GlobVirtualFS = Pick<VirtualFS, "readdir" | "stat" | "resolve">;

export interface GlobOptions {
  cwd?: string;
}

export async function globVirtualFS(fs: GlobVirtualFS, pattern: string, opts?: GlobOptions): Promise<string[]> {
  const cwd = fs.resolve(opts?.cwd ?? "/");
  const patterns = expandBraces(pattern);
  const allMatches: string[] = [];

  for (const expandedPattern of patterns) {
    const matches = await matchPattern(fs, expandedPattern, cwd);
    allMatches.push(...matches);
  }

  return [...new Set(allMatches)].sort();
}

function expandBraces(pattern: string): string[] {
  const braceMatch = pattern.match(/\{([^{}]+)\}/);
  if (!braceMatch) return [pattern];

  const before = pattern.slice(0, braceMatch.index);
  const after = pattern.slice(braceMatch.index! + braceMatch[0].length);
  const options = braceMatch[1]!.split(",");
  const results: string[] = [];

  for (const option of options) {
    results.push(...expandBraces(before + option + after));
  }

  return results;
}

async function matchPattern(fs: GlobVirtualFS, pattern: string, cwd: string): Promise<string[]> {
  const parts = pattern.split("/").filter(Boolean);
  const startDir = pattern.startsWith("/") ? "/" : cwd;
  return matchParts(fs, parts, startDir);
}

async function matchParts(fs: GlobVirtualFS, parts: string[], currentPath: string): Promise<string[]> {
  if (parts.length === 0) {
    return (await pathExists(fs, currentPath)) ? [currentPath] : [];
  }

  const [part, ...rest] = parts;

  if (part === "**") {
    const results = await matchParts(fs, rest, currentPath);

    try {
      const entries = await fs.readdir(currentPath);
      for (const entry of entries) {
        const entryPath = fs.resolve(currentPath, entry);
        try {
          const stat = await fs.stat(entryPath);
          if (stat.isDirectory()) {
            results.push(...(await matchParts(fs, parts, entryPath)));
          }
        } catch {
          // Skip entries we can't stat.
        }
      }
    } catch {
      // Directory not readable.
    }

    return results;
  }

  try {
    const entries = await fs.readdir(currentPath);
    const results: string[] = [];

    for (const entry of entries) {
      if (!matchGlob(part!, entry)) continue;

      const entryPath = fs.resolve(currentPath, entry);

      if (rest.length === 0) {
        if (await pathExists(fs, entryPath)) {
          results.push(entryPath);
        }
        continue;
      }

      try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          results.push(...(await matchParts(fs, rest, entryPath)));
        }
      } catch {
        // Skip entries we can't stat.
      }
    }

    return results;
  } catch {
    return [];
  }
}

async function pathExists(fs: GlobVirtualFS, filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
