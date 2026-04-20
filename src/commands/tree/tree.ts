import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";
import { matchGlob } from "../../utils/match-glob.ts";

interface TreeFlags {
  all: boolean;
  directoriesOnly: boolean;
  maxDepth: number;
  dirsfirst: boolean;
  prune: boolean;
  noReport: boolean;
  ignorePatterns: string[];
}

const spec = {
  name: "tree",
  flags: [
    { short: "a", long: "all" },
    { short: "d" },
    { short: "L", takesValue: true },
    { short: "I", takesValue: true },
    { long: "dirsfirst" },
    { long: "prune" },
    { long: "noreport" },
  ] as FlagDefinition[],
  usage: "tree [-adI] [-L level] [-I pattern] [--dirsfirst] [--prune] [--noreport] [directory ...]",
};

const defaults: TreeFlags = {
  all: false,
  directoriesOnly: false,
  maxDepth: Infinity,
  dirsfirst: true,
  prune: false,
  noReport: false,
  ignorePatterns: [],
};

interface HandlerResult {
  error?: string;
}

let handlerResult: HandlerResult = {};

const handler = (flags: TreeFlags, flag: FlagDefinition, value?: string) => {
  if (flag.short === "a") flags.all = true;
  if (flag.short === "d") flags.directoriesOnly = true;
  if (flag.long === "dirsfirst") flags.dirsfirst = true;
  if (flag.long === "prune") flags.prune = true;
  if (flag.long === "noreport") flags.noReport = true;
  if (flag.short === "I" && value) {
    if (flags.ignorePatterns === defaults.ignorePatterns) {
      flags.ignorePatterns = [];
    }
    flags.ignorePatterns.push(...value.split("|"));
  }
  if (flag.short === "L" && value) {
    const depth = parseInt(value, 10);
    if (isNaN(depth) || !/^\d+$/.test(value)) {
      handlerResult.error = `tree: -L option requires a numeric argument\nusage: ${spec.usage}\n`;
    } else {
      flags.maxDepth = depth;
    }
  }
};

const parser = createFlagParser(spec, defaults, handler);

export const tree: Command = async (ctx) => {
  // Reset handler result for each invocation
  handlerResult = {};

  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  if (handlerResult.error) {
    await ctx.stderr.writeText(handlerResult.error);
    return 1;
  }

  const { all: showAll, directoriesOnly, maxDepth, prune, noReport, ignorePatterns } = result.flags;
  const targetPath = result.args[0] ?? ".";

  // Validate maxDepth
  if (maxDepth < 1) {
    await ctx.stderr.writeText("tree: Invalid level, must be greater than 0\n");
    return 1;
  }

  const resolvedPath = ctx.fs.resolve(ctx.cwd, targetPath);

  // Check if path exists
  let stat;
  try {
    stat = await ctx.fs.stat(resolvedPath);
  } catch {
    await ctx.stderr.writeText(`tree: ${targetPath}: No such file or directory\n`);
    return 1;
  }

  // If it's a file, just print the filename
  if (stat.isFile()) {
    await ctx.stdout.writeText(noReport ? targetPath + "\n" : targetPath + "\n\n0 directories, 1 file\n");
    return 0;
  }

  let dirCount = 0;
  let fileCount = 0;
  const entriesCache = new Map<string, { name: string; path: string; isDir: boolean }[]>();
  const visibleContentCache = new Map<string, boolean>();

  // Print root
  await ctx.stdout.writeText(targetPath + "\n");

  async function getEntries(path: string): Promise<{ name: string; path: string; isDir: boolean }[]> {
    const cached = entriesCache.get(path);
    if (cached) return cached;

    let entries = await ctx.fs.readdir(path);

    // Filter hidden files unless -a
    if (!showAll) {
      entries = entries.filter((e) => !e.startsWith("."));
    }

    // Filter by -I ignore patterns
    if (ignorePatterns.length > 0) {
      entries = entries.filter((e) => !ignorePatterns.some((p) => matchGlob(p, e)));
    }

    // Sort entries
    entries.sort();

    const resolvedEntries: { name: string; path: string; isDir: boolean }[] = [];

    for (const name of entries) {
      const entryPath = ctx.fs.resolve(path, name);
      try {
        const entryStat = await ctx.fs.stat(entryPath);
        resolvedEntries.push({ name, path: entryPath, isDir: entryStat.isDirectory() });
      } catch {
        // Skip entries we can't stat
      }
    }

    entriesCache.set(path, resolvedEntries);
    return resolvedEntries;
  }

  async function hasVisibleContent(path: string): Promise<boolean> {
    const cached = visibleContentCache.get(path);
    if (cached !== undefined) return cached;

    const entries = await getEntries(path);

    for (const entry of entries) {
      if (!entry.isDir) {
        visibleContentCache.set(path, true);
        return true;
      }

      if (await hasVisibleContent(entry.path)) {
        visibleContentCache.set(path, true);
        return true;
      }
    }

    visibleContentCache.set(path, false);
    return false;
  }

  // Recursive function to build tree
  async function printTree(path: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    const entries = await getEntries(path);

    // Separate dirs and files, dirs first
    const dirEntries: { name: string; path: string; isDir: boolean }[] = [];
    const fileEntries: { name: string; path: string; isDir: boolean }[] = [];

    for (const entry of entries) {
      if (entry.isDir) {
        if (prune && !(await hasVisibleContent(entry.path))) {
          continue;
        }
        dirEntries.push(entry);
      } else {
        fileEntries.push(entry);
      }
    }

    // Combine: directories first, then files (unless directoriesOnly)
    const sortedEntries = directoriesOnly
      ? dirEntries
      : [...dirEntries, ...fileEntries];

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i]!;
      const isLast = i === sortedEntries.length - 1;
      const connector = isLast ? "└── " : "├── ";

      await ctx.stdout.writeText(prefix + connector + entry.name + "\n");

      if (entry.isDir) {
        dirCount++;
        if (depth < maxDepth) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          await printTree(entry.path, newPrefix, depth + 1);
        }
      } else {
        fileCount++;
      }
    }
  }

  await printTree(resolvedPath, "", 1);

  if (!noReport) {
    // Print summary
    const dirWord = dirCount === 1 ? "directory" : "directories";
    const fileWord = fileCount === 1 ? "file" : "files";
    await ctx.stdout.writeText(`\n${dirCount} ${dirWord}, ${fileCount} ${fileWord}\n`);
  }

  return 0;
};
