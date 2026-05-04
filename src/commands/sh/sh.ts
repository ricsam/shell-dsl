import type { Command, Stderr, VirtualFS } from "../../types.ts";

async function readShellFile(
  fs: VirtualFS,
  cwd: string,
  pathName: string,
  stderr: Stderr
): Promise<{ ok: true; source: string } | { ok: false; exitCode: number }> {
  const path = fs.resolve(cwd, pathName);

  if (!(await fs.exists(path))) {
    await stderr.writeText(`sh: ${pathName}: No such file or directory\n`);
    return { ok: false, exitCode: 127 };
  }

  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    await stderr.writeText(`sh: ${pathName}: is a directory\n`);
    return { ok: false, exitCode: 126 };
  }
  if (!stat.isFile()) {
    await stderr.writeText(`sh: ${pathName}: not a file\n`);
    return { ok: false, exitCode: 126 };
  }

  try {
    return { ok: true, source: await fs.readFile(path, "utf-8") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stderr.writeText(`sh: ${pathName}: ${message}\n`);
    return { ok: false, exitCode: 126 };
  }
}

export const sh: Command = async (ctx) => {
  if (!ctx.shell) {
    await ctx.stderr.writeText("sh: shell evaluation not supported\n");
    return 1;
  }

  if (ctx.args.length === 0) {
    return ctx.shell.runShell(await ctx.stdin.text(), { argv0: "sh", args: [] });
  }

  const first = ctx.args[0]!;
  if (first === "-c") {
    const source = ctx.args[1];
    if (source === undefined) {
      await ctx.stderr.writeText("sh: -c requires an argument\n");
      return 2;
    }

    const argv0 = ctx.args[2] ?? "sh";
    const args = ctx.args[2] === undefined ? [] : ctx.args.slice(3);
    return ctx.shell.runShell(source, { argv0, args });
  }

  if (first.startsWith("-")) {
    await ctx.stderr.writeText(`sh: unsupported option: ${first}\n`);
    return 2;
  }

  const loaded = await readShellFile(ctx.fs, ctx.cwd, first, ctx.stderr);
  if (!loaded.ok) {
    return loaded.exitCode;
  }

  return ctx.shell.runShell(loaded.source, { argv0: first, args: ctx.args.slice(1) });
};

export const evalCmd: Command = async (ctx) => {
  if (!ctx.shell) {
    await ctx.stderr.writeText("eval: shell evaluation not supported\n");
    return 1;
  }
  if (ctx.args.length === 0) {
    return 0;
  }
  return ctx.shell.eval(ctx.args.join(" "));
};

export const source: Command = async (ctx) => {
  if (!ctx.shell) {
    await ctx.stderr.writeText("source: shell evaluation not supported\n");
    return 1;
  }
  const path = ctx.args[0];
  if (path === undefined) {
    await ctx.stderr.writeText("source: filename argument required\n");
    return 2;
  }
  return ctx.shell.source(path, ctx.args.slice(1));
};

export const dot = source;
