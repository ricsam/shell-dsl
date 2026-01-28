import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface UniqFlags {
  count: boolean;
  duplicates: boolean;
  unique: boolean;
}

const spec = {
  name: "uniq",
  flags: [
    { short: "c", long: "count" },
    { short: "d", long: "repeated" },
    { short: "u", long: "unique" },
  ] as FlagDefinition[],
  usage: "uniq [-cdu] [input [output]]",
};

const defaults: UniqFlags = { count: false, duplicates: false, unique: false };

const handler = (flags: UniqFlags, flag: FlagDefinition) => {
  if (flag.short === "c") flags.count = true;
  if (flag.short === "d") flags.duplicates = true;
  if (flag.short === "u") flags.unique = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const uniq: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { count: countMode, duplicates: duplicatesOnly, unique: uniqueOnly } = result.flags;
  const files = result.args;

  let lines: string[] = [];

  if (files.length === 0) {
    for await (const line of ctx.stdin.lines()) {
      lines.push(line);
    }
  } else {
    const file = files[0]!;
    try {
      const path = ctx.fs.resolve(ctx.cwd, file);
      const content = (await ctx.fs.readFile(path)).toString();
      lines = content.split("\n");
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
    } catch (err) {
      await ctx.stderr.writeText(`uniq: ${file}: No such file or directory\n`);
      return 1;
    }
  }

  // Process lines
  const results: Array<{ line: string; count: number }> = [];
  let currentLine: string | null = null;
  let currentCount = 0;

  for (const line of lines) {
    if (line === currentLine) {
      currentCount++;
    } else {
      if (currentLine !== null) {
        results.push({ line: currentLine, count: currentCount });
      }
      currentLine = line;
      currentCount = 1;
    }
  }
  if (currentLine !== null) {
    results.push({ line: currentLine, count: currentCount });
  }

  // Output
  for (const { line, count } of results) {
    const isDuplicate = count > 1;
    const isUnique = count === 1;

    if (duplicatesOnly && !isDuplicate) continue;
    if (uniqueOnly && !isUnique) continue;

    if (countMode) {
      await ctx.stdout.writeText(`${String(count).padStart(7)} ${line}\n`);
    } else {
      await ctx.stdout.writeText(line + "\n");
    }
  }

  return 0;
};
