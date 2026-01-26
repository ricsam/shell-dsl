import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("cp command", () => {
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

  test("copies a file", async () => {
    await sh`cp /file1.txt /copy.txt`;
    expect(vol.existsSync("/copy.txt")).toBe(true);
    expect(vol.readFileSync("/copy.txt", "utf8")).toBe("content1");
    // Original should still exist
    expect(vol.existsSync("/file1.txt")).toBe(true);
  });

  test("copies file into directory", async () => {
    await sh`cp /file1.txt /destdir`;
    expect(vol.existsSync("/destdir/file1.txt")).toBe(true);
    expect(vol.readFileSync("/destdir/file1.txt", "utf8")).toBe("content1");
  });

  test("copies multiple files into directory", async () => {
    await sh`cp /file1.txt /file2.txt /destdir`;
    expect(vol.existsSync("/destdir/file1.txt")).toBe(true);
    expect(vol.existsSync("/destdir/file2.txt")).toBe(true);
  });

  test("copies directory recursively with -r", async () => {
    await sh`cp -r /dir /dircopy`;
    expect(vol.existsSync("/dircopy")).toBe(true);
    expect(vol.existsSync("/dircopy/file3.txt")).toBe(true);
    expect(vol.readFileSync("/dircopy/file3.txt", "utf8")).toBe("content3");
    expect(vol.existsSync("/dircopy/subdir/file4.txt")).toBe(true);
    // Original should still exist
    expect(vol.existsSync("/dir")).toBe(true);
  });

  test("-R is alias for -r", async () => {
    await sh`cp -R /dir /dircopy2`;
    expect(vol.existsSync("/dircopy2")).toBe(true);
    expect(vol.existsSync("/dircopy2/file3.txt")).toBe(true);
  });

  test("--recursive flag works", async () => {
    await sh`cp --recursive /dir /dircopy3`;
    expect(vol.existsSync("/dircopy3")).toBe(true);
  });

  test("copies directory into existing directory", async () => {
    await sh`cp -r /dir /destdir`;
    expect(vol.existsSync("/destdir/dir")).toBe(true);
    expect(vol.existsSync("/destdir/dir/file3.txt")).toBe(true);
  });

  test("error copying directory without -r", async () => {
    const result = await sh`cp /dir /dircopy`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("-r not specified");
  });

  test("error when source doesn't exist", async () => {
    const result = await sh`cp /nonexistent.txt /dest.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cannot stat");
  });

  test("error when multiple sources and dest is not a directory", async () => {
    const result = await sh`cp /file1.txt /file2.txt /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("not a directory");
  });

  test("-n flag prevents overwrite", async () => {
    vol.writeFileSync("/dest.txt", "original");
    await sh`cp -n /file1.txt /dest.txt`;
    expect(vol.readFileSync("/dest.txt", "utf8")).toBe("original");
  });

  test("--no-clobber flag prevents overwrite", async () => {
    vol.writeFileSync("/dest2.txt", "original");
    await sh`cp --no-clobber /file1.txt /dest2.txt`;
    expect(vol.readFileSync("/dest2.txt", "utf8")).toBe("original");
  });

  test("overwrites by default", async () => {
    vol.writeFileSync("/dest3.txt", "original");
    await sh`cp /file1.txt /dest3.txt`;
    expect(vol.readFileSync("/dest3.txt", "utf8")).toBe("content1");
  });

  test("error with missing destination operand", async () => {
    const result = await sh`cp /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing destination");
  });
});
