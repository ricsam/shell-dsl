import { describe, expect, test } from "bun:test";
import { createShellInput } from "../src/index.ts";

describe("ShellInputController", () => {
  test("streams string and byte writes", async () => {
    const input = createShellInput();
    const collected = (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of input) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString("utf-8");
    })();

    await input.write("hello");
    await input.write(new TextEncoder().encode("\n"));
    input.close();

    expect(await collected).toBe("hello\n");
  });

  test("waits for writes when the reader starts first", async () => {
    const input = createShellInput();
    const iterator = input[Symbol.asyncIterator]();
    const next = iterator.next();

    await input.write("later");
    input.close();

    const result = await next;
    expect(result.done).toBe(false);
    expect(Buffer.from(result.value!).toString("utf-8")).toBe("later");
  });

  test("ends readers on close", async () => {
    const input = createShellInput();
    const iterator = input[Symbol.asyncIterator]();

    input.close();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  test("rejects pending readers on abort", async () => {
    const input = createShellInput();
    const iterator = input[Symbol.asyncIterator]();
    const next = iterator.next();
    const reason = new Error("stop");

    input.abort(reason);

    await expect(next).rejects.toThrow("stop");
    await expect(input.write("nope")).rejects.toThrow("stop");
  });
});
