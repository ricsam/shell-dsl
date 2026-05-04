import type {
  Command,
  CommandCompleter,
  CompletionResult,
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
  completions?: Record<string, CommandCompleter>;
  isTTY?: boolean;
  terminal?: TerminalInfo;
  externalCommand?: ShellCommandFallback;
}

export class ShellSession {
  private fs: VirtualFS;
  private commands: Record<string, Command>;
  private completions: Record<string, CommandCompleter>;
  private terminal: TerminalInfo;
  private interpreter: Interpreter;

  constructor(options: ShellSessionOptions) {
    this.fs = options.fs;
    this.commands = options.commands;
    this.completions = options.completions ?? {};
    this.terminal = options.terminal ?? { isTTY: options.isTTY ?? false };
    this.interpreter = new Interpreter({
      fs: options.fs,
      cwd: options.cwd,
      env: options.env,
      commands: options.commands,
      terminal: this.terminal,
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

  async complete(source: string, cursor: number = source.length): Promise<CompletionResult> {
    const boundedCursor = Math.max(0, Math.min(cursor, source.length));
    const prefix = source.slice(0, boundedCursor);
    const { word, start } = getCurrentWord(prefix);

    if (isCommandPosition(prefix, start) && !looksLikePath(word)) {
      return {
        replacement: word,
        matches: Object.keys(this.commands)
          .filter((name) => name.startsWith(word))
          .sort()
          .map((name) => `${name} `),
      };
    }

    const commandLine = getCurrentCommandLine(prefix, start);
    const [command = "", ...args] = splitCompletionWords(commandLine);
    const completer = command === "" ? undefined : this.completions[command];
    if (completer) {
      return completer({
        source,
        cursor: boundedCursor,
        command,
        args,
        word,
        wordStart: start,
        wordEnd: boundedCursor,
        cwd: this.getCwd(),
        env: this.getEnv(),
        fs: this.fs,
        terminal: this.terminal,
      });
    }

    return this.completePath(word);
  }

  async dispose(): Promise<void> {
    // Reserved for future resources owned by a session.
  }

  private async completePath(word: string): Promise<CompletionResult> {
    const slash = word.lastIndexOf("/");
    const dirPart = slash === -1 ? "" : word.slice(0, slash + 1);
    const namePrefix = slash === -1 ? word : word.slice(slash + 1);
    const basePath = dirPart === ""
      ? this.getCwd()
      : dirPart.startsWith("/")
        ? dirPart
        : this.fs.resolve(this.getCwd(), dirPart);

    let entries: string[];
    try {
      entries = await this.fs.readdir(basePath);
    } catch {
      return { replacement: word, matches: [] };
    }

    const matches = await Promise.all(
      entries
        .filter((entry) => entry.startsWith(namePrefix))
        .sort()
        .map(async (entry) => {
          const candidate = `${dirPart}${escapeCompletionSegment(entry)}`;
          const path = this.fs.resolve(basePath, entry);
          try {
            const stat = await this.fs.stat(path);
            return stat.isDirectory() ? `${candidate}/` : candidate;
          } catch {
            return candidate;
          }
        })
    );

    if (matches.length === 1 && !matches[0]!.endsWith("/")) {
      matches[0] = `${matches[0]} `;
    }

    return { replacement: word, matches };
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

function getCurrentWord(prefix: string): { word: string; start: number } {
  let start = prefix.length;
  while (start > 0 && !/\s/.test(prefix[start - 1]!)) {
    start--;
  }
  return { word: prefix.slice(start), start };
}

function isCommandPosition(prefix: string, wordStart: number): boolean {
  const beforeWord = prefix.slice(0, wordStart);
  const segmentStart = Math.max(
    beforeWord.lastIndexOf(";"),
    beforeWord.lastIndexOf("|"),
    beforeWord.lastIndexOf("&")
  );
  const segment = beforeWord.slice(segmentStart + 1).trim();
  if (segment === "") {
    return true;
  }
  return segment.split(/\s+/).every((part) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(part));
}

function getCurrentCommandLine(prefix: string, wordStart: number): string {
  const beforeWord = prefix.slice(0, wordStart);
  const segmentStart = Math.max(
    beforeWord.lastIndexOf(";"),
    beforeWord.lastIndexOf("|"),
    beforeWord.lastIndexOf("&")
  );
  return prefix.slice(segmentStart + 1).trimStart();
}

function splitCompletionWords(source: string): string[] {
  return source.trim().split(/\s+/).filter(Boolean);
}

function looksLikePath(word: string): boolean {
  return word.startsWith("/") || word.startsWith(".") || word.includes("/");
}

function escapeCompletionSegment(segment: string): string {
  return segment.replace(/([\s\\'"$`!#&;|<>()[\]{}*?])/g, "\\$1");
}
