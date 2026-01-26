import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../src/index.ts";
import { builtinCommands } from "../../commands/index.ts";

describe("grep command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "foo\nbar\nbaz\nfoo bar\nFOO\n",
      "/numbers.txt": "line1\nline2\nline3\nother\n",
      "/file1.txt": "apple\norange\n",
      "/file2.txt": "banana\napple pie\n",
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
  // Basic functionality (existing tests)
  // ============================================================

  test("matches lines with pattern", async () => {
    const result = await sh`grep foo /data.txt`.text();
    expect(result).toBe("foo\nfoo bar\n");
  });

  test("-i case insensitive match", async () => {
    const result = await sh`grep -i foo /data.txt`.text();
    expect(result).toBe("foo\nfoo bar\nFOO\n");
  });

  test("-v inverts match", async () => {
    const result = await sh`grep -v foo /data.txt`.text();
    expect(result).toBe("bar\nbaz\nFOO\n");
  });

  test("-n shows line numbers", async () => {
    const result = await sh`grep -n foo /data.txt`.text();
    expect(result).toBe("1:foo\n4:foo bar\n");
  });

  test("-c counts matches", async () => {
    const result = await sh`grep -c foo /data.txt`.text();
    expect(result.trim()).toBe("2");
  });

  test("-iv combined works", async () => {
    const result = await sh`grep -iv foo /data.txt`.text();
    expect(result).toBe("bar\nbaz\n");
  });

  test("-in combined works", async () => {
    const result = await sh`grep -in foo /data.txt`.text();
    expect(result).toContain("1:foo");
    expect(result).toContain("4:foo bar");
    expect(result).toContain("5:FOO");
  });

  test("multiple files prefix with filename", async () => {
    const result = await sh`grep apple /file1.txt /file2.txt`.text();
    expect(result).toContain("file1.txt:apple");
    expect(result).toContain("file2.txt:apple pie");
  });

  test("returns 1 when no matches", async () => {
    const result = await sh`grep notfound /data.txt`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("returns 0 when matches found", async () => {
    const result = await sh`grep foo /data.txt`.nothrow();
    expect(result.exitCode).toBe(0);
  });

  test("error on invalid regex", async () => {
    const result = await sh`grep "[" /data.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid pattern");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`grep foo /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("reads from stdin", async () => {
    const input = Buffer.from("apple\nbanana\napricot\n");
    const result = await sh`cat < ${input} | grep ap`.text();
    expect(result).toBe("apple\napricot\n");
  });

  test("missing pattern error", async () => {
    const result = await sh`grep`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing pattern");
  });

  test("regex pattern matching", async () => {
    const result = await sh`grep "line[0-9]" /numbers.txt`.text();
    expect(result).toBe("line1\nline2\nline3\n");
  });

  test("-c with -v counts non-matches", async () => {
    const result = await sh`grep -cv foo /data.txt`.text();
    expect(result.trim()).toBe("3");
  });

  test("empty file returns 1", async () => {
    vol.writeFileSync("/empty.txt", "");
    const result = await sh`grep foo /empty.txt`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("works in pipeline", async () => {
    const result = await sh`cat /data.txt | grep -c foo`.text();
    expect(result.trim()).toBe("2");
  });

  test("combined -vnc flags work", async () => {
    const result = await sh`grep -vnc foo /data.txt`.nothrow();
    // -c overrides -n for output, should show count
    expect(result.stdout.toString().trim()).toBe("3");
  });

  // ============================================================
  // Phase 1: Simple Flags
  // ============================================================

  describe("Phase 1: Simple Flags", () => {
    test("-q quiet mode - no output, exit 0 on match", async () => {
      const result = await sh`grep -q foo /data.txt`.nothrow();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
    });

    test("-q quiet mode - exit 1 on no match", async () => {
      const result = await sh`grep -q notfound /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
    });

    test("-l lists filenames with matches", async () => {
      const result = await sh`grep -l foo /data.txt /file1.txt`.text();
      expect(result).toBe("/data.txt\n");
    });

    test("-l with multiple matching files", async () => {
      const result = await sh`grep -l apple /file1.txt /file2.txt`.text();
      expect(result).toContain("/file1.txt");
      expect(result).toContain("/file2.txt");
    });

    test("-L lists filenames without matches", async () => {
      const result = await sh`grep -L foo /data.txt /file1.txt`.text();
      expect(result).toBe("/file1.txt\n");
    });

    test("-m stops after N matches", async () => {
      const result = await sh`grep -m 1 foo /data.txt`.text();
      expect(result).toBe("foo\n");
    });

    test("-m2 format works", async () => {
      const result = await sh`grep -m2 foo /data.txt`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("-m with -n shows line numbers for limited matches", async () => {
      const result = await sh`grep -m 1 -n foo /data.txt`.text();
      expect(result).toBe("1:foo\n");
    });

    test("-H always shows filename", async () => {
      const result = await sh`grep -H foo /data.txt`.text();
      expect(result).toBe("/data.txt:foo\n/data.txt:foo bar\n");
    });

    test("-h never shows filename even with multiple files", async () => {
      const result = await sh`grep -h apple /file1.txt /file2.txt`.text();
      expect(result).toBe("apple\napple pie\n");
    });
  });

  // ============================================================
  // Phase 2: Pattern Matching Enhancements
  // ============================================================

  describe("Phase 2: Pattern Matching", () => {
    test("-E extended regex (default)", async () => {
      const result = await sh`grep -E "foo|bar" /data.txt`.text();
      expect(result).toBe("foo\nbar\nfoo bar\n");
    });

    test("-F fixed strings escapes metacharacters", async () => {
      vol.writeFileSync("/special.txt", "a.b\na*b\na+b\nab\n");
      const result = await sh`grep -F "a.b" /special.txt`.text();
      expect(result).toBe("a.b\n");
    });

    test("-F with regex metacharacters in pattern", async () => {
      vol.writeFileSync("/special.txt", "hello[world]\nhello world\n");
      const result = await sh`grep -F "[world]" /special.txt`.text();
      expect(result).toBe("hello[world]\n");
    });

    test("-w whole word match", async () => {
      vol.writeFileSync("/words.txt", "foo\nfoobar\nbarfoo\nfoo bar\n");
      const result = await sh`grep -w foo /words.txt`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("-x whole line match", async () => {
      vol.writeFileSync("/lines.txt", "foo\nfoo bar\n  foo  \n");
      const result = await sh`grep -x foo /lines.txt`.text();
      expect(result).toBe("foo\n");
    });

    test("-e multiple patterns with OR logic", async () => {
      const result = await sh`grep -e foo -e baz /data.txt`.text();
      expect(result).toBe("foo\nbaz\nfoo bar\n");
    });

    test("-e with file positional arg", async () => {
      const result = await sh`grep -e foo /data.txt`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("-w with -i combination", async () => {
      vol.writeFileSync("/words.txt", "FOO\nfoobar\nFoo bar\n");
      const result = await sh`grep -wi foo /words.txt`.text();
      expect(result).toBe("FOO\nFoo bar\n");
    });

    test("-F with -i case insensitive fixed string", async () => {
      vol.writeFileSync("/mixed.txt", "HELLO\nhello\nHeLLo\n");
      const result = await sh`grep -Fi hello /mixed.txt`.text();
      expect(result).toBe("HELLO\nhello\nHeLLo\n");
    });
  });

  // ============================================================
  // Phase 3: Output Enhancement
  // ============================================================

  describe("Phase 3: Output Enhancement (-o)", () => {
    test("-o prints only matching parts", async () => {
      vol.writeFileSync("/test.txt", "hello world hello\nfoo bar\n");
      const result = await sh`grep -o hello /test.txt`.text();
      expect(result).toBe("hello\nhello\n");
    });

    test("-o with regex captures multiple matches per line", async () => {
      vol.writeFileSync("/test.txt", "abc123def456ghi\n");
      const result = await sh`grep -o "[0-9]+" /test.txt`.text();
      expect(result).toBe("123\n456\n");
    });

    test("-o with -n shows line numbers for each match", async () => {
      vol.writeFileSync("/test.txt", "hello world hello\nhi there\nhello again\n");
      const result = await sh`grep -on hello /test.txt`.text();
      expect(result).toBe("1:hello\n1:hello\n3:hello\n");
    });

    test("-o with -H shows filename for each match", async () => {
      vol.writeFileSync("/test.txt", "foo foo\n");
      const result = await sh`grep -oH foo /test.txt`.text();
      expect(result).toBe("/test.txt:foo\n/test.txt:foo\n");
    });

    test("-o with -c counts matches (not lines)", async () => {
      vol.writeFileSync("/test.txt", "foo foo\nfoo\n");
      // -c takes precedence over -o in terms of output
      const result = await sh`grep -oc foo /test.txt`.text();
      expect(result.trim()).toBe("2");
    });
  });

  // ============================================================
  // Phase 4: Context Lines
  // ============================================================

  describe("Phase 4: Context Lines", () => {
    beforeEach(() => {
      vol.writeFileSync("/context.txt", "line1\nline2\nmatch\nline4\nline5\nline6\nanother match\nline8\n");
    });

    test("-A shows lines after match", async () => {
      const result = await sh`grep -A 2 match /context.txt`.text();
      expect(result).toContain("match");
      expect(result).toContain("line4");
      expect(result).toContain("line5");
    });

    test("-B shows lines before match", async () => {
      const result = await sh`grep -B 2 match /context.txt`.text();
      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).toContain("match");
    });

    test("-C shows context both sides", async () => {
      vol.writeFileSync("/simple.txt", "a\nb\nmatch\nd\ne\n");
      const result = await sh`grep -C 1 match /simple.txt`.text();
      expect(result).toBe("b\nmatch\nd\n");
    });

    test("-A2 format works", async () => {
      vol.writeFileSync("/simple.txt", "match\na\nb\nc\n");
      const result = await sh`grep -A2 match /simple.txt`.text();
      expect(result).toBe("match\na\nb\n");
    });

    test("-B2 format works", async () => {
      vol.writeFileSync("/simple.txt", "a\nb\nmatch\n");
      const result = await sh`grep -B2 match /simple.txt`.text();
      expect(result).toBe("a\nb\nmatch\n");
    });

    test("context with -n uses : for match, - for context", async () => {
      vol.writeFileSync("/simple.txt", "before\nmatch\nafter\n");
      const result = await sh`grep -n -C 1 match /simple.txt`.text();
      expect(result).toBe("1-before\n2:match\n3-after\n");
    });

    test("context prints -- separator for non-contiguous groups", async () => {
      const result = await sh`grep -A 1 match /context.txt`.text();
      expect(result).toContain("--");
    });

    test("context overlapping regions don't duplicate lines", async () => {
      vol.writeFileSync("/close.txt", "a\nmatch1\nb\nmatch2\nc\n");
      const result = await sh`grep -C 1 match /close.txt`.text();
      // Should not duplicate 'b' line
      const lines = result.split("\n").filter(l => l !== "");
      const bCount = lines.filter(l => l === "b" || l.endsWith("-b") || l.endsWith(":b")).length;
      expect(bCount).toBe(1);
    });

    test("-A with -m limits output correctly", async () => {
      const result = await sh`grep -A 1 -m 1 match /context.txt`.text();
      expect(result).toContain("match");
      expect(result).toContain("line4");
      expect(result).not.toContain("another match");
    });
  });

  // ============================================================
  // Phase 5: Recursive Search
  // ============================================================

  describe("Phase 5: Recursive Search", () => {
    beforeEach(() => {
      vol.mkdirSync("/dir", { recursive: true });
      vol.mkdirSync("/dir/sub", { recursive: true });
      vol.writeFileSync("/dir/a.txt", "hello world\n");
      vol.writeFileSync("/dir/b.txt", "goodbye world\n");
      vol.writeFileSync("/dir/sub/c.txt", "hello again\n");
    });

    test("-r searches directories recursively", async () => {
      const result = await sh`grep -r hello /dir`.text();
      expect(result).toContain("hello");
      expect(result).toContain("/dir/a.txt");
      expect(result).toContain("/dir/sub/c.txt");
    });

    test("-R works same as -r", async () => {
      const result = await sh`grep -R hello /dir`.text();
      expect(result).toContain("hello");
    });

    test("-r shows filenames by default", async () => {
      const result = await sh`grep -r hello /dir`.text();
      // Should show filenames since it's recursive
      expect(result).toMatch(/\/dir\//);
    });

    test("-r with -l lists matching files", async () => {
      const result = await sh`grep -rl hello /dir`.text();
      expect(result).toContain("/dir/a.txt");
      expect(result).toContain("/dir/sub/c.txt");
      expect(result).not.toContain("hello world");
    });

    test("-r with -c shows counts per file", async () => {
      const result = await sh`grep -rc hello /dir`.text();
      expect(result).toContain(":1");
    });

    test("directory without -r shows error", async () => {
      const result = await sh`grep hello /dir`.nothrow();
      expect(result.stderr.toString()).toContain("Is a directory");
    });
  });

  // ============================================================
  // Flag Combinations
  // ============================================================

  describe("Flag Combinations", () => {
    test("-lc list files wins over count", async () => {
      const result = await sh`grep -lc foo /data.txt /file1.txt`.text();
      // -l should take precedence
      expect(result).toBe("/data.txt\n");
    });

    test("-qm quiet with max - exits early", async () => {
      const result = await sh`grep -qm1 foo /data.txt`.nothrow();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
    });

    test("-vw invert + whole word", async () => {
      vol.writeFileSync("/words.txt", "foo\nfoobar\nbar\n");
      const result = await sh`grep -vw foo /words.txt`.text();
      expect(result).toBe("foobar\nbar\n");
    });

    test("-Fwi fixed + whole word + case insensitive", async () => {
      vol.writeFileSync("/test.txt", "FOO\nfoobar\nFoo Bar\n");
      const result = await sh`grep -Fwi foo /test.txt`.text();
      expect(result).toBe("FOO\nFoo Bar\n");
    });

    test("-A 2 -B 1 asymmetric context", async () => {
      vol.writeFileSync("/test.txt", "1\n2\n3\nmatch\n5\n6\n7\n");
      const result = await sh`grep -B 1 -A 2 match /test.txt`.text();
      expect(result).toBe("3\nmatch\n5\n6\n");
    });

    test("-on with multiple matches per line", async () => {
      vol.writeFileSync("/test.txt", "foo foo foo\n");
      const result = await sh`grep -on foo /test.txt`.text();
      expect(result).toBe("1:foo\n1:foo\n1:foo\n");
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe("Edge Cases", () => {
    test("-- stops option parsing", async () => {
      vol.writeFileSync("/-v", "test content\n");
      const result = await sh`grep test -- /-v`.text();
      expect(result).toBe("test content\n");
    });

    test("pattern with spaces using quotes", async () => {
      const result = await sh`grep "foo bar" /data.txt`.text();
      expect(result).toBe("foo bar\n");
    });

    test("-e pattern then positional file", async () => {
      const result = await sh`grep -e foo /data.txt`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("multiple -e with no matches returns 1", async () => {
      const result = await sh`grep -e xxx -e yyy /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("empty pattern matches all lines", async () => {
      vol.writeFileSync("/test.txt", "a\nb\nc\n");
      const result = await sh`grep "" /test.txt`.text();
      expect(result).toBe("a\nb\nc\n");
    });

    test("-c with multiple files shows per-file counts", async () => {
      const result = await sh`grep -c apple /file1.txt /file2.txt`.text();
      expect(result).toContain("/file1.txt:1");
      expect(result).toContain("/file2.txt:1");
    });

    test("handles file with no trailing newline", async () => {
      vol.writeFileSync("/notrail.txt", "foo");
      const result = await sh`grep foo /notrail.txt`.text();
      expect(result).toBe("foo\n");
    });

    test("-x with empty lines", async () => {
      vol.writeFileSync("/empty-lines.txt", "\nfoo\n\nbar\n");
      const result = await sh`grep -x "" /empty-lines.txt`.text();
      expect(result).toBe("\n\n");
    });
  });
});
