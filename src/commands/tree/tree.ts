import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface TreeFlags {
  all: boolean;
  directoriesOnly: boolean;
  maxDepth: number;
}

const spec = {
  name: "tree",
  flags: [
    { short: "a", long: "all" },
    { short: "d" },
    { short: "L", takesValue: true },
  ] as FlagDefinition[],
  usage: "tree [-ad] [-L level] [directory ...]",
};

const defaults: TreeFlags = { all: false, directoriesOnly: false, maxDepth: Infinity };

interface HandlerResult {
  error?: string;
}

let handlerResult: HandlerResult = {};

const handler = (flags: TreeFlags, flag: FlagDefinition, value?: string) => {
  if (flag.short === "a") flags.all = true;
  if (flag.short === "d") flags.directoriesOnly = true;
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

  const { all: showAll, directoriesOnly, maxDepth } = result.flags;
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
    await ctx.stdout.writeText(targetPath + "\n\n0 directories, 1 file\n");
    return 0;
  }

  let dirCount = 0;
  let fileCount = 0;

  // Print root
  await ctx.stdout.writeText(targetPath + "\n");

  // Recursive function to build tree
  async function printTree(path: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries = await ctx.fs.readdir(path);

    // Filter hidden files unless -a
    if (!showAll) {
      entries = entries.filter((e) => !e.startsWith("."));
    }

    // Sort entries
    entries.sort();

    // Separate dirs and files, dirs first
    const dirEntries: string[] = [];
    const fileEntries: string[] = [];

    for (const entry of entries) {
      const entryPath = ctx.fs.resolve(path, entry);
      try {
        const entryStat = await ctx.fs.stat(entryPath);
        if (entryStat.isDirectory()) {
          dirEntries.push(entry);
        } else {
          fileEntries.push(entry);
        }
      } catch {
        // Skip entries we can't stat
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
      const entryPath = ctx.fs.resolve(path, entry);

      let isDir = false;
      try {
        const entryStat = await ctx.fs.stat(entryPath);
        isDir = entryStat.isDirectory();
      } catch {
        continue;
      }

      await ctx.stdout.writeText(prefix + connector + entry + "\n");

      if (isDir) {
        dirCount++;
        if (depth < maxDepth) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          await printTree(entryPath, newPrefix, depth + 1);
        }
      } else {
        fileCount++;
      }
    }
  }

  await printTree(resolvedPath, "", 1);

  // Print summary
  const dirWord = dirCount === 1 ? "directory" : "directories";
  const fileWord = fileCount === 1 ? "file" : "files";
  await ctx.stdout.writeText(`\n${dirCount} ${dirWord}, ${fileCount} ${fileWord}\n`);

  return 0;
};
