import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("tree command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/mydir/file1.txt": "content1",
      "/mydir/file2.txt": "content2",
      "/mydir/subdir/nested.txt": "nested content",
      "/mydir/subdir/deep/file.txt": "deep content",
      "/mydir/.hidden": "hidden file",
      "/mydir/.hiddendir/secret.txt": "secret",
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

  test("basic tree output with nested directories", async () => {
    const result = await sh`tree /mydir`.text();
    expect(result).toContain("/mydir");
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
    expect(result).toContain("subdir");
    expect(result).toContain("nested.txt");
    expect(result).toContain("deep");
    // Should not contain hidden by default
    expect(result).not.toContain(".hidden");
    expect(result).not.toContain(".hiddendir");
  });

  test("displays correct tree characters", async () => {
    const result = await sh`tree /mydir`.text();
    // Should contain tree branch characters
    expect(result).toMatch(/[├└]── /);
    expect(result).toMatch(/│   /);
  });

  test("-a flag shows hidden files", async () => {
    const result = await sh`tree -a /mydir`.text();
    expect(result).toContain(".hidden");
    expect(result).toContain(".hiddendir");
    expect(result).toContain("secret.txt");
  });

  test("--all flag shows hidden files", async () => {
    const result = await sh`tree --all /mydir`.text();
    expect(result).toContain(".hidden");
    expect(result).toContain(".hiddendir");
  });

  test("-d flag shows only directories", async () => {
    const result = await sh`tree -d /mydir`.text();
    expect(result).toContain("subdir");
    expect(result).toContain("deep");
    // Should not contain files
    expect(result).not.toContain("file1.txt");
    expect(result).not.toContain("file2.txt");
    expect(result).not.toContain("nested.txt");
  });

  test("-L limits recursion depth to 1", async () => {
    const result = await sh`tree -L 1 /mydir`.text();
    expect(result).toContain("subdir");
    expect(result).toContain("file1.txt");
    // Should not recurse into subdir
    expect(result).not.toContain("nested.txt");
    expect(result).not.toContain("deep");
  });

  test("-L limits recursion depth to 2", async () => {
    const result = await sh`tree -L 2 /mydir`.text();
    expect(result).toContain("subdir");
    expect(result).toContain("nested.txt");
    expect(result).toContain("deep");
    // Should not recurse into deep
    expect(result).not.toContain("file.txt");
  });

  test("-L2 format (no space) works", async () => {
    const result = await sh`tree -L1 /mydir`.text();
    expect(result).toContain("subdir");
    expect(result).not.toContain("nested.txt");
  });

  test("combined flags -ad work", async () => {
    const result = await sh`tree -ad /mydir`.text();
    expect(result).toContain("subdir");
    expect(result).toContain(".hiddendir");
    // Should not contain files
    expect(result).not.toContain("file1.txt");
    // .hidden is a file, should not appear (check it's not on its own line)
    expect(result).not.toMatch(/[├└]── \.hidden\n/);
  });

  test("error handling for nonexistent paths", async () => {
    const result = await sh`tree /nonexistent`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file or directory");
  });

  test("empty directory handling", async () => {
    vol.mkdirSync("/emptydir");
    const result = await sh`tree /emptydir`.text();
    expect(result).toContain("/emptydir");
    expect(result).toContain("0 directories, 0 files");
  });

  test("single file path just prints the filename", async () => {
    const result = await sh`tree /single.txt`.text();
    expect(result).toContain("/single.txt");
    expect(result).toContain("0 directories, 1 file");
  });

  test("summary line format for multiple items", async () => {
    const result = await sh`tree /mydir`.text();
    // Should end with summary line
    expect(result).toMatch(/\d+ directories?, \d+ files?\n$/);
  });

  test("summary uses singular 'directory' for 1 directory", async () => {
    vol.fromJSON({
      "/onedir/subdir/file.txt": "content",
    });
    const result = await sh`tree /onedir`.text();
    expect(result).toContain("1 directory,");
  });

  test("summary uses singular 'file' for 1 file", async () => {
    vol.fromJSON({
      "/onefile/file.txt": "content",
    });
    const result = await sh`tree /onefile`.text();
    expect(result).toContain("1 file");
    expect(result).not.toContain("1 files");
  });

  test("default path is current directory", async () => {
    sh.cwd("/mydir");
    const result = await sh`tree`.text();
    expect(result).toContain(".");
    expect(result).toContain("file1.txt");
  });

  test("-L requires argument", async () => {
    const result = await sh`tree -L`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing argument");
  });

  test("-L with invalid value", async () => {
    const result = await sh`tree -L 0`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Invalid level");
  });

  test("-L with non-numeric value", async () => {
    const result = await sh`tree -L abc`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing argument");
  });

  test("entries are sorted alphabetically", async () => {
    const result = await sh`tree /mydir`.text();
    const lines = result.split("\n");
    // Find lines with file1.txt and file2.txt
    const file1Index = lines.findIndex((l) => l.includes("file1.txt"));
    const file2Index = lines.findIndex((l) => l.includes("file2.txt"));
    expect(file1Index).toBeLessThan(file2Index);
  });

  test("directories come before files in listing", async () => {
    const result = await sh`tree /mydir`.text();
    const lines = result.split("\n");
    // subdir should come before file1.txt and file2.txt
    const subdirIndex = lines.findIndex((l) => l.includes("subdir"));
    const file1Index = lines.findIndex((l) => l.includes("file1.txt"));
    expect(subdirIndex).toBeLessThan(file1Index);
  });

  test("last entry uses └── connector", async () => {
    const result = await sh`tree /mydir`.text();
    // The last visible entry at each level should use └──
    expect(result).toContain("└── ");
  });

  test("non-last entries use ├── connector", async () => {
    const result = await sh`tree /mydir`.text();
    // Non-last entries should use ├──
    expect(result).toContain("├── ");
  });

  test("invalid flag returns error", async () => {
    const result = await sh`tree -x /mydir`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Invalid argument");
  });
});
