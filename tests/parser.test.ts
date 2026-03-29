import { test, expect, describe } from "bun:test";
import { lex } from "../src/lexer/index.ts";
import { parse } from "../src/parser/index.ts";

describe("Parser", () => {
  test("parses simple command", () => {
    const tokens = lex("echo hello");
    const ast = parse(tokens);
    expect(ast).toEqual({
      type: "command",
      name: { type: "word", parts: [{ type: "text", value: "echo", quoted: false }] },
      args: [{ type: "word", parts: [{ type: "text", value: "hello", quoted: false }] }],
      redirects: [],
      assignments: [],
    });
  });

  test("parses pipeline", () => {
    const tokens = lex("cat file | grep foo");
    const ast = parse(tokens);
    expect(ast.type).toBe("pipeline");
    expect((ast as any).commands.length).toBe(2);
  });

  test("parses and expression", () => {
    const tokens = lex("cmd1 && cmd2");
    const ast = parse(tokens);
    expect(ast.type).toBe("and");
    expect((ast as any).left.type).toBe("command");
    expect((ast as any).right.type).toBe("command");
  });

  test("parses or expression", () => {
    const tokens = lex("cmd1 || cmd2");
    const ast = parse(tokens);
    expect(ast.type).toBe("or");
  });

  test("parses sequence", () => {
    const tokens = lex("cmd1; cmd2; cmd3");
    const ast = parse(tokens);
    expect(ast.type).toBe("sequence");
    expect((ast as any).commands.length).toBe(3);
  });

  test("parses redirects", () => {
    const tokens = lex("echo hello > file.txt");
    const ast = parse(tokens);
    expect(ast.type).toBe("command");
    expect((ast as any).redirects.length).toBe(1);
    expect((ast as any).redirects[0].mode).toBe(">");
  });

  test("parses variable expansion", () => {
    const tokens = lex("echo $HOME");
    const ast = parse(tokens);
    expect((ast as any).args[0]).toEqual({
      type: "word",
      parts: [{ type: "variable", name: "HOME", quoted: false }],
    });
  });

  test("parses glob pattern", () => {
    const tokens = lex("ls *.txt");
    const ast = parse(tokens);
    expect((ast as any).args[0]).toEqual({
      type: "word",
      parts: [{ type: "text", value: "*.txt", quoted: false }],
    });
  });

  test("parses command with assignments", () => {
    const tokens = lex("FOO=bar echo $FOO");
    const ast = parse(tokens);
    expect(ast.type).toBe("command");
    expect((ast as any).assignments.length).toBe(1);
    expect((ast as any).assignments[0].name).toBe("FOO");
  });

  test("operator precedence: pipeline binds tighter than and/or", () => {
    const tokens = lex("a | b && c | d");
    const ast = parse(tokens);
    expect(ast.type).toBe("and");
    expect((ast as any).left.type).toBe("pipeline");
    expect((ast as any).right.type).toBe("pipeline");
  });

  test("operator precedence: semicolon has lowest precedence", () => {
    const tokens = lex("a && b; c || d");
    const ast = parse(tokens);
    expect(ast.type).toBe("sequence");
    expect((ast as any).commands.length).toBe(2);
    expect((ast as any).commands[0].type).toBe("and");
    expect((ast as any).commands[1].type).toBe("or");
  });

  test("parses double quoted strings with concatenation", () => {
    const tokens = lex('echo "hello $USER!"');
    const ast = parse(tokens);
    expect((ast as any).args[0]).toEqual({
      type: "word",
      parts: [
        { type: "text", value: "hello ", quoted: true },
        { type: "variable", name: "USER", quoted: true },
        { type: "text", value: "!", quoted: true },
      ],
    });
  });

  test("preserves quote boundaries across adjacent tokens", () => {
    const tokens = lex('echo a"$USER"b');
    const ast = parse(tokens);
    expect((ast as any).args[0]).toEqual({
      type: "word",
      parts: [
        { type: "text", value: "a", quoted: false },
        { type: "variable", name: "USER", quoted: true },
        { type: "text", value: "b", quoted: false },
      ],
    });
  });

  test("single-quoted globs remain quoted text", () => {
    const tokens = lex("echo '*.txt'");
    const ast = parse(tokens);
    expect((ast as any).args[0]).toEqual({
      type: "word",
      parts: [{ type: "text", value: "*.txt", quoted: true }],
    });
  });

  test("keeps command substitution adjacent to literal suffixes", () => {
    const tokens = lex("echo $(pwd)suffix");
    const ast = parse(tokens);
    expect((ast as any).args[0].type).toBe("word");
    expect((ast as any).args[0].parts).toHaveLength(2);
    expect((ast as any).args[0].parts[0].type).toBe("substitution");
    expect((ast as any).args[0].parts[0].quoted).toBe(false);
    expect((ast as any).args[0].parts[1]).toEqual({
      type: "text",
      value: "suffix",
      quoted: false,
    });
  });
});
