import { test, expect, describe } from "bun:test";
import { createFlagParser, type FlagDefinition } from "./flag-parser.ts";

describe("flag-parser", () => {
  describe("boolean flags", () => {
    const spec = {
      name: "testcmd",
      flags: [
        { short: "a", long: "all" },
        { short: "l", long: "list" },
        { short: "r", long: "recursive" },
      ],
      usage: "testcmd [-alr] [file ...]",
    };

    interface TestFlags {
      all: boolean;
      list: boolean;
      recursive: boolean;
    }

    const defaults: TestFlags = { all: false, list: false, recursive: false };

    const handler = (flags: TestFlags, flag: FlagDefinition) => {
      if (flag.short === "a") flags.all = true;
      if (flag.short === "l") flags.list = true;
      if (flag.short === "r") flags.recursive = true;
    };

    const parser = createFlagParser(spec, defaults, handler);

    test("parses short flag", () => {
      const result = parser.parse(["-a", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.all).toBe(true);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("parses long flag", () => {
      const result = parser.parse(["--all", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.all).toBe(true);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("parses combined short flags", () => {
      const result = parser.parse(["-alr", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.all).toBe(true);
      expect(result.flags.list).toBe(true);
      expect(result.flags.recursive).toBe(true);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("returns error for unrecognized short flag", () => {
      const result = parser.parse(["-x"]);
      expect(result.error).toEqual({
        type: "unrecognized_option",
        option: "-x",
      });
    });

    test("returns error for unrecognized long flag", () => {
      const result = parser.parse(["--invalid"]);
      expect(result.error).toEqual({
        type: "unrecognized_option",
        option: "--invalid",
      });
    });

    test("returns error for unrecognized flag in combined flags", () => {
      const result = parser.parse(["-alx"]);
      expect(result.error).toEqual({
        type: "unrecognized_option",
        option: "-x",
      });
    });

    test("stops parsing flags after --", () => {
      const result = parser.parse(["-a", "--", "-l", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.all).toBe(true);
      expect(result.flags.list).toBe(false);
      expect(result.args).toEqual(["-l", "file.txt"]);
    });
  });

  describe("value flags", () => {
    const spec = {
      name: "head",
      flags: [{ short: "n", long: "lines", takesValue: true }],
      usage: "head [-n lines] [file ...]",
    };

    interface HeadFlags {
      lines: number;
    }

    const defaults: HeadFlags = { lines: 10 };

    const handler = (flags: HeadFlags, flag: FlagDefinition, value?: string) => {
      if (flag.short === "n" && value) {
        flags.lines = parseInt(value, 10);
      }
    };

    const parser = createFlagParser(spec, defaults, handler);

    test("parses short flag with space-separated value", () => {
      const result = parser.parse(["-n", "5", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.lines).toBe(5);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("parses short flag with attached value", () => {
      const result = parser.parse(["-n5", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.lines).toBe(5);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("parses long flag with space-separated value", () => {
      const result = parser.parse(["--lines", "5", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.lines).toBe(5);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("parses long flag with = value", () => {
      const result = parser.parse(["--lines=5", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.lines).toBe(5);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("returns error when value missing for short flag", () => {
      const result = parser.parse(["-n"]);
      expect(result.error).toEqual({
        type: "missing_value",
        option: "-n",
      });
    });

    test("returns error when value missing for long flag", () => {
      const result = parser.parse(["--lines"]);
      expect(result.error).toEqual({
        type: "missing_value",
        option: "--lines",
      });
    });
  });

  describe("error formatting", () => {
    const spec = {
      name: "grep",
      flags: [{ short: "i" }, { short: "v" }],
      usage: "grep [-iv] pattern [file ...]",
    };

    const parser = createFlagParser(spec, {}, () => {});

    test("formats short flag error correctly", () => {
      const error = { type: "unrecognized_option" as const, option: "-x" };
      const message = parser.formatError(error);
      expect(message).toBe(
        "grep: invalid option -- 'x'\nusage: grep [-iv] pattern [file ...]\n"
      );
    });

    test("formats long flag error correctly", () => {
      const error = { type: "unrecognized_option" as const, option: "--blabla" };
      const message = parser.formatError(error);
      expect(message).toBe(
        "grep: unrecognized option '--blabla'\nusage: grep [-iv] pattern [file ...]\n"
      );
    });

    test("formats missing value error correctly", () => {
      const error = { type: "missing_value" as const, option: "-n" };
      const message = parser.formatError(error);
      expect(message).toBe(
        "grep: option '-n' requires an argument\nusage: grep [-iv] pattern [file ...]\n"
      );
    });
  });

  describe("mixed boolean and value flags", () => {
    const spec = {
      name: "grep",
      flags: [
        { short: "i" },
        { short: "v" },
        { short: "n" },
        { short: "m", takesValue: true },
        { short: "e", takesValue: true },
      ],
      usage: "grep [-ivn] [-m num] [-e pattern] pattern [file ...]",
    };

    interface GrepFlags {
      ignoreCase: boolean;
      invert: boolean;
      lineNumbers: boolean;
      maxCount: number;
      patterns: string[];
    }

    const defaults: GrepFlags = {
      ignoreCase: false,
      invert: false,
      lineNumbers: false,
      maxCount: 0,
      patterns: [],
    };

    const handler = (flags: GrepFlags, flag: FlagDefinition, value?: string) => {
      if (flag.short === "i") flags.ignoreCase = true;
      if (flag.short === "v") flags.invert = true;
      if (flag.short === "n") flags.lineNumbers = true;
      if (flag.short === "m" && value) flags.maxCount = parseInt(value, 10);
      if (flag.short === "e" && value) flags.patterns.push(value);
    };

    const parser = createFlagParser(spec, defaults, handler);

    test("parses mixed flags correctly", () => {
      const result = parser.parse(["-iv", "-m", "5", "-e", "foo", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.ignoreCase).toBe(true);
      expect(result.flags.invert).toBe(true);
      expect(result.flags.maxCount).toBe(5);
      expect(result.flags.patterns).toEqual(["foo"]);
      expect(result.args).toEqual(["file.txt"]);
    });

    test("value flag at end of combined flags", () => {
      const result = parser.parse(["-ivm5", "file.txt"]);
      expect(result.error).toBeUndefined();
      expect(result.flags.ignoreCase).toBe(true);
      expect(result.flags.invert).toBe(true);
      expect(result.flags.maxCount).toBe(5);
      expect(result.args).toEqual(["file.txt"]);
    });
  });
});
