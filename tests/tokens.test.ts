import { test, expect, describe } from "bun:test";
import { tokenToString, type Token } from "../src/lexer/tokens.ts";

describe("tokenToString", () => {
  test("word token", () => {
    const token: Token = { type: "word", value: "hello" };
    expect(tokenToString(token)).toBe("hello");
  });

  test("keyword token", () => {
    const token: Token = { type: "keyword", value: "if" };
    expect(tokenToString(token)).toBe("if");
  });

  test("pipe token", () => {
    const token: Token = { type: "pipe" };
    expect(tokenToString(token)).toBe("|");
  });

  test("and token", () => {
    const token: Token = { type: "and" };
    expect(tokenToString(token)).toBe("&&");
  });

  test("or token", () => {
    const token: Token = { type: "or" };
    expect(tokenToString(token)).toBe("||");
  });

  test("semicolon token", () => {
    const token: Token = { type: "semicolon" };
    expect(tokenToString(token)).toBe(";");
  });

  test("newline token", () => {
    const token: Token = { type: "newline" };
    expect(tokenToString(token)).toBe("\n");
  });

  test("redirect token (>)", () => {
    const token: Token = { type: "redirect", mode: ">" };
    expect(tokenToString(token)).toBe(">");
  });

  test("redirect token (>>)", () => {
    const token: Token = { type: "redirect", mode: ">>" };
    expect(tokenToString(token)).toBe(">>");
  });

  test("redirect token (<)", () => {
    const token: Token = { type: "redirect", mode: "<" };
    expect(tokenToString(token)).toBe("<");
  });

  test("redirect token (2>)", () => {
    const token: Token = { type: "redirect", mode: "2>" };
    expect(tokenToString(token)).toBe("2>");
  });

  test("redirect token (2>>)", () => {
    const token: Token = { type: "redirect", mode: "2>>" };
    expect(tokenToString(token)).toBe("2>>");
  });

  test("redirect token (&>)", () => {
    const token: Token = { type: "redirect", mode: "&>" };
    expect(tokenToString(token)).toBe("&>");
  });

  test("redirect token (&>>)", () => {
    const token: Token = { type: "redirect", mode: "&>>" };
    expect(tokenToString(token)).toBe("&>>");
  });

  test("redirect token (2>&1)", () => {
    const token: Token = { type: "redirect", mode: "2>&1" };
    expect(tokenToString(token)).toBe("2>&1");
  });

  test("redirect token (1>&2)", () => {
    const token: Token = { type: "redirect", mode: "1>&2" };
    expect(tokenToString(token)).toBe("1>&2");
  });

  test("variable token", () => {
    const token: Token = { type: "variable", name: "HOME" };
    expect(tokenToString(token)).toBe("$HOME");
  });

  test("substitution token", () => {
    const token: Token = { type: "substitution", command: "date" };
    expect(tokenToString(token)).toBe("$(date)");
  });

  test("arithmetic token", () => {
    const token: Token = { type: "arithmetic", expression: "1 + 2" };
    expect(tokenToString(token)).toBe("$((1 + 2))");
  });

  test("glob token", () => {
    const token: Token = { type: "glob", pattern: "*.txt" };
    expect(tokenToString(token)).toBe("*.txt");
  });

  test("singleQuote token", () => {
    const token: Token = { type: "singleQuote", value: "hello world" };
    expect(tokenToString(token)).toBe("'hello world'");
  });

  test("doubleQuote token with string parts", () => {
    const token: Token = { type: "doubleQuote", parts: ["hello ", "world"] };
    expect(tokenToString(token)).toBe('"hello world"');
  });

  test("doubleQuote token with variable", () => {
    const token: Token = {
      type: "doubleQuote",
      parts: ["hello ", { type: "variable", name: "USER" }],
    };
    expect(tokenToString(token)).toBe('"hello $USER"');
  });

  test("doubleQuote token with nested tokens", () => {
    const token: Token = {
      type: "doubleQuote",
      parts: [
        "prefix-",
        { type: "substitution", command: "date" },
        "-suffix",
      ],
    };
    expect(tokenToString(token)).toBe('"prefix-$(date)-suffix"');
  });

  test("assignment token with string value", () => {
    const token: Token = { type: "assignment", name: "FOO", value: "bar" };
    expect(tokenToString(token)).toBe("FOO=bar");
  });

  test("assignment token with token array value", () => {
    const token: Token = {
      type: "assignment",
      name: "PATH",
      value: [
        { type: "variable", name: "HOME" },
        { type: "word", value: "/bin" },
      ],
    };
    expect(tokenToString(token)).toBe("PATH=$HOME/bin");
  });

  test("heredoc token with expansion", () => {
    const token: Token = {
      type: "heredoc",
      content: "line1\nline2",
      expand: true,
    };
    expect(tokenToString(token)).toBe("<<EOF\nline1\nline2\nEOF");
  });

  test("heredoc token without expansion", () => {
    const token: Token = {
      type: "heredoc",
      content: "$VAR stays literal",
      expand: false,
    };
    expect(tokenToString(token)).toBe("<<'EOF'\n$VAR stays literal\nEOF");
  });

  test("openParen token", () => {
    const token: Token = { type: "openParen" };
    expect(tokenToString(token)).toBe("(");
  });

  test("closeParen token", () => {
    const token: Token = { type: "closeParen" };
    expect(tokenToString(token)).toBe(")");
  });

  test("doubleSemicolon token", () => {
    const token: Token = { type: "doubleSemicolon" };
    expect(tokenToString(token)).toBe(";;");
  });

  test("eof token", () => {
    const token: Token = { type: "eof" };
    expect(tokenToString(token)).toBe("<EOF>");
  });
});
