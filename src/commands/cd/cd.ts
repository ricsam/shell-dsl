import type { Command } from "../../types.ts";

export const cd: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    return 0;
  }

  let target = ctx.args[0]!;

  if (target === "-") {
    const oldpwd = ctx.env.OLDPWD;
    if (!oldpwd) {
      await ctx.stderr.writeText("cd: OLDPWD not set\n");
      return 1;
    }
    target = oldpwd;
  }

  const resolved = ctx.fs.resolve(ctx.cwd, target);

  try {
    const stat = await ctx.fs.stat(resolved);
    if (!stat.isDirectory()) {
      await ctx.stderr.writeText(`cd: not a directory: ${target}\n`);
      return 1;
    }
  } catch {
    await ctx.stderr.writeText(`cd: not a directory: ${target}\n`);
    return 1;
  }

  ctx.setCwd(resolved);

  return 0;
};
