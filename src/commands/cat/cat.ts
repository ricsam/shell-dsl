import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

const spec = {
  name: "cat",
  flags: [] as FlagDefinition[],
  usage: "cat [file ...]",
};

const parser = createFlagParser(spec, {}, () => {});

export const cat: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const files = result.args;

  if (files.length === 0) {
    // Read from stdin
    for await (const chunk of ctx.stdin.stream()) {
      await ctx.stdout.write(chunk);
    }
  } else {
    // Read from files
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        await ctx.stdout.write(new Uint8Array(content));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`cat: ${file}: ${message}\n`);
        return 1;
      }
    }
  }
  return 0;
};
