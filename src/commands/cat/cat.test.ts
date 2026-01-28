import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("cat command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file1.txt": "hello\n",
      "/file2.txt": "world\n",
      "/dir/nested.txt": "nested content\n",
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

  test("reads a single file", async () => {
    const result = await sh`cat /file1.txt`.text();
    expect(result).toBe("hello\n");
  });

  test("reads multiple files", async () => {
    const result = await sh`cat /file1.txt /file2.txt`.text();
    expect(result).toBe("hello\nworld\n");
  });

  test("reads from stdin when no files", async () => {
    const input = Buffer.from("stdin content\n");
    const result = await sh`cat < ${input}`.text();
    expect(result).toBe("stdin content\n");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`cat /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("nonexistent.txt");
  });

  test("reads nested file", async () => {
    const result = await sh`cat /dir/nested.txt`.text();
    expect(result).toBe("nested content\n");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`cat -n /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`cat --number /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
