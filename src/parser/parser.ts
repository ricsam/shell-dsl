import { ParseError } from "../errors.ts";
import { Lexer } from "../lexer/lexer.ts";
import type { Token, KeywordValue } from "../lexer/tokens.ts";
import type {
  ASTNode,
  Redirect,
  RedirectMode,
  CommandNode,
  IfNode,
  ForNode,
  WhileNode,
  UntilNode,
  CaseNode,
  CaseClause,
  WordNode,
  WordPart,
} from "./ast.ts";

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

    const varToken = this.peek();
    if (varToken.type !== "word") {
      throw new ParseError("Expected variable name after 'for'");
    }
    this.advance();
    const variable = varToken.value;

    const items: WordNode[] = [];
    if (this.checkKeyword("in")) {
      this.expectKeyword("in");
      while (!this.isAtEnd() && !this.check("semicolon") && !this.check("newline") && !this.checkKeyword("do")) {
        items.push(this.parseWordArg());
      }
    }

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

  // case := 'case' word 'in' case_clause* 'esac'
  private parseCase(): CaseNode {
    this.expectKeyword("case");
    const word = this.parseWordArg();
    this.expectKeyword("in");
    this.skipNewlines();

    const clauses: CaseClause[] = [];

    while (!this.isAtEnd() && !this.checkKeyword("esac")) {
      this.match("openParen");

      const patterns: WordNode[] = [];
      patterns.push(this.parseCasePattern());

      while (this.match("pipe")) {
        patterns.push(this.parseCasePattern());
      }

      if (!this.match("closeParen")) {
        throw new ParseError("Expected ')' after case pattern");
      }

      const body = this.parseCaseBody();
      clauses.push({ patterns, body });

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

  private parseCasePattern(): WordNode {
    const token = this.peek();

    if (token.type === "word" || token.type === "glob" || token.type === "singleQuote" || token.type === "doubleQuote") {
      return this.parseWordArg();
    }

    throw new ParseError(`Expected pattern in case clause, got ${token.type}`);
  }

  private parseCaseBody(): ASTNode {
    const commands: ASTNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd() && !this.check("doubleSemicolon") && !this.checkKeyword("esac")) {
      commands.push(this.parseAndOr());
      if (!this.match("semicolon") && !this.match("newline")) {
        break;
      }
      this.skipNewlines();
      if (this.check("doubleSemicolon") || this.checkKeyword("esac")) {
        break;
      }
    }

    if (commands.length === 0) {
      return this.createNoopCommand();
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

    if (this.isCompoundListTerminator(terminators)) {
      return this.createNoopCommand();
    }

    commands.push(this.parseAndOr());

    while ((this.match("semicolon") || this.match("newline")) && !this.isAtEnd()) {
      this.skipNewlines();
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

  private createNoopCommand(): CommandNode {
    return {
      type: "command",
      name: this.createTextWord("true"),
      args: [],
      redirects: [],
      assignments: [],
    };
  }

  private createTextWord(value: string, quoted = false): WordNode {
    return {
      type: "word",
      parts: value === "" && !quoted ? [] : [{ type: "text", value, quoted }],
    };
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
  }

  // command := assignment* word+ redirect*
  private parseCommand(): CommandNode {
    const assignments: Array<{ name: string; value: WordNode }> = [];
    const args: WordNode[] = [];
    const redirects: Redirect[] = [];

    while (this.check("assignment")) {
      const token = this.advance() as Token & { type: "assignment" };
      assignments.push({
        name: token.name,
        value: this.tokenToWord(token.value),
      });
    }

    while (this.isWordToken()) {
      if (this.peek().type === "heredoc") {
        const heredocToken = this.advance() as Token & { type: "heredoc" };
        redirects.push({
          mode: "<",
          target: this.tokenToWord(heredocToken),
          heredocContent: true,
        });
      } else {
        args.push(this.parseWordArg());
      }
    }

    while (this.check("redirect")) {
      const redirect = this.parseRedirect();
      redirects.push(redirect);
      while (this.isWordToken()) {
        if (this.peek().type === "heredoc") {
          const heredocToken = this.advance() as Token & { type: "heredoc" };
          redirects.push({
            mode: "<",
            target: this.tokenToWord(heredocToken),
            heredocContent: true,
          });
        } else {
          args.push(this.parseWordArg());
        }
      }
    }

    if (args.length === 0 && assignments.length === 0 && redirects.length === 0) {
      throw new ParseError("Expected command");
    }

    const name = args.shift() ?? this.createTextWord(redirects.length > 0 ? ":" : "");

    return {
      type: "command",
      name,
      args,
      redirects,
      assignments,
    };
  }

  private parseWordArg(): WordNode {
    const token = this.advance();
    return this.tokenToWord(token);
  }

  private tokenToWord(token: Token | string | Token[]): WordNode {
    const parts = this.tokenToWordParts(token);
    return {
      type: "word",
      parts,
    };
  }

  private tokenToWordParts(token: Token | string | Token[], quoted = false): WordPart[] {
    if (typeof token === "string") {
      return [{ type: "text", value: token, quoted }];
    }

    if (Array.isArray(token)) {
      return token.flatMap((part) => this.tokenToWordParts(part, quoted));
    }

    switch (token.type) {
      case "word":
        return [{ type: "text", value: token.value, quoted }];
      case "singleQuote":
        return [{ type: "text", value: token.value, quoted: true }];
      case "doubleQuote":
        return this.parseDoubleQuoteParts(token.parts);
      case "variable":
        return [{ type: "variable", name: token.name, quoted }];
      case "substitution": {
        const innerParser = new Parser(
          new Lexer(token.command, { preserveNewlines: true }).tokenize()
        );
        return [{ type: "substitution", command: innerParser.parse(), quoted }];
      }
      case "arithmetic":
        return [{ type: "arithmetic", expression: token.expression, quoted }];
      case "glob":
        return [{ type: "text", value: token.pattern, quoted }];
      case "assignment":
        return this.tokenToWordParts(token.value, quoted);
      case "heredoc":
        return token.expand
          ? this.parseHeredocContent(token.content).parts
          : [{ type: "text", value: token.content, quoted: true }];
      default:
        throw new ParseError(`Unexpected token type: ${(token as Token).type}`);
    }
  }

  private parseDoubleQuoteParts(parts: Array<string | Token>): WordPart[] {
    if (parts.length === 0) {
      return [{ type: "text", value: "", quoted: true }];
    }

    return parts.flatMap((part) => this.tokenToWordParts(part, true));
  }

  private parseHeredocContent(content: string): WordNode {
    const parts: WordPart[] = [];
    let currentText = "";
    let i = 0;

    const pushText = () => {
      if (currentText.length > 0) {
        parts.push({ type: "text", value: currentText, quoted: false });
        currentText = "";
      }
    };

    while (i < content.length) {
      if (content[i] !== "$") {
        currentText += content[i];
        i++;
        continue;
      }

      pushText();
      i++;

      if (i >= content.length) {
        currentText += "$";
        break;
      }

      if (content[i] === "{") {
        i++;
        let name = "";
        while (i < content.length && content[i] !== "}") {
          name += content[i];
          i++;
        }
        if (i < content.length && content[i] === "}") {
          i++;
        }
        parts.push({ type: "variable", name, quoted: false });
        continue;
      }

      if (["#", "*", "@", "?"].includes(content[i] ?? "")) {
        parts.push({ type: "variable", name: content[i]!, quoted: false });
        i++;
        continue;
      }

      if (/[0-9]/.test(content[i] ?? "")) {
        parts.push({ type: "variable", name: content[i]!, quoted: false });
        i++;
        continue;
      }

      if (content[i] === "(" && content[i + 1] === "(") {
        i += 2;
        let depth = 1;
        let expression = "";
        while (i < content.length && depth > 0) {
          if (content[i] === "(" && content[i + 1] === "(") {
            depth++;
            expression += content[i]! + content[i + 1]!;
            i += 2;
            continue;
          }
          if (content[i] === ")" && content[i + 1] === ")") {
            depth--;
            if (depth === 0) {
              i += 2;
              break;
            }
            expression += content[i]! + content[i + 1]!;
            i += 2;
            continue;
          }
          expression += content[i]!;
          i++;
        }
        parts.push({ type: "arithmetic", expression, quoted: false });
        continue;
      }

      if (content[i] === "(") {
        i++;
        let depth = 1;
        let command = "";
        while (i < content.length && depth > 0) {
          if (content[i] === "(") {
            depth++;
          } else if (content[i] === ")") {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          command += content[i]!;
          i++;
        }
        const innerParser = new Parser(
          new Lexer(command, { preserveNewlines: true }).tokenize()
        );
        parts.push({ type: "substitution", command: innerParser.parse(), quoted: false });
        continue;
      }

      if (/[a-zA-Z_]/.test(content[i] ?? "")) {
        let name = "";
        while (i < content.length && /[a-zA-Z0-9_]/.test(content[i] ?? "")) {
          name += content[i];
          i++;
        }
        parts.push({ type: "variable", name, quoted: false });
        continue;
      }

      currentText += "$";
    }

    pushText();

    return {
      type: "word",
      parts,
    };
  }

  private parseRedirect(): Redirect {
    const token = this.advance() as Token & { type: "redirect" };
    const mode = token.mode as RedirectMode;

    if (mode === "2>&1" || mode === "1>&2") {
      return { mode, target: this.createTextWord("") };
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
      Array.isArray(token) ||
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
