import { describe, expect, test } from "bun:test";

describe("terminal demo executor protocol", () => {
  test("runs commands over JSON-lines and preserves cwd", async () => {
    const child = Bun.spawn(["bun", "examples/terminal/shell-executor.ts"], {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = readLines(child.stdout)[Symbol.asyncIterator]();

    try {
      const ready = JSON.parse((await lines.next()).value!) as { type: string; cwd: string };
      expect(ready).toMatchObject({ type: "ready", cwd: "/home/demo" });

      child.stdin.write(`${JSON.stringify({
        type: "run",
        id: 1,
        source: "pwd; cd /tmp; pwd",
        terminal: { isTTY: true, columns: 80, rows: 24 },
      })}\n`);

      let stdout = "";
      let exit: { type: "exit"; exitCode: number; cwd: string } | undefined;
      while (!exit) {
        const next = await lines.next();
        expect(next.done).toBe(false);
        const event = JSON.parse(next.value!) as
          | { type: "output"; fd: 1 | 2; data: string }
          | { type: "exit"; exitCode: number; cwd: string };
        if (event.type === "output" && event.fd === 1) {
          stdout += Buffer.from(event.data, "base64").toString("utf-8");
        } else if (event.type === "exit") {
          exit = event;
        }
      }

      expect(stdout).toBe("/home/demo\n/tmp\n");
      expect(exit).toMatchObject({ exitCode: 0, cwd: "/tmp" });
    } finally {
      child.stdin.write(`${JSON.stringify({ type: "exit" })}\n`);
      child.stdin.end();
      await child.exited;
    }
  });

  test("completes commands and virtual filesystem paths", async () => {
    const child = Bun.spawn(["bun", "examples/terminal/shell-executor.ts"], {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = readLines(child.stdout)[Symbol.asyncIterator]();

    try {
      const ready = JSON.parse((await lines.next()).value!) as { type: string; cwd: string };
      expect(ready).toMatchObject({ type: "ready", cwd: "/home/demo" });

      child.stdin.write(`${JSON.stringify({
        type: "complete",
        id: 1,
        source: "ec",
        cursor: 2,
      })}\n`);

      const commandCompletion = JSON.parse((await lines.next()).value!) as {
        type: "complete";
        replacement: string;
        matches: string[];
      };
      expect(commandCompletion).toMatchObject({ type: "complete", replacement: "ec" });
      expect(commandCompletion.matches).toContain("echo ");

      child.stdin.write(`${JSON.stringify({
        type: "complete",
        id: 2,
        source: "cat RE",
        cursor: 6,
      })}\n`);

      const pathCompletion = JSON.parse((await lines.next()).value!) as {
        type: "complete";
        id: number;
        replacement: string;
        matches: string[];
      };
      expect(pathCompletion).toEqual({
        type: "complete",
        id: 2,
        replacement: "RE",
        matches: ["README.txt "],
      });
    } finally {
      child.stdin.write(`${JSON.stringify({ type: "exit" })}\n`);
      child.stdin.end();
      await child.exited;
    }
  });
});

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}
