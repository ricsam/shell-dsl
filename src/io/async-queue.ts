export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private closed = false;
  private error: unknown;
  private waiters: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }> = [];

  push(item: T): void {
    if (this.closed) {
      throw new Error("Queue is closed");
    }
    this.items.push(item);
    this.wake();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.wake();
  }

  fail(reason?: unknown): void {
    if (this.closed) {
      return;
    }
    this.error = reason ?? new Error("Queue failed");
    this.closed = true;
    this.wakeWithError(this.error);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }

      if (this.error !== undefined) {
        throw this.error;
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
