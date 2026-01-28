import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("wc command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/lines.txt": "one\ntwo\nthree\nfour\nfive\n",
      "/words.txt": "hello world foo bar\n",
      "/mixed.txt": "line one\nline two\nline three\n",
      "/file1.txt": "a b\nc d\n",
      "/file2.txt": "e f g\n",
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

  test("-l counts lines", async () => {
    const result = await sh`wc -l /lines.txt`.text();
    expect(result).toContain("5");
    expect(result).toContain("lines.txt");
  });

  test("-w counts words", async () => {
    const result = await sh`wc -w /words.txt`.text();
    expect(result).toContain("4");
  });

  test("-c counts bytes", async () => {
    const result = await sh`wc -c /words.txt`.text();
    // "hello world foo bar\n" = 20 bytes
    expect(result).toContain("20");
  });

  test("-m counts characters (same as -c for ASCII)", async () => {
    const result = await sh`wc -m /words.txt`.text();
    expect(result).toContain("20");
  });

  test("default shows all counts", async () => {
    const result = await sh`wc /lines.txt`.text();
    // Should contain lines, words, and chars
    expect(result).toContain("5"); // lines
    expect(result).toContain("lines.txt");
  });

  test("-lw combined counts lines and words", async () => {
    const result = await sh`wc -lw /mixed.txt`.text();
    expect(result).toContain("3"); // lines
    expect(result).toContain("6"); // words: "line one line two line three"
  });

  test("multiple files show totals", async () => {
    const result = await sh`wc -l /file1.txt /file2.txt`.text();
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
    expect(result).toContain("total");
  });

  test("reads from stdin", async () => {
    const input = Buffer.from("one two three\n");
    const result = await sh`cat < ${input} | wc -w`.text();
    expect(result.trim()).toMatch(/3/);
  });

  test("error on nonexistent file", async () => {
    const result = await sh`wc /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("handles empty file", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`wc -l /empty.txt`.text();
    // wc counts newline-separated lines, empty file still has 1 logical line
    expect(result).toContain("empty.txt");
  });

  test("combined flags -lwc work", async () => {
    const result = await sh`wc -lwc /words.txt`.text();
    // Should show lines (1), words (4), chars (20)
    expect(result).toContain("1");
    expect(result).toContain("4");
    expect(result).toContain("20");
  });

  test("single word file", async () => {
    vol.writeFileSync("/single.txt", "word\n");
    const result = await sh`wc -w /single.txt`.text();
    expect(result).toContain("1");
  });

  test("file without trailing newline", async () => {
    vol.writeFileSync("/no-newline.txt", "no newline");
    const result = await sh`wc -l /no-newline.txt`.text();
    // wc counts lines based on \n splits, content without newline still counts as 1 line
    expect(result).toContain("no-newline.txt");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`wc -x /lines.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`wc --invalid /lines.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
