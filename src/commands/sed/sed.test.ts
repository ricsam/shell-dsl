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

  describe("Invalid Flags", () => {
    test("invalid short flag returns error with usage", async () => {
      const result = await sh`sed -x 's/a/b/' /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("invalid option");
      expect(result.stderr.toString()).toContain("usage:");
    });

    test("invalid long flag returns error with usage", async () => {
      const result = await sh`sed --invalid 's/a/b/' /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("unrecognized option");
      expect(result.stderr.toString()).toContain("usage:");
    });
  });

  // ============================================================
  // Hold Space Commands (h/H/g/G/x)
  // ============================================================

  describe("Hold Space Commands", () => {
    test("h and g: copy pattern to hold, then hold to pattern", async () => {
      vol.writeFileSync("/hold.txt", "first\nsecond\n");
      // h saves "first" to hold; on "second" line, g replaces pattern with held value
      const result = await sh`sed -n -e '/first/h' -e '/second/{ g; p }' /hold.txt`.text();
      expect(result).toBe("first\n");
    });

    test("H appends to hold space with newline", async () => {
      vol.writeFileSync("/hold2.txt", "aaa\nbbb\n");
      // H on every line: hold="\naaa" then "\naaa\nbbb"
      // On bbb line, g replaces pattern with hold, then p
      const result = await sh`sed -n -e 'H' -e '/bbb/{ g; p }' /hold2.txt`.text();
      expect(result).toBe("\naaa\nbbb\n");
    });

    test("x exchanges pattern and hold spaces", async () => {
      // x on every line: first line swaps "" and "alpha" -> outputs ""
      // second line swaps "alpha" and "beta" -> outputs "alpha"
      vol.writeFileSync("/xtest.txt", "alpha\nbeta\n");
      const result = await sh`sed -n -e 'x' -e 'p' /xtest.txt`.text();
      expect(result).toBe("\nalpha\n");
    });

    test("h then x to swap", async () => {
      vol.writeFileSync("/xtest2.txt", "first\nsecond\n");
      // h on first: hold="first". x on second: swap hold="second", pattern="first"
      const result = await sh`sed -n -e '/first/h' -e '/second/{ x; p }' /xtest2.txt`.text();
      expect(result).toBe("first\n");
    });

    test("G appends hold space to pattern space", async () => {
      vol.writeFileSync("/gtest.txt", "aaa\nbbb\n");
      // G on bbb: appends hold (empty) -> "bbb\n"
      const result = await sh`sed -n '/bbb/{ G; p }' /gtest.txt`.text();
      expect(result).toBe("bbb\n\n");
    });

    test("h then G appends saved line", async () => {
      vol.writeFileSync("/gtest2.txt", "first\nsecond\n");
      const result = await sh`sed -n -e '/first/h' -e '/second/{ G; p }' /gtest2.txt`.text();
      expect(result).toBe("second\nfirst\n");
    });
  });

  // ============================================================
  // Address Negation (!)
  // ============================================================

  describe("Address Negation (!)", () => {
    test("/pattern/!d deletes non-matching lines", async () => {
      const result = await sh`sed '/foo/!d' /data.txt`.text();
      expect(result).toBe("foo bar\n");
    });

    test("/pattern/!s only substitutes on non-matching lines", async () => {
      vol.writeFileSync("/neg.txt", "keep\nchange\nkeep\n");
      const result = await sh`sed '/keep/!s/change/CHANGED/' /neg.txt`.text();
      expect(result).toBe("keep\nCHANGED\nkeep\n");
    });

    test("/pattern/!p with -n prints non-matching lines", async () => {
      const result = await sh`sed -n '/foo/!p' /data.txt`.text();
      expect(result).toBe("hello world\nbaz qux\n");
    });
  });

  // ============================================================
  // Command Grouping ({ })
  // ============================================================

  describe("Command Grouping", () => {
    test("group with substitution and print", async () => {
      vol.writeFileSync("/grp.txt", "hello\nworld\n");
      const result = await sh`sed -n '/hello/{ s/hello/HI/; p }' /grp.txt`.text();
      expect(result).toBe("HI\n");
    });

    test("group applies only when address matches", async () => {
      vol.writeFileSync("/grp2.txt", "aaa\nbbb\nccc\n");
      const result = await sh`sed '/bbb/{ s/bbb/BBB/; }' /grp2.txt`.text();
      expect(result).toBe("aaa\nBBB\nccc\n");
    });

    test("negated group", async () => {
      vol.writeFileSync("/grp3.txt", "keep\nremove\nkeep\n");
      const result = await sh`sed '/keep/!{ d }' /grp3.txt`.text();
      expect(result).toBe("keep\nkeep\n");
    });
  });

  // ============================================================
  // Branching (b / :label)
  // ============================================================

  describe("Branching", () => {
    test("b with no label skips rest of script", async () => {
      vol.writeFileSync("/br.txt", "hello\nworld\n");
      // b skips s/hello/BYE/, so hello stays unchanged
      const result = await sh`sed -e 'b' -e 's/hello/BYE/' /br.txt`.text();
      expect(result).toBe("hello\nworld\n");
    });

    test("conditional branch with address: /pattern/b skips rest for matching lines", async () => {
      vol.writeFileSync("/br2.txt", "skip\nchange\nskip\n");
      const result = await sh`sed -e '/skip/b' -e 's/change/CHANGED/' /br2.txt`.text();
      expect(result).toBe("skip\nCHANGED\nskip\n");
    });

    test("b label jumps to :label", async () => {
      vol.writeFileSync("/br3.txt", "test\n");
      // Jump over the substitution to :end
      const result = await sh`sed -e 'b end' -e 's/test/FAIL/' -e ':end' /br3.txt`.text();
      expect(result).toBe("test\n");
    });
  });

  // ============================================================
  // Multi-line Commands (n/N/P/D)
  // ============================================================

  describe("Multi-line Commands", () => {
    test("n outputs current line and reads next", async () => {
      vol.writeFileSync("/ml.txt", "a\nb\nc\n");
      // n on every line: outputs 'a', reads 'b', then s applies to 'b'
      const result = await sh`sed -e 'n' -e 's/b/B/' /ml.txt`.text();
      expect(result).toBe("a\nB\nc\n");
    });

    test("N appends next line to pattern space", async () => {
      vol.writeFileSync("/ml2.txt", "hello\nworld\n");
      const result = await sh`sed -n -e 'N' -e 'p' /ml2.txt`.text();
      expect(result).toBe("hello\nworld\n");
    });

    test("P prints up to first newline", async () => {
      vol.writeFileSync("/ml3.txt", "first\nsecond\n");
      const result = await sh`sed -n -e 'N' -e 'P' /ml3.txt`.text();
      expect(result).toBe("first\n");
    });

    test("D deletes up to first newline and restarts", async () => {
      vol.writeFileSync("/ml4.txt", "a\nb\nc\n");
      // N joins: "a\nb", D deletes "a\n" leaving "b", restarts
      // N joins: "b\nc", D deletes "b\n" leaving "c", restarts
      // N: no next line, pattern is "c", D: no newline -> delete all
      const result = await sh`sed 'N; D' /ml4.txt`.text();
      expect(result).toBe("c\n");
    });
  });

  // ============================================================
  // Combined / Integration
  // ============================================================

  describe("Combined Advanced Features", () => {
    test("hold space + negation + grouping + branching", async () => {
      vol.writeFileSync("/combo.txt", "header\ndata1\ndata2\nfooter\n");
      // Print only 'data' lines using negation
      const result = await sh`sed -n '/data/p' /combo.txt`.text();
      expect(result).toBe("data1\ndata2\n");
    });

    test("reverse two lines using hold space", async () => {
      vol.writeFileSync("/rev.txt", "first\nsecond\n");
      const result = await sh`sed -n -e '/first/h' -e '/second/{ G; p }' /rev.txt`.text();
      expect(result).toBe("second\nfirst\n");
    });

    test("skip matching lines with /pattern/b, transform rest", async () => {
      vol.writeFileSync("/skip.txt", "keep_this\ntransform\nkeep_this\n");
      const result = await sh`sed -e '/keep/b' -e 's/transform/TRANSFORMED/' /skip.txt`.text();
      expect(result).toBe("keep_this\nTRANSFORMED\nkeep_this\n");
    });

    test("standalone group applies to all lines", async () => {
      vol.writeFileSync("/sgrp.txt", "aaa\nbbb\n");
      const result = await sh`sed '{ s/aaa/AAA/; s/bbb/BBB/ }' /sgrp.txt`.text();
      expect(result).toBe("AAA\nBBB\n");
    });

    test("b label inside group jumps to top-level label", async () => {
      vol.writeFileSync("/blbl.txt", "match\nother\n");
      // On "match": group runs b skip, jumping over the substitution to :skip
      // On "other": no address match, group skipped, substitution runs
      const result = await sh`sed -e '/match/{ b skip }' -e 's/other/OTHER/' -e ':skip' /blbl.txt`.text();
      expect(result).toBe("match\nOTHER\n");
    });
  });

  describe("escape sequences in replacement", () => {
    test("\\n in replacement inserts newline", async () => {
      vol.writeFileSync("/esc.txt", "foo\n");
      const result = await sh`sed 's/foo/bar\\nbaz/' /esc.txt`.text();
      expect(result).toBe("bar\nbaz\n");
    });

    test("\\t in replacement inserts tab", async () => {
      vol.writeFileSync("/esc.txt", "foo\n");
      const result = await sh`sed 's/foo/bar\\tbaz/' /esc.txt`.text();
      expect(result).toBe("bar\tbaz\n");
    });

    test("\\\\ in replacement inserts literal backslash", async () => {
      vol.writeFileSync("/esc.txt", "foo\n");
      const result = await sh`sed 's/foo/bar\\\\baz/' /esc.txt`.text();
      expect(result).toBe("bar\\baz\n");
    });
  });
});
