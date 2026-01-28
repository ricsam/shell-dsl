import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

const spec = {
  name: "pwd",
  flags: [] as FlagDefinition[],
  usage: "pwd",
};

const parser = createFlagParser(spec, {}, () => {});

export const pwd: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  await ctx.stdout.writeText(ctx.cwd + "\n");
  return 0;
};
