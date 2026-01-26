import type { Command } from "../src/types.ts";

export const tee: Command = async (ctx) => {
  let append = false;
  const files: string[] = [];

  for (const arg of ctx.args) {
    if (arg === "-a" || arg === "--append") {
      append = true;
    } else if (!arg.startsWith("-")) {
      files.push(arg);
    }
  }

  // Read all stdin content
  const content = await ctx.stdin.buffer();

  // Write to stdout
  await ctx.stdout.write(new Uint8Array(content));

  // Write to each file
  for (const file of files) {
    const path = ctx.fs.resolve(ctx.cwd, file);
    try {
      if (append) {
        await ctx.fs.appendFile(path, content);
      } else {
        await ctx.fs.writeFile(path, content);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`tee: ${file}: ${message}\n`);
      return 1;
    }
  }

  return 0;
};
