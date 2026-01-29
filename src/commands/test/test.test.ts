import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("test command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file.txt": "content",
      "/empty.txt": "",
      "/dir/.gitkeep": "",
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

  describe("String tests", () => {
    test("-z returns 0 for empty string", async () => {
      const result = await sh`test -z ""`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-z returns 1 for non-empty string", async () => {
      const result = await sh`test -z "hello"`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-n returns 0 for non-empty string", async () => {
      const result = await sh`test -n "hello"`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-n returns 1 for empty string", async () => {
      const result = await sh`test -n ""`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("single non-empty argument returns 0", async () => {
      const result = await sh`test "hello"`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("single empty argument returns 1", async () => {
      const result = await sh`test ""`.nothrow();
      expect(result.exitCode).toBe(1);
    });
  });

  describe("File tests", () => {
    test("-e returns 0 if file exists", async () => {
      const result = await sh`test -e /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-e returns 0 if directory exists", async () => {
      const result = await sh`test -e /dir`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-e returns 1 if path does not exist", async () => {
      const result = await sh`test -e /nonexistent`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-f returns 0 for regular file", async () => {
      const result = await sh`test -f /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-f returns 1 for directory", async () => {
      const result = await sh`test -f /dir`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-d returns 0 for directory", async () => {
      const result = await sh`test -d /dir`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-d returns 1 for file", async () => {
      const result = await sh`test -d /file.txt`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-s returns 0 if file has content", async () => {
      const result = await sh`test -s /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-s returns 1 if file is empty", async () => {
      const result = await sh`test -s /empty.txt`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-r returns 0 for readable file (always true in virtual fs)", async () => {
      const result = await sh`test -r /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-w returns 0 for writable file", async () => {
      const result = await sh`test -w /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-x returns 0 for executable file (if exists)", async () => {
      const result = await sh`test -x /file.txt`.nothrow();
      expect(result.exitCode).toBe(0);
    });
  });

  describe("String comparisons", () => {
    test("= returns 0 for equal strings", async () => {
      const result = await sh`test "foo" = "foo"`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("= returns 1 for different strings", async () => {
      const result = await sh`test "foo" = "bar"`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("== returns 0 for equal strings", async () => {
      const result = await sh`test "foo" == "foo"`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("!= returns 0 for different strings", async () => {
      const result = await sh`test "foo" != "bar"`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("!= returns 1 for equal strings", async () => {
      const result = await sh`test "foo" != "foo"`.nothrow();
      expect(result.exitCode).toBe(1);
    });
  });

  describe("Numeric comparisons", () => {
    test("-eq returns 0 for equal numbers", async () => {
      const result = await sh`test 5 -eq 5`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-eq returns 1 for different numbers", async () => {
      const result = await sh`test 5 -eq 3`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-ne returns 0 for different numbers", async () => {
      const result = await sh`test 5 -ne 3`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-ne returns 1 for equal numbers", async () => {
      const result = await sh`test 5 -ne 5`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-lt returns 0 when left < right", async () => {
      const result = await sh`test 3 -lt 5`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-lt returns 1 when left >= right", async () => {
      const result = await sh`test 5 -lt 3`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-le returns 0 when left <= right", async () => {
      const result1 = await sh`test 3 -le 5`.nothrow();
      const result2 = await sh`test 5 -le 5`.nothrow();
      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
    });

    test("-gt returns 0 when left > right", async () => {
      const result = await sh`test 5 -gt 3`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("-gt returns 1 when left <= right", async () => {
      const result = await sh`test 3 -gt 5`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("-ge returns 0 when left >= right", async () => {
      const result1 = await sh`test 5 -ge 3`.nothrow();
      const result2 = await sh`test 5 -ge 5`.nothrow();
      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
    });
  });

  describe("Negation", () => {
    test("! negates the result of single arg", async () => {
      const result = await sh`test ! ""`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("! with -f returns 0 for nonexistent file", async () => {
      const result = await sh`test ! -f /nonexistent`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("! with -f returns 1 for existing file", async () => {
      const result = await sh`test ! -f /file.txt`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("! with string comparison", async () => {
      const result = await sh`test ! "foo" = "bar"`.nothrow();
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Bracket syntax", () => {
    test("[ ] syntax works like test", async () => {
      const result = await sh`[ -f /file.txt ]`.nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("[ ] with string comparison", async () => {
      const result = await sh`[ "foo" = "foo" ]`.nothrow();
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Errors", () => {
    test("unknown operator returns exit code 2 with stderr", async () => {
      const result = await sh`test --unknown foo`.nothrow();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("test: unknown operator:");
    });

    test("unknown binary operator returns exit code 2 with stderr", async () => {
      const result = await sh`test a --badop b`.nothrow();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("test: unknown operator:");
    });

    test("too many arguments returns exit code 2 with stderr", async () => {
      const result = await sh`test a b c d e`.nothrow();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("test: too many arguments");
    });

    test("empty test returns 1", async () => {
      const result = await sh`test`.nothrow();
      expect(result.exitCode).toBe(1);
    });
  });
});
