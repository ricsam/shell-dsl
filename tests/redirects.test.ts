import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

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
  });

  describe("Combined redirects", () => {
    test("input and output redirection", async () => {
      await sh`cat < /input.txt > /copy.txt`;
      expect(vol.readFileSync("/copy.txt", "utf8")).toBe("hello world");
    });
  });
});
