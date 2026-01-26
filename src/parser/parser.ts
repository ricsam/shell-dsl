import { ParseError } from "../errors.ts";
import type { Token } from "../lexer/tokens.ts";
import type { ASTNode, Redirect, RedirectMode, CommandNode } from "./ast.ts";

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ASTNode {
    const result = this.parseSequence();
    if (!this.isAtEnd()) {
      throw new ParseError(`Unexpected token: ${JSON.stringify(this.peek())}`);
    }
    return result;
  }

  // sequence := and_or (';' and_or)*
  private parseSequence(): ASTNode {
    const commands: ASTNode[] = [];
    commands.push(this.parseAndOr());

    while (this.match("semicolon")) {
      // Skip empty commands after semicolon
      if (this.isAtEnd() || this.check("semicolon")) continue;
      commands.push(this.parseAndOr());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "sequence", commands };
  }

  // and_or := pipeline (('&&'|'||') pipeline)*
  private parseAndOr(): ASTNode {
    let left = this.parsePipeline();

    while (this.check("and") || this.check("or")) {
      if (this.match("and")) {
        const right = this.parsePipeline();
        left = { type: "and", left, right };
      } else if (this.match("or")) {
        const right = this.parsePipeline();
        left = { type: "or", left, right };
      }
    }

    return left;
  }

  // pipeline := command ('|' command)*
  private parsePipeline(): ASTNode {
    const commands: ASTNode[] = [];
    commands.push(this.parseCommand());

    while (this.match("pipe")) {
      commands.push(this.parseCommand());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "pipeline", commands };
  }

  // command := assignment* word+ redirect*
  private parseCommand(): CommandNode {
    const assignments: Array<{ name: string; value: ASTNode }> = [];
    const args: ASTNode[] = [];
    const redirects: Redirect[] = [];

    // Collect leading assignments
    while (this.check("assignment")) {
      const token = this.advance() as Token & { type: "assignment" };
      assignments.push({
        name: token.name,
        value: this.tokenToNode(token.value),
      });
    }

    // Collect command name and arguments
    while (this.isWordToken()) {
      // Check if it's a heredoc token - convert to input redirect
      if (this.peek().type === "heredoc") {
        const heredocToken = this.advance() as Token & { type: "heredoc" };
        redirects.push({
          mode: "<",
          target: this.tokenToNode(heredocToken),
          heredocContent: true,
        });
      } else {
        args.push(this.parseWordArg());
      }
    }

    // Collect redirects
    while (this.check("redirect")) {
      const redirect = this.parseRedirect();
      redirects.push(redirect);
      // After a redirect, there might be more words
      while (this.isWordToken()) {
        args.push(this.parseWordArg());
      }
    }

    if (args.length === 0 && assignments.length === 0) {
      throw new ParseError("Expected command");
    }

    const name = args.shift() ?? { type: "literal" as const, value: "" };

    return {
      type: "command",
      name,
      args,
      redirects,
      assignments,
    };
  }

  private parseWordArg(): ASTNode {
    const token = this.advance();
    return this.tokenToNode(token);
  }

  private tokenToNode(token: Token | string | Token[]): ASTNode {
    if (typeof token === "string") {
      return { type: "literal", value: token };
    }

    if (Array.isArray(token)) {
      const parts = token.map((t) => this.tokenToNode(t));
      if (parts.length === 1) return parts[0]!;
      return { type: "concat", parts };
    }

    switch (token.type) {
      case "word":
        return { type: "literal", value: token.value };
      case "singleQuote":
        return { type: "literal", value: token.value };
      case "doubleQuote":
        return this.parseDoubleQuoteParts(token.parts);
      case "variable":
        return { type: "variable", name: token.name };
      case "substitution":
        // Parse the inner command
        const innerParser = new Parser(
          new (require("../lexer/lexer.ts").Lexer)(token.command).tokenize()
        );
        return { type: "substitution", command: innerParser.parse() };
      case "glob":
        return { type: "glob", pattern: token.pattern };
      case "assignment":
        return this.tokenToNode(token.value);
      case "heredoc":
        if (token.expand) {
          return this.parseHeredocContent(token.content);
        }
        return { type: "literal", value: token.content };
      default:
        throw new ParseError(`Unexpected token type: ${(token as Token).type}`);
    }
  }

  private parseDoubleQuoteParts(parts: Array<string | Token>): ASTNode {
    if (parts.length === 0) {
      return { type: "literal", value: "" };
    }

    if (parts.length === 1) {
      const part = parts[0]!;
      if (typeof part === "string") {
        return { type: "literal", value: part };
      }
      return this.tokenToNode(part);
    }

    const nodes: ASTNode[] = parts.map((part) => {
      if (typeof part === "string") {
        return { type: "literal" as const, value: part };
      }
      return this.tokenToNode(part);
    });

    return { type: "concat", parts: nodes };
  }

  private parseHeredocContent(content: string): ASTNode {
    // Parse content looking for $VAR and ${VAR} patterns
    const parts: ASTNode[] = [];
    let currentLiteral = "";
    let i = 0;

    while (i < content.length) {
      if (content[i] === "$") {
        // Flush current literal
        if (currentLiteral) {
          parts.push({ type: "literal", value: currentLiteral });
          currentLiteral = "";
        }

        i++; // consume $
        if (i >= content.length) {
          currentLiteral += "$";
          break;
        }

        if (content[i] === "{") {
          // ${VAR} syntax
          i++; // consume {
          let varName = "";
          while (i < content.length && content[i] !== "}") {
            varName += content[i];
            i++;
          }
          if (i < content.length && content[i] === "}") {
            i++; // consume }
          }
          if (varName) {
            parts.push({ type: "variable", name: varName });
          }
        } else if (/[a-zA-Z_]/.test(content[i] ?? "")) {
          // $VAR syntax
          let varName = "";
          while (i < content.length && /[a-zA-Z0-9_]/.test(content[i] ?? "")) {
            varName += content[i];
            i++;
          }
          parts.push({ type: "variable", name: varName });
        } else {
          // Not a variable, keep the $
          currentLiteral += "$";
        }
      } else {
        currentLiteral += content[i];
        i++;
      }
    }

    // Flush remaining literal
    if (currentLiteral) {
      parts.push({ type: "literal", value: currentLiteral });
    }

    if (parts.length === 0) {
      return { type: "literal", value: "" };
    }
    if (parts.length === 1) {
      return parts[0]!;
    }
    return { type: "concat", parts };
  }

  private parseRedirect(): Redirect {
    const token = this.advance() as Token & { type: "redirect" };
    const mode = token.mode as RedirectMode;

    // 2>&1 and 1>&2 don't have a target
    if (mode === "2>&1" || mode === "1>&2") {
      return { mode, target: { type: "literal", value: "" } };
    }

    if (!this.isWordToken()) {
      throw new ParseError(`Expected redirect target after ${mode}`);
    }

    const target = this.parseWordArg();
    return { mode, target };
  }

  private isWordToken(): boolean {
    const token = this.peek();
    return (
      token.type === "word" ||
      token.type === "singleQuote" ||
      token.type === "doubleQuote" ||
      token.type === "variable" ||
      token.type === "substitution" ||
      token.type === "glob" ||
      token.type === "heredoc"
    );
  }

  private check(type: Token["type"]): boolean {
    return this.peek().type === type;
  }

  private match(type: Token["type"]): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof" };
  }

  private advance(): Token {
    const token = this.peek();
    this.pos++;
    return token;
  }

  private isAtEnd(): boolean {
    return this.peek().type === "eof";
  }
}

export function parse(tokens: Token[]): ASTNode {
  return new Parser(tokens).parse();
}
