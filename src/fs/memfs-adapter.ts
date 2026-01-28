import type { IFs } from "memfs";
import type { VirtualFS, FileStat } from "../types.ts";
import * as pathModule from "path";

export function createVirtualFS(memfs: IFs): VirtualFS {
  const { promises: fs } = memfs;

  return {
    async readFile(path: string): Promise<Buffer> {
      if (path === "/dev/null") return Buffer.alloc(0);
      const content = await fs.readFile(path);
      return Buffer.from(content);
    },

    async readdir(path: string): Promise<string[]> {
      const entries = await fs.readdir(path);
      return entries.map(String);
    },

    async stat(path: string): Promise<FileStat> {
      const stats = await fs.stat(path);
      return {
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        size: Number(stats.size),
        mtime: new Date(stats.mtime),
      };
    },

    async exists(path: string): Promise<boolean> {
      try {
        await fs.stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async writeFile(path: string, data: Buffer | string): Promise<void> {
      await fs.writeFile(path, data);
    },

    async appendFile(path: string, data: Buffer | string): Promise<void> {
      await fs.appendFile(path, data);
    },

    async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      await fs.mkdir(path, opts);
    },

    async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
      try {
        const stats = await fs.stat(path);
        if (stats.isDirectory()) {
          await fs.rmdir(path, { recursive: opts?.recursive });
        } else {
          await fs.unlink(path);
        }
      } catch (err) {
        if (!opts?.force) throw err;
      }
    },

    resolve(...paths: string[]): string {
      return pathModule.resolve(...paths);
    },

    dirname(path: string): string {
      return pathModule.dirname(path);
    },

    basename(path: string): string {
      return pathModule.basename(path);
    },

    async glob(pattern: string, opts?: { cwd?: string }): Promise<string[]> {
      const cwd = opts?.cwd ?? "/";
      return expandGlob(memfs, pattern, cwd);
    },
  };
}

async function expandGlob(memfs: IFs, pattern: string, cwd: string): Promise<string[]> {
  const { promises: fs } = memfs;

  // Handle brace expansion first
  const patterns = expandBraces(pattern);
  const allMatches: string[] = [];

  for (const pat of patterns) {
    const matches = await matchPattern(fs, pat, cwd);
    allMatches.push(...matches);
  }

  // Remove duplicates and sort
  return [...new Set(allMatches)].sort();
}

function expandBraces(pattern: string): string[] {
  const braceMatch = pattern.match(/\{([^{}]+)\}/);
  if (!braceMatch) return [pattern];

  const before = pattern.slice(0, braceMatch.index);
  const after = pattern.slice(braceMatch.index! + braceMatch[0].length);
  const options = braceMatch[1]!.split(",");

  const results: string[] = [];
  for (const opt of options) {
    const expanded = expandBraces(before + opt + after);
    results.push(...expanded);
  }
  return results;
}

async function matchPattern(
  fs: IFs["promises"],
  pattern: string,
  cwd: string
): Promise<string[]> {
  const parts = pattern.split("/").filter((p) => p !== "");
  const isAbsolute = pattern.startsWith("/");
  const startDir = isAbsolute ? "/" : cwd;

  return matchParts(fs, parts, startDir, isAbsolute);
}

async function matchParts(
  fs: IFs["promises"],
  parts: string[],
  currentPath: string,
  isAbsolute: boolean
): Promise<string[]> {
  if (parts.length === 0) {
    return [currentPath];
  }

  const [part, ...rest] = parts;

  // Handle ** (recursive glob)
  if (part === "**") {
    const results: string[] = [];

    // Match current directory
    const withoutStar = await matchParts(fs, rest, currentPath, isAbsolute);
    results.push(...withoutStar);

    // Recurse into subdirectories
    try {
      const entries = await fs.readdir(currentPath);
      for (const entry of entries) {
        const entryPath = pathModule.join(currentPath, String(entry));
        try {
          const stat = await fs.stat(entryPath);
          if (stat.isDirectory()) {
            const subMatches = await matchParts(fs, parts, entryPath, isAbsolute);
            results.push(...subMatches);
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Directory not readable
    }

    return results;
  }

  // Handle regular glob patterns
  const regex = globToRegex(part!);

  try {
    const entries = await fs.readdir(currentPath);
    const results: string[] = [];

    for (const entry of entries) {
      const entryName = String(entry);
      if (regex.test(entryName)) {
        const entryPath = pathModule.join(currentPath, entryName);
        if (rest.length === 0) {
          results.push(entryPath);
        } else {
          try {
            const stat = await fs.stat(entryPath);
            if (stat.isDirectory()) {
              const subMatches = await matchParts(fs, rest, entryPath, isAbsolute);
              results.push(...subMatches);
            }
          } catch {
            // Skip inaccessible entries
          }
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

function globToRegex(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += "[^/]";
    } else if (char === "[") {
      // Character class
      let j = i + 1;
      let classContent = "";
      while (j < pattern.length && pattern[j] !== "]") {
        classContent += pattern[j];
        j++;
      }
      regex += `[${classContent}]`;
      i = j;
    } else if (".+^${}()|\\".includes(char)) {
      regex += "\\" + char;
    } else {
      regex += char;
    }
  }
  regex += "$";
  return new RegExp(regex);
}
