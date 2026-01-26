import { test, expect, describe } from "bun:test";
import { ShellError, LexError, ParseError } from "../src/errors.ts";

describe("ShellError", () => {
  test("creates error with correct properties", () => {
    const stdout = Buffer.from("output");
    const stderr = Buffer.from("error message");
    const exitCode = 1;

    const error = new ShellError("Command failed", stdout, stderr, exitCode);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ShellError);
    expect(error.name).toBe("ShellError");
    expect(error.message).toBe("Command failed");
    expect(error.stdout).toBe(stdout);
    expect(error.stderr).toBe(stderr);
    expect(error.exitCode).toBe(exitCode);
  });

  test("stores buffers correctly", () => {
    const stdout = Buffer.from("stdout content");
    const stderr = Buffer.from("stderr content");

    const error = new ShellError("test", stdout, stderr, 2);

    expect(error.stdout.toString()).toBe("stdout content");
    expect(error.stderr.toString()).toBe("stderr content");
  });

  test("handles empty buffers", () => {
    const error = new ShellError("empty", Buffer.alloc(0), Buffer.alloc(0), 0);

    expect(error.stdout.length).toBe(0);
    expect(error.stderr.length).toBe(0);
  });
});

describe("LexError", () => {
  test("creates error with formatted message", () => {
    const error = new LexError("Unexpected character", 10, 2, 5);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LexError);
    expect(error.name).toBe("LexError");
    expect(error.message).toBe("Lex error at line 2, column 5: Unexpected character");
    expect(error.position).toBe(10);
    expect(error.line).toBe(2);
    expect(error.column).toBe(5);
  });

  test("handles position at start of input", () => {
    const error = new LexError("Invalid token", 0, 1, 1);

    expect(error.message).toBe("Lex error at line 1, column 1: Invalid token");
    expect(error.position).toBe(0);
    expect(error.line).toBe(1);
    expect(error.column).toBe(1);
  });

  test("preserves original error message in formatted output", () => {
    const error = new LexError("Unterminated string", 25, 3, 10);

    expect(error.message).toContain("Unterminated string");
    expect(error.message).toContain("line 3");
    expect(error.message).toContain("column 10");
  });
});

describe("ParseError", () => {
  test("creates error with message only", () => {
    const error = new ParseError("Unexpected token");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ParseError);
    expect(error.name).toBe("ParseError");
    expect(error.message).toBe("Unexpected token");
    expect(error.position).toBeUndefined();
  });

  test("creates error with position", () => {
    const error = new ParseError("Expected )", 42);

    expect(error.message).toBe("Expected )");
    expect(error.position).toBe(42);
  });

  test("handles position of 0", () => {
    const error = new ParseError("Syntax error at start", 0);

    expect(error.position).toBe(0);
  });
});
