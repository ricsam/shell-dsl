import type { Command } from "../src/types.ts";

export const ls: Command = async (ctx) => {
  let showAll = false;
  let longFormat = false;
  let onePerLine = false;
  const paths: string[] = [];

  // Parse arguments
  for (const arg of ctx.args) {
    if (arg === "-a" || arg === "--all") {
      showAll = true;
    } else if (arg === "-l") {
      longFormat = true;
    } else if (arg === "-1") {
      onePerLine = true;
    } else if (arg.startsWith("-")) {
      for (const flag of arg.slice(1)) {
        if (flag === "a") showAll = true;
        else if (flag === "l") longFormat = true;
        else if (flag === "1") onePerLine = true;
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    paths.push(".");
  }

  for (let i = 0; i < paths.length; i++) {
    const pathArg = paths[i]!;
    const path = ctx.fs.resolve(ctx.cwd, pathArg);

    try {
      const stat = await ctx.fs.stat(path);

      if (stat.isFile()) {
        // It's a file, just print the name
        await ctx.stdout.writeText(ctx.fs.basename(path) + "\n");
        continue;
      }

      // It's a directory
      if (paths.length > 1) {
        if (i > 0) await ctx.stdout.writeText("\n");
        await ctx.stdout.writeText(`${pathArg}:\n`);
      }

      let entries = await ctx.fs.readdir(path);

      if (!showAll) {
        entries = entries.filter((e) => !e.startsWith("."));
      }

      entries.sort();

      if (longFormat) {
        for (const entry of entries) {
          const entryPath = ctx.fs.resolve(path, entry);
          try {
            const entryStat = await ctx.fs.stat(entryPath);
            const type = entryStat.isDirectory() ? "d" : "-";
            const perms = "rwxr-xr-x"; // Simplified permissions
            const size = String(entryStat.size).padStart(8);
            const date = entryStat.mtime.toISOString().slice(0, 10);
            await ctx.stdout.writeText(`${type}${perms} ${size} ${date} ${entry}\n`);
          } catch {
            await ctx.stdout.writeText(`?????????? ${entry}\n`);
          }
        }
      } else if (onePerLine) {
        for (const entry of entries) {
          await ctx.stdout.writeText(entry + "\n");
        }
      } else {
        // Default: space-separated
        await ctx.stdout.writeText(entries.join("  ") + "\n");
      }
    } catch (err) {
      await ctx.stderr.writeText(`ls: cannot access '${pathArg}': No such file or directory\n`);
      return 1;
    }
  }

  return 0;
};
