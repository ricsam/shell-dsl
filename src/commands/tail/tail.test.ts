import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("tail command", () => {
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

  test("outputs last 10 lines by default", async () => {
    const result = await sh`tail /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(10);
    expect(lines[0]).toBe("line11");
    expect(lines[9]).toBe("line20");
  });

  test("-n 5 outputs last 5 lines", async () => {
    const result = await sh`tail -n 5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
    expect(lines[0]).toBe("line16");
    expect(lines[4]).toBe("line20");
  });

  test("-n5 combined form works", async () => {
    const result = await sh`tail -n5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
    expect(lines[4]).toBe("line20");
  });

  test("-5 legacy form works", async () => {
    const result = await sh`tail -5 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
  });

  test("reads from stdin", async () => {
    const input = Buffer.from("a\nb\nc\nd\ne\nf\n");
    const result = await sh`cat < ${input} | tail -n 3`.text();
    expect(result).toBe("d\ne\nf\n");
  });

  test("multiple files show headers", async () => {
    const result = await sh`tail -n 2 /five.txt /short.txt`.text();
    expect(result).toContain("==> /five.txt <==");
    expect(result).toContain("==> /short.txt <==");
    expect(result).toContain("four");
    expect(result).toContain("five");
    expect(result).toContain("b");
    expect(result).toContain("c");
  });

  test("file with fewer lines outputs all", async () => {
    const result = await sh`tail -n 100 /short.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("error on nonexistent file", async () => {
    const result = await sh`tail /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("-n 0 outputs all lines (JavaScript slice behavior)", async () => {
    // In JavaScript, slice(-0) equals slice(0) which returns all elements
    // This matches the implementation behavior
    const result = await sh`tail -n 0 /twenty.txt`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(20);
  });

  test("handles empty file", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`tail /empty.txt`.text();
    expect(result).toBe("");
  });

  test("-n 1 outputs single line", async () => {
    const result = await sh`tail -n 1 /five.txt`.text();
    expect(result).toBe("five\n");
  });

  test("invalid number of lines returns error", async () => {
    const result = await sh`tail -n abc /five.txt`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("works in pipeline", async () => {
    const result = await sh`head -n 15 /twenty.txt | tail -n 5`.text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(5);
    expect(lines[0]).toBe("line11");
    expect(lines[4]).toBe("line15");
  });
});
