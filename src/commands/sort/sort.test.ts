import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("sort command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/alpha.txt": "banana\napple\ncherry\ndate\n",
      "/numbers.txt": "10\n2\n1\n20\n3\n",
      "/duplicates.txt": "foo\nbar\nfoo\nbaz\nbar\n",
      "/file1.txt": "z\na\n",
      "/file2.txt": "m\nb\n",
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

  test("sorts lines alphabetically by default", async () => {
    const result = await sh`sort /alpha.txt`.text();
    expect(result).toBe("apple\nbanana\ncherry\ndate\n");
  });

  test("-r reverses sort order", async () => {
    const result = await sh`sort -r /alpha.txt`.text();
    expect(result).toBe("date\ncherry\nbanana\napple\n");
  });

  test("-n sorts numerically", async () => {
    const result = await sh`sort -n /numbers.txt`.text();
    expect(result).toBe("1\n2\n3\n10\n20\n");
  });

  test("-u removes duplicates", async () => {
    const result = await sh`sort -u /duplicates.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("foo");
    expect(lines).toContain("bar");
    expect(lines).toContain("baz");
    expect(lines.length).toBe(3);
  });

  test("-rn combined: reverse numeric", async () => {
    const result = await sh`sort -rn /numbers.txt`.text();
    expect(result).toBe("20\n10\n3\n2\n1\n");
  });

  test("-nu combined: numeric unique", async () => {
    vol.writeFileSync("/dup-nums.txt", "1\n2\n1\n3\n2\n");
    const result = await sh`sort -nu /dup-nums.txt`.text();
    expect(result).toBe("1\n2\n3\n");
  });

  test("reads from stdin when no files", async () => {
    // Use Buffer input instead of echo -e which doesn't interpret escape sequences
    const input = Buffer.from("c\na\nb\n");
    const result = await sh`cat < ${input} | sort`.text();
    expect(result).toBe("a\nb\nc\n");
  });

  test("sorts stdin input", async () => {
    const input = Buffer.from("cherry\napple\nbanana\n");
    const result = await sh`cat < ${input} | sort`.text();
    expect(result).toBe("apple\nbanana\ncherry\n");
  });

  test("sorts multiple files together", async () => {
    const result = await sh`sort /file1.txt /file2.txt`.text();
    expect(result).toBe("a\nb\nm\nz\n");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`sort /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("handles empty file", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`sort /empty.txt`.text();
    expect(result).toBe("");
  });

  test("combined flags -ru work", async () => {
    const result = await sh`sort -ru /duplicates.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("foo");
    expect(lines[2]).toBe("bar");
  });
});
