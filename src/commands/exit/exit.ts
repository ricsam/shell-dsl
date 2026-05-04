import type { Command } from "../../types.ts";

function parseExitCode(value: string): number | null {
  if (!/^[+-]?\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

export const exitCmd: Command = async (ctx) => {
  if (!ctx.shell) {
    await ctx.stderr.writeText("exit: shell control not supported\n");
    return 1;
  }

  if (ctx.args.length === 0) {
    ctx.shell.exit(ctx.shell.getLastExitCode());
    return 0;
  }

  const rawExitCode = ctx.args[0]!;
  const exitCode = parseExitCode(rawExitCode);
  if (exitCode === null) {
    await ctx.stderr.writeText(`exit: ${rawExitCode}: numeric argument required\n`);
    ctx.shell.exit(2);
    return 0;
  }

  if (!Number.isFinite(exitCode)) {
    await ctx.stderr.writeText(`exit: ${rawExitCode}: numeric argument required\n`);
    ctx.shell.exit(2);
    return 0;
  }

  if (ctx.args.length > 1) {
    await ctx.stderr.writeText("exit: too many arguments\n");
    return 1;
  }

  ctx.shell.exit(exitCode);
  return 0;
};
