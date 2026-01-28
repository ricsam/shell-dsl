import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("ls command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/dir/file1.txt": "content1",
      "/dir/file2.txt": "content2",
      "/dir/.hidden": "hidden content",
      "/dir/subdir/.gitkeep": "",
      "/single.txt": "single file",
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

  test("lists directory contents", async () => {
    const result = await sh`ls /dir`.text();
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
    expect(result).toContain("subdir");
    // Should not contain hidden by default
    expect(result).not.toContain(".hidden");
  });

  test("-a shows hidden files", async () => {
    const result = await sh`ls -a /dir`.text();
    expect(result).toContain("file1.txt");
    expect(result).toContain(".hidden");
  });

  test("-l shows long format", async () => {
    const result = await sh`ls -l /dir`.text();
    expect(result).toContain("file1.txt");
    // Long format should have permissions and dates
    expect(result).toMatch(/[-d]rwx/);
  });

  test("-1 shows one entry per line", async () => {
    const result = await sh`ls -1 /dir`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("file1.txt");
    expect(lines).toContain("file2.txt");
    expect(lines).toContain("subdir");
  });

  test("-la combined works", async () => {
    const result = await sh`ls -la /dir`.text();
    expect(result).toContain(".hidden");
    expect(result).toMatch(/[-d]rwx/);
  });

  test("-al combined works (order shouldn't matter)", async () => {
    const result = await sh`ls -al /dir`.text();
    expect(result).toContain(".hidden");
  });

  test("lists specific file", async () => {
    const result = await sh`ls /single.txt`.text();
    expect(result.trim()).toBe("single.txt");
  });

  test("multiple paths", async () => {
    vol.mkdirSync("/dir2");
    vol.writeFileSync("/dir2/other.txt", "other");
    const result = await sh`ls /dir /dir2`.text();
    expect(result).toContain("/dir:");
    expect(result).toContain("/dir2:");
    expect(result).toContain("file1.txt");
    expect(result).toContain("other.txt");
  });

  test("error on nonexistent path", async () => {
    const result = await sh`ls /nonexistent`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("lists current directory by default", async () => {
    sh.cwd("/dir");
    const result = await sh`ls`.text();
    expect(result).toContain("file1.txt");
  });

  test("entries are sorted alphabetically", async () => {
    const result = await sh`ls -1 /dir`.text();
    const lines = result.trim().split("\n");
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
  });

  test("-l shows directory with d prefix", async () => {
    const result = await sh`ls -l /dir`.text();
    // subdir should have 'd' prefix
    expect(result).toMatch(/drwx.*subdir/);
  });

  test("-l shows file size", async () => {
    const result = await sh`ls -l /dir`.text();
    // file1.txt has "content1" = 8 bytes
    expect(result).toContain("8");
  });

  test("handles empty directory", async () => {
    vol.mkdirSync("/empty");
    const result = await sh`ls /empty`.text();
    expect(result.trim()).toBe("");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`ls -x /dir`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`ls --invalid /dir`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
