import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("mkdir command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/existing/.gitkeep": "",
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

  test("creates a single directory", async () => {
    await sh`mkdir /newdir`;
    expect(vol.existsSync("/newdir")).toBe(true);
    expect(vol.statSync("/newdir").isDirectory()).toBe(true);
  });

  test("creates multiple directories", async () => {
    await sh`mkdir /dir1 /dir2 /dir3`;
    expect(vol.existsSync("/dir1")).toBe(true);
    expect(vol.existsSync("/dir2")).toBe(true);
    expect(vol.existsSync("/dir3")).toBe(true);
  });

  test("error on missing operand", async () => {
    const result = await sh`mkdir`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing operand");
  });

  test("error when parent directory does not exist without -p", async () => {
    const result = await sh`mkdir /nonexistent/subdir`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cannot create directory");
  });

  test("-p creates parent directories", async () => {
    await sh`mkdir -p /deep/nested/path`;
    expect(vol.existsSync("/deep")).toBe(true);
    expect(vol.existsSync("/deep/nested")).toBe(true);
    expect(vol.existsSync("/deep/nested/path")).toBe(true);
  });

  test("--parents flag works like -p", async () => {
    await sh`mkdir --parents /another/deep/path`;
    expect(vol.existsSync("/another/deep/path")).toBe(true);
  });

  test("-p does not error on existing directory", async () => {
    const result = await sh`mkdir -p /existing`.nothrow();
    expect(result.exitCode).toBe(0);
  });

  test("creates directory relative to cwd", async () => {
    sh.cwd("/existing");
    await sh`mkdir subdir`;
    expect(vol.existsSync("/existing/subdir")).toBe(true);
  });

  test("error on existing directory without -p", async () => {
    const result = await sh`mkdir /existing`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cannot create directory");
  });

  test("error message includes directory name", async () => {
    const result = await sh`mkdir /missing/parent/dir`.nothrow();
    expect(result.stderr.toString()).toContain("missing/parent/dir");
  });
});
