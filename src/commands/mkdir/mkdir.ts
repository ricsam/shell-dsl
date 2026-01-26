import type { Command } from "../../types.ts";

export const mkdir: Command = async (ctx) => {
  let parents = false;
  const dirs: string[] = [];

  for (const arg of ctx.args) {
    if (arg === "-p" || arg === "--parents") {
      parents = true;
    } else if (!arg.startsWith("-")) {
      dirs.push(arg);
    }
  }

  if (dirs.length === 0) {
    await ctx.stderr.writeText("mkdir: missing operand\n");
    return 1;
  }

  for (const dir of dirs) {
    const path = ctx.fs.resolve(ctx.cwd, dir);
    try {
      await ctx.fs.mkdir(path, { recursive: parents });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`mkdir: cannot create directory '${dir}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};
