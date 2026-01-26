import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS } from "../src/index.ts";
import type { VirtualFS } from "../src/types.ts";

describe("VirtualFS Adapter", () => {
  let vol: InstanceType<typeof Volume>;
  let fs: VirtualFS;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file.txt": "content",
      "/dir/nested.txt": "nested content",
      "/dir/sub/deep.txt": "deep content",
    });
    const memfs = createFsFromVolume(vol);
    fs = createVirtualFS(memfs);
  });

  describe("readFile", () => {
    test("reads file content as Buffer", async () => {
      const content = await fs.readFile("/file.txt");
      expect(content).toBeInstanceOf(Buffer);
      expect(content.toString()).toBe("content");
    });

    test("throws on non-existent file", async () => {
      await expect(fs.readFile("/nonexistent")).rejects.toThrow();
    });
  });

  describe("readdir", () => {
    test("lists directory contents", async () => {
      const entries = await fs.readdir("/");
      expect(entries).toContain("file.txt");
      expect(entries).toContain("dir");
    });

    test("lists subdirectory contents", async () => {
      const entries = await fs.readdir("/dir");
      expect(entries).toContain("nested.txt");
      expect(entries).toContain("sub");
    });
  });

  describe("stat", () => {
    test("returns FileStat for file", async () => {
      const stat = await fs.stat("/file.txt");
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(typeof stat.size).toBe("number");
      expect(stat.mtime).toBeInstanceOf(Date);
    });

    test("returns FileStat for directory", async () => {
      const stat = await fs.stat("/dir");
      expect(stat.isFile()).toBe(false);
      expect(stat.isDirectory()).toBe(true);
    });

    test("throws on non-existent path", async () => {
      await expect(fs.stat("/nonexistent")).rejects.toThrow();
    });
  });

  describe("exists", () => {
    test("returns true for existing file", async () => {
      expect(await fs.exists("/file.txt")).toBe(true);
    });

    test("returns true for existing directory", async () => {
      expect(await fs.exists("/dir")).toBe(true);
    });

    test("returns false for non-existent path", async () => {
      expect(await fs.exists("/nonexistent")).toBe(false);
    });
  });

  describe("writeFile", () => {
    test("creates new file with content", async () => {
      await fs.writeFile("/new.txt", "new content");
      expect(vol.readFileSync("/new.txt", "utf8")).toBe("new content");
    });

    test("overwrites existing file", async () => {
      await fs.writeFile("/file.txt", "overwritten");
      expect(vol.readFileSync("/file.txt", "utf8")).toBe("overwritten");
    });

    test("accepts Buffer content", async () => {
      await fs.writeFile("/buffer.txt", Buffer.from("buffer content"));
      expect(vol.readFileSync("/buffer.txt", "utf8")).toBe("buffer content");
    });
  });

  describe("appendFile", () => {
    test("appends to existing file", async () => {
      await fs.appendFile("/file.txt", " appended");
      expect(vol.readFileSync("/file.txt", "utf8")).toBe("content appended");
    });

    test("creates file if not exists", async () => {
      await fs.appendFile("/new-append.txt", "first content");
      expect(vol.readFileSync("/new-append.txt", "utf8")).toBe("first content");
    });
  });

  describe("mkdir", () => {
    test("creates directory", async () => {
      await fs.mkdir("/newdir");
      expect(vol.statSync("/newdir").isDirectory()).toBe(true);
    });

    test("creates nested directories with recursive option", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(vol.statSync("/a/b/c").isDirectory()).toBe(true);
    });

    test("throws without recursive when parent doesn't exist", async () => {
      await expect(fs.mkdir("/nonexistent/child")).rejects.toThrow();
    });
  });

  describe("rm", () => {
    test("removes file", async () => {
      await fs.rm("/file.txt");
      expect(vol.existsSync("/file.txt")).toBe(false);
    });

    test("removes empty directory", async () => {
      vol.mkdirSync("/empty-dir");
      await fs.rm("/empty-dir");
      expect(vol.existsSync("/empty-dir")).toBe(false);
    });

    test("removes directory recursively", async () => {
      await fs.rm("/dir", { recursive: true });
      expect(vol.existsSync("/dir")).toBe(false);
    });

    test("throws on non-existent without force", async () => {
      await expect(fs.rm("/nonexistent")).rejects.toThrow();
    });

    test("does not throw on non-existent with force", async () => {
      await fs.rm("/nonexistent", { force: true });
      // Should not throw
    });
  });

  describe("Path utilities", () => {
    test("resolve combines paths", () => {
      expect(fs.resolve("/dir", "file.txt")).toBe("/dir/file.txt");
      expect(fs.resolve("/dir", "..", "other")).toBe("/other");
    });

    test("dirname returns parent directory", () => {
      expect(fs.dirname("/dir/file.txt")).toBe("/dir");
      expect(fs.dirname("/file.txt")).toBe("/");
    });

    test("basename returns file name", () => {
      expect(fs.basename("/dir/file.txt")).toBe("file.txt");
      expect(fs.basename("/dir/")).toBe("dir");
    });
  });

  describe("glob", () => {
    test("matches files with wildcard", async () => {
      const matches = await fs.glob("*.txt", { cwd: "/" });
      expect(matches).toContain("/file.txt");
    });

    test("matches recursively with **", async () => {
      const matches = await fs.glob("**/*.txt", { cwd: "/" });
      expect(matches).toContain("/file.txt");
      expect(matches).toContain("/dir/nested.txt");
      expect(matches).toContain("/dir/sub/deep.txt");
    });

    test("uses cwd option for relative patterns", async () => {
      const matches = await fs.glob("*.txt", { cwd: "/dir" });
      expect(matches).toContain("/dir/nested.txt");
      expect(matches).not.toContain("/file.txt");
    });

    test("returns empty array for no matches", async () => {
      const matches = await fs.glob("*.xyz", { cwd: "/" });
      expect(matches).toEqual([]);
    });
  });
});
