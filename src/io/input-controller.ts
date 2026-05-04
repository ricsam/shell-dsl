import type { ShellInputController } from "../types.ts";

type Waiter = {
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

export class ShellInputControllerImpl implements ShellInputController {
  private chunks: Uint8Array[] = [];
  private closed = false;
  private aborted = false;
  private abortReason: unknown;
  private waiters: Waiter[] = [];

  async write(chunk: Uint8Array | string): Promise<void> {
    if (this.closed) {
      throw new Error("Input stream is closed");
    }
    if (this.aborted) {
      throw this.abortReason ?? new Error("Input stream aborted");
    }

    this.chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    this.wake();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.wake();
  }

  abort(reason?: unknown): void {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.abortReason = reason ?? new Error("Input stream aborted");
    this.wakeWithError(this.abortReason);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    while (true) {
      while (this.chunks.length > 0) {
        yield this.chunks.shift()!;
      }

      if (this.aborted) {
        throw this.abortReason ?? new Error("Input stream aborted");
      }
      if (this.closed) {
        break;
      }

      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private wakeWithError(reason?: unknown): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(reason);
    }
  }
}

export function createShellInput(): ShellInputController {
  return new ShellInputControllerImpl();
}
