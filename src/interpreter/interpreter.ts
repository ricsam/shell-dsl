import type { ASTNode, CommandNode, Redirect } from "../parser/ast.ts";
import type { Command, VirtualFS, ExecResult, OutputCollector } from "../types.ts";
import { createCommandContext } from "./context.ts";
import { createStdin } from "../io/stdin.ts";
import { createStdout, createStderr, createPipe, PipeBuffer } from "../io/stdout.ts";
import { Lexer } from "../lexer/lexer.ts";
import { Parser } from "../parser/parser.ts";

export interface InterpreterOptions {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
}

export class Interpreter {
  private fs: VirtualFS;
  private cwd: string;
  private env: Record<string, string>;
  private commands: Record<string, Command>;

  constructor(options: InterpreterOptions) {
    this.fs = options.fs;
    this.cwd = options.cwd;
    this.env = { ...options.env };
    this.commands = options.commands;
  }

  async execute(ast: ASTNode): Promise<ExecResult> {
    const stdout = createStdout();
    const stderr = createStderr();

    const exitCode = await this.executeNode(ast, null, stdout, stderr);

    stdout.close();
    stderr.close();

    return {
      stdout: await stdout.collect(),
      stderr: await stderr.collect(),
      exitCode,
    };
  }

  private async executeNode(
    node: ASTNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    switch (node.type) {
      case "command":
        return this.executeCommand(node, stdinSource, stdout, stderr);
      case "pipeline":
        return this.executePipeline(node.commands, stdinSource, stdout, stderr);
      case "sequence":
        return this.executeSequence(node.commands, stdinSource, stdout, stderr);
      case "and":
        return this.executeAnd(node.left, node.right, stdinSource, stdout, stderr);
      case "or":
        return this.executeOr(node.left, node.right, stdinSource, stdout, stderr);
      default:
        throw new Error(`Cannot execute node type: ${node.type}`);
    }
  }

  private async executeCommand(
    node: CommandNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    // Create local env with assignments
    const localEnv = { ...this.env };
    for (const assignment of node.assignments) {
      localEnv[assignment.name] = await this.evaluateNode(assignment.value);
    }

    // If there's no command name but there are assignments, just update env
    const name = await this.evaluateNode(node.name);
    if (name === "" && node.assignments.length > 0) {
      for (const assignment of node.assignments) {
        this.env[assignment.name] = await this.evaluateNode(assignment.value);
      }
      return 0;
    }

    // Evaluate arguments
    const args: string[] = [];
    for (const arg of node.args) {
      const evaluated = await this.evaluateNode(arg);
      // Glob expansion returns multiple values
      if (arg.type === "glob") {
        const matches = await this.fs.glob(evaluated, { cwd: this.cwd });
        if (matches.length > 0) {
          args.push(...matches);
        } else {
          // No matches - use pattern as-is
          args.push(evaluated);
        }
      } else {
        args.push(evaluated);
      }
    }

    // Handle redirects
    let actualStdin = stdinSource;
    let actualStdout: OutputCollector = stdout;
    let actualStderr: OutputCollector = stderr;
    let stderrToStdout = false;
    let stdoutToStderr = false;
    const fileWritePromises: Promise<void>[] = [];

    for (const redirect of node.redirects) {
      const result = await this.handleRedirect(
        redirect,
        actualStdin,
        actualStdout,
        actualStderr
      );
      actualStdin = result.stdin;
      actualStdout = result.stdout;
      actualStderr = result.stderr;
      stderrToStdout = result.stderrToStdout || stderrToStdout;
      stdoutToStderr = result.stdoutToStderr || stdoutToStderr;
      if (result.fileWritePromise) {
        fileWritePromises.push(result.fileWritePromise);
      }
    }

    // Handle stderr->stdout redirect
    if (stderrToStdout) {
      actualStderr = actualStdout;
    }
    if (stdoutToStderr) {
      actualStdout = actualStderr;
    }

    // Look up command
    const command = this.commands[name];
    if (!command) {
      await stderr.writeText(`${name}: command not found\n`);
      return 127;
    }

    // Create context and execute
    const ctx = createCommandContext({
      args,
      stdin: createStdin(actualStdin),
      stdout: actualStdout,
      stderr: actualStderr,
      fs: this.fs,
      cwd: this.cwd,
      env: localEnv,
    });

    let exitCode: number;
    try {
      exitCode = await command(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stderr.writeText(`${name}: ${message}\n`);
      exitCode = 1;
    }

    // Close redirect collectors and wait for file writes
    if (actualStdout !== stdout) {
      actualStdout.close();
    }
    if (actualStderr !== stderr && actualStderr !== actualStdout) {
      actualStderr.close();
    }

    // Wait for all file write operations to complete
    await Promise.all(fileWritePromises);

    return exitCode;
  }

  private async handleRedirect(
    redirect: Redirect,
    stdin: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<{
    stdin: AsyncIterable<Uint8Array> | null;
    stdout: OutputCollector;
    stderr: OutputCollector;
    stderrToStdout?: boolean;
    stdoutToStderr?: boolean;
    fileWritePromise?: Promise<void>;
  }> {
    const target = await this.evaluateNode(redirect.target);

    switch (redirect.mode) {
      case "<": {
        // Input redirect
        const path = this.fs.resolve(this.cwd, target);
        const content = await this.fs.readFile(path);
        return {
          stdin: (async function* () {
            yield new Uint8Array(content);
          })(),
          stdout,
          stderr,
        };
      }
      case ">": {
        // Output redirect (overwrite)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStdout();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout: collector, stderr, fileWritePromise };
      }
      case ">>": {
        // Output redirect (append)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStdout();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.appendFile(path, data);
        })();
        return { stdin, stdout: collector, stderr, fileWritePromise };
      }
      case "2>": {
        // Stderr redirect (overwrite)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStderr();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout, stderr: collector, fileWritePromise };
      }
      case "2>>": {
        // Stderr redirect (append)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStderr();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.appendFile(path, data);
        })();
        return { stdin, stdout, stderr: collector, fileWritePromise };
      }
      case "&>": {
        // Both to file (overwrite)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStdout();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout: collector, stderr: collector, fileWritePromise };
      }
      case "&>>": {
        // Both to file (append)
        const path = this.fs.resolve(this.cwd, target);
        const collector = createStdout();
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.appendFile(path, data);
        })();
        return { stdin, stdout: collector, stderr: collector, fileWritePromise };
      }
      case "2>&1":
        return { stdin, stdout, stderr, stderrToStdout: true };
      case "1>&2":
        return { stdin, stdout, stderr, stdoutToStderr: true };
      default:
        return { stdin, stdout, stderr };
    }
  }

  private async executePipeline(
    commands: ASTNode[],
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    if (commands.length === 0) return 0;
    if (commands.length === 1) {
      return this.executeNode(commands[0]!, stdinSource, stdout, stderr);
    }

    // Create pipes between commands
    const pipes: PipeBuffer[] = [];
    for (let i = 0; i < commands.length - 1; i++) {
      pipes.push(createPipe());
    }

    // Execute all commands concurrently
    const promises: Promise<number>[] = [];

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]!;
      const cmdStdin = i === 0 ? stdinSource : pipes[i - 1]!.getReadableStream();
      const cmdStdout = i === commands.length - 1 ? stdout : pipes[i]!;

      promises.push(
        this.executeNode(command, cmdStdin, cmdStdout, stderr).then((code) => {
          // Close pipe when command finishes
          if (i < commands.length - 1) {
            pipes[i]!.close();
          }
          return code;
        })
      );
    }

    // Wait for all commands and return last exit code
    const results = await Promise.all(promises);
    return results[results.length - 1]!;
  }

  private async executeSequence(
    commands: ASTNode[],
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    let lastExitCode = 0;

    for (const command of commands) {
      lastExitCode = await this.executeNode(command, stdinSource, stdout, stderr);
    }

    return lastExitCode;
  }

  private async executeAnd(
    left: ASTNode,
    right: ASTNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    const leftCode = await this.executeNode(left, stdinSource, stdout, stderr);
    if (leftCode !== 0) {
      return leftCode;
    }
    return this.executeNode(right, stdinSource, stdout, stderr);
  }

  private async executeOr(
    left: ASTNode,
    right: ASTNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    const leftCode = await this.executeNode(left, stdinSource, stdout, stderr);
    if (leftCode === 0) {
      return 0;
    }
    return this.executeNode(right, stdinSource, stdout, stderr);
  }

  private async evaluateNode(node: ASTNode): Promise<string> {
    switch (node.type) {
      case "literal":
        return node.value;
      case "variable":
        return this.env[node.name] ?? "";
      case "glob":
        return node.pattern;
      case "concat": {
        const parts = await Promise.all(node.parts.map((p) => this.evaluateNode(p)));
        return parts.join("");
      }
      case "substitution": {
        // Execute the command and capture output
        const subStdout = createStdout();
        const subStderr = createStderr();
        await this.executeNode(node.command, null, subStdout, subStderr);
        subStdout.close();
        const output = await subStdout.collect();
        // Trim trailing newlines
        return output.toString("utf-8").replace(/\n+$/, "");
      }
      default:
        throw new Error(`Cannot evaluate node type: ${node.type}`);
    }
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  setEnv(vars: Record<string, string>): void {
    Object.assign(this.env, vars);
  }

  getCwd(): string {
    return this.cwd;
  }

  getEnv(): Record<string, string> {
    return { ...this.env };
  }
}
