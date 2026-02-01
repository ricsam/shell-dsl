import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("awk command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "a b c\nd e f\ng h i\n",
      "/numbers.txt": "1 2 3\n4 5 6\n7 8 9\n",
      "/colon.txt": "a:b:c\nd:e:f\n",
      "/mixed.txt": "foo bar\nbaz\nqux quux corge\n",
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
  // Basic Field Printing
  // ============================================================

  describe("Field Printing", () => {
    test("print whole line with {print}", async () => {
      const result = await sh`echo "a b c" | awk '{print}'`.text();
      expect(result).toBe("a b c\n");
    });

    test("print whole line with {print $0}", async () => {
      const result = await sh`echo "a b c" | awk '{print $0}'`.text();
      expect(result).toBe("a b c\n");
    });

    test("print first field", async () => {
      const result = await sh`echo "a b c" | awk '{print $1}'`.text();
      expect(result).toBe("a\n");
    });

    test("print second field", async () => {
      const result = await sh`echo "a b c" | awk '{print $2}'`.text();
      expect(result).toBe("b\n");
    });

    test("print third field", async () => {
      const result = await sh`echo "a b c" | awk '{print $3}'`.text();
      expect(result).toBe("c\n");
    });

    test("print multiple fields", async () => {
      const result = await sh`echo "a b c" | awk '{print $3, $1}'`.text();
      expect(result).toBe("c a\n");
    });

    test("print nonexistent field returns empty", async () => {
      const result = await sh`echo "a b" | awk '{print $5}'`.text();
      expect(result).toBe("\n");
    });

    test("print from file", async () => {
      const result = await sh`awk '{print $2}' /data.txt`.text();
      expect(result).toBe("b\ne\nh\n");
    });
  });

  // ============================================================
  // Field Separator (-F)
  // ============================================================

  describe("Field Separator (-F)", () => {
    test("-F changes field separator", async () => {
      const result = await sh`echo "a:b:c" | awk -F: '{print $2}'`.text();
      expect(result).toBe("b\n");
    });

    test("-F with colon file", async () => {
      const result = await sh`awk -F: '{print $1}' /colon.txt`.text();
      expect(result).toBe("a\nd\n");
    });

    test("-F with no space", async () => {
      const result = await sh`echo "a:b:c" | awk -F: '{print $3}'`.text();
      expect(result).toBe("c\n");
    });

    test("-F with special regex char", async () => {
      vol.writeFileSync("/pipe.txt", "a|b|c\n");
      const result = await sh`awk -F'|' '{print $2}' /pipe.txt`.text();
      expect(result).toBe("b\n");
    });

    test("-F with comma separator", async () => {
      const result = await sh`echo "a,b,c" | awk -F, '{print $2}'`.text();
      expect(result).toBe("b\n");
    });
  });

  // ============================================================
  // Built-in Variables
  // ============================================================

  describe("Built-in Variables", () => {
    test("NF returns field count", async () => {
      const result = await sh`echo "a b c" | awk '{print NF}'`.text();
      expect(result).toBe("3\n");
    });

    test("NF varies per line", async () => {
      const result = await sh`awk '{print NF}' /mixed.txt`.text();
      expect(result).toBe("2\n1\n3\n");
    });

    test("NR returns line number", async () => {
      const result = await sh`awk '{print NR}' /data.txt`.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("NR and NF together", async () => {
      const result = await sh`awk '{print NR, NF}' /mixed.txt`.text();
      expect(result).toBe("1 2\n2 1\n3 3\n");
    });
  });

  // ============================================================
  // Pattern Matching
  // ============================================================

  describe("Pattern Matching", () => {
    test("regex pattern filters lines", async () => {
      const result = await sh`echo "foo\nbar\nbaz" | awk '/bar/ {print}'`.text();
      expect(result).toBe("bar\n");
    });

    test("pattern without explicit action prints matching line", async () => {
      const result = await sh`echo "foo\nbar\nbaz" | awk '/foo/'`.text();
      expect(result).toBe("foo\n");
    });

    test("pattern with field print", async () => {
      const result = await sh`awk '/d/ {print $2}' /data.txt`.text();
      expect(result).toBe("e\n");
    });

    test("multiple patterns", async () => {
      const result = await sh`echo "a\nb\nc" | awk '/a/ {print "found a"} /c/ {print "found c"}'`.text();
      expect(result).toBe("found a\nfound c\n");
    });

    test("no pattern matches all lines", async () => {
      const result = await sh`awk '{print $1}' /data.txt`.text();
      expect(result).toBe("a\nd\ng\n");
    });
  });

  // ============================================================
  // Pipeline Integration
  // ============================================================

  describe("Pipeline Integration", () => {
    test("awk in pipeline from cat", async () => {
      const result = await sh`cat /data.txt | awk '{print $1}'`.text();
      expect(result).toBe("a\nd\ng\n");
    });

    test("awk piped to grep", async () => {
      const result = await sh`awk '{print $2}' /data.txt | grep e`.text();
      expect(result).toBe("e\n");
    });

    test("grep piped to awk", async () => {
      const result = await sh`grep "d" /data.txt | awk '{print $3}'`.text();
      expect(result).toBe("f\n");
    });

    test("multiple awk commands piped", async () => {
      const result = await sh`echo "a b c" | awk '{print $2}' | awk '{print "result: " $0}'`.text();
      expect(result).toBe("result: b\n");
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe("Error Handling", () => {
    test("missing program error", async () => {
      const result = await sh`awk`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing program");
    });

    test("nonexistent file error", async () => {
      const result = await sh`awk '{print}' /nonexistent.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("nonexistent.txt");
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe("Edge Cases", () => {
    test("empty input", async () => {
      vol.writeFileSync("/empty.txt", "");
      const result = await sh`awk '{print}' /empty.txt`.text();
      expect(result).toBe("");
    });

    test("single field line", async () => {
      const result = await sh`echo "single" | awk '{print $1}'`.text();
      expect(result).toBe("single\n");
    });

    test("multiple spaces between fields", async () => {
      const result = await sh`echo "a    b    c" | awk '{print $2}'`.text();
      expect(result).toBe("b\n");
    });

    test("leading spaces", async () => {
      const result = await sh`echo "  a b c" | awk '{print $1}'`.text();
      expect(result).toBe("a\n");
    });

    test("tabs as separator", async () => {
      vol.writeFileSync("/tabs.txt", "a\tb\tc\n");
      const result = await sh`awk '{print $2}' /tabs.txt`.text();
      expect(result).toBe("b\n");
    });

    test("handles file without trailing newline", async () => {
      vol.writeFileSync("/notrail.txt", "a b c");
      const result = await sh`awk '{print $2}' /notrail.txt`.text();
      expect(result).toBe("b\n");
    });

    test("string literal in print", async () => {
      const result = await sh`echo "test" | awk '{print "hello"}'`.text();
      expect(result).toBe("hello\n");
    });

    test("string concatenation with field", async () => {
      const result = await sh`echo "world" | awk '{print "hello " $1}'`.text();
      expect(result).toBe("hello world\n");
    });
  });

  describe("Escape sequences", () => {
    test("-F '\\t' splits on tab characters", async () => {
      vol.writeFileSync("/tsv.txt", "col1\tcol2\tcol3\n");
      const result = await sh`awk -F '\\t' '{print $2}' /tsv.txt`.text();
      expect(result).toBe("col2\n");
    });

    test("string literal with \\n produces newline", async () => {
      const result = await sh`echo "test" | awk '{print "hello\\nworld"}'`.text();
      expect(result).toBe("hello\nworld\n");
    });

    test("string literal with \\t produces tab", async () => {
      const result = await sh`echo "test" | awk '{print "col1\\tcol2"}'`.text();
      expect(result).toBe("col1\tcol2\n");
    });
  });

  describe("Invalid Flags", () => {
    test("invalid short flag returns error with usage", async () => {
      const result = await sh`awk -x '{print}' /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("invalid option");
      expect(result.stderr.toString()).toContain("usage:");
    });

    test("invalid long flag returns error with usage", async () => {
      const result = await sh`awk --invalid '{print}' /data.txt`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("unrecognized option");
      expect(result.stderr.toString()).toContain("usage:");
    });
  });
});
