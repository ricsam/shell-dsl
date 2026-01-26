import type { Command } from "../../types.ts";

export const echo: Command = async (ctx) => {
  let output = ctx.args.join(" ");
  let newline = true;

  // Handle -n flag (no newline)
  if (ctx.args[0] === "-n") {
    newline = false;
    output = ctx.args.slice(1).join(" ");
  }

  if (newline) {
    output += "\n";
  }

  await ctx.stdout.writeText(output);
  return 0;
};
