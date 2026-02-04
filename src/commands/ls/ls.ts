import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface LsFlags {
  all: boolean;
  long: boolean;
  onePerLine: boolean;
  recursive: boolean;
}

const spec = {
  name: "ls",
  flags: [
    { short: "a", long: "all" },
    { short: "l" },
    { short: "1" },
    { short: "R" },
  ] as FlagDefinition[],
  usage: "ls [-alR1] [file ...]",
};

const defaults: LsFlags = { all: false, long: false, onePerLine: false, recursive: false };

const handler = (flags: LsFlags, flag: FlagDefinition) => {
  if (flag.short === "a") flags.all = true;
  if (flag.short === "l") flags.long = true;
  if (flag.short === "1") flags.onePerLine = true;
  if (flag.short === "R") flags.recursive = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const ls: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { all: showAll, long: longFormat, onePerLine, recursive } = result.flags;
  const paths = result.args.length === 0 ? ["."] : result.args;
  let needsBlankLine = false;

  const listDir = async (dirPath: string, displayPath: string, showHeader: boolean) => {
    if (needsBlankLine) await ctx.stdout.writeText("\n");
    needsBlankLine = true;

    if (showHeader) {
      await ctx.stdout.writeText(`${displayPath}:\n`);
    }

    let entries = await ctx.fs.readdir(dirPath);

    if (!showAll) {
      entries = entries.filter((e) => !e.startsWith("."));
    }

    entries.sort();

    if (longFormat) {
      for (const entry of entries) {
        const entryPath = ctx.fs.resolve(dirPath, entry);
        try {
          const entryStat = await ctx.fs.stat(entryPath);
          const type = entryStat.isDirectory() ? "d" : "-";
          const perms = "rwxr-xr-x";
          const size = String(entryStat.size).padStart(8);
          const date = entryStat.mtime.toISOString().slice(0, 10);
          await ctx.stdout.writeText(`${type}${perms} ${size} ${date} ${entry}\n`);
        } catch {
          await ctx.stdout.writeText(`?????????? ${entry}\n`);
        }
      }
    } else if (onePerLine || !ctx.stdout.isTTY) {
      for (const entry of entries) {
        await ctx.stdout.writeText(entry + "\n");
      }
    } else {
      if (entries.length > 0) {
        await ctx.stdout.writeText(entries.join("  ") + "\n");
      }
    }

    if (recursive) {
      for (const entry of entries) {
        const entryPath = ctx.fs.resolve(dirPath, entry);
        try {
          const entryStat = await ctx.fs.stat(entryPath);
          if (entryStat.isDirectory()) {
            const subDisplay = displayPath === "." ? entry : `${displayPath}/${entry}`;
            await listDir(entryPath, subDisplay, true);
          }
        } catch {
          // skip entries we can't stat
        }
      }
    }
  };

  for (let i = 0; i < paths.length; i++) {
    const pathArg = paths[i]!;
    const path = ctx.fs.resolve(ctx.cwd, pathArg);

    try {
      const stat = await ctx.fs.stat(path);

      if (stat.isFile()) {
        await ctx.stdout.writeText(ctx.fs.basename(path) + "\n");
        continue;
      }

      const showHeader = recursive || paths.length > 1;
      await listDir(path, pathArg, showHeader);
    } catch (err) {
      await ctx.stderr.writeText(`ls: cannot access '${pathArg}': No such file or directory\n`);
      return 1;
    }
  }

  return 0;
};
