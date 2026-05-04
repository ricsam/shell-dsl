import type {
  Command,
  ExecResult,
  ShellCommandFallback,
  ShellConfig,
  ShellExecution,
  ShellExecutionOptions,
  TerminalInfo,
  VirtualFS,
} from "./types.ts";
import type { Program } from "./shell-dsl.ts";
import { Lexer } from "./lexer/lexer.ts";
import { Parser } from "./parser/parser.ts";
import { Interpreter } from "./interpreter/interpreter.ts";
import { createStderr, createStdout } from "./io/stdout.ts";
import { AsyncQueue } from "./io/async-queue.ts";
import type { ShellOutputEvent } from "./types.ts";

export interface ShellSessionOptions {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
  isTTY?: boolean;
  terminal?: TerminalInfo;
  externalCommand?: ShellCommandFallback;
}

export class ShellSession {
  private interpreter: Interpreter;

  constructor(options: ShellSessionOptions) {
    this.interpreter = new Interpreter({
      fs: options.fs,
      cwd: options.cwd,
      env: options.env,
      commands: options.commands,
      terminal: options.terminal ?? { isTTY: options.isTTY ?? false },
      externalCommand: options.externalCommand,
    });
  }

  run(source: string, options: ShellExecutionOptions = {}): ShellExecution {
    try {
      const tokens = new Lexer(source, { preserveNewlines: true }).tokenize();
      if (tokens.every((token) => token.type === "newline" || token.type === "eof")) {
        return this.createImmediateExecution(0, "", "");
      }
      const ast = new Parser(tokens).parse();
      return this.interpreter.executeStreaming(ast, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.createImmediateExecution(2, "", `sh: ${message}\n`);
    }
  }

  runProgram(program: Program, options: ShellExecutionOptions = {}): ShellExecution {
    return this.interpreter.executeStreaming(program.ast, options);
  }

  getCwd(): string {
    return this.interpreter.getCwd();
  }

  getEnv(): Record<string, string> {
    return this.interpreter.getEnv();
  }

  getLastExitCode(): number {
    return this.interpreter.getLastExitCode();
  }

  async dispose(): Promise<void> {
    // Reserved for future resources owned by a session.
  }

  private createImmediateExecution(exitCode: number, stdoutText: string, stderrText: string): ShellExecution {
    const stdout = createStdout();
    const stderr = createStderr();
    const output = new AsyncQueue<ShellOutputEvent>();

    const exit = (async (): Promise<ExecResult> => {
      if (stdoutText.length > 0) {
        const chunk = new TextEncoder().encode(stdoutText);
        output.push({ fd: 1, chunk });
        await stdout.write(chunk);
      }
      if (stderrText.length > 0) {
        const chunk = new TextEncoder().encode(stderrText);
        output.push({ fd: 2, chunk });
        await stderr.write(chunk);
      }
      stdout.close();
      stderr.close();
      output.close();
      return {
        stdout: await stdout.collect(),
        stderr: await stderr.collect(),
        exitCode,
      };
    })();

    return {
      stdout: stdout.getReadableStream(),
      stderr: stderr.getReadableStream(),
      output,
      exit,
      kill: () => {},
    };
  }
}

export function createShellSession(config: ShellConfig): ShellSession {
  return new ShellSession(config);
}
