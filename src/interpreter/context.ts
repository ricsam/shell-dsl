import type { CommandContext, VirtualFS, Stdin, Stdout, Stderr, ExecResult } from "../types.ts";

export interface ContextOptions {
  args: string[];
  stdin: Stdin;
  stdout: Stdout;
  stderr: Stderr;
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  setCwd: (path: string) => void;
  exec?: (name: string, args: string[]) => Promise<ExecResult>;
}

export function createCommandContext(options: ContextOptions): CommandContext {
  const ctx: CommandContext = {
    args: options.args,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    fs: options.fs,
    cwd: options.cwd,
    env: options.env,
    setCwd: options.setCwd,
  };
  if (options.exec) {
    ctx.exec = options.exec;
  }
  return ctx;
}
