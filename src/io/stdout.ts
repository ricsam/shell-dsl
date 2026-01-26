import type { Stdout, Stderr, OutputCollector } from "../types.ts";

export class OutputCollectorImpl implements OutputCollector {
  private chunks: Uint8Array[] = [];
  private closed: boolean = false;
  private closeResolvers: Array<() => void> = [];
  private resolveWait: (() => void) | null = null;
  private waitPromise: Promise<void> | null = null;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Output stream is closed");
    }
    this.chunks.push(chunk);
    if (this.resolveWait) {
      this.resolveWait();
      this.resolveWait = null;
      this.waitPromise = null;
    }
  }

  async writeText(str: string): Promise<void> {
    await this.write(new TextEncoder().encode(str));
  }

  close(): void {
    this.closed = true;
    if (this.resolveWait) {
      this.resolveWait();
      this.resolveWait = null;
      this.waitPromise = null;
    }
    // Wake up anyone waiting for close
    for (const resolve of this.closeResolvers) {
      resolve();
    }
    this.closeResolvers = [];
  }

  async collect(): Promise<Buffer> {
    // Wait until closed
    while (!this.closed) {
      await new Promise<void>((resolve) => {
        this.closeResolvers.push(resolve);
      });
    }
    return Buffer.concat(this.chunks);
  }

  async *getReadableStream(): AsyncIterable<Uint8Array> {
    let index = 0;

    while (true) {
      while (index < this.chunks.length) {
        yield this.chunks[index]!;
        index++;
      }

      if (this.closed) {
        break;
      }

      // Wait for more data or close
      if (!this.waitPromise) {
        this.waitPromise = new Promise<void>((resolve) => {
          this.resolveWait = resolve;
        });
      }
      await this.waitPromise;
    }
  }
}

export class PipeBuffer implements OutputCollector, Stdout {
  private chunks: Uint8Array[] = [];
  private closed: boolean = false;
  private waitingReaders: Array<() => void> = [];
  private readIndex: number = 0;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Pipe is closed");
    }
    this.chunks.push(chunk);
    // Wake up any waiting readers
    for (const resolve of this.waitingReaders) {
      resolve();
    }
    this.waitingReaders = [];
  }

  async writeText(str: string): Promise<void> {
    await this.write(new TextEncoder().encode(str));
  }

  close(): void {
    this.closed = true;
    // Wake up any waiting readers
    for (const resolve of this.waitingReaders) {
      resolve();
    }
    this.waitingReaders = [];
  }

  async collect(): Promise<Buffer> {
    // Wait until closed
    while (!this.closed) {
      await new Promise<void>((resolve) => {
        this.waitingReaders.push(resolve);
      });
    }
    return Buffer.concat(this.chunks);
  }

  async *getReadableStream(): AsyncIterable<Uint8Array> {
    while (true) {
      // Yield any available chunks
      while (this.readIndex < this.chunks.length) {
        yield this.chunks[this.readIndex]!;
        this.readIndex++;
      }

      if (this.closed) {
        break;
      }

      // Wait for more data
      await new Promise<void>((resolve) => {
        this.waitingReaders.push(resolve);
      });
    }
  }
}

export function createStdout(): OutputCollector {
  return new OutputCollectorImpl();
}

export function createStderr(): OutputCollector {
  return new OutputCollectorImpl();
}

export function createPipe(): PipeBuffer {
  return new PipeBuffer();
}
