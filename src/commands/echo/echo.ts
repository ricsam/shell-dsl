import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface EchoFlags {
  noNewline: boolean;
}

const spec = {
  name: "echo",
  flags: [
    { short: "n" },
  ] as FlagDefinition[],
  usage: "echo [-n] [string ...]",
  stopAfterFirstPositional: true,
};

const defaults: EchoFlags = { noNewline: false };

const handler = (flags: EchoFlags, flag: FlagDefinition) => {
  if (flag.short === "n") flags.noNewline = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const echo: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  let output = result.args.join(" ");

  if (!result.flags.noNewline) {
    output += "\n";
  }

  await ctx.stdout.writeText(output);
  return 0;
};
