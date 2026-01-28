import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("head command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    vol.fromJSON({
      "/twenty.txt": lines,
      "/five.txt": "one\ntwo\nthree\nfour\nfive\n",
      "/short.txt": "a\nb\nc\n",
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

  test("outputs first 10 lines by default", async () => {
    const result = await sh`head /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(10);
    expect(lines[0]).toBe("line1");
    expect(lines[9]).toBe("line10");
  });

  test("-n 5 outputs first 5 lines", async () => {
    const result = await sh`head -n 5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
    expect(lines[4]).toBe("line5");
  });

  test("-n5 combined form works", async () => {
    const result = await sh`head -n5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
  });

  test("-5 legacy form works", async () => {
    const result = await sh`head -5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
  });

  test("reads from stdin", async () => {
    const input = Buffer.from("a\nb\nc\nd\ne\nf\n");
    const result = await sh`cat < ${input} | head -n 3`.text();
    expect(result).toBe("a\nb\nc\n");
  });

  test("multiple files show headers", async () => {
    const result = await sh`head -n 2 /five.txt /short.txt`.text();
    expect(result).toContain("==> /five.txt <==");
    expect(result).toContain("==> /short.txt <==");
    expect(result).toContain("one");
    expect(result).toContain("a");
  });

  test("file with fewer lines outputs all", async () => {
    const result = await sh`head -n 100 /short.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("error on nonexistent file", async () => {
    const result = await sh`head /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("-n 0 outputs nothing", async () => {
    const result = await sh`head -n 0 /twenty.txt`.text();
    expect(result).toBe("");
  });

  test("handles empty file", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`head /empty.txt`.text();
    expect(result).toBe("");
  });

  test("-n 1 outputs single line", async () => {
    const result = await sh`head -n 1 /five.txt`.text();
    expect(result).toBe("one\n");
  });

  test("invalid number of lines returns error", async () => {
    const result = await sh`head -n abc /five.txt`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`head -x /five.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`head --invalid /five.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
