import type { Command } from "../src/types.ts";

export const tree: Command = async (ctx) => {
  let showAll = false;
  let directoriesOnly = false;
  let maxDepth = Infinity;
  let targetPath = ".";

  // Parse arguments
  const args = [...ctx.args];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-a" || arg === "--all") {
      showAll = true;
    } else if (arg === "-d") {
      directoriesOnly = true;
    } else if (arg === "-L") {
      const depthArg = args[++i];
      if (depthArg === undefined || isNaN(parseInt(depthArg, 10))) {
        await ctx.stderr.writeText("tree: missing argument to -L\n");
        return 1;
      }
      maxDepth = parseInt(depthArg, 10);
      if (maxDepth < 1) {
        await ctx.stderr.writeText("tree: Invalid level, must be greater than 0\n");
        return 1;
      }
    } else if (arg.startsWith("-L")) {
      // Handle -L2 format (no space)
      const depthStr = arg.slice(2);
      const depth = parseInt(depthStr, 10);
      if (isNaN(depth) || depth < 1) {
        await ctx.stderr.writeText("tree: Invalid level, must be greater than 0\n");
        return 1;
      }
      maxDepth = depth;
    } else if (arg.startsWith("-") && arg !== "-") {
      // Handle combined short flags
      for (const flag of arg.slice(1)) {
        if (flag === "a") showAll = true;
        else if (flag === "d") directoriesOnly = true;
        else {
          await ctx.stderr.writeText(`tree: Invalid argument -${flag}\n`);
          return 1;
        }
      }
    } else {
      targetPath = arg;
    }
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
