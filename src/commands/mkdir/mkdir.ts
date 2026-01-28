import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface MkdirFlags {
  parents: boolean;
}

const spec = {
  name: "mkdir",
  flags: [
    { short: "p", long: "parents" },
  ] as FlagDefinition[],
  usage: "mkdir [-p] directory ...",
};

const defaults: MkdirFlags = { parents: false };

const handler = (flags: MkdirFlags, flag: FlagDefinition) => {
  if (flag.short === "p") flags.parents = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const mkdir: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const dirs = result.args;

  if (dirs.length === 0) {
    await ctx.stderr.writeText("mkdir: missing operand\n");
    return 1;
  }

  for (const dir of dirs) {
    const path = ctx.fs.resolve(ctx.cwd, dir);
    try {
      await ctx.fs.mkdir(path, { recursive: result.flags.parents });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`mkdir: cannot create directory '${dir}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};
