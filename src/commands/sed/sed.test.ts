import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("sed command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "hello world\nfoo bar\nbaz qux\n",
      "/lines.txt": "line1\nline2\nline3\nline4\n",
      "/mixed.txt": "HELLO\nhello\nHeLLo\n",
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

  // ============================================================
  // Basic Substitution
  // ============================================================

  describe("Substitution (s///)", () => {
    test("basic substitution", async () => {
      const result = await sh`echo "hello world" | sed 's/world/universe/'`.text();
      expect(result).toBe("hello universe\n");
    });

    test("substitution replaces first occurrence only by default", async () => {
      const result = await sh`echo "foo foo foo" | sed 's/foo/bar/'`.text();
      expect(result).toBe("bar foo foo\n");
    });

    test("global flag replaces all occurrences", async () => {
      const result = await sh`echo "foo foo foo" | sed 's/foo/bar/g'`.text();
      expect(result).toBe("bar bar bar\n");
    });

    test("case-insensitive flag", async () => {
      const result = await sh`echo "HELLO" | sed 's/hello/hi/i'`.text();
      expect(result).toBe("hi\n");
    });

    test("combined gi flags", async () => {
      const result = await sh`echo "HELLO hello HELLO" | sed 's/hello/hi/gi'`.text();
      expect(result).toBe("hi hi hi\n");
    });

    test("substitution on file", async () => {
      const result = await sh`sed 's/world/universe/' /data.txt`.text();
      expect(result).toContain("hello universe");
    });

    test("regex pattern in substitution", async () => {
      const result = await sh`echo "abc123def" | sed 's/[0-9]+/XXX/'`.text();
      expect(result).toBe("abcXXXdef\n");
    });

    test("different delimiter", async () => {
      const result = await sh`echo "/path/to/file" | sed 's#/path#/new#'`.text();
      expect(result).toBe("/new/to/file\n");
    });

    test("empty replacement", async () => {
      const result = await sh`echo "hello world" | sed 's/world//'`.text();
      expect(result).toBe("hello \n");
    });

    test("replacement with special characters", async () => {
      const result = await sh`echo "hello" | sed 's/hello/hello world/'`.text();
      expect(result).toBe("hello world\n");
    });
  });

  // ============================================================
  // Delete Command
  // ============================================================

  describe("Delete (d)", () => {
    test("delete with pattern", async () => {
      const result = await sh`sed '/foo/d' /data.txt`.text();
      expect(result).not.toContain("foo");
      expect(result).toContain("hello world");
      expect(result).toContain("baz qux");
    });

    test("delete multiple matching lines", async () => {
      const result = await sh`sed '/line/d' /lines.txt`.text();
      expect(result).toBe("");
    });

    test("delete no matches", async () => {
      const result = await sh`sed '/notfound/d' /data.txt`.text();
      expect(result).toBe("hello world\nfoo bar\nbaz qux\n");
    });
  });

  // ============================================================
  // Print Command
  // ============================================================

  describe("Print (p)", () => {
    test("print with -n suppresses auto-print", async () => {
      const result = await sh`sed -n '/foo/p' /data.txt`.text();
      expect(result).toBe("foo bar\n");
    });

    test("print without -n duplicates matching lines", async () => {
      const result = await sh`sed '/foo/p' /data.txt`.text();
      // foo bar should appear twice, others once
      const lines = result.split("\n").filter((l) => l !== "");
      const fooCount = lines.filter((l) => l === "foo bar").length;
      expect(fooCount).toBe(2);
    });

    test("-n with no matching print outputs nothing", async () => {
      const result = await sh`sed -n '/notfound/p' /data.txt`.text();
      expect(result).toBe("");
    });
  });

  // ============================================================
  // Multiple Scripts (-e)
  // ============================================================

  describe("Multiple Scripts (-e)", () => {
    test("multiple -e scripts applied in order", async () => {
      const result = await sh`echo "foo bar" | sed -e 's/foo/baz/' -e 's/bar/qux/'`.text();
      expect(result).toBe("baz qux\n");
    });

    test("-e with substitution and delete", async () => {
      const result = await sh`sed -e 's/foo/FOO/' -e '/baz/d' /data.txt`.text();
      expect(result).toContain("FOO bar");
      expect(result).not.toContain("baz");
    });
  });

  // ============================================================
  // Address Patterns with Substitution
  // ============================================================

  describe("Address Patterns", () => {
    test("substitution only on matching lines", async () => {
      const result = await sh`sed '/line2/s/line/LINE/' /lines.txt`.text();
      expect(result).toContain("line1");
      expect(result).toContain("LINE2");
      expect(result).toContain("line3");
    });
  });

  // ============================================================
  // Pipeline Integration
  // ============================================================

  describe("Pipeline Integration", () => {
    test("sed in pipeline from cat", async () => {
      const result = await sh`cat /data.txt | sed 's/hello/hi/'`.text();
      expect(result).toContain("hi world");
    });

    test("sed piped to grep", async () => {
      const result = await sh`cat /data.txt | sed 's/foo/FOO/' | grep FOO`.text();
      expect(result).toBe("FOO bar\n");
    });

    test("multiple sed commands piped", async () => {
      const result = await sh`echo "abc" | sed 's/a/A/' | sed 's/b/B/' | sed 's/c/C/'`.text();
      expect(result).toBe("ABC\n");
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe("Error Handling", () => {
    test("missing script error", async () => {
      const result = await sh`sed`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing script");
    });

    test("nonexistent file error", async () => {
      const result = await sh`sed 's/a/b/' /nonexistent.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("nonexistent.txt");
    });
  });

  // ============================================================
  // In-place editing (-i)
  // ============================================================

  describe("In-place editing (-i)", () => {
    test("sed -i modifies file in place", async () => {
      const result = await sh`sed -i 's/foo/bar/g' /data.txt`.nothrow();
      expect(result.exitCode).toBe(0);
      const content = vol.readFileSync("/data.txt", "utf8") as string;
      expect(content).toContain("bar bar");
      expect(content).not.toContain("foo");
    });

    test("sed -i does not output to stdout", async () => {
      const result = await sh`sed -i 's/foo/bar/g' /data.txt`.text();
      expect(result).toBe("");
    });
  });

  // ============================================================
  // Backreference capture groups
  // ============================================================

  describe("Backreference capture groups", () => {
    test("sed \\(\\) capture groups and \\1 replacement", async () => {
      const result = await sh`echo "foobar" | sed 's/\\(foo\\)/[\\1]/'`.text();
      expect(result).toBe("[foo]bar\n");
    });

    test("multiple capture groups \\1 \\2", async () => {
      const result = await sh`echo "hello world" | sed 's/\\(hello\\) \\(world\\)/\\2 \\1/'`.text();
      expect(result).toBe("world hello\n");
    });
  });

  // ============================================================
  // Semicolon-separated commands
  // ============================================================

  describe("Semicolon-separated commands", () => {
    test("multiple s/// commands separated by ;", async () => {
      const result = await sh`echo "foo bar" | sed 's/foo/baz/; s/bar/qux/'`.text();
      expect(result).toBe("baz qux\n");
    });

    test("three commands separated by ;", async () => {
      const result = await sh`echo "a b c" | sed 's/a/A/; s/b/B/; s/c/C/'`.text();
      expect(result).toBe("A B C\n");
    });
  });

  // ============================================================
  // Real-world SQL use cases
  // ============================================================

  describe("SQL use cases", () => {
    test("sed -i adds IF NOT EXISTS to CREATE TABLE", async () => {
      vol.writeFileSync("/schema.sql", 'CREATE TABLE "users" (\n  id INTEGER\n);\n');
      await sh`sed -i 's/CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/g' /schema.sql`;
      const content = vol.readFileSync("/schema.sql", "utf8") as string;
      expect(content).toContain('CREATE TABLE IF NOT EXISTS "users"');
    });

    test("sed -i with backreferences and semicolon-separated commands on SQL", async () => {
      vol.writeFileSync(
        "/fk.sql",
        'ALTER TABLE "orders" ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;\n'
      );
      const replaceCmd = 's/ALTER TABLE "\\(.*\\)" ADD CONSTRAINT "\\(.*\\)" FOREIGN KEY/DO $$ BEGIN ALTER TABLE "\\1" ADD CONSTRAINT "\\2" FOREIGN KEY/g; s/ON DELETE \\(.*\\);/ON DELETE \\1; EXCEPTION WHEN duplicate_object THEN NULL; END $$;/g';
      await sh`sed -i ${replaceCmd} /fk.sql`;
      const content = vol.readFileSync("/fk.sql", "utf8") as string;
      expect(content).toContain("DO $$ BEGIN ALTER TABLE");
      expect(content).toContain("EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe("Edge Cases", () => {
    test("empty input", async () => {
      vol.writeFileSync("/empty.txt", "");
      const result = await sh`sed 's/a/b/' /empty.txt`.text();
      expect(result).toBe("");
    });

    test("line with no matches for substitution", async () => {
      const result = await sh`echo "abc" | sed 's/xyz/123/'`.text();
      expect(result).toBe("abc\n");
    });

    test("substitution at start of line", async () => {
      const result = await sh`echo "hello" | sed 's/^/> /'`.text();
      expect(result).toBe("> hello\n");
    });

    test("substitution at end of line", async () => {
      const result = await sh`echo "hello" | sed 's/$/ world/'`.text();
      expect(result).toBe("hello world\n");
    });

    test("handles file without trailing newline", async () => {
      vol.writeFileSync("/notrail.txt", "hello");
      const result = await sh`sed 's/hello/hi/' /notrail.txt`.text();
      expect(result).toBe("hi\n");
    });

    test("preserves empty lines", async () => {
      vol.writeFileSync("/spaces.txt", "foo\n\nbar\n");
      const result = await sh`sed 's/x/y/' /spaces.txt`.text();
      expect(result).toBe("foo\n\nbar\n");
    });
  });
});
