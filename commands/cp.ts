import type { Command } from "../src/types.ts";

export const cp: Command = async (ctx) => {
  let recursive = false;
  let noClobber = false;
  const paths: string[] = [];

  for (const arg of ctx.args) {
    if (arg === "-r" || arg === "-R" || arg === "--recursive") {
      recursive = true;
    } else if (arg === "-n" || arg === "--no-clobber") {
      noClobber = true;
    } else if (arg === "-f" || arg === "--force") {
      // Force is default behavior, just accept the flag
    } else if (arg.startsWith("-")) {
      // Parse combined flags like -rn
      for (const flag of arg.slice(1)) {
        if (flag === "r" || flag === "R") recursive = true;
        else if (flag === "n") noClobber = true;
        else if (flag === "f") { /* force is default */ }
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length < 2) {
    await ctx.stderr.writeText("cp: missing destination file operand\n");
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
    await ctx.stderr.writeText(`cp: target '${dest}' is not a directory\n`);
    return 1;
  }

  for (const source of sources) {
    const srcPath = ctx.fs.resolve(ctx.cwd, source);

    try {
      const srcStat = await ctx.fs.stat(srcPath);

      if (srcStat.isDirectory()) {
        if (!recursive) {
          await ctx.stderr.writeText(`cp: -r not specified; omitting directory '${source}'\n`);
          return 1;
        }
        // Copy directory recursively
        const finalDest = destIsDir
          ? ctx.fs.resolve(destPath, ctx.fs.basename(srcPath))
          : destPath;

        await copyDirectory(ctx, srcPath, finalDest, noClobber);
      } else {
        // Copy file
        const finalDest = destIsDir
          ? ctx.fs.resolve(destPath, ctx.fs.basename(srcPath))
          : destPath;

        // Check if dest exists and noClobber
        if (noClobber) {
          const exists = await ctx.fs.exists(finalDest);
          if (exists) continue; // Skip silently
        }

        const content = await ctx.fs.readFile(srcPath);
        await ctx.fs.writeFile(finalDest, content);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.stderr.writeText(`cp: cannot stat '${source}': ${message}\n`);
      return 1;
    }
  }

  return 0;
};

async function copyDirectory(
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
      await copyDirectory(ctx, srcPath, destPath, noClobber);
    } else {
      if (noClobber) {
        const exists = await ctx.fs.exists(destPath);
        if (exists) continue;
      }
      const content = await ctx.fs.readFile(srcPath);
      await ctx.fs.writeFile(destPath, content);
    }
  }
}
