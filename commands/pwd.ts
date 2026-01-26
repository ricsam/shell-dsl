import type { Command } from "../src/types.ts";

export const pwd: Command = async (ctx) => {
  await ctx.stdout.writeText(ctx.cwd + "\n");
  return 0;
};
