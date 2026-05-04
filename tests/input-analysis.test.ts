import { describe, expect, test } from "bun:test";
import { analyzeInput } from "../src/index.ts";

describe("analyzeInput", () => {
  test("returns complete with an AST for valid input", () => {
    const result = analyzeInput("echo hello");

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") {
      expect(result.ast.type).toBe("command");
    }
  });

  test("detects incomplete compound input", () => {
    expect(analyzeInput("if true; then\n").kind).toBe("incomplete");
    expect(analyzeInput("if true; then\n")).toMatchObject({ kind: "incomplete", reason: "compound" });
  });

  test("detects incomplete heredoc input", () => {
    expect(analyzeInput("cat <<EOF\nhello\n")).toMatchObject({
      kind: "incomplete",
      reason: "heredoc",
    });
  });

  test("detects trailing pipeline input", () => {
    expect(analyzeInput("echo hello |")).toMatchObject({
      kind: "incomplete",
      reason: "pipeline",
    });
  });

  test("detects unclosed quotes", () => {
    expect(analyzeInput('echo "hello')).toMatchObject({
      kind: "incomplete",
      reason: "quote",
    });
  });

  test("reports invalid syntax", () => {
    const result = analyzeInput(")");

    expect(result.kind).toBe("invalid");
  });
});
