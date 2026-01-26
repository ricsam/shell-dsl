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

  describe("Recursive glob patterns", () => {
    test("** matches files in subdirectories", async () => {
      const result = await sh`echo **/*.txt`.text();
      const files = result.trim().split(/\s+/).sort();
      // Should include files in current dir and subdirectories
      expect(files).toContain("/files/a.txt");
      expect(files).toContain("/files/b.txt");
      expect(files).toContain("/files/sub/e.txt");
      expect(files).toContain("/files/sub/f.txt");
    });

    test("**/file.txt matches specific filename recursively", async () => {
      vol.mkdirSync("/files/sub/deep", { recursive: true });
      vol.writeFileSync("/files/sub/deep/target.txt", "deep");
      const result = await sh`echo **/target.txt`.text();
      expect(result.trim()).toContain("/files/sub/deep/target.txt");
    });

    test("**/*.md matches only .md files recursively", async () => {
      vol.writeFileSync("/files/sub/nested.md", "nested md");
      const result = await sh`echo **/*.md`.text();
      const files = result.trim().split(/\s+/).sort();
      expect(files).toContain("/files/c.md");
      expect(files).toContain("/files/d.md");
      expect(files).toContain("/files/sub/nested.md");
      // Should not contain .txt files
      expect(files.filter((f) => f.endsWith(".txt"))).toEqual([]);
    });

    test("** with multiple directory levels", async () => {
      vol.mkdirSync("/files/a/b/c", { recursive: true });
      vol.writeFileSync("/files/a/b/c/deep.txt", "very deep");
      const result = await sh`echo **/deep.txt`.text();
      expect(result.trim()).toContain("/files/a/b/c/deep.txt");
    });
  });
});
