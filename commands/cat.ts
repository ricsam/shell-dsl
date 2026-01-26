import type { Command } from "../src/types.ts";

export const cat: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    // Read from stdin
    for await (const chunk of ctx.stdin.stream()) {
      await ctx.stdout.write(chunk);
    }
  } else {
    // Read from files
    for (const file of ctx.args) {
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
