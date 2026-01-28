import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface TailFlags {
  lines: number;
}

const spec = {
  name: "tail",
  flags: [
    { short: "n", long: "lines", takesValue: true },
  ] as FlagDefinition[],
  usage: "tail [-n lines] [file ...]",
};

const defaults: TailFlags = { lines: 10 };

const handler = (flags: TailFlags, flag: FlagDefinition, value?: string) => {
  if (flag.short === "n" && value) {
    flags.lines = parseInt(value, 10);
  }
};

const parser = createFlagParser(spec, defaults, handler);

export const tail: Command = async (ctx) => {
  // Pre-process args to handle legacy -N format (e.g., -5 means -n 5)
  const processedArgs: string[] = [];
  for (const arg of ctx.args) {
    if (arg.startsWith("-") && /^-\d+$/.test(arg)) {
      processedArgs.push("-n", arg.slice(1));
    } else {
      processedArgs.push(arg);
    }
  }

  const result = parser.parse(processedArgs);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const numLines = result.flags.lines;
  const files = result.args;

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
