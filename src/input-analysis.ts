import type { ASTNode } from "./parser/ast.ts";
import type { Token, KeywordValue } from "./lexer/tokens.ts";
import { Lexer } from "./lexer/lexer.ts";
import { Parser } from "./parser/parser.ts";
import { LexError, ParseError } from "./errors.ts";

export type InputIncompleteReason = "quote" | "heredoc" | "compound" | "pipeline";

export type InputAnalysis =
  | { kind: "complete"; ast: ASTNode }
  | { kind: "incomplete"; reason: InputIncompleteReason }
  | { kind: "invalid"; error: LexError | ParseError | Error };

export function analyzeInput(source: string): InputAnalysis {
  const heredoc = findIncompleteHeredoc(source);
  if (heredoc) {
    return { kind: "incomplete", reason: "heredoc" };
  }

  let tokens: Token[];
  try {
    tokens = new Lexer(source, { preserveNewlines: true }).tokenize();
  } catch (err) {
    if (err instanceof LexError && err.message.toLowerCase().includes("unterminated")) {
      return { kind: "incomplete", reason: "quote" };
    }
    return { kind: "invalid", error: err instanceof Error ? err : new Error(String(err)) };
  }

  if (tokens.every((token) => token.type === "newline" || token.type === "eof")) {
    return { kind: "complete", ast: emptyCommandAst() };
  }

  if (hasTrailingPipeline(tokens)) {
    return { kind: "incomplete", reason: "pipeline" };
  }

  try {
    const ast = new Parser(tokens).parse();
    return { kind: "complete", ast };
  } catch (err) {
    if (hasOpenCompound(tokens)) {
      return { kind: "incomplete", reason: "compound" };
    }
    if (err instanceof ParseError && isIncompleteParseMessage(err.message)) {
      return { kind: "incomplete", reason: "compound" };
    }
    return { kind: "invalid", error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function emptyCommandAst(): ASTNode {
  return {
    type: "command",
    name: { type: "word", parts: [] },
    args: [],
    redirects: [],
    assignments: [],
  };
}

function hasTrailingPipeline(tokens: Token[]): boolean {
  let i = tokens.length - 1;
  while (i >= 0 && (tokens[i]!.type === "eof" || tokens[i]!.type === "newline")) {
    i--;
  }
  return i >= 0 && tokens[i]!.type === "pipe";
}

function hasOpenCompound(tokens: Token[]): boolean {
  const stack: KeywordValue[] = [];

  for (const token of tokens) {
    if (token.type !== "keyword") {
      continue;
    }

    switch (token.value) {
      case "if":
        stack.push("fi");
        break;
      case "for":
      case "while":
      case "until":
        stack.push("done");
        break;
      case "case":
        stack.push("esac");
        break;
      case "fi":
      case "done":
      case "esac":
        if (stack[stack.length - 1] === token.value) {
          stack.pop();
        }
        break;
    }
  }

  return stack.length > 0;
}

function isIncompleteParseMessage(message: string): boolean {
  return (
    message.includes("Expected 'fi'") ||
    message.includes("Expected 'done'") ||
    message.includes("Expected 'esac'") ||
    message.includes("Expected 'then'") ||
    message.includes("Expected 'do'")
  );
}

function findIncompleteHeredoc(source: string): boolean {
  const lines = source.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*|\S+))/);
    if (!match) {
      continue;
    }

    const delimiter = match[1] ?? match[2] ?? match[3];
    if (!delimiter) {
      continue;
    }

    let found = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === delimiter || lines[j]!.replace(/^\t+/, "") === delimiter) {
        found = true;
        break;
      }
    }
    if (!found) {
      return true;
    }
  }

  return false;
}
