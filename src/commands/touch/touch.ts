import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface TouchFlags {
  noCreate: boolean;
}

const spec = {
  name: "touch",
  flags: [
    { short: "c", long: "no-create" },
  ] as FlagDefinition[],
  usage: "touch [-c] file ...",
};

const defaults: TouchFlags = { noCreate: false };

const handler = (flags: TouchFlags, flag: FlagDefinition) => {
  if (flag.short === "c") flags.noCreate = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const touch: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const files = result.args;

  if (files.length === 0) {
    await ctx.stderr.writeText("touch: missing file operand\n");
    return 1;
  }

  for (const file of files) {
    const path = ctx.fs.resolve(ctx.cwd, file);
    try {
      const exists = await ctx.fs.exists(path);
      if (exists) {
        // Update mtime by reading and writing back
        const content = await ctx.fs.readFile(path);
        await ctx.fs.writeFile(path, content);
      } else if (!result.flags.noCreate) {
        // Create empty file
        await ctx.fs.writeFile(path, "");
      }
      // If noCreate and doesn't exist, skip silently
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`touch: cannot touch '${file}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};
