import { test, expect, describe } from "bun:test";
import {
  OutputCollectorImpl,
  PipeBuffer,
  BufferTargetCollector,
  createStdout,
  createStderr,
  createPipe,
  createBufferTargetCollector,
} from "../src/io/stdout.ts";

describe("OutputCollectorImpl", () => {
  test("write and collect", async () => {
    const collector = new OutputCollectorImpl();
    await collector.write(new TextEncoder().encode("hello "));
    await collector.write(new TextEncoder().encode("world"));
    collector.close();

    const result = await collector.collect();
    expect(result.toString()).toBe("hello world");
  });

  test("writeText and collect", async () => {
    const collector = new OutputCollectorImpl();
    await collector.writeText("line1\n");
    await collector.writeText("line2\n");
    collector.close();

    const result = await collector.collect();
    expect(result.toString()).toBe("line1\nline2\n");
  });

  test("getReadableStream yields chunks", async () => {
    const collector = new OutputCollectorImpl();
    await collector.writeText("chunk1");
    await collector.writeText("chunk2");
    collector.close();

    const chunks: string[] = [];
    for await (const chunk of collector.getReadableStream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });

  test("getReadableStream waits for more data", async () => {
    const collector = new OutputCollectorImpl();

    const streamPromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of collector.getReadableStream()) {
        chunks.push(new TextDecoder().decode(chunk));
      }
      return chunks;
    })();

    await collector.writeText("first");
    // Small delay to allow stream to process
    await new Promise((resolve) => setTimeout(resolve, 10));
    await collector.writeText("second");
    collector.close();

    const chunks = await streamPromise;
    expect(chunks).toEqual(["first", "second"]);
  });

  test("throws error when writing to closed stream", async () => {
    const collector = new OutputCollectorImpl();
    collector.close();

    expect(collector.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Output stream is closed"
    );
  });

  test("collect waits for close", async () => {
    const collector = new OutputCollectorImpl();
    await collector.writeText("data");

    const collectPromise = collector.collect();
    // Close after a small delay
    setTimeout(() => collector.close(), 10);

    const result = await collectPromise;
    expect(result.toString()).toBe("data");
  });
});

describe("PipeBuffer", () => {
  test("write and collect", async () => {
    const pipe = new PipeBuffer();
    await pipe.write(new TextEncoder().encode("pipe data"));
    pipe.close();

    const result = await pipe.collect();
    expect(result.toString()).toBe("pipe data");
  });

  test("writeText and collect", async () => {
    const pipe = new PipeBuffer();
    await pipe.writeText("text data");
    pipe.close();

    const result = await pipe.collect();
    expect(result.toString()).toBe("text data");
  });

  test("getReadableStream yields chunks in order", async () => {
    const pipe = new PipeBuffer();
    await pipe.writeText("a");
    await pipe.writeText("b");
    await pipe.writeText("c");
    pipe.close();

    const chunks: string[] = [];
    for await (const chunk of pipe.getReadableStream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  test("getReadableStream waits for data when empty", async () => {
    const pipe = new PipeBuffer();

    const streamPromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of pipe.getReadableStream()) {
        chunks.push(new TextDecoder().decode(chunk));
      }
      return chunks;
    })();

    // Write data after stream starts
    await new Promise((resolve) => setTimeout(resolve, 10));
    await pipe.writeText("delayed");
    pipe.close();

    const chunks = await streamPromise;
    expect(chunks).toEqual(["delayed"]);
  });

  test("throws error when writing to closed pipe", async () => {
    const pipe = new PipeBuffer();
    pipe.close();

    expect(pipe.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Pipe is closed"
    );
  });

  test("collect waits for close", async () => {
    const pipe = new PipeBuffer();
    await pipe.writeText("waiting");

    const collectPromise = pipe.collect();
    setTimeout(() => pipe.close(), 10);

    const result = await collectPromise;
    expect(result.toString()).toBe("waiting");
  });
});

describe("BufferTargetCollector", () => {
  test("writes to target buffer", async () => {
    const target = Buffer.alloc(20);
    const collector = new BufferTargetCollector(target);

    await collector.writeText("hello");
    collector.close();

    const result = await collector.collect();
    expect(result.toString()).toBe("hello");
  });

  test("truncates when target buffer is full", async () => {
    const target = Buffer.alloc(5);
    const collector = new BufferTargetCollector(target);

    await collector.writeText("hello world");
    collector.close();

    const result = await collector.collect();
    expect(result.toString()).toBe("hello");
    expect(result.length).toBe(5);
  });

  test("getReadableStream yields written content", async () => {
    const target = Buffer.alloc(100);
    const collector = new BufferTargetCollector(target);

    await collector.writeText("stream content");
    collector.close();

    const chunks: string[] = [];
    for await (const chunk of collector.getReadableStream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    expect(chunks.join("")).toBe("stream content");
  });

  test("throws error when writing to closed collector", async () => {
    const target = Buffer.alloc(100);
    const collector = new BufferTargetCollector(target);
    collector.close();

    expect(collector.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Output stream is closed"
    );
  });

  test("collect waits for close", async () => {
    const target = Buffer.alloc(100);
    const collector = new BufferTargetCollector(target);
    await collector.writeText("test");

    const collectPromise = collector.collect();
    setTimeout(() => collector.close(), 10);

    const result = await collectPromise;
    expect(result.toString()).toBe("test");
  });
});

describe("factory functions", () => {
  test("createStdout returns OutputCollectorImpl", () => {
    const stdout = createStdout();
    expect(stdout).toBeInstanceOf(OutputCollectorImpl);
  });

  test("createStderr returns OutputCollectorImpl", () => {
    const stderr = createStderr();
    expect(stderr).toBeInstanceOf(OutputCollectorImpl);
  });

  test("createPipe returns PipeBuffer", () => {
    const pipe = createPipe();
    expect(pipe).toBeInstanceOf(PipeBuffer);
  });

  test("createBufferTargetCollector returns BufferTargetCollector", () => {
    const target = Buffer.alloc(100);
    const collector = createBufferTargetCollector(target);
    expect(collector).toBeInstanceOf(BufferTargetCollector);
  });
});
