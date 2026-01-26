import type { Command } from "../../types.ts";

export const touch: Command = async (ctx) => {
  let noCreate = false;
  const files: string[] = [];

  for (const arg of ctx.args) {
    if (arg === "-c" || arg === "--no-create") {
      noCreate = true;
    } else if (!arg.startsWith("-")) {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    await ctx.stderr.writeText("touch: missing file operand\n");
    return 1;
  }

  for (const file of files) {
    const path = ctx.fs.resolve(ctx.cwd, file);
    try {
      const exists = await ctx.fs.exists(path);
      if (exists) {
        // Update mtime by reading and writing back
        const content = await ctx.fs.readFile(path);
        await ctx.fs.writeFile(path, content);
      } else if (!noCreate) {
        // Create empty file
        await ctx.fs.writeFile(path, "");
      }
      // If noCreate and doesn't exist, skip silently
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`touch: cannot touch '${file}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};
