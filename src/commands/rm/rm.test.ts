import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("rm command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file1.txt": "content1",
      "/file2.txt": "content2",
      "/dir/file3.txt": "content3",
      "/dir/subdir/file4.txt": "content4",
      "/empty-dir/.gitkeep": "",
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

  test("removes a file", async () => {
    await sh`rm /file1.txt`;
    expect(vol.existsSync("/file1.txt")).toBe(false);
  });

  test("removes multiple files", async () => {
    await sh`rm /file1.txt /file2.txt`;
    expect(vol.existsSync("/file1.txt")).toBe(false);
    expect(vol.existsSync("/file2.txt")).toBe(false);
  });

  test("-r removes directory recursively", async () => {
    await sh`rm -r /dir`;
    expect(vol.existsSync("/dir")).toBe(false);
    expect(vol.existsSync("/dir/file3.txt")).toBe(false);
    expect(vol.existsSync("/dir/subdir")).toBe(false);
  });

  test("-R is alias for -r", async () => {
    await sh`rm -R /dir`;
    expect(vol.existsSync("/dir")).toBe(false);
  });

  test("-f ignores nonexistent files", async () => {
    const result = await sh`rm -f /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(0);
  });

  test("-rf combined removes directory without error", async () => {
    await sh`rm -rf /dir`;
    expect(vol.existsSync("/dir")).toBe(false);
  });

  test("-fr combined removes directory without error", async () => {
    // recreate dir for this test
    vol.mkdirSync("/newdir");
    vol.writeFileSync("/newdir/file.txt", "test");
    await sh`rm -fr /newdir`;
    expect(vol.existsSync("/newdir")).toBe(false);
  });

  test("error on nonexistent file without -f", async () => {
    const result = await sh`rm /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("nonexistent.txt");
  });

  test("error on directory without -r", async () => {
    const result = await sh`rm /dir`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("error message format includes filename", async () => {
    const result = await sh`rm /missing-file.txt`.nothrow();
    expect(result.stderr.toString()).toContain("missing-file.txt");
  });

  test("missing operand error without -f", async () => {
    const result = await sh`rm`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing operand");
  });

  test("no error with -f and no operands", async () => {
    const result = await sh`rm -f`.nothrow();
    expect(result.exitCode).toBe(0);
  });
});
