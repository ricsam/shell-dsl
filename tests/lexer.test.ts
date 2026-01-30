import { test, expect, describe } from "bun:test";
import { lex } from "../src/lexer/index.ts";

describe("Lexer", () => {
  test("tokenizes simple words", () => {
    const tokens = lex("echo hello world");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "word", value: "hello" },
      { type: "word", value: "world" },
      { type: "eof" },
    ]);
  });

  test("tokenizes pipe", () => {
    const tokens = lex("cat file | grep foo");
    expect(tokens).toEqual([
      { type: "word", value: "cat" },
      { type: "word", value: "file" },
      { type: "pipe" },
      { type: "word", value: "grep" },
      { type: "word", value: "foo" },
      { type: "eof" },
    ]);
  });

  test("tokenizes and operator", () => {
    const tokens = lex("cmd1 && cmd2");
    expect(tokens).toEqual([
      { type: "word", value: "cmd1" },
      { type: "and" },
      { type: "word", value: "cmd2" },
      { type: "eof" },
    ]);
  });

  test("tokenizes or operator", () => {
    const tokens = lex("cmd1 || cmd2");
    expect(tokens).toEqual([
      { type: "word", value: "cmd1" },
      { type: "or" },
      { type: "word", value: "cmd2" },
      { type: "eof" },
    ]);
  });

  test("tokenizes semicolon", () => {
    const tokens = lex("cmd1; cmd2");
    expect(tokens).toEqual([
      { type: "word", value: "cmd1" },
      { type: "semicolon" },
      { type: "word", value: "cmd2" },
      { type: "eof" },
    ]);
  });

  test("tokenizes redirects", () => {
    expect(lex("echo > file")[1]).toEqual({ type: "redirect", mode: ">" });
    expect(lex("echo >> file")[1]).toEqual({ type: "redirect", mode: ">>" });
    expect(lex("cat < file")[1]).toEqual({ type: "redirect", mode: "<" });
    expect(lex("cmd 2> file")[1]).toEqual({ type: "redirect", mode: "2>" });
    expect(lex("cmd 2>> file")[1]).toEqual({ type: "redirect", mode: "2>>" });
    expect(lex("cmd &> file")[1]).toEqual({ type: "redirect", mode: "&>" });
    expect(lex("cmd &>> file")[1]).toEqual({ type: "redirect", mode: "&>>" });
    expect(lex("cmd 2>&1")[1]).toEqual({ type: "redirect", mode: "2>&1" });
    expect(lex("cmd 1>&2")[1]).toEqual({ type: "redirect", mode: "1>&2" });
  });

  test("tokenizes variables", () => {
    const tokens = lex("echo $HOME");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "variable", name: "HOME" },
      { type: "eof" },
    ]);
  });

  test("tokenizes braced variables", () => {
    const tokens = lex("echo ${USER}");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "variable", name: "USER" },
      { type: "eof" },
    ]);
  });

  test("tokenizes command substitution", () => {
    const tokens = lex("echo $(pwd)");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "substitution", command: "pwd" },
      { type: "eof" },
    ]);
  });

  test("tokenizes single quotes", () => {
    const tokens = lex("echo 'hello world'");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "singleQuote", value: "hello world" },
      { type: "eof" },
    ]);
  });

  test("tokenizes double quotes", () => {
    const tokens = lex('echo "hello world"');
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "doubleQuote", parts: ["hello world"] },
      { type: "eof" },
    ]);
  });

  test("tokenizes double quotes with variables", () => {
    const tokens = lex('echo "hello $USER"');
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "doubleQuote", parts: ["hello ", { type: "variable", name: "USER" }] },
      { type: "eof" },
    ]);
  });

  test("tokenizes globs", () => {
    const tokens = lex("ls *.txt");
    expect(tokens).toEqual([
      { type: "word", value: "ls" },
      { type: "glob", pattern: "*.txt" },
      { type: "eof" },
    ]);
  });

  test("tokenizes assignments", () => {
    const tokens = lex("FOO=bar echo $FOO");
    expect(tokens).toEqual([
      { type: "assignment", name: "FOO", value: "bar" },
      { type: "word", value: "echo" },
      { type: "variable", name: "FOO" },
      { type: "eof" },
    ]);
  });

  test("handles escaped characters", () => {
    const tokens = lex("echo hello\\ world");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "word", value: "hello world" },
      { type: "eof" },
    ]);
  });

  test("handles comments", () => {
    const tokens = lex("echo hello # this is a comment");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "word", value: "hello" },
      { type: "eof" },
    ]);
  });

  test("handles nested substitution", () => {
    const tokens = lex("echo $(cat $(pwd)/file)");
    expect(tokens).toEqual([
      { type: "word", value: "echo" },
      { type: "substitution", command: "cat $(pwd)/file" },
      { type: "eof" },
    ]);
  });

  describe("adjacent token merging", () => {
    test('--flag="value" produces merged token', () => {
      const tokens = lex('--include="*.tsx"');
      // Should be a single merged (array) token, not two separate tokens
      expect(tokens.length).toBe(2); // merged token + eof
      expect(Array.isArray(tokens[0])).toBe(true);
      const parts = tokens[0] as unknown as any[];
      expect(parts[0]).toEqual({ type: "word", value: "--include=" });
      expect(parts[1]).toEqual({ type: "doubleQuote", parts: ["*.tsx"] });
    });

    test("word'quoted' merges into single token", () => {
      const tokens = lex("hello'world'");
      expect(tokens.length).toBe(2); // merged + eof
      expect(Array.isArray(tokens[0])).toBe(true);
    });

    test('"part1"\'part2\' merges into single token', () => {
      const tokens = lex(`"part1"'part2'`);
      expect(tokens.length).toBe(2);
      expect(Array.isArray(tokens[0])).toBe(true);
    });

    test("separate tokens stay separate with whitespace", () => {
      const tokens = lex('--include "*.tsx"');
      expect(tokens.length).toBe(3); // word, doubleQuote, eof
      expect(tokens[0]).toEqual({ type: "word", value: "--include" });
    });

    test("word$VAR merges into single token", () => {
      const tokens = lex("prefix$VAR");
      expect(tokens.length).toBe(2);
      expect(Array.isArray(tokens[0])).toBe(true);
    });

    test("three adjacent parts merge", () => {
      const tokens = lex(`"a"'b'"c"`);
      expect(tokens.length).toBe(2);
      const parts = tokens[0] as unknown as any[];
      expect(parts.length).toBe(3);
    });
  });
});
