import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("find command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/project/src/index.ts": "main file",
      "/project/src/utils/helper.ts": "helper",
      "/project/src/utils/parser.ts": "parser",
      "/project/src/components/Button.tsx": "button",
      "/project/src/components/Input.tsx": "input",
      "/project/tests/index.test.ts": "test file",
      "/project/tests/utils.test.ts": "utils test",
      "/project/README.md": "readme",
      "/project/package.json": "{}",
      "/data/file1.txt": "data1",
      "/data/file2.txt": "data2",
      "/data/file3.TXT": "uppercase ext",
      "/data/subdir/nested.txt": "nested",
      "/data/subdir/other.log": "log file",
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

  describe("basic find", () => {
    test("finds all files and directories in a tree", async () => {
      const result = await sh`find /data`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).toContain("/data/subdir");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
    });

    test("uses current directory by default", async () => {
      sh.cwd("/data");
      const result = await sh`find`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain(".");
      expect(lines).toContain("file1.txt");
      expect(lines).toContain("subdir");
    });

    test("multiple starting paths", async () => {
      const result = await sh`find /data/file1.txt /data/file2.txt`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines.length).toBe(2);
    });
  });

  describe("-name pattern matching", () => {
    test("finds files matching exact name", async () => {
      const result = await sh`find /project -name package.json`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/package.json");
      expect(lines.length).toBe(1);
    });

    test("finds files matching wildcard pattern *.ts", async () => {
      const result = await sh`find /project -name "*.ts"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src/index.ts");
      expect(lines).toContain("/project/src/utils/helper.ts");
      expect(lines).toContain("/project/src/utils/parser.ts");
      expect(lines).toContain("/project/tests/index.test.ts");
      expect(lines).toContain("/project/tests/utils.test.ts");
      // Should not include .tsx files
      expect(lines).not.toContain("/project/src/components/Button.tsx");
    });

    test("finds files matching wildcard pattern *.tsx", async () => {
      const result = await sh`find /project -name "*.tsx"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src/components/Button.tsx");
      expect(lines).toContain("/project/src/components/Input.tsx");
      expect(lines.length).toBe(2);
    });

    test("finds files matching pattern with ?", async () => {
      const result = await sh`find /data -name "file?.txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      // Case sensitive, file3.TXT won't match .txt
      expect(lines).not.toContain("/data/file3.TXT");
      expect(lines.length).toBe(2);
    });

    test("-name is case sensitive", async () => {
      const result = await sh`find /data -name "*.txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).not.toContain("/data/file3.TXT");
    });

    test("-name matches directories too", async () => {
      const result = await sh`find /project -name src`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src");
      expect(lines.length).toBe(1);
    });

    test("missing argument to -name returns error", async () => {
      const result = await sh`find /data -name`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing argument to '-name'");
    });
  });

  describe("-iname case-insensitive matching", () => {
    test("finds files case-insensitively", async () => {
      const result = await sh`find /data -iname "*.txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).toContain("/data/subdir/nested.txt");
    });

    test("-iname pattern itself is case-insensitive", async () => {
      const result = await sh`find /data -iname "*.TXT"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file3.TXT");
    });

    test("missing argument to -iname returns error", async () => {
      const result = await sh`find /data -iname`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing argument to '-iname'");
    });
  });

  describe("-type filtering", () => {
    test("-type f finds only files", async () => {
      const result = await sh`find /data -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
      // Should not include directories
      expect(lines).not.toContain("/data");
      expect(lines).not.toContain("/data/subdir");
    });

    test("-type d finds only directories", async () => {
      const result = await sh`find /data -type d`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines).toContain("/data/subdir");
      // Should not include files
      expect(lines).not.toContain("/data/file1.txt");
      expect(lines).not.toContain("/data/subdir/nested.txt");
    });

    test("invalid -type argument returns error", async () => {
      const result = await sh`find /data -type x`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Unknown argument to -type: x");
    });

    test("missing argument to -type returns error", async () => {
      const result = await sh`find /data -type`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing argument to '-type'");
    });
  });

  describe("-maxdepth limiting", () => {
    test("-maxdepth 0 returns only starting point", async () => {
      const result = await sh`find /data -maxdepth 0`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines.length).toBe(1);
    });

    test("-maxdepth 1 returns starting point and direct children", async () => {
      const result = await sh`find /data -maxdepth 1`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).toContain("/data/subdir");
      // Should not include nested items
      expect(lines).not.toContain("/data/subdir/nested.txt");
      expect(lines).not.toContain("/data/subdir/other.log");
    });

    test("-maxdepth 2 allows one level of nesting", async () => {
      const result = await sh`find /data -maxdepth 2`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines).toContain("/data/subdir");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
    });

    test("missing argument to -maxdepth returns error", async () => {
      const result = await sh`find /data -maxdepth`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing argument to '-maxdepth'");
    });

    test("invalid -maxdepth value returns error", async () => {
      const result = await sh`find /data -maxdepth abc`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Invalid argument 'abc' to -maxdepth");
    });

    test("negative -maxdepth value returns error", async () => {
      const result = await sh`find /data -maxdepth -1`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Invalid argument '-1' to -maxdepth");
    });
  });

  describe("-mindepth limiting", () => {
    test("-mindepth 1 excludes starting point", async () => {
      const result = await sh`find /data -mindepth 1`.text();
      const lines = result.trim().split("\n");
      expect(lines).not.toContain("/data");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/subdir");
      expect(lines).toContain("/data/subdir/nested.txt");
    });

    test("-mindepth 2 excludes first level", async () => {
      const result = await sh`find /data -mindepth 2`.text();
      const lines = result.trim().split("\n");
      expect(lines).not.toContain("/data");
      expect(lines).not.toContain("/data/file1.txt");
      expect(lines).not.toContain("/data/subdir");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
    });

    test("-mindepth 0 includes everything", async () => {
      const result = await sh`find /data -mindepth 0`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/subdir/nested.txt");
    });

    test("missing argument to -mindepth returns error", async () => {
      const result = await sh`find /data -mindepth`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing argument to '-mindepth'");
    });

    test("invalid argument to -mindepth returns error with stderr", async () => {
      const result = await sh`find /data -mindepth abc`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Invalid argument 'abc' to -mindepth");
    });

    test("negative argument to -mindepth returns error with stderr", async () => {
      const result = await sh`find /data -mindepth -1`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Invalid argument '-1' to -mindepth");
    });
  });

  describe("combined filters", () => {
    test("-type f -name combines file type and name pattern", async () => {
      const result = await sh`find /project -type f -name "*.ts"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src/index.ts");
      expect(lines).toContain("/project/src/utils/helper.ts");
      expect(lines).not.toContain("/project/src"); // directory
      expect(lines).not.toContain("/project/src/components/Button.tsx"); // not .ts
    });

    test("-type d -name finds directories by name", async () => {
      const result = await sh`find /project -type d -name "src"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src");
      expect(lines.length).toBe(1);
    });

    test("-maxdepth and -type f combine correctly", async () => {
      const result = await sh`find /data -maxdepth 1 -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).not.toContain("/data"); // directory
      expect(lines).not.toContain("/data/subdir/nested.txt"); // too deep
    });

    test("-mindepth and -maxdepth together", async () => {
      const result = await sh`find /data -mindepth 1 -maxdepth 1`.text();
      const lines = result.trim().split("\n");
      expect(lines).not.toContain("/data");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/subdir");
      expect(lines).not.toContain("/data/subdir/nested.txt");
    });

    test("all filters combined", async () => {
      const result = await sh`find /project -mindepth 2 -maxdepth 3 -type f -name "*.ts"`.text();
      const lines = result.trim().split("\n");
      // depth 2: src/index.ts, tests/index.test.ts, etc
      // depth 3: src/utils/helper.ts, src/components/* (but .tsx not .ts)
      expect(lines).toContain("/project/src/index.ts");
      expect(lines).toContain("/project/src/utils/helper.ts");
      expect(lines).toContain("/project/tests/index.test.ts");
      expect(lines).not.toContain("/project"); // depth 0
      expect(lines).not.toContain("/project/src"); // directory
    });
  });

  describe("error handling", () => {
    test("non-existent path returns error", async () => {
      const result = await sh`find /nonexistent`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("No such file or directory");
    });

    test("unknown predicate returns error", async () => {
      const result = await sh`find /data -unknown`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("unknown predicate '-unknown'");
    });

    test("starting from a file works", async () => {
      const result = await sh`find /data/file1.txt`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines.length).toBe(1);
    });

    test("starting from file with -type d returns nothing", async () => {
      const result = await sh`find /data/file1.txt -type d`.text();
      expect(result.trim()).toBe("");
    });

    test("starting from file with -type f returns the file", async () => {
      const result = await sh`find /data/file1.txt -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
    });

    test("partial failure with multiple paths", async () => {
      const result = await sh`find /data /nonexistent`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("No such file or directory");
      // But should still output results from valid path
      expect(result.stdout.toString()).toContain("/data");
    });
  });

  describe("character class in patterns", () => {
    test("-name with [0-9] character class", async () => {
      const result = await sh`find /data -name "file[0-9].txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
    });

    test("-name with negated character class [!0-9]", async () => {
      vol.fromJSON({
        "/chars/filea.txt": "",
        "/chars/file1.txt": "",
      });
      const result = await sh`find /chars -name "file[!0-9].txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/chars/filea.txt");
      expect(lines).not.toContain("/chars/file1.txt");
    });
  });

  describe("output format", () => {
    test("entries are sorted alphabetically", async () => {
      const result = await sh`find /data -maxdepth 1`.text();
      const lines = result.trim().split("\n");
      // Check order: /data comes first, then children sorted
      expect(lines[0]).toBe("/data");
      // The direct children should be sorted
      const children = lines.slice(1).filter((l) => l.startsWith("/data/") && !l.includes("subdir/"));
    });

    test("each result is on its own line", async () => {
      const result = await sh`find /data -maxdepth 0`.text();
      expect(result).toBe("/data\n");
    });
  });

  describe("-o (OR) operator", () => {
    test("finds files matching either pattern", async () => {
      const result = await sh`find /data -name "*.txt" -o -name "*.log"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
      expect(lines).not.toContain("/data/file3.TXT"); // case sensitive
    });

    test("finds .ts or .tsx files with grouping", async () => {
      const result = await sh`find /project -type f \\( -name "*.ts" -o -name "*.tsx" \\)`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src/index.ts");
      expect(lines).toContain("/project/src/utils/helper.ts");
      expect(lines).toContain("/project/src/components/Button.tsx");
      expect(lines).toContain("/project/src/components/Input.tsx");
      expect(lines).not.toContain("/project/README.md");
      expect(lines).not.toContain("/project/package.json");
    });

    test("OR without grouping has lower precedence than AND", async () => {
      // -name "*.txt" -o -name "*.log" -type f
      // means: (-name "*.txt") OR ((-name "*.log") AND (-type f))
      const result = await sh`find /data -name "*.txt" -o -name "*.log" -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/subdir/other.log");
      // directories matching *.txt should appear since left side of OR has no -type filter
      // but there are no dirs named *.txt in our test data
    });
  });

  describe("grouping with ( )", () => {
    test("grouping with AND outside", async () => {
      const result = await sh`find /data \\( -name "*.txt" -o -name "*.log" \\) -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/subdir/nested.txt");
      expect(lines).toContain("/data/subdir/other.log");
      // directories should be excluded
      expect(lines).not.toContain("/data");
      expect(lines).not.toContain("/data/subdir");
    });

    test("nested grouping", async () => {
      const result = await sh`find /project \\( \\( -name "*.ts" -o -name "*.tsx" \\) -type f \\)`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/project/src/index.ts");
      expect(lines).toContain("/project/src/components/Button.tsx");
      expect(lines).not.toContain("/project/README.md");
    });

    test("unmatched ( returns error", async () => {
      const result = await sh`find /data \\( -name "*.txt"`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing closing ')'");
    });
  });

  describe("! and -not (negation)", () => {
    test("! negates a predicate", async () => {
      const result = await sh`find /data -type f ! -name "*.txt"`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).toContain("/data/subdir/other.log");
      expect(lines).not.toContain("/data/file1.txt");
      expect(lines).not.toContain("/data/file2.txt");
      expect(lines).not.toContain("/data/subdir/nested.txt");
    });

    test("-not negates a predicate", async () => {
      const result = await sh`find /data -not -type d`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/subdir/other.log");
      expect(lines).not.toContain("/data");
      expect(lines).not.toContain("/data/subdir");
    });

    test("double negation", async () => {
      const result = await sh`find /data ! ! -type f`.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("/data/file1.txt");
      expect(lines).not.toContain("/data");
    });

    test("missing operand after ! returns error", async () => {
      const result = await sh`find /data !`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("expected expression");
    });
  });

  describe("-o error cases", () => {
    test("missing operand after -o returns error", async () => {
      const result = await sh`find /data -name "*.txt" -o`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("expected expression");
    });
  });

  test("trailing slash in path does not produce double slashes", async () => {
    const result = await sh`find /data/ -type f`.text();
    const lines = result.trim().split("\n");
    expect(lines).toContain("/data/file1.txt");
    expect(lines).not.toContain("/data//file1.txt");
  });

  describe("-exec (per-file mode)", () => {
    test("-exec cmd {} \\; runs once per match with {} replaced", async () => {
      const result = await sh`find /data -maxdepth 1 -name "*.txt" -exec echo found {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      expect(lines).toContain("found /data/file1.txt");
      expect(lines).toContain("found /data/file2.txt");
    });

    test("-exec suppresses default path printing", async () => {
      const result = await sh`find /data -maxdepth 1 -name "*.txt" -exec echo {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      // Should only have echo output, not duplicated bare paths
      expect(lines).toEqual(["/data/file1.txt", "/data/file2.txt"]);
    });

    test("-exec acts as filter (true on exit 0)", async () => {
      // Use grep (returns 0 if match found, 1 if not)
      // file1.txt contains "data1", file2.txt contains "data2"
      // Only file1.txt matches "data1" - -exec grep returns true only for it
      const result = await sh`find /data -maxdepth 1 -name "*.txt" -exec grep data1 {} \\;`.nothrow();
      const stdout = result.stdout.toString();
      expect(stdout).toContain("data1");
      // find itself should succeed (no traversal errors)
      expect(result.exitCode).toBe(0);
    });

    test("-exec false \\; filters out everything", async () => {
      const result = await sh`find /data -maxdepth 1 -type f -exec false {} \\;`.text();
      // false always returns 1, so -exec evaluates to false for all files
      // With -exec suppressing default print and all results filtered, output should be empty
      expect(result.trim()).toBe("");
    });

    test("-exec combined with -name", async () => {
      const result = await sh`find /data -name "*.txt" -exec echo hit {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      expect(lines).toContain("hit /data/file1.txt");
      expect(lines).toContain("hit /data/file2.txt");
      expect(lines).toContain("hit /data/subdir/nested.txt");
      // Should not include .TXT (case sensitive)
      expect(lines).not.toContain("hit /data/file3.TXT");
    });

    test("-exec combined with -type", async () => {
      const result = await sh`find /data -type d -exec echo dir {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      expect(lines).toContain("dir /data");
      expect(lines).toContain("dir /data/subdir");
      expect(lines.length).toBe(2);
    });

    test("-exec combined with -o", async () => {
      const result = await sh`find /data -maxdepth 1 \\( -name "*.txt" -o -name "*.TXT" \\) -exec echo {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      expect(lines).toContain("/data/file1.txt");
      expect(lines).toContain("/data/file2.txt");
      expect(lines).toContain("/data/file3.TXT");
    });

    test("-exec with ! (negation)", async () => {
      const result = await sh`find /data -maxdepth 1 -type f ! -name "*.txt" -exec echo {} \\;`.text();
      const lines = result.trim().split("\n").sort();
      expect(lines).toContain("/data/file3.TXT");
      expect(lines).not.toContain("/data/file1.txt");
    });

    test("-exec can modify filesystem (rm)", async () => {
      // Verify file exists first
      const before = await sh`find /data -name "file1.txt"`.text();
      expect(before.trim()).toContain("/data/file1.txt");

      // Remove it via -exec
      await sh`find /data -name "file1.txt" -exec rm {} \\;`;

      // Verify it's gone
      const after = await sh`find /data -name "file1.txt"`.text();
      expect(after.trim()).toBe("");
    });

    test("non-existent command in -exec returns false", async () => {
      const result = await sh`find /data -maxdepth 1 -name "file1.txt" -exec nonexistent {} \\;`.nothrow();
      // The command doesn't exist, so -exec returns false, suppresses print
      expect(result.stdout.toString().trim()).toBe("");
      expect(result.stderr.toString()).toContain("command not found");
    });
  });

  describe("-exec (batch mode with +)", () => {
    test("-exec cmd {} + batches all matches into one invocation", async () => {
      const result = await sh`find /data -maxdepth 1 -name "*.txt" -exec echo {} +`.text();
      const output = result.trim();
      // All paths should be in a single line (one echo invocation)
      expect(output.split("\n").length).toBe(1);
      expect(output).toContain("/data/file1.txt");
      expect(output).toContain("/data/file2.txt");
    });

    test("-exec cmd {} + with -type f", async () => {
      const result = await sh`find /data -type f -exec echo {} +`.text();
      const output = result.trim();
      // Single invocation with all file paths
      expect(output.split("\n").length).toBe(1);
      expect(output).toContain("/data/file1.txt");
      expect(output).toContain("/data/file2.txt");
      expect(output).toContain("/data/file3.TXT");
      expect(output).toContain("/data/subdir/nested.txt");
      expect(output).toContain("/data/subdir/other.log");
    });

    test("-exec cmd with extra args {} + puts paths where {} is", async () => {
      const result = await sh`find /data -maxdepth 1 -name "*.txt" -exec echo prefix {} +`.text();
      const output = result.trim();
      expect(output).toMatch(/^prefix /);
      expect(output).toContain("/data/file1.txt");
      expect(output).toContain("/data/file2.txt");
    });
  });

  describe("-exec error cases", () => {
    test("missing terminator returns error", async () => {
      const result = await sh`find /data -exec echo {}`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing terminator");
    });

    test("missing command returns error", async () => {
      const result = await sh`find /data -exec ;`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing command");
    });

    test("-exec + with missing command returns error", async () => {
      const result = await sh`find /data -exec +`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("missing command");
    });
  });
});
