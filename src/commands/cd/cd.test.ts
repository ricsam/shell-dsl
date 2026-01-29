import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("cd command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/dir/sub/file.txt": "content",
      "/a/file.txt": "a",
      "/b/file.txt": "b",
      "/somefile": "not a directory",
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

  test("cd /dir && pwd", async () => {
    const result = await sh`cd /dir && pwd`.text();
    expect(result).toBe("/dir\n");
  });

  test("cd with no args returns exit 0", async () => {
    const result = await sh`cd`.nothrow();
    expect(result.exitCode).toBe(0);
  });

  test("cd /nonexistent returns exit 1", async () => {
    const result = await sh`cd /nonexistent`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("not a directory");
  });

  test("cd to a file returns exit 1", async () => {
    const result = await sh`cd /somefile`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("not a directory");
  });

  test("cd /dir && cd .. && pwd", async () => {
    const result = await sh`cd /dir && cd .. && pwd`.text();
    expect(result).toBe("/\n");
  });

  test("relative path: cd /dir && cd sub && pwd", async () => {
    const result = await sh`cd /dir && cd sub && pwd`.text();
    expect(result).toBe("/dir/sub\n");
  });

  test("cd - returns to previous directory", async () => {
    const result = await sh`cd /a && cd /b && cd - && pwd`.text();
    expect(result).toBe("/a\n");
  });

  test("cd - with no OLDPWD returns error", async () => {
    const result = await sh`cd -`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("OLDPWD not set");
  });

  test("cwd does not persist across separate invocations", async () => {
    await sh`cd /dir`.nothrow();
    const result = await sh`pwd`.text();
    expect(result).toBe("/\n");
  });
});
