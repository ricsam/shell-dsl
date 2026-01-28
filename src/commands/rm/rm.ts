import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface RmFlags {
  recursive: boolean;
  force: boolean;
}

const spec = {
  name: "rm",
  flags: [
    { short: "r", long: "recursive" },
    { short: "R" },
    { short: "f", long: "force" },
  ] as FlagDefinition[],
  usage: "rm [-rf] file ...",
};

const defaults: RmFlags = { recursive: false, force: false };

const handler = (flags: RmFlags, flag: FlagDefinition) => {
  if (flag.short === "r" || flag.short === "R") flags.recursive = true;
  if (flag.short === "f") flags.force = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const rm: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { recursive, force } = result.flags;
  const targets = result.args;

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
