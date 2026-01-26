import type { Command } from "../src/types.ts";

export const tail: Command = async (ctx) => {
  let numLines = 10;
  const files: string[] = [];

  // Parse arguments
  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i]!;
    if (arg === "-n" && ctx.args[i + 1]) {
      numLines = parseInt(ctx.args[i + 1]!, 10);
      i++;
    } else if (arg.startsWith("-n")) {
      numLines = parseInt(arg.slice(2), 10);
    } else if (arg.startsWith("-") && /^\d+$/.test(arg.slice(1))) {
      numLines = parseInt(arg.slice(1), 10);
    } else if (!arg.startsWith("-")) {
      files.push(arg);
    }
  }

  if (isNaN(numLines) || numLines < 0) {
    await ctx.stderr.writeText("tail: invalid number of lines\n");
    return 1;
  }

  const outputLines = async (content: string) => {
    const lines = content.split("\n");
    // Remove trailing empty line if present
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    const toOutput = lines.slice(-numLines);
    for (const line of toOutput) {
      await ctx.stdout.writeText(line + "\n");
    }
  };

  if (files.length === 0) {
    // Read from stdin
    const content = await ctx.stdin.text();
    await outputLines(content);
  } else {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        if (files.length > 1) {
          if (i > 0) await ctx.stdout.writeText("\n");
          await ctx.stdout.writeText(`==> ${file} <==\n`);
        }
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = (await ctx.fs.readFile(path)).toString();
        await outputLines(content);
      } catch (err) {
        await ctx.stderr.writeText(`tail: ${file}: No such file or directory\n`);
        return 1;
      }
    }
  }

  return 0;
};
