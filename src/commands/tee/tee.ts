import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface TeeFlags {
  append: boolean;
}

const spec = {
  name: "tee",
  flags: [
    { short: "a", long: "append" },
  ] as FlagDefinition[],
  usage: "tee [-a] [file ...]",
};

const defaults: TeeFlags = { append: false };

const handler = (flags: TeeFlags, flag: FlagDefinition) => {
  if (flag.short === "a") flags.append = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const tee: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const files = result.args;

  // Read all stdin content
  const content = await ctx.stdin.buffer();

  // Write to stdout
  await ctx.stdout.write(new Uint8Array(content));

  // Write to each file
  for (const file of files) {
    const path = ctx.fs.resolve(ctx.cwd, file);
    try {
      if (result.flags.append) {
        await ctx.fs.appendFile(path, content);
      } else {
        await ctx.fs.writeFile(path, content);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`tee: ${file}: ${message}\n`);
      return 1;
    }
  }

  return 0;
};
