import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

describe("Redirections", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/input.txt": "hello world",
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

  describe("Input redirection (<)", () => {
    test("reads from file", async () => {
      const result = await sh`cat < /input.txt`.text();
      expect(result).toBe("hello world");
    });
  });

  describe("Output redirection (>)", () => {
    test("writes to file (overwrite)", async () => {
      await sh`echo "new content" > /output.txt`;
      expect(vol.readFileSync("/output.txt", "utf8")).toBe("new content\n");
    });

    test("overwrites existing file", async () => {
      vol.writeFileSync("/existing.txt", "old content");
      await sh`echo "new content" > /existing.txt`;
      expect(vol.readFileSync("/existing.txt", "utf8")).toBe("new content\n");
    });
  });

  describe("Append redirection (>>)", () => {
    test("appends to file", async () => {
      vol.writeFileSync("/append.txt", "line1\n");
      await sh`echo "line2" >> /append.txt`;
      expect(vol.readFileSync("/append.txt", "utf8")).toBe("line1\nline2\n");
    });

    test("creates file if not exists", async () => {
      await sh`echo "first line" >> /new-append.txt`;
      expect(vol.readFileSync("/new-append.txt", "utf8")).toBe("first line\n");
    });
  });

  describe("Stderr redirection (2>)", () => {
    test("redirects stderr to file", async () => {
      await sh`cat /nonexistent 2> /errors.txt`.nothrow();
      const errors = vol.readFileSync("/errors.txt", "utf8");
      expect(errors).toContain("nonexistent");
    });

    test("appends stderr to file (2>>)", async () => {
      vol.writeFileSync("/errors.txt", "previous error\n");
      await sh`cat /nonexistent 2>> /errors.txt`.nothrow();
      const errors = vol.readFileSync("/errors.txt", "utf8");
      expect(errors).toContain("previous error");
      expect(errors).toContain("nonexistent");
    });
  });

  describe("File descriptor redirects", () => {
    test("2>&1 redirects stderr to stdout", async () => {
      const result = await sh`cat /nonexistent 2>&1`.nothrow();
      expect(result.stdout.toString()).toContain("nonexistent");
      expect(result.stderr.toString()).toBe("");
    });

    test("1>&2 redirects stdout to stderr", async () => {
      const result = await sh`echo "test message" 1>&2`;
      expect(result.stderr.toString()).toBe("test message\n");
      expect(result.stdout.toString()).toBe("");
    });

    test("&> redirects both stdout and stderr to file", async () => {
      vol.writeFileSync("/data.txt", "some content");
      await sh`cat /data.txt /nonexistent &> /output.txt`.nothrow();
      const output = vol.readFileSync("/output.txt", "utf8");
      expect(output).toContain("some content");
      expect(output).toContain("nonexistent");
    });

    test("&>> appends both stdout and stderr to file", async () => {
      vol.writeFileSync("/output.txt", "previous output\n");
      vol.writeFileSync("/data.txt", "new content");
      await sh`cat /data.txt /nonexistent &>> /output.txt`.nothrow();
      const output = vol.readFileSync("/output.txt", "utf8");
      expect(output).toContain("previous output");
      expect(output).toContain("new content");
      expect(output).toContain("nonexistent");
    });
  });

  describe("Combined redirects", () => {
    test("input and output redirection", async () => {
      await sh`cat < /input.txt > /copy.txt`;
      expect(vol.readFileSync("/copy.txt", "utf8")).toBe("hello world");
    });
  });

  describe("Redirect error handling", () => {
    test("< nonexistent file produces stderr", async () => {
      const result = await sh`cat < /nonexistent.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("sh: /nonexistent.txt:");
    });

    test("> to nonexistent parent dir produces stderr", async () => {
      const result = await sh`echo hi > /no-such-dir/file.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("sh: /no-such-dir/file.txt:");
    });

    test(">> to nonexistent parent dir produces stderr", async () => {
      const result = await sh`echo hi >> /no-such-dir/file.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("sh: /no-such-dir/file.txt:");
    });

    test("2> to nonexistent parent dir produces stderr", async () => {
      const result = await sh`echo hi 2> /no-such-dir/file.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("sh: /no-such-dir/file.txt:");
    });
  });
});
