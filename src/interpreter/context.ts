import type { CommandContext, VirtualFS, Stdin, Stdout, Stderr } from "../types.ts";

export interface ContextOptions {
  args: string[];
  stdin: Stdin;
  stdout: Stdout;
  stderr: Stderr;
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
}

export function createCommandContext(options: ContextOptions): CommandContext {
  return {
    args: options.args,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    fs: options.fs,
    cwd: options.cwd,
    env: options.env,
  };
}
