import type { Command } from "../../types.ts";
import { expandEscapes } from "../../utils/expand-escapes.ts";

interface EchoFlags {
  noNewline: boolean;
  interpretEscapes: boolean;
}

const defaults: EchoFlags = { noNewline: false, interpretEscapes: false };

function isEchoOption(arg: string): boolean {
  if (!arg.startsWith("-") || arg === "-") {
    return false;
  }

  for (const char of arg.slice(1)) {
    if (char !== "n" && char !== "e" && char !== "E") {
      return false;
    }
  }

  return true;
}

function parseEchoArgs(args: string[]): { flags: EchoFlags; args: string[] } {
  const flags = { ...defaults };
  let index = 0;

  // Match common shell echo behavior: only leading -n/-e/-E clusters are
  // treated as options. Anything else, including "--" and "--invalid", is
  // printed literally.
  while (index < args.length && isEchoOption(args[index]!)) {
    for (const char of args[index]!.slice(1)) {
      if (char === "n") flags.noNewline = true;
      if (char === "e") flags.interpretEscapes = true;
      if (char === "E") flags.interpretEscapes = false;
    }
    index++;
  }

  return { flags, args: args.slice(index) };
}

export const echo: Command = async (ctx) => {
  const result = parseEchoArgs(ctx.args);

  let output = result.args.join(" ");

  if (result.flags.interpretEscapes) {
    output = expandEscapes(output);
  }

  if (!result.flags.noNewline) {
    output += "\n";
  }

  await ctx.stdout.writeText(output);
  return 0;
};
