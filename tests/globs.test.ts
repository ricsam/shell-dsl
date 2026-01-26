import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Glob Expansion", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/files/a.txt": "a",
      "/files/b.txt": "b",
      "/files/c.md": "c",
      "/files/d.md": "d",
      "/files/sub/e.txt": "e",
      "/files/sub/f.txt": "f",
    });
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/files",
      env: {},
      commands: builtinCommands,
    });
  });

  test("* matches files in current directory", async () => {
    const result = await sh`echo *.txt`.text();
    expect(result.trim().split(/\s+/).sort()).toEqual(["/files/a.txt", "/files/b.txt"]);
  });

  test("* matches all files", async () => {
    const result = await sh`ls -1 *.md`.text();
    const files = result.trim().split("\n").sort();
    expect(files).toEqual(["c.md", "d.md"]);
  });

  test("? matches single character", async () => {
    const result = await sh`echo ?.txt`.text();
    expect(result.trim().split(/\s+/).sort()).toEqual(["/files/a.txt", "/files/b.txt"]);
  });

  test("no matches returns pattern as-is", async () => {
    const result = await sh`echo *.xyz`.text();
    expect(result.trim()).toBe("*.xyz");
  });

  test("brace expansion {a,b}", async () => {
    const result = await sh`echo {a,b}.txt`.text();
    expect(result.trim().split(/\s+/).sort()).toEqual(["/files/a.txt", "/files/b.txt"]);
  });
});
