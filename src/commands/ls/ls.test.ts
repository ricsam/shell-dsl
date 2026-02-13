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

  test("-R lists directory and subdirectories recursively with headers", async () => {
    const result = await sh`ls -R /dir`.text();
    expect(result).toContain("/dir:");
    expect(result).toContain("file1.txt");
    expect(result).toContain("subdir");
    expect(result).toContain("/dir/subdir:");
  });

  test("-laR combines all flags correctly", async () => {
    const result = await sh`ls -laR /dir`.text();
    expect(result).toContain("/dir:");
    expect(result).toContain(".hidden");
    expect(result).toMatch(/[-d]rwx/);
    expect(result).toContain("/dir/subdir:");
  });

  test("-R on a directory with no subdirectories", async () => {
    vol.mkdirSync("/flat");
    vol.writeFileSync("/flat/a.txt", "a");
    vol.writeFileSync("/flat/b.txt", "b");
    const result = await sh`ls -R /flat`.text();
    expect(result).toContain("/flat:");
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
    // Should not contain any other header
    const headers = result.match(/^\S+:$/gm) || [];
    expect(headers).toHaveLength(1);
  });

  test("-R on nested directories (multiple levels deep)", async () => {
    vol.mkdirSync("/deep/a/b", { recursive: true });
    vol.writeFileSync("/deep/top.txt", "top");
    vol.writeFileSync("/deep/a/mid.txt", "mid");
    vol.writeFileSync("/deep/a/b/bottom.txt", "bottom");
    const result = await sh`ls -R /deep`.text();
    expect(result).toContain("/deep:");
    expect(result).toContain("top.txt");
    expect(result).toContain("/deep/a:");
    expect(result).toContain("mid.txt");
    expect(result).toContain("/deep/a/b:");
    expect(result).toContain("bottom.txt");
  });

  test("default (non-TTY) outputs one entry per line", async () => {
    const result = await sh`ls /dir`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("file1.txt");
    expect(lines).toContain("file2.txt");
    expect(lines).toContain("subdir");
    // Each entry should be on its own line
    expect(lines.length).toBe(3);
  });

  test("isTTY: true outputs space-separated", async () => {
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);
    const ttysh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
      isTTY: true,
    });

    const result = await ttysh`ls /dir`.text();
    // Space-separated on one line
    expect(result.trim().split("\n").length).toBe(1);
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
  });

  test("isTTY: true piped still outputs one-per-line (pipe forces isTTY=false)", async () => {
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);
    const ttysh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
      isTTY: true,
    });

    const result = await ttysh`ls /dir | grep file`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("file1.txt");
    expect(lines).toContain("file2.txt");
    expect(lines.length).toBe(2);
  });

  test("ls | grep pipeline returns matching entries", async () => {
    const result = await sh`ls /dir | grep file`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("file1.txt");
    expect(lines).toContain("file2.txt");
    expect(lines).not.toContain("subdir");
  });

  describe("-h flag (human-readable sizes)", () => {
    test("-lh shows human-readable sizes", async () => {
      vol.writeFileSync("/dir/big.bin", Buffer.alloc(2048));
      const result = await sh`ls -lh /dir`.text();
      expect(result).toContain("2.0K");
    });

    test("-lh formats bytes (< 1024) as raw number", async () => {
      // file1.txt has "content1" = 8 bytes
      const result = await sh`ls -lh /dir`.text();
      expect(result).toMatch(/\s+8\s/);
    });

    test("-lh formats kilobytes", async () => {
      vol.writeFileSync("/dir/medium.bin", Buffer.alloc(15 * 1024));
      const result = await sh`ls -lh /dir`.text();
      expect(result).toContain("15K");
    });

    test("-lh formats megabytes", async () => {
      vol.writeFileSync("/dir/large.bin", Buffer.alloc(5 * 1024 * 1024));
      const result = await sh`ls -lh /dir`.text();
      expect(result).toContain("5.0M");
    });

    test("-lah combined works", async () => {
      vol.writeFileSync("/dir/big.bin", Buffer.alloc(2048));
      const result = await sh`ls -lah /dir`.text();
      expect(result).toContain(".hidden");
      expect(result).toContain("2.0K");
      expect(result).toMatch(/[-d]rwx/);
    });

    test("-h without -l is silently ignored", async () => {
      const result = await sh`ls -h /dir`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("file1.txt");
      // Should not contain size info
      expect(result).not.toMatch(/rwx/);
    });
  });

  describe("TTY color support", () => {
    let ttysh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      const memfs = createFsFromVolume(vol);
      const fs = createVirtualFS(memfs);
      ttysh = createShellDSL({
        fs,
        cwd: "/",
        env: {},
        commands: builtinCommands,
        isTTY: true,
      });
    });

    test("TTY mode colorizes directories in long format", async () => {
      const result = await ttysh`ls -l /dir`.text();
      // subdir should be wrapped in bold blue
      expect(result).toContain("\x1b[1;34msubdir\x1b[0m");
      // regular files should not have color
      expect(result).not.toContain("\x1b[1;34mfile1.txt");
    });

    test("TTY mode colorizes directories in default (space-separated) format", async () => {
      const result = await ttysh`ls /dir`.text();
      expect(result).toContain("\x1b[1;34msubdir\x1b[0m");
      expect(result).not.toContain("\x1b[1;34mfile1.txt");
    });

    test("TTY mode with -1 still colorizes directories", async () => {
      const result = await ttysh`ls -1 /dir`.text();
      expect(result).toContain("\x1b[1;34msubdir\x1b[0m");
      expect(result).not.toContain("\x1b[1;34mfile1.txt");
    });

    test("non-TTY mode has no ANSI escape codes", async () => {
      const result = await sh`ls /dir`.text();
      expect(result).not.toContain("\x1b[");
    });

    test("piped output has no ANSI escape codes even with TTY shell", async () => {
      const result = await ttysh`ls /dir | cat`.text();
      expect(result).not.toContain("\x1b[");
    });
  });
});
