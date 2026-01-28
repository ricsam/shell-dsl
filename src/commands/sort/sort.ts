import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface SortFlags {
  reverse: boolean;
  numeric: boolean;
  unique: boolean;
}

const spec = {
  name: "sort",
  flags: [
    { short: "r", long: "reverse" },
    { short: "n", long: "numeric-sort" },
    { short: "u", long: "unique" },
  ] as FlagDefinition[],
  usage: "sort [-rnu] [file ...]",
};

const defaults: SortFlags = { reverse: false, numeric: false, unique: false };

const handler = (flags: SortFlags, flag: FlagDefinition) => {
  if (flag.short === "r") flags.reverse = true;
  if (flag.short === "n") flags.numeric = true;
  if (flag.short === "u") flags.unique = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const sort: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { reverse, numeric, unique } = result.flags;
  const files = result.args;

  let allLines: string[] = [];

  if (files.length === 0) {
    // Read from stdin
    for await (const line of ctx.stdin.lines()) {
      allLines.push(line);
    }
  } else {
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = (await ctx.fs.readFile(path)).toString();
        const lines = content.split("\n");
        if (lines[lines.length - 1] === "") {
          lines.pop();
        }
        allLines.push(...lines);
      } catch (err) {
        await ctx.stderr.writeText(`sort: ${file}: No such file or directory\n`);
        return 1;
      }
    }
  }

  // Sort
  if (numeric) {
    allLines.sort((a, b) => {
      const numA = parseFloat(a) || 0;
      const numB = parseFloat(b) || 0;
      return numA - numB;
    });
  } else {
    allLines.sort();
  }

  if (reverse) {
    allLines.reverse();
  }

  if (unique) {
    allLines = [...new Set(allLines)];
  }

  for (const line of allLines) {
    await ctx.stdout.writeText(line + "\n");
  }

  return 0;
};
