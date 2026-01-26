import { test, expect, describe } from "bun:test";
import { lex } from "../src/lexer/index.ts";
import { parse } from "../src/parser/index.ts";

describe("Parser", () => {
  test("parses simple command", () => {
    const tokens = lex("echo hello");
    const ast = parse(tokens);
    expect(ast).toEqual({
      type: "command",
      name: { type: "literal", value: "echo" },
      args: [{ type: "literal", value: "hello" }],
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
    expect((ast as any).args[0].type).toBe("variable");
    expect((ast as any).args[0].name).toBe("HOME");
  });

  test("parses glob pattern", () => {
    const tokens = lex("ls *.txt");
    const ast = parse(tokens);
    expect((ast as any).args[0].type).toBe("glob");
    expect((ast as any).args[0].pattern).toBe("*.txt");
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
    expect((ast as any).args[0].type).toBe("concat");
  });
});
