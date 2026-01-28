import { ParseError } from "../errors.ts";
import type { Token, KeywordValue } from "../lexer/tokens.ts";
import type { ASTNode, Redirect, RedirectMode, CommandNode, IfNode, ForNode, WhileNode, UntilNode, CaseNode, CaseClause } from "./ast.ts";

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

  // sequence := and_or ((';'|'\n') and_or)*
  private parseSequence(): ASTNode {
    this.skipNewlines();
    const commands: ASTNode[] = [];
    commands.push(this.parseAndOr());

    while (this.match("semicolon") || this.match("newline")) {
      this.skipNewlines();
      // Skip empty commands after separator, or stop at terminating keywords
      if (this.isAtEnd() || this.check("semicolon") || this.check("newline") || this.isTerminatingKeyword()) continue;
      commands.push(this.parseAndOr());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "sequence", commands };
  }

  private skipNewlines(): void {
    while (this.match("newline")) {
      // keep consuming newlines
    }
  }

  private isTerminatingKeyword(): boolean {
    const token = this.peek();
    if (token.type !== "keyword") return false;
    return ["then", "elif", "else", "fi", "do", "done", "esac"].includes(token.value);
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
    commands.push(this.parseCompoundOrCommand());

    while (this.match("pipe")) {
      this.skipNewlines();
      commands.push(this.parseCompoundOrCommand());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "pipeline", commands };
  }

  // compound_or_command := compound_command | simple_command
  private parseCompoundOrCommand(): ASTNode {
    this.skipNewlines();
    const token = this.peek();

    if (token.type === "keyword") {
      switch (token.value) {
        case "if":
          return this.parseIf();
        case "for":
          return this.parseFor();
        case "while":
          return this.parseWhile();
        case "until":
          return this.parseUntil();
        case "case":
          return this.parseCase();
      }
    }

    return this.parseCommand();
  }

  // if := 'if' compound_list 'then' compound_list ('elif' compound_list 'then' compound_list)* ['else' compound_list] 'fi'
  private parseIf(): IfNode {
    this.expectKeyword("if");
    const condition = this.parseCompoundList(["then"]);
    this.expectKeyword("then");
    const thenBranch = this.parseCompoundList(["elif", "else", "fi"]);

    const elifBranches: Array<{ condition: ASTNode; body: ASTNode }> = [];
    while (this.checkKeyword("elif")) {
      this.expectKeyword("elif");
      const elifCondition = this.parseCompoundList(["then"]);
      this.expectKeyword("then");
      const elifBody = this.parseCompoundList(["elif", "else", "fi"]);
      elifBranches.push({ condition: elifCondition, body: elifBody });
    }

    let elseBranch: ASTNode | undefined;
    if (this.checkKeyword("else")) {
      this.expectKeyword("else");
      elseBranch = this.parseCompoundList(["fi"]);
    }

    this.expectKeyword("fi");

    return {
      type: "if",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
    };
  }

  // for := 'for' NAME ['in' word*] (';'|'\n') 'do' compound_list 'done'
  private parseFor(): ForNode {
    this.expectKeyword("for");

    // Get variable name
    const varToken = this.peek();
    if (varToken.type !== "word") {
      throw new ParseError("Expected variable name after 'for'");
    }
    this.advance();
    const variable = varToken.value;

    // Parse optional 'in' clause
    const items: ASTNode[] = [];
    if (this.checkKeyword("in")) {
      this.expectKeyword("in");
      // Read items until semicolon, newline, or 'do'
      while (!this.isAtEnd() && !this.check("semicolon") && !this.check("newline") && !this.checkKeyword("do")) {
        items.push(this.parseWordArg());
      }
    }

    // Consume separator (semicolon or newline)
    if (!this.match("semicolon")) {
      this.match("newline");
    }
    this.skipNewlines();

    this.expectKeyword("do");
    const body = this.parseCompoundList(["done"]);
    this.expectKeyword("done");

    return {
      type: "for",
      variable,
      items,
      body,
    };
  }

  // while := 'while' compound_list 'do' compound_list 'done'
  private parseWhile(): WhileNode {
    this.expectKeyword("while");
    const condition = this.parseCompoundList(["do"]);
    this.expectKeyword("do");
    const body = this.parseCompoundList(["done"]);
    this.expectKeyword("done");

    return {
      type: "while",
      condition,
      body,
    };
  }

  // until := 'until' compound_list 'do' compound_list 'done'
  private parseUntil(): UntilNode {
    this.expectKeyword("until");
    const condition = this.parseCompoundList(["do"]);
    this.expectKeyword("do");
    const body = this.parseCompoundList(["done"]);
    this.expectKeyword("done");

    return {
      type: "until",
      condition,
      body,
    };
  }

  // case := 'case' word 'in' (pattern ('|' pattern)* ')' compound_list ';;')* 'esac'
  private parseCase(): CaseNode {
    this.expectKeyword("case");
    const word = this.parseWordArg();
    this.expectKeyword("in");
    this.skipNewlines();

    const clauses: CaseClause[] = [];

    while (!this.isAtEnd() && !this.checkKeyword("esac")) {
      // Parse patterns separated by '|'
      // Skip leading '(' if present
      this.match("openParen");

      const patterns: ASTNode[] = [];
      patterns.push(this.parseCasePattern());

      while (this.match("pipe")) {
        patterns.push(this.parseCasePattern());
      }

      // Expect ')'
      if (!this.match("closeParen")) {
        throw new ParseError("Expected ')' after case pattern");
      }

      // Parse body until ';;' or 'esac'
      const body = this.parseCaseBody();

      clauses.push({ patterns, body });

      // ';;' is optional for the last clause
      this.match("doubleSemicolon");
      this.skipNewlines();
    }

    this.expectKeyword("esac");

    return {
      type: "case",
      word,
      clauses,
    };
  }

  private parseCasePattern(): ASTNode {
    const token = this.peek();

    // Handle glob patterns and words
    if (token.type === "word" || token.type === "glob" || token.type === "singleQuote" || token.type === "doubleQuote") {
      return this.parseWordArg();
    }

    throw new ParseError(`Expected pattern in case clause, got ${token.type}`);
  }

  private parseCaseBody(): ASTNode {
    const commands: ASTNode[] = [];
    this.skipNewlines();

    // Parse until ';;' or 'esac'
    while (!this.isAtEnd() && !this.check("doubleSemicolon") && !this.checkKeyword("esac")) {
      commands.push(this.parseAndOr());
      // Consume separator
      if (!this.match("semicolon") && !this.match("newline")) {
        break;
      }
      this.skipNewlines();
      // Check for terminators after consuming separators
      if (this.check("doubleSemicolon") || this.checkKeyword("esac")) {
        break;
      }
    }

    if (commands.length === 0) {
      return { type: "command", name: { type: "literal", value: "true" }, args: [], redirects: [], assignments: [] };
    }
    if (commands.length === 1) {
      return commands[0]!;
    }
    return { type: "sequence", commands };
  }

  // compound_list := and_or ((';'|'\n') and_or)* [';'|'\n']
  private parseCompoundList(terminators: KeywordValue[]): ASTNode {
    this.skipNewlines();
    const commands: ASTNode[] = [];

    // Check for empty list
    if (this.isCompoundListTerminator(terminators)) {
      // Return a no-op command for empty list
      return { type: "command", name: { type: "literal", value: "true" }, args: [], redirects: [], assignments: [] };
    }

    commands.push(this.parseAndOr());

    while ((this.match("semicolon") || this.match("newline")) && !this.isAtEnd()) {
      this.skipNewlines();
      // Check for terminators
      if (this.isCompoundListTerminator(terminators)) {
        break;
      }
      commands.push(this.parseAndOr());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "sequence", commands };
  }

  private isCompoundListTerminator(terminators: KeywordValue[]): boolean {
    const token = this.peek();
    if (token.type !== "keyword") return false;
    return terminators.includes(token.value);
  }

  private checkKeyword(value: KeywordValue): boolean {
    const token = this.peek();
    return token.type === "keyword" && token.value === value;
  }

  private expectKeyword(value: KeywordValue): void {
    if (!this.checkKeyword(value)) {
      throw new ParseError(`Expected '${value}'`);
    }
    this.advance();
    // Don't skip newlines here - let the caller handle them
    // Newlines are significant as command separators in compound lists
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

    if (args.length === 0 && assignments.length === 0 && redirects.length === 0) {
      throw new ParseError("Expected command");
    }

    const name = args.shift() ?? { type: "literal" as const, value: redirects.length > 0 ? ":" : "" };

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
          new (require("../lexer/lexer.ts").Lexer)(token.command, { preserveNewlines: true }).tokenize()
        );
        return { type: "substitution", command: innerParser.parse() };
      case "arithmetic":
        return { type: "arithmetic", expression: token.expression };
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
      token.type === "arithmetic" ||
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
