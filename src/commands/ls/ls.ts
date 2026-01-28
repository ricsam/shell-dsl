import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface LsFlags {
  all: boolean;
  long: boolean;
  onePerLine: boolean;
}

const spec = {
  name: "ls",
  flags: [
    { short: "a", long: "all" },
    { short: "l" },
    { short: "1" },
  ] as FlagDefinition[],
  usage: "ls [-al1] [file ...]",
};

const defaults: LsFlags = { all: false, long: false, onePerLine: false };

const handler = (flags: LsFlags, flag: FlagDefinition) => {
  if (flag.short === "a") flags.all = true;
  if (flag.short === "l") flags.long = true;
  if (flag.short === "1") flags.onePerLine = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const ls: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { all: showAll, long: longFormat, onePerLine } = result.flags;
  const paths = result.args.length === 0 ? ["."] : result.args;

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
