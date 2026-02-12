import type { ASTNode, CommandNode, Redirect, IfNode, ForNode, WhileNode, UntilNode, CaseNode } from "../parser/ast.ts";
import type { Command, VirtualFS, ExecResult, OutputCollector, RedirectObjectMap } from "../types.ts";
import { createCommandContext } from "./context.ts";
import { createStdin } from "../io/stdin.ts";
import { createStdout, createStderr, createPipe, PipeBuffer, createBufferTargetCollector } from "../io/stdout.ts";
import { Lexer } from "../lexer/lexer.ts";
import { Parser } from "../parser/parser.ts";

export interface InterpreterOptions {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
  redirectObjects?: RedirectObjectMap;
  isTTY?: boolean;
}

// Loop control flow exceptions
export class BreakException extends Error {
  constructor(public levels: number = 1) {
    super("break");
  }
}

export class ContinueException extends Error {
  constructor(public levels: number = 1) {
    super("continue");
  }
}

export class Interpreter {
  private fs: VirtualFS;
  private cwd: string;
  private env: Record<string, string>;
  private commands: Record<string, Command>;
  private redirectObjects: RedirectObjectMap;
  private loopDepth: number = 0;
  private isTTY: boolean;

  constructor(options: InterpreterOptions) {
    this.fs = options.fs;
    this.cwd = options.cwd;
    this.env = { ...options.env };
    this.commands = options.commands;
    this.redirectObjects = options.redirectObjects ?? {};
    this.isTTY = options.isTTY ?? false;
  }

  getLoopDepth(): number {
    return this.loopDepth;
  }

  async execute(ast: ASTNode): Promise<ExecResult> {
    const stdout = createStdout(this.isTTY);
    const stderr = createStderr(this.isTTY);

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
      case "if":
        return this.executeIf(node, stdinSource, stdout, stderr);
      case "for":
        return this.executeFor(node, stdinSource, stdout, stderr);
      case "while":
        return this.executeWhile(node, stdinSource, stdout, stderr);
      case "until":
        return this.executeUntil(node, stdinSource, stdout, stderr);
      case "case":
        return this.executeCase(node, stdinSource, stdout, stderr);
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

    // Evaluate arguments using localEnv for scoped variable expansion
    const args: string[] = [];
    for (const arg of node.args) {
      const evaluated = await this.evaluateNode(arg, localEnv);
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
      try {
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
      } catch (err) {
        const target = await this.evaluateNode(redirect.target);
        const message = err instanceof Error ? err.message : String(err);
        await stderr.writeText(`sh: ${target}: ${message}\n`);
        return 1;
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

    // Create exec closure for sub-command invocation
    const exec = async (cmdName: string, cmdArgs: string[]) => {
      const cmd = this.commands[cmdName];
      if (!cmd) {
        return {
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(`${cmdName}: command not found\n`),
          exitCode: 127,
        };
      }
      const subStdout = createStdout();
      const subStderr = createStderr();
      const subCtx = createCommandContext({
        args: cmdArgs,
        stdin: createStdin(null),
        stdout: subStdout,
        stderr: subStderr,
        fs: this.fs,
        cwd: this.cwd,
        env: { ...localEnv },
        setCwd: (path: string) => this.setCwd(path),
        exec,
      });
      let exitCode: number;
      try {
        exitCode = await cmd(subCtx);
      } catch (err) {
        if (err instanceof BreakException || err instanceof ContinueException) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        await subStderr.writeText(`${cmdName}: ${message}\n`);
        exitCode = 1;
      }
      subStdout.close();
      subStderr.close();
      return {
        stdout: await subStdout.collect(),
        stderr: await subStderr.collect(),
        exitCode,
      };
    };

    // Create context and execute
    const ctx = createCommandContext({
      args,
      stdin: createStdin(actualStdin),
      stdout: actualStdout,
      stderr: actualStderr,
      fs: this.fs,
      cwd: this.cwd,
      env: localEnv,
      setCwd: (path: string) => this.setCwd(path),
      exec,
    });

    let exitCode: number;
    try {
      exitCode = await command(ctx);
    } catch (err) {
      // Re-throw loop control exceptions
      if (err instanceof BreakException || err instanceof ContinueException) {
        throw err;
      }
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
    try {
      await Promise.all(fileWritePromises);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Find the redirect target for the error message
      const writeRedirects = node.redirects.filter(r => r.mode !== "<" && r.mode !== "2>&1" && r.mode !== "1>&2");
      const target = writeRedirects.length > 0
        ? await this.evaluateNode(writeRedirects[writeRedirects.length - 1]!.target)
        : "unknown";
      await stderr.writeText(`sh: ${target}: ${message}\n`);
      exitCode = 1;
    }

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

    // Check if target is a redirect object marker
    if (target in this.redirectObjects) {
      return this.handleObjectRedirect(redirect.mode, this.redirectObjects[target]!, stdin, stdout, stderr);
    }

    switch (redirect.mode) {
      case "<": {
        if (redirect.heredocContent) {
          // Heredoc: target is already the content
          return {
            stdin: (async function* () {
              yield new TextEncoder().encode(target);
            })(),
            stdout,
            stderr,
          };
        }
        // /dev/null: empty input
        if (target === "/dev/null") {
          return {
            stdin: (async function* () {})(),
            stdout,
            stderr,
          };
        }
        // Input redirect from file
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
        const collector = createStdout();
        if (target === "/dev/null") {
          return { stdin, stdout: collector, stderr };
        }
        const path = this.fs.resolve(this.cwd, target);
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout: collector, stderr, fileWritePromise };
      }
      case ">>": {
        // Output redirect (append)
        const collector = createStdout();
        if (target === "/dev/null") {
          return { stdin, stdout: collector, stderr };
        }
        const path = this.fs.resolve(this.cwd, target);
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.appendFile(path, data);
        })();
        return { stdin, stdout: collector, stderr, fileWritePromise };
      }
      case "2>": {
        // Stderr redirect (overwrite)
        const collector = createStderr();
        if (target === "/dev/null") {
          return { stdin, stdout, stderr: collector };
        }
        const path = this.fs.resolve(this.cwd, target);
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout, stderr: collector, fileWritePromise };
      }
      case "2>>": {
        // Stderr redirect (append)
        const collector = createStderr();
        if (target === "/dev/null") {
          return { stdin, stdout, stderr: collector };
        }
        const path = this.fs.resolve(this.cwd, target);
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.appendFile(path, data);
        })();
        return { stdin, stdout, stderr: collector, fileWritePromise };
      }
      case "&>": {
        // Both to file (overwrite)
        const collector = createStdout();
        if (target === "/dev/null") {
          return { stdin, stdout: collector, stderr: collector };
        }
        const path = this.fs.resolve(this.cwd, target);
        const fileWritePromise = (async () => {
          const data = await collector.collect();
          await this.fs.writeFile(path, data);
        })();
        return { stdin, stdout: collector, stderr: collector, fileWritePromise };
      }
      case "&>>": {
        // Both to file (append)
        const collector = createStdout();
        if (target === "/dev/null") {
          return { stdin, stdout: collector, stderr: collector };
        }
        const path = this.fs.resolve(this.cwd, target);
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

  private async handleObjectRedirect(
    mode: string,
    obj: Buffer | Blob | Response | string,
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
    switch (mode) {
      case "<": {
        // Input from object
        const data = await this.readFromObject(obj);
        return {
          stdin: (async function* () {
            yield data;
          })(),
          stdout,
          stderr,
        };
      }
      case ">":
      case ">>": {
        // Output to object (only Buffer supported)
        if (!Buffer.isBuffer(obj)) {
          throw new Error("Output redirection only supports Buffer targets");
        }
        const collector = createBufferTargetCollector(obj);
        return { stdin, stdout: collector, stderr };
      }
      case "2>":
      case "2>>": {
        // Stderr to object (only Buffer supported)
        if (!Buffer.isBuffer(obj)) {
          throw new Error("Stderr redirection only supports Buffer targets");
        }
        const collector = createBufferTargetCollector(obj);
        return { stdin, stdout, stderr: collector };
      }
      case "&>":
      case "&>>": {
        // Both to object (only Buffer supported)
        if (!Buffer.isBuffer(obj)) {
          throw new Error("Combined redirection only supports Buffer targets");
        }
        const collector = createBufferTargetCollector(obj);
        return { stdin, stdout: collector, stderr: collector };
      }
      default:
        return { stdin, stdout, stderr };
    }
  }

  private async readFromObject(obj: Buffer | Blob | Response | string): Promise<Uint8Array> {
    if (Buffer.isBuffer(obj)) {
      return new Uint8Array(obj);
    }
    if (obj instanceof Blob) {
      return new Uint8Array(await obj.arrayBuffer());
    }
    if (obj instanceof Response) {
      return new Uint8Array(await obj.arrayBuffer());
    }
    if (typeof obj === "string") {
      return new TextEncoder().encode(obj);
    }
    throw new Error("Unsupported redirect object type");
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

  private async executeIf(
    node: IfNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    // Execute condition
    const conditionCode = await this.executeNode(node.condition, stdinSource, stdout, stderr);

    if (conditionCode === 0) {
      // Condition succeeded, execute then branch
      return this.executeNode(node.thenBranch, stdinSource, stdout, stderr);
    }

    // Check elif branches
    for (const elif of node.elifBranches) {
      const elifConditionCode = await this.executeNode(elif.condition, stdinSource, stdout, stderr);
      if (elifConditionCode === 0) {
        return this.executeNode(elif.body, stdinSource, stdout, stderr);
      }
    }

    // Execute else branch if present
    if (node.elseBranch) {
      return this.executeNode(node.elseBranch, stdinSource, stdout, stderr);
    }

    return 0;
  }

  private async executeFor(
    node: ForNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    // Evaluate items and expand globs
    const expandedItems: string[] = [];
    for (const item of node.items) {
      const evaluated = await this.evaluateNode(item);
      if (item.type === "glob") {
        const matches = await this.fs.glob(evaluated, { cwd: this.cwd });
        if (matches.length > 0) {
          expandedItems.push(...matches);
        } else {
          expandedItems.push(evaluated);
        }
      } else {
        expandedItems.push(evaluated);
      }
    }

    // If no items provided, use positional parameters (not implemented, so empty)
    if (expandedItems.length === 0) {
      return 0;
    }

    let lastExitCode = 0;
    this.loopDepth++;

    try {
      for (const value of expandedItems) {
        // Set the loop variable
        this.env[node.variable] = value;

        try {
          lastExitCode = await this.executeNode(node.body, stdinSource, stdout, stderr);
        } catch (e) {
          if (e instanceof ContinueException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            continue;
          }
          if (e instanceof BreakException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            break;
          }
          throw e;
        }
      }
    } finally {
      this.loopDepth--;
    }

    return lastExitCode;
  }

  private async executeWhile(
    node: WhileNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    let lastExitCode = 0;
    this.loopDepth++;

    try {
      while (true) {
        // Check condition
        const conditionCode = await this.executeNode(node.condition, stdinSource, stdout, stderr);
        if (conditionCode !== 0) {
          break;
        }

        try {
          lastExitCode = await this.executeNode(node.body, stdinSource, stdout, stderr);
        } catch (e) {
          if (e instanceof ContinueException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            continue;
          }
          if (e instanceof BreakException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            break;
          }
          throw e;
        }
      }
    } finally {
      this.loopDepth--;
    }

    return lastExitCode;
  }

  private async executeUntil(
    node: UntilNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    let lastExitCode = 0;
    this.loopDepth++;

    try {
      while (true) {
        // Check condition - loop until condition succeeds
        const conditionCode = await this.executeNode(node.condition, stdinSource, stdout, stderr);
        if (conditionCode === 0) {
          break;
        }

        try {
          lastExitCode = await this.executeNode(node.body, stdinSource, stdout, stderr);
        } catch (e) {
          if (e instanceof ContinueException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            continue;
          }
          if (e instanceof BreakException) {
            if (e.levels > 1) {
              e.levels--;
              throw e;
            }
            break;
          }
          throw e;
        }
      }
    } finally {
      this.loopDepth--;
    }

    return lastExitCode;
  }

  private async executeCase(
    node: CaseNode,
    stdinSource: AsyncIterable<Uint8Array> | null,
    stdout: OutputCollector,
    stderr: OutputCollector
  ): Promise<number> {
    const word = await this.evaluateNode(node.word);

    for (const clause of node.clauses) {
      for (const patternNode of clause.patterns) {
        const pattern = await this.evaluateNode(patternNode);

        if (this.matchCasePattern(word, pattern)) {
          return this.executeNode(clause.body, stdinSource, stdout, stderr);
        }
      }
    }

    return 0;
  }

  private matchCasePattern(word: string, pattern: string): boolean {
    // Convert shell glob pattern to regex
    // * matches any string, ? matches any single character
    let regexStr = "^";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "*") {
        regexStr += ".*";
      } else if (char === "?") {
        regexStr += ".";
      } else if (char === "[") {
        // Character class - find closing bracket
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== "]") {
          j++;
        }
        if (j < pattern.length) {
          regexStr += pattern.slice(i, j + 1);
          i = j;
        } else {
          regexStr += "\\[";
        }
      } else if (/[.+^${}()|\\]/.test(char!)) {
        // Escape regex special characters
        regexStr += "\\" + char;
      } else {
        regexStr += char;
      }
    }
    regexStr += "$";

    try {
      const regex = new RegExp(regexStr);
      return regex.test(word);
    } catch {
      // If regex fails, fall back to exact match
      return word === pattern;
    }
  }

  private async evaluateNode(node: ASTNode, localEnv?: Record<string, string>): Promise<string> {
    const env = localEnv ?? this.env;
    switch (node.type) {
      case "literal":
        return node.value;
      case "variable":
        return env[node.name] ?? "";
      case "glob":
        return node.pattern;
      case "concat": {
        const parts = await Promise.all(node.parts.map((p) => this.evaluateNode(p, localEnv)));
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
      case "arithmetic": {
        const result = this.evaluateArithmetic(node.expression, env);
        return String(result);
      }
      default:
        throw new Error(`Cannot evaluate node type: ${node.type}`);
    }
  }

  private evaluateArithmetic(expression: string, env: Record<string, string>): number {
    // Expand variables in the expression
    let expandedExpr = expression;
    // Replace $VAR and ${VAR} with their values
    expandedExpr = expandedExpr.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name) => {
      return env[name] ?? "0";
    });
    expandedExpr = expandedExpr.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      return env[name] ?? "0";
    });
    // Also handle bare variable names (in arithmetic, variables can be referenced without $)
    expandedExpr = expandedExpr.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
      // Don't replace if it looks like a number
      if (/^\d+$/.test(match)) return match;
      return env[match] ?? "0";
    });

    // Parse and evaluate the expression
    return this.parseArithmeticExpr(expandedExpr.trim());
  }

  private parseArithmeticExpr(expr: string): number {
    // Simple arithmetic expression parser
    // Supports: +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||, parentheses
    // Uses a simple recursive descent parser

    let pos = 0;

    const skipWhitespace = () => {
      while (pos < expr.length && /\s/.test(expr[pos]!)) pos++;
    };

    const parseNumber = (): number => {
      skipWhitespace();
      let numStr = "";
      const negative = expr[pos] === "-";
      if (negative) {
        pos++;
        skipWhitespace();
      }
      while (pos < expr.length && /[0-9]/.test(expr[pos]!)) {
        numStr += expr[pos];
        pos++;
      }
      if (numStr === "") return 0;
      return negative ? -parseInt(numStr, 10) : parseInt(numStr, 10);
    };

    const parsePrimary = (): number => {
      skipWhitespace();
      if (expr[pos] === "(") {
        pos++; // consume (
        const result = parseOr();
        skipWhitespace();
        if (expr[pos] === ")") pos++; // consume )
        return result;
      }
      return parseNumber();
    };

    const parseUnary = (): number => {
      skipWhitespace();
      if (expr[pos] === "-" && !/[0-9]/.test(expr[pos + 1] ?? "")) {
        pos++;
        return -parseUnary();
      }
      if (expr[pos] === "!") {
        pos++;
        return parseUnary() === 0 ? 1 : 0;
      }
      return parsePrimary();
    };

    const parseMulDiv = (): number => {
      let left = parseUnary();
      while (true) {
        skipWhitespace();
        const op = expr[pos];
        if (op === "*" || op === "/" || op === "%") {
          pos++;
          const right = parseUnary();
          if (op === "*") left = left * right;
          else if (op === "/") left = right === 0 ? 0 : Math.trunc(left / right);
          else left = right === 0 ? 0 : left % right;
        } else {
          break;
        }
      }
      return left;
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (true) {
        skipWhitespace();
        const op = expr[pos];
        if (op === "+" || (op === "-" && !/[0-9]/.test(expr[pos + 1] ?? ""))) {
          pos++;
          const right = parseMulDiv();
          if (op === "+") left = left + right;
          else left = left - right;
        } else {
          break;
        }
      }
      return left;
    };

    const parseComparison = (): number => {
      let left = parseAddSub();
      while (true) {
        skipWhitespace();
        if (expr.slice(pos, pos + 2) === "<=") {
          pos += 2;
          const right = parseAddSub();
          left = left <= right ? 1 : 0;
        } else if (expr.slice(pos, pos + 2) === ">=") {
          pos += 2;
          const right = parseAddSub();
          left = left >= right ? 1 : 0;
        } else if (expr.slice(pos, pos + 2) === "==") {
          pos += 2;
          const right = parseAddSub();
          left = left === right ? 1 : 0;
        } else if (expr.slice(pos, pos + 2) === "!=") {
          pos += 2;
          const right = parseAddSub();
          left = left !== right ? 1 : 0;
        } else if (expr[pos] === "<") {
          pos++;
          const right = parseAddSub();
          left = left < right ? 1 : 0;
        } else if (expr[pos] === ">") {
          pos++;
          const right = parseAddSub();
          left = left > right ? 1 : 0;
        } else {
          break;
        }
      }
      return left;
    };

    const parseAnd = (): number => {
      let left = parseComparison();
      while (true) {
        skipWhitespace();
        if (expr.slice(pos, pos + 2) === "&&") {
          pos += 2;
          const right = parseComparison();
          left = (left !== 0 && right !== 0) ? 1 : 0;
        } else {
          break;
        }
      }
      return left;
    };

    const parseOr = (): number => {
      let left = parseAnd();
      while (true) {
        skipWhitespace();
        if (expr.slice(pos, pos + 2) === "||") {
          pos += 2;
          const right = parseAnd();
          left = (left !== 0 || right !== 0) ? 1 : 0;
        } else {
          break;
        }
      }
      return left;
    };

    return parseOr();
  }

  setCwd(cwd: string): void {
    this.env.OLDPWD = this.cwd;
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
