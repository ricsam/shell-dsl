import type { ExecResult } from "./types.ts";
import { ShellError } from "./errors.ts";

export interface ExecuteOverrides {
  cwd?: string;
  env?: Record<string, string>;
}

export interface ShellPromiseOptions {
  execute: (overrides: ExecuteOverrides) => Promise<ExecResult>;
  cwdOverride?: string;
  envOverride?: Record<string, string>;
  shouldThrow?: boolean;
  quiet?: boolean;
}

export class ShellPromise implements PromiseLike<ExecResult> {
  private executor: (overrides: ExecuteOverrides) => Promise<ExecResult>;
  private cwdOverride?: string;
  private envOverride?: Record<string, string>;
  private shouldThrow: boolean;
  private isQuiet: boolean;
  private cachedResult?: Promise<ExecResult>;

  constructor(options: ShellPromiseOptions) {
    this.executor = options.execute;
    this.cwdOverride = options.cwdOverride;
    this.envOverride = options.envOverride;
    this.shouldThrow = options.shouldThrow ?? true;
    this.isQuiet = options.quiet ?? false;
  }

  private async run(): Promise<ExecResult> {
    if (!this.cachedResult) {
      this.cachedResult = this.executor({
        cwd: this.cwdOverride,
        env: this.envOverride,
      });
    }

    const result = await this.cachedResult;

    if (this.shouldThrow && result.exitCode !== 0) {
      throw new ShellError(
        `Command failed with exit code ${result.exitCode}`,
        result.stdout,
        result.stderr,
        result.exitCode
      );
    }

    return result;
  }

  then<TResult1 = ExecResult, TResult2 = never>(
    onfulfilled?: ((value: ExecResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<ExecResult | TResult> {
    return this.run().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<ExecResult> {
    return this.run().finally(onfinally);
  }

  // Output formats
  async text(): Promise<string> {
    const result = await this.run();
    return result.stdout.toString("utf-8");
  }

  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async *lines(): AsyncIterable<string> {
    const text = await this.text();
    const lines = text.split("\n");
    // Remove trailing empty line if present
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    for (const line of lines) {
      yield line;
    }
  }

  async blob(): Promise<Blob> {
    const result = await this.run();
    return new Blob([result.stdout]);
  }

  async buffer(): Promise<Buffer> {
    const result = await this.run();
    return result.stdout;
  }

  // Behavior modifiers - return new ShellPromise with modified options
  quiet(): ShellPromise {
    return new ShellPromise({
      execute: this.executor,
      cwdOverride: this.cwdOverride,
      envOverride: this.envOverride,
      shouldThrow: this.shouldThrow,
      quiet: true,
    });
  }

  nothrow(): ShellPromise {
    return new ShellPromise({
      execute: this.executor,
      cwdOverride: this.cwdOverride,
      envOverride: this.envOverride,
      shouldThrow: false,
      quiet: this.isQuiet,
    });
  }

  throws(enable: boolean): ShellPromise {
    return new ShellPromise({
      execute: this.executor,
      cwdOverride: this.cwdOverride,
      envOverride: this.envOverride,
      shouldThrow: enable,
      quiet: this.isQuiet,
    });
  }

  // Context overrides - these need to be handled by the shell
  cwd(path: string): ShellPromise {
    return new ShellPromise({
      execute: this.executor,
      cwdOverride: path,
      envOverride: this.envOverride,
      shouldThrow: this.shouldThrow,
      quiet: this.isQuiet,
    });
  }

  env(vars: Record<string, string>): ShellPromise {
    return new ShellPromise({
      execute: this.executor,
      cwdOverride: this.cwdOverride,
      envOverride: { ...this.envOverride, ...vars },
      shouldThrow: this.shouldThrow,
      quiet: this.isQuiet,
    });
  }

  // Getters for internal state (used by ShellDSL)
  getCwdOverride(): string | undefined {
    return this.cwdOverride;
  }

  getEnvOverride(): Record<string, string> | undefined {
    return this.envOverride;
  }

  getShouldThrow(): boolean {
    return this.shouldThrow;
  }

  getIsQuiet(): boolean {
    return this.isQuiet;
  }
}
