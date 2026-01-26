import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { FileSystem, type UnderlyingFS } from "../src/fs/real-fs.ts";
import { ReadOnlyFileSystem } from "../src/fs/readonly-fs.ts";

describe("FileSystem", () => {
  let vol: InstanceType<typeof Volume>;
  let memfs: UnderlyingFS;

  beforeEach(() => {
    vol = Volume.fromJSON({
      "/project/src/index.ts": "console.log('hello');",
      "/project/src/utils/helper.ts": "export const helper = 1;",
      "/project/config/app.json": "{}",
      "/project/.env": "SECRET=123",
      "/project/.git/HEAD": "ref: refs/heads/main",
    });
    memfs = createFsFromVolume(vol) as unknown as UnderlyingFS;
  });

  describe("Basic Operations", () => {
    test("reads file within mount", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const content = await fs.readFile("/src/index.ts");
      expect(content.toString()).toBe("console.log('hello');");
    });

    test("reads file from root path", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const content = await fs.readFile("src/index.ts");
      expect(content.toString()).toBe("console.log('hello');");
    });

    test("lists directory contents", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const entries = await fs.readdir("/");
      expect(entries).toContain("src");
      expect(entries).toContain("config");
      expect(entries).toContain(".env");
    });

    test("checks file existence", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      expect(await fs.exists("/src/index.ts")).toBe(true);
      expect(await fs.exists("/nonexistent.ts")).toBe(false);
    });

    test("gets file stats", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const stat = await fs.stat("/src/index.ts");
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
    });

    test("writes new file", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await fs.writeFile("/src/new.ts", "// new file");
      expect(vol.readFileSync("/project/src/new.ts", "utf8")).toBe("// new file");
    });

    test("appends to file", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await fs.appendFile("/src/index.ts", "\nconsole.log('appended');");
      expect(vol.readFileSync("/project/src/index.ts", "utf8")).toBe(
        "console.log('hello');\nconsole.log('appended');"
      );
    });

    test("creates directory", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await fs.mkdir("/new-dir", { recursive: true });
      expect(vol.statSync("/project/new-dir").isDirectory()).toBe(true);
    });

    test("removes file", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await fs.rm("/src/index.ts");
      expect(vol.existsSync("/project/src/index.ts")).toBe(false);
    });
  });

  describe("Path Containment", () => {
    test("blocks path traversal with ..", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await expect(fs.readFile("/../etc/passwd")).rejects.toThrow(/escapes mount/);
    });

    test("blocks path traversal with nested ..", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      await expect(fs.readFile("/src/../../etc/passwd")).rejects.toThrow(/escapes mount/);
    });

    test("allows .. that stays within mount", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const content = await fs.readFile("/src/../config/app.json");
      expect(content.toString()).toBe("{}");
    });
  });

  describe("Permission: excluded", () => {
    test("blocks read for excluded file", async () => {
      const fs = new FileSystem("/project", { ".env": "excluded" }, memfs);
      await expect(fs.readFile("/.env")).rejects.toThrow(/excluded/);
    });

    test("blocks write for excluded file", async () => {
      const fs = new FileSystem("/project", { ".env": "excluded" }, memfs);
      await expect(fs.writeFile("/.env", "NEW=value")).rejects.toThrow(/excluded/);
    });

    test("blocks existence check for excluded file", async () => {
      const fs = new FileSystem("/project", { ".env": "excluded" }, memfs);
      // exists returns false for excluded files (catches the error)
      expect(await fs.exists("/.env")).toBe(false);
    });

    test("blocks read for excluded directory pattern", async () => {
      const fs = new FileSystem("/project", { ".git/**": "excluded" }, memfs);
      await expect(fs.readFile("/.git/HEAD")).rejects.toThrow(/excluded/);
    });
  });

  describe("Permission: read-only", () => {
    test("allows read for read-only file", async () => {
      const fs = new FileSystem("/project", { "config/**": "read-only" }, memfs);
      const content = await fs.readFile("/config/app.json");
      expect(content.toString()).toBe("{}");
    });

    test("blocks write for read-only file", async () => {
      const fs = new FileSystem("/project", { "config/**": "read-only" }, memfs);
      await expect(fs.writeFile("/config/app.json", "new")).rejects.toThrow(/read-only/);
    });

    test("blocks append for read-only file", async () => {
      const fs = new FileSystem("/project", { "config/**": "read-only" }, memfs);
      await expect(fs.appendFile("/config/app.json", "new")).rejects.toThrow(/read-only/);
    });

    test("blocks rm for read-only file", async () => {
      const fs = new FileSystem("/project", { "config/**": "read-only" }, memfs);
      await expect(fs.rm("/config/app.json")).rejects.toThrow(/read-only/);
    });

    test("blocks mkdir in read-only directory", async () => {
      const fs = new FileSystem("/project", { "config/**": "read-only" }, memfs);
      await expect(fs.mkdir("/config/subdir")).rejects.toThrow(/read-only/);
    });
  });

  describe("Specificity: more specific rule wins", () => {
    test("literal path beats wildcard", async () => {
      const fs = new FileSystem(
        "/project",
        {
          "config/**": "read-only",
          "config/app.json": "read-write",
        },
        memfs
      );
      // Specific file should be writable
      await fs.writeFile("/config/app.json", '{"updated": true}');
      expect(vol.readFileSync("/project/config/app.json", "utf8")).toBe('{"updated": true}');
    });

    test("deeper path beats shallower", async () => {
      const fs = new FileSystem(
        "/project",
        {
          "**": "read-only",
          "src/**": "read-write",
        },
        memfs
      );
      // src is writable despite ** being read-only
      await fs.writeFile("/src/new.ts", "// new file");
      expect(vol.readFileSync("/project/src/new.ts", "utf8")).toBe("// new file");

      // But config should still be read-only
      await expect(fs.writeFile("/config/app.json", "{}")).rejects.toThrow(/read-only/);
    });

    test("single wildcard beats double wildcard", async () => {
      const fs = new FileSystem(
        "/project",
        {
          "src/**": "excluded",
          "src/*": "read-write",
        },
        memfs
      );
      // Direct children of src should be accessible
      const content = await fs.readFile("/src/index.ts");
      expect(content.toString()).toBe("console.log('hello');");

      // But deeper files should be excluded
      await expect(fs.readFile("/src/utils/helper.ts")).rejects.toThrow(/excluded/);
    });
  });

  describe("Path Utilities", () => {
    test("resolve combines paths", () => {
      const fs = new FileSystem("/project", {}, memfs);
      expect(fs.resolve("/dir", "file.txt")).toBe("/dir/file.txt");
      expect(fs.resolve("/dir", "..", "other")).toBe("/other");
    });

    test("dirname returns parent directory", () => {
      const fs = new FileSystem("/project", {}, memfs);
      expect(fs.dirname("/dir/file.txt")).toBe("/dir");
      expect(fs.dirname("/file.txt")).toBe("/");
    });

    test("basename returns file name", () => {
      const fs = new FileSystem("/project", {}, memfs);
      expect(fs.basename("/dir/file.txt")).toBe("file.txt");
    });
  });

  describe("Glob", () => {
    test("matches files with wildcard", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const matches = await fs.glob("*.ts", { cwd: "/src" });
      expect(matches).toContain("/src/index.ts");
    });

    test("matches recursively with **", async () => {
      const fs = new FileSystem("/project", {}, memfs);
      const matches = await fs.glob("**/*.ts", { cwd: "/" });
      expect(matches).toContain("/src/index.ts");
      expect(matches).toContain("/src/utils/helper.ts");
    });

    test("filters out excluded paths from glob results", async () => {
      const fs = new FileSystem("/project", { ".git/**": "excluded" }, memfs);
      const matches = await fs.glob("**/*", { cwd: "/" });
      expect(matches).not.toContain("/.git/HEAD");
    });
  });

  describe("No Mount (Full System Access)", () => {
    test("works without mount path", async () => {
      const fs = new FileSystem(undefined, {}, memfs);
      const content = await fs.readFile("/project/src/index.ts");
      expect(content.toString()).toBe("console.log('hello');");
    });
  });
});

describe("ReadOnlyFileSystem", () => {
  let vol: InstanceType<typeof Volume>;
  let memfs: UnderlyingFS;

  beforeEach(() => {
    vol = Volume.fromJSON({
      "/data/file.txt": "content",
      "/data/config/app.json": "{}",
    });
    memfs = createFsFromVolume(vol) as unknown as UnderlyingFS;
  });

  test("blocks all writes by default", async () => {
    const fs = new ReadOnlyFileSystem("/data", {}, memfs);

    await expect(fs.writeFile("/file.txt", "new")).rejects.toThrow(/read-only/);
    await expect(fs.appendFile("/file.txt", "new")).rejects.toThrow(/read-only/);
    await expect(fs.rm("/file.txt")).rejects.toThrow(/read-only/);
    await expect(fs.mkdir("/newdir")).rejects.toThrow(/read-only/);
  });

  test("allows all reads", async () => {
    const fs = new ReadOnlyFileSystem("/data", {}, memfs);

    const content = await fs.readFile("/file.txt");
    expect(content.toString()).toBe("content");

    const entries = await fs.readdir("/");
    expect(entries).toContain("file.txt");

    expect(await fs.exists("/file.txt")).toBe(true);

    const stat = await fs.stat("/file.txt");
    expect(stat.isFile()).toBe(true);
  });

  test("allows overriding with read-write permission", async () => {
    const fs = new ReadOnlyFileSystem(
      "/data",
      {
        "config/**": "read-write",
      },
      memfs
    );

    // Default is still read-only
    await expect(fs.writeFile("/file.txt", "new")).rejects.toThrow(/read-only/);

    // But config is writable
    await fs.writeFile("/config/app.json", '{"new": true}');
    expect(vol.readFileSync("/data/config/app.json", "utf8")).toBe('{"new": true}');
  });

  test("allows excluding paths", async () => {
    const fs = new ReadOnlyFileSystem(
      "/data",
      {
        "config/**": "excluded",
      },
      memfs
    );

    await expect(fs.readFile("/config/app.json")).rejects.toThrow(/excluded/);
  });
});
