import type { Command } from "../src/types.ts";

export const sort: Command = async (ctx) => {
  let reverse = false;
  let numeric = false;
  let unique = false;
  const files: string[] = [];

  // Parse arguments
  for (const arg of ctx.args) {
    if (arg === "-r") {
      reverse = true;
    } else if (arg === "-n") {
      numeric = true;
    } else if (arg === "-u") {
      unique = true;
    } else if (arg.startsWith("-")) {
      for (const flag of arg.slice(1)) {
        if (flag === "r") reverse = true;
        else if (flag === "n") numeric = true;
        else if (flag === "u") unique = true;
      }
    } else {
      files.push(arg);
    }
  }

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
