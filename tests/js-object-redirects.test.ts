import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("JS Object Redirection", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "hello world\n",
    });
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  describe("Input from objects", () => {
    test("cat < Buffer reads from Buffer", async () => {
      const input = Buffer.from("hello from buffer");
      const result = await sh`cat < ${input}`.text();
      expect(result).toBe("hello from buffer");
    });

    test("cat < Blob reads from Blob", async () => {
      const input = new Blob(["hello from blob"]);
      const result = await sh`cat < ${input}`.text();
      expect(result).toBe("hello from blob");
    });

    test("cat < Response reads from Response", async () => {
      const input = new Response("hello from response");
      const result = await sh`cat < ${input}`.text();
      expect(result).toBe("hello from response");
    });

    test("pipe from Buffer through grep", async () => {
      const input = Buffer.from("foo\nbar\nbaz\nfoo bar\n");
      const result = await sh`cat < ${input} | grep foo`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("pipe from Blob to wc", async () => {
      const input = new Blob(["line1\nline2\nline3\n"]);
      const result = await sh`cat < ${input} | wc -l`.text();
      expect(result.trim()).toBe("3");
    });

    test("cat < string reads from string (spec compliance)", async () => {
      const result = await sh`cat < ${"raw string input"}`.text();
      expect(result).toBe("raw string input");
    });

    test("string with newlines as input", async () => {
      const result = await sh`cat < ${"line1\nline2\nline3"}`.text();
      expect(result).toBe("line1\nline2\nline3");
    });
  });

  describe("Output to objects", () => {
    test("echo > Buffer writes to Buffer", async () => {
      const buf = Buffer.alloc(100);
      await sh`echo "hi there" > ${buf}`;
      const written = buf.toString("utf-8").replace(/\0+$/, "");
      expect(written).toBe("hi there\n");
    });

    test("Buffer fills with multiple writes", async () => {
      const buf = Buffer.alloc(50);
      await sh`echo one; echo two; echo three > ${buf}`.nothrow();
      const written = buf.toString("utf-8").replace(/\0+$/, "");
      // Only "three" goes to buffer due to redirect only on last command
      expect(written).toBe("three\n");
    });

    test("pipeline output to Buffer", async () => {
      const buf = Buffer.alloc(100);
      await sh`echo "FOO BAR" | cat > ${buf}`;
      const written = buf.toString("utf-8").replace(/\0+$/, "");
      expect(written).toBe("FOO BAR\n");
    });

    test("truncates when Buffer too small", async () => {
      const buf = Buffer.alloc(5);
      await sh`echo "hello world" > ${buf}`;
      const written = buf.toString("utf-8");
      expect(written).toBe("hello");
    });
  });

  describe("Edge cases", () => {
    test("empty Buffer input", async () => {
      const input = Buffer.from("");
      const result = await sh`cat < ${input}`.text();
      expect(result).toBe("");
    });

    test("empty Blob input", async () => {
      const input = new Blob([]);
      const result = await sh`cat < ${input}`.text();
      expect(result).toBe("");
    });

    test("large data through Buffer redirect", async () => {
      const largeData = "x".repeat(10000);
      const input = Buffer.from(largeData);
      const result = await sh`cat < ${input}`.text();
      expect(result.length).toBe(10000);
      expect(result).toBe(largeData);
    });

    test("binary data in Buffer", async () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      const result = await sh`cat < ${binary}`.buffer();
      expect(result).toEqual(binary);
    });

    test("multiple redirect objects in one command", async () => {
      const input = Buffer.from("hello");
      const output = Buffer.alloc(100);
      await sh`cat < ${input} > ${output}`;
      const written = output.toString("utf-8").replace(/\0+$/, "");
      expect(written).toBe("hello");
    });
  });
});
