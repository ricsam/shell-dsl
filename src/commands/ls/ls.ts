import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface LsFlags {
  all: boolean;
  long: boolean;
  onePerLine: boolean;
  recursive: boolean;
  humanReadable: boolean;
}

const spec = {
  name: "ls",
  flags: [
    { short: "a", long: "all" },
    { short: "l" },
    { short: "h" },
    { short: "1" },
    { short: "R" },
  ] as FlagDefinition[],
  usage: "ls [-alhR1] [file ...]",
};

const defaults: LsFlags = { all: false, long: false, onePerLine: false, recursive: false, humanReadable: false };

const handler = (flags: LsFlags, flag: FlagDefinition) => {
  if (flag.short === "a") flags.all = true;
  if (flag.short === "l") flags.long = true;
  if (flag.short === "h") flags.humanReadable = true;
  if (flag.short === "1") flags.onePerLine = true;
  if (flag.short === "R") flags.recursive = true;
};

const parser = createFlagParser(spec, defaults, handler);

const BOLD_BLUE = "\x1b[1;34m";
const RESET = "\x1b[0m";

function formatSize(bytes: number, humanReadable: boolean): string {
  if (!humanReadable) return String(bytes).padStart(8);
  if (bytes < 1024) return String(bytes).padStart(8);
  const units = ["K", "M", "G", "T"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted = value < 10 ? value.toFixed(1) : String(Math.floor(value));
  return (formatted + units[unitIndex]!).padStart(8);
}

function colorize(name: string, isDirectory: boolean, isTTY: boolean): string {
  if (!isTTY || !isDirectory) return name;
  return `${BOLD_BLUE}${name}${RESET}`;
}

export const ls: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { all: showAll, long: longFormat, onePerLine, recursive, humanReadable } = result.flags;
  const isTTY = ctx.stdout.isTTY;
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
          const isDir = entryStat.isDirectory();
          const type = isDir ? "d" : "-";
          const perms = "rwxr-xr-x";
          const size = formatSize(entryStat.size, humanReadable);
          const date = entryStat.mtime.toISOString().slice(0, 10);
          const name = colorize(entry, isDir, isTTY);
          await ctx.stdout.writeText(`${type}${perms} ${size} ${date} ${name}\n`);
        } catch {
          await ctx.stdout.writeText(`?????????? ${entry}\n`);
        }
      }
    } else if (onePerLine || !isTTY) {
      if (isTTY) {
        // -1 flag with TTY: still colorize directories
        const dirSet = new Set<string>();
        for (const entry of entries) {
          try {
            const entryStat = await ctx.fs.stat(ctx.fs.resolve(dirPath, entry));
            if (entryStat.isDirectory()) dirSet.add(entry);
          } catch {}
        }
        for (const entry of entries) {
          await ctx.stdout.writeText(colorize(entry, dirSet.has(entry), true) + "\n");
        }
      } else {
        for (const entry of entries) {
          await ctx.stdout.writeText(entry + "\n");
        }
      }
    } else {
      // TTY default: space-separated with colors
      if (entries.length > 0) {
        const dirSet = new Set<string>();
        for (const entry of entries) {
          try {
            const entryStat = await ctx.fs.stat(ctx.fs.resolve(dirPath, entry));
            if (entryStat.isDirectory()) dirSet.add(entry);
          } catch {}
        }
        const colored = entries.map((e) => colorize(e, dirSet.has(e), true));
        await ctx.stdout.writeText(colored.join("  ") + "\n");
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
