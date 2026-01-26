import type { ShellConfig, Command, VirtualFS, ExecResult, RedirectObjectMap } from "./types.ts";
import { isRawValue, isRedirectObject } from "./types.ts";
import type { Token } from "./lexer/tokens.ts";
import type { ASTNode } from "./parser/ast.ts";
import { Lexer } from "./lexer/lexer.ts";
import { Parser } from "./parser/parser.ts";
import { Interpreter } from "./interpreter/interpreter.ts";
import { ShellPromise } from "./shell-promise.ts";
import { escape, escapeForInterpolation } from "./utils/escape.ts";

export interface Program {
  ast: ASTNode;
  source: string;
}

export class ShellDSL {
  private fs: VirtualFS;
  private initialCwd: string;
  private initialEnv: Record<string, string>;
  private currentCwd: string;
  private currentEnv: Record<string, string>;
  private commands: Record<string, Command>;
  private shouldThrow: boolean = true;

  constructor(config: ShellConfig) {
    this.fs = config.fs;
    this.initialCwd = config.cwd;
    this.initialEnv = { ...config.env };
    this.currentCwd = config.cwd;
    this.currentEnv = { ...config.env };
    this.commands = config.commands;
  }

  // Template tag function
  tag(strings: TemplateStringsArray, ...values: unknown[]): ShellPromise {
    // Build the command string with escaped interpolations
    let source = strings[0] ?? "";
    const redirectObjects: RedirectObjectMap = {};
    let objIndex = 0;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const precedingString = strings[i] ?? "";

      if (isRawValue(value)) {
        source += value.raw;
      } else if (this.isRedirectTarget(precedingString, value)) {
        // Value appears after a redirect operator - store as redirect object
        const marker = `__REDIR_OBJ_${objIndex++}__`;
        redirectObjects[marker] = value as Buffer | Blob | Response | string;
        source += marker;
      } else {
        source += escapeForInterpolation(value);
      }
      source += strings[i + 1] ?? "";
    }

    return this.createPromise(source, { redirectObjects });
  }

  private isRedirectTarget(precedingString: string, value: unknown): boolean {
    // Check if value is a redirect object type AND appears after redirect operator
    if (!isRedirectObject(value) || isRawValue(value)) {
      return false;
    }
    // Check if preceding string ends with redirect operator
    const trimmed = precedingString.trimEnd();
    const afterRedirectOp = /(<|>|>>|2>|2>>|&>|&>>)\s*$/.test(trimmed);

    if (!afterRedirectOp) {
      return false;
    }

    // Buffer, Blob, Response are always treated as redirect objects
    if (Buffer.isBuffer(value) || value instanceof Blob || value instanceof Response) {
      return true;
    }

    // For strings after input redirect (<), treat as content per spec
    // For strings after output redirect (>), they must be Buffers
    if (typeof value === "string") {
      // Only input redirection supports string content
      return /<\s*$/.test(trimmed);
    }

    return false;
  }

  private createPromise(source: string, options?: { cwd?: string; env?: Record<string, string>; shouldThrow?: boolean; redirectObjects?: RedirectObjectMap }): ShellPromise {
    const shell = this;

    return new ShellPromise({
      execute: async (overrides) => {
        const cwd = overrides?.cwd ?? options?.cwd ?? shell.currentCwd;
        const env = { ...shell.currentEnv, ...options?.env, ...overrides?.env };

        const interpreter = new Interpreter({
          fs: shell.fs,
          cwd,
          env,
          commands: shell.commands,
          redirectObjects: options?.redirectObjects,
        });

        const tokens = shell.lex(source);
        const ast = shell.parse(tokens);
        return interpreter.execute(ast);
      },
      cwdOverride: options?.cwd,
      envOverride: options?.env,
      shouldThrow: options?.shouldThrow ?? this.shouldThrow,
    });
  }

  // Global defaults
  cwd(path: string): void {
    this.currentCwd = path;
  }

  env(vars: Record<string, string>): void {
    Object.assign(this.currentEnv, vars);
  }

  throws(enable: boolean): void {
    this.shouldThrow = enable;
  }

  resetCwd(): void {
    this.currentCwd = this.initialCwd;
  }

  resetEnv(): void {
    this.currentEnv = { ...this.initialEnv };
  }

  // Utility
  escape(str: string): string {
    return escape(str);
  }

  // Low-level API
  lex(source: string): Token[] {
    return new Lexer(source).tokenize();
  }

  parse(tokens: Token[]): ASTNode {
    return new Parser(tokens).parse();
  }

  compile(ast: ASTNode): Program {
    // For now, the "program" is just the AST with source reconstruction
    return {
      ast,
      source: "", // Could reconstruct source from AST if needed
    };
  }

  async run(program: Program): Promise<ExecResult> {
    const interpreter = new Interpreter({
      fs: this.fs,
      cwd: this.currentCwd,
      env: this.currentEnv,
      commands: this.commands,
    });

    return interpreter.execute(program.ast);
  }
}

// Factory function that returns a callable template tag
export function createShellDSL(config: ShellConfig): ShellDSL & ((strings: TemplateStringsArray, ...values: unknown[]) => ShellPromise) {
  const shell = new ShellDSL(config);

  // Create a function that acts as both tag and shell instance
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    return shell.tag(strings, ...values);
  };

  // Copy all properties and methods from shell to tag function
  Object.setPrototypeOf(tag, ShellDSL.prototype);
  Object.assign(tag, {
    fs: (shell as any).fs,
    initialCwd: (shell as any).initialCwd,
    initialEnv: (shell as any).initialEnv,
    currentCwd: (shell as any).currentCwd,
    currentEnv: (shell as any).currentEnv,
    commands: (shell as any).commands,
    shouldThrow: (shell as any).shouldThrow,
  });

  // Bind methods
  (tag as any).cwd = shell.cwd.bind(shell);
  (tag as any).env = shell.env.bind(shell);
  (tag as any).throws = shell.throws.bind(shell);
  (tag as any).resetCwd = shell.resetCwd.bind(shell);
  (tag as any).resetEnv = shell.resetEnv.bind(shell);
  (tag as any).escape = shell.escape.bind(shell);
  (tag as any).lex = shell.lex.bind(shell);
  (tag as any).parse = shell.parse.bind(shell);
  (tag as any).compile = shell.compile.bind(shell);
  (tag as any).run = shell.run.bind(shell);
  (tag as any).tag = shell.tag.bind(shell);

  return tag as ShellDSL & ((strings: TemplateStringsArray, ...values: unknown[]) => ShellPromise);
}
