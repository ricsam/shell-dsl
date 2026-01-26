import type { Command } from "../src/types.ts";
import { BreakException, ContinueException } from "../src/interpreter/interpreter.ts";

export const breakCmd: Command = async (ctx) => {
  const levels = ctx.args[0] ? parseInt(ctx.args[0], 10) : 1;
  if (isNaN(levels) || levels < 1) {
    await ctx.stderr.writeText("break: invalid level\n");
    return 1;
  }
  throw new BreakException(levels);
};

export const continueCmd: Command = async (ctx) => {
  const levels = ctx.args[0] ? parseInt(ctx.args[0], 10) : 1;
  if (isNaN(levels) || levels < 1) {
    await ctx.stderr.writeText("continue: invalid level\n");
    return 1;
  }
  throw new ContinueException(levels);
};
