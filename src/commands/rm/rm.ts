import type { Command } from "../../types.ts";

export const rm: Command = async (ctx) => {
  let recursive = false;
  let force = false;
  const targets: string[] = [];

  for (const arg of ctx.args) {
    if (arg === "-r" || arg === "-R" || arg === "--recursive") {
      recursive = true;
    } else if (arg === "-f" || arg === "--force") {
      force = true;
    } else if (arg === "-rf" || arg === "-fr") {
      recursive = true;
      force = true;
    } else if (arg.startsWith("-")) {
      for (const flag of arg.slice(1)) {
        if (flag === "r" || flag === "R") recursive = true;
        else if (flag === "f") force = true;
      }
    } else {
      targets.push(arg);
    }
  }

  if (targets.length === 0) {
    if (!force) {
      await ctx.stderr.writeText("rm: missing operand\n");
      return 1;
    }
    return 0;
  }

  for (const target of targets) {
    const path = ctx.fs.resolve(ctx.cwd, target);
    try {
      await ctx.fs.rm(path, { recursive, force });
    } catch (err) {
      if (!force) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`rm: cannot remove '${target}': ${message}\n`);
        return 1;
      }
    }
  }

  return 0;
};
