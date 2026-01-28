import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface MvFlags {
  noClobber: boolean;
}

const spec = {
  name: "mv",
  flags: [
    { short: "n", long: "no-clobber" },
    { short: "f", long: "force" },
  ] as FlagDefinition[],
  usage: "mv [-nf] source ... dest",
};

const defaults: MvFlags = { noClobber: false };

const handler = (flags: MvFlags, flag: FlagDefinition) => {
  if (flag.short === "n") flags.noClobber = true;
  // -f is default behavior, so we don't need to do anything
};

const parser = createFlagParser(spec, defaults, handler);

export const mv: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { noClobber } = result.flags;
  const paths = result.args;

  if (paths.length < 2) {
    await ctx.stderr.writeText("mv: missing destination file operand\n");
    return 1;
  }

  const sources = paths.slice(0, -1);
  const dest = paths[paths.length - 1]!;
  const destPath = ctx.fs.resolve(ctx.cwd, dest);

  // Check if destination is a directory
  let destIsDir = false;
  try {
    const stat = await ctx.fs.stat(destPath);
    destIsDir = stat.isDirectory();
  } catch {
    // Destination doesn't exist
  }

  // If multiple sources, dest must be a directory
  if (sources.length > 1 && !destIsDir) {
    await ctx.stderr.writeText(`mv: target '${dest}' is not a directory\n`);
    return 1;
  }

  for (const source of sources) {
    const srcPath = ctx.fs.resolve(ctx.cwd, source);

    try {
      // Check source exists
      await ctx.fs.stat(srcPath);

      // Determine final destination path
      const finalDest = destIsDir
        ? ctx.fs.resolve(destPath, ctx.fs.basename(srcPath))
        : destPath;

      // Check if dest exists and noClobber
      if (noClobber) {
        const exists = await ctx.fs.exists(finalDest);
        if (exists) continue; // Skip silently
      }

      // Move: copy then delete
      const srcStat = await ctx.fs.stat(srcPath);
      if (srcStat.isDirectory()) {
        await moveDirectory(ctx, srcPath, finalDest, noClobber);
      } else {
        const content = await ctx.fs.readFile(srcPath);
        await ctx.fs.writeFile(finalDest, content);
        await ctx.fs.rm(srcPath);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`mv: cannot stat '${source}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};

async function moveDirectory(
  ctx: Parameters<Command>[0],
  src: string,
  dest: string,
  noClobber: boolean
): Promise<void> {
  // Create destination directory
  await ctx.fs.mkdir(dest, { recursive: true });

  // Read source directory contents
  const entries = await ctx.fs.readdir(src);

  for (const entry of entries) {
    const srcPath = ctx.fs.resolve(src, entry);
    const destPath = ctx.fs.resolve(dest, entry);

    const stat = await ctx.fs.stat(srcPath);

    if (stat.isDirectory()) {
      await moveDirectory(ctx, srcPath, destPath, noClobber);
    } else {
      if (noClobber) {
        const exists = await ctx.fs.exists(destPath);
        if (exists) continue;
      }
      const content = await ctx.fs.readFile(srcPath);
      await ctx.fs.writeFile(destPath, content);
    }
  }

  // Remove source directory after copying
  await ctx.fs.rm(src, { recursive: true });
}
