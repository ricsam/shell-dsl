import type { Stdin } from "../types.ts";

export class StdinImpl implements Stdin {
  private source: AsyncIterable<Uint8Array> | null;
  private consumed: boolean = false;

  constructor(source: AsyncIterable<Uint8Array> | null = null) {
    this.source = source;
  }

  async *stream(): AsyncIterable<Uint8Array> {
    if (this.consumed) {
      throw new Error("Stdin already consumed");
    }
    this.consumed = true;

    if (this.source === null) {
      return;
    }

    for await (const chunk of this.source) {
      yield chunk;
    }
  }

  async buffer(): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.stream()) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async text(): Promise<string> {
    const buf = await this.buffer();
    return buf.toString("utf-8");
  }

  async *lines(): AsyncIterable<string> {
    let buffer = "";

    for await (const chunk of this.stream()) {
      buffer += new TextDecoder().decode(chunk);

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield line;
      }
    }

    if (buffer) {
      yield buffer;
    }
  }
}

export function createStdin(source: AsyncIterable<Uint8Array> | Buffer | string | null): Stdin {
  if (source === null) {
    return new StdinImpl(null);
  }

  if (typeof source === "string") {
    return new StdinImpl(
      (async function* () {
        yield new TextEncoder().encode(source);
      })()
    );
  }

  if (Buffer.isBuffer(source)) {
    return new StdinImpl(
      (async function* () {
        yield new Uint8Array(source);
      })()
    );
  }

  return new StdinImpl(source);
}
