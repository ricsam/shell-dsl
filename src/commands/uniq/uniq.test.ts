import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("uniq command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/consecutive.txt": "foo\nfoo\nbar\nbar\nbar\nbaz\n",
      "/mixed.txt": "foo\nbar\nfoo\nbaz\nbar\n",
      "/single.txt": "one\ntwo\nthree\n",
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

  test("removes consecutive duplicates", async () => {
    const result = await sh`uniq /consecutive.txt`.text();
    expect(result).toBe("foo\nbar\nbaz\n");
  });

  test("-c prefixes lines with count", async () => {
    const result = await sh`uniq -c /consecutive.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines[0]).toMatch(/\s*2 foo/);
    expect(lines[1]).toMatch(/\s*3 bar/);
    expect(lines[2]).toMatch(/\s*1 baz/);
  });

  test("-d only outputs duplicate lines", async () => {
    const result = await sh`uniq -d /consecutive.txt`.text();
    expect(result).toBe("foo\nbar\n");
  });

  test("-u only outputs unique lines", async () => {
    const result = await sh`uniq -u /consecutive.txt`.text();
    expect(result).toBe("baz\n");
  });

  test("reads from stdin", async () => {
    const input = Buffer.from("a\na\nb\nc\nc\n");
    const result = await sh`cat < ${input} | uniq`.text();
    expect(result).toBe("a\nb\nc\n");
  });

  test("preserves non-consecutive duplicates", async () => {
    const result = await sh`uniq /mixed.txt`.text();
    expect(result).toBe("foo\nbar\nfoo\nbaz\nbar\n");
  });

  test("combined flags -cd work", async () => {
    const result = await sh`uniq -cd /consecutive.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/\s*2 foo/);
    expect(lines[1]).toMatch(/\s*3 bar/);
  });

  test("handles empty input", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`uniq /empty.txt`.text();
    expect(result).toBe("");
  });

  test("handles single line", async () => {
    vol.writeFileSync("/single-line.txt", "only\n");
    const result = await sh`uniq /single-line.txt`.text();
    expect(result).toBe("only\n");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`uniq /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("all unique lines with -u", async () => {
    const result = await sh`uniq -u /single.txt`.text();
    expect(result).toBe("one\ntwo\nthree\n");
  });

  test("no output with -d when no duplicates", async () => {
    const result = await sh`uniq -d /single.txt`.text();
    expect(result).toBe("");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`uniq -x /consecutive.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`uniq --invalid /consecutive.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
