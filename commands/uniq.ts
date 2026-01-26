import type { Command } from "../src/types.ts";

export const uniq: Command = async (ctx) => {
  let countMode = false;
  let duplicatesOnly = false;
  let uniqueOnly = false;
  const files: string[] = [];

  // Parse arguments
  for (const arg of ctx.args) {
    if (arg === "-c") {
      countMode = true;
    } else if (arg === "-d") {
      duplicatesOnly = true;
    } else if (arg === "-u") {
      uniqueOnly = true;
    } else if (arg.startsWith("-")) {
      for (const flag of arg.slice(1)) {
        if (flag === "c") countMode = true;
        else if (flag === "d") duplicatesOnly = true;
        else if (flag === "u") uniqueOnly = true;
      }
    } else {
      files.push(arg);
    }
  }

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
