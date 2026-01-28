import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("mv command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file1.txt": "content1",
      "/file2.txt": "content2",
      "/dir/file3.txt": "content3",
      "/dir/subdir/file4.txt": "content4",
      "/destdir/.gitkeep": "",
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

  test("renames a file", async () => {
    await sh`mv /file1.txt /renamed.txt`;
    expect(vol.existsSync("/renamed.txt")).toBe(true);
    expect(vol.readFileSync("/renamed.txt", "utf8")).toBe("content1");
    expect(vol.existsSync("/file1.txt")).toBe(false);
  });

  test("moves file into directory", async () => {
    await sh`mv /file1.txt /destdir`;
    expect(vol.existsSync("/destdir/file1.txt")).toBe(true);
    expect(vol.readFileSync("/destdir/file1.txt", "utf8")).toBe("content1");
    expect(vol.existsSync("/file1.txt")).toBe(false);
  });

  test("moves multiple files into directory", async () => {
    await sh`mv /file1.txt /file2.txt /destdir`;
    expect(vol.existsSync("/destdir/file1.txt")).toBe(true);
    expect(vol.existsSync("/destdir/file2.txt")).toBe(true);
    expect(vol.existsSync("/file1.txt")).toBe(false);
    expect(vol.existsSync("/file2.txt")).toBe(false);
  });

  test("moves directory into another directory", async () => {
    await sh`mv /dir /destdir`;
    expect(vol.existsSync("/destdir/dir")).toBe(true);
    expect(vol.existsSync("/destdir/dir/file3.txt")).toBe(true);
    expect(vol.existsSync("/destdir/dir/subdir/file4.txt")).toBe(true);
    expect(vol.existsSync("/dir")).toBe(false);
  });

  test("renames directory", async () => {
    await sh`mv /dir /renameddir`;
    expect(vol.existsSync("/renameddir")).toBe(true);
    expect(vol.existsSync("/renameddir/file3.txt")).toBe(true);
    expect(vol.existsSync("/dir")).toBe(false);
  });

  test("error when source doesn't exist", async () => {
    const result = await sh`mv /nonexistent.txt /dest.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cannot stat");
  });

  test("error when multiple sources and dest is not a directory", async () => {
    const result = await sh`mv /file1.txt /file2.txt /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("not a directory");
  });

  test("-n flag prevents overwrite", async () => {
    vol.writeFileSync("/dest.txt", "original");
    await sh`mv -n /file1.txt /dest.txt`;
    expect(vol.readFileSync("/dest.txt", "utf8")).toBe("original");
    // Source should still exist since move was skipped
    expect(vol.existsSync("/file1.txt")).toBe(true);
  });

  test("--no-clobber flag prevents overwrite", async () => {
    vol.writeFileSync("/dest2.txt", "original");
    await sh`mv --no-clobber /file1.txt /dest2.txt`;
    expect(vol.readFileSync("/dest2.txt", "utf8")).toBe("original");
    expect(vol.existsSync("/file1.txt")).toBe(true);
  });

  test("overwrites by default", async () => {
    vol.writeFileSync("/dest3.txt", "original");
    await sh`mv /file1.txt /dest3.txt`;
    expect(vol.readFileSync("/dest3.txt", "utf8")).toBe("content1");
    expect(vol.existsSync("/file1.txt")).toBe(false);
  });

  test("error with missing destination operand", async () => {
    const result = await sh`mv /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing destination");
  });

  test("-f flag is accepted (force is default)", async () => {
    vol.writeFileSync("/dest4.txt", "original");
    await sh`mv -f /file1.txt /dest4.txt`;
    expect(vol.readFileSync("/dest4.txt", "utf8")).toBe("content1");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`mv -x /file1.txt /dest.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`mv --invalid /file1.txt /dest.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
