import { LexError } from "../errors.ts";
import type { Token, RedirectMode } from "./tokens.ts";

const GLOB_CHARS = new Set(["*", "?", "[", "{", "}"]);
const WORD_BREAK_CHARS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "|",
  "&",
  ";",
  ">",
  "<",
  "(",
  ")",
  "$",
  "'",
  '"',
  "`",
]);

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespace();
      if (this.isAtEnd()) break;

      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    tokens.push({ type: "eof" });
    return tokens;
  }

  private nextToken(): Token | null {
    const char = this.peek();

    // Comments
    if (char === "#") {
      this.skipComment();
      return null;
    }

    // Operators and redirects
    if (char === "|") {
      this.advance();
      if (this.peek() === "|") {
        this.advance();
        return { type: "or" };
      }
      return { type: "pipe" };
    }

    if (char === "&") {
      this.advance();
      if (this.peek() === "&") {
        this.advance();
        return { type: "and" };
      }
      if (this.peek() === ">") {
        this.advance();
        if (this.peek() === ">") {
          this.advance();
          return { type: "redirect", mode: "&>>" };
        }
        return { type: "redirect", mode: "&>" };
      }
      // Background execution (&) - treat as word for now
      return { type: "word", value: "&" };
    }

    if (char === ";") {
      this.advance();
      return { type: "semicolon" };
    }

    // Redirects
    if (char === ">") {
      this.advance();
      if (this.peek() === ">") {
        this.advance();
        return { type: "redirect", mode: ">>" };
      }
      return { type: "redirect", mode: ">" };
    }

    if (char === "<") {
      this.advance();
      return { type: "redirect", mode: "<" };
    }

    // File descriptor redirects (2>, 2>>, 2>&1, 1>&2)
    if (char === "1" || char === "2") {
      const fd = char;
      const nextChar = this.peekAhead(1);
      if (nextChar === ">") {
        this.advance(); // consume fd
        this.advance(); // consume >
        if (fd === "2") {
          if (this.peek() === "&" && this.peekAhead(1) === "1") {
            this.advance(); // consume &
            this.advance(); // consume 1
            return { type: "redirect", mode: "2>&1" };
          }
          if (this.peek() === ">") {
            this.advance();
            return { type: "redirect", mode: "2>>" };
          }
          return { type: "redirect", mode: "2>" };
        } else {
          // 1>&2
          if (this.peek() === "&" && this.peekAhead(1) === "2") {
            this.advance(); // consume &
            this.advance(); // consume 2
            return { type: "redirect", mode: "1>&2" };
          }
          if (this.peek() === ">") {
            this.advance();
            return { type: "redirect", mode: ">>" };
          }
          return { type: "redirect", mode: ">" };
        }
      }
    }

    // Variables and substitutions
    if (char === "$") {
      return this.readVariable();
    }

    // Single quotes
    if (char === "'") {
      return this.readSingleQuote();
    }

    // Double quotes
    if (char === '"') {
      return this.readDoubleQuote();
    }

    // Word (including potential globs and assignments)
    return this.readWord();
  }

  private readVariable(): Token {
    this.advance(); // consume $

    // Command substitution $(...)
    if (this.peek() === "(") {
      this.advance(); // consume (
      const command = this.readUntilMatchingParen();
      return { type: "substitution", command };
    }

    // ${VAR} syntax
    if (this.peek() === "{") {
      this.advance(); // consume {
      let name = "";
      while (!this.isAtEnd() && this.peek() !== "}") {
        name += this.advance();
      }
      if (this.peek() === "}") {
        this.advance(); // consume }
      }
      return { type: "variable", name };
    }

    // $VAR syntax
    let name = "";
    while (!this.isAtEnd() && this.isVarChar(this.peek())) {
      name += this.advance();
    }

    if (name === "") {
      return { type: "word", value: "$" };
    }

    return { type: "variable", name };
  }

  private readUntilMatchingParen(): string {
    let depth = 1;
    let result = "";

    while (!this.isAtEnd() && depth > 0) {
      const char = this.peek();
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          this.advance(); // consume closing )
          break;
        }
      }
      result += this.advance();
    }

    return result;
  }

  private readSingleQuote(): Token {
    this.advance(); // consume opening '
    let value = "";

    while (!this.isAtEnd() && this.peek() !== "'") {
      value += this.advance();
    }

    if (this.peek() === "'") {
      this.advance(); // consume closing '
    } else {
      throw new LexError("Unterminated single quote", this.pos, this.line, this.column);
    }

    return { type: "singleQuote", value };
  }

  private readDoubleQuote(): Token {
    this.advance(); // consume opening "
    const parts: Array<string | Token> = [];
    let currentString = "";

    while (!this.isAtEnd() && this.peek() !== '"') {
      const char = this.peek();

      if (char === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          const escaped = this.advance();
          // In double quotes, only certain chars are special
          if (["$", '"', "\\", "`", "\n"].includes(escaped)) {
            currentString += escaped;
          } else {
            currentString += "\\" + escaped;
          }
        }
      } else if (char === "$") {
        if (currentString) {
          parts.push(currentString);
          currentString = "";
        }
        parts.push(this.readVariable());
      } else {
        currentString += this.advance();
      }
    }

    if (currentString) {
      parts.push(currentString);
    }

    if (this.peek() === '"') {
      this.advance(); // consume closing "
    } else {
      throw new LexError("Unterminated double quote", this.pos, this.line, this.column);
    }

    return { type: "doubleQuote", parts };
  }

  private readWord(): Token {
    let value = "";
    let hasGlobChars = false;

    while (!this.isAtEnd() && !this.isWordBreak(this.peek())) {
      const char = this.peek();

      if (char === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          value += this.advance();
        }
      } else {
        if (GLOB_CHARS.has(char)) {
          hasGlobChars = true;
        }
        value += this.advance();
      }
    }

    // Check if this is an assignment (VAR=value)
    const assignmentMatch = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (assignmentMatch) {
      return {
        type: "assignment",
        name: assignmentMatch[1]!,
        value: assignmentMatch[2]!,
      };
    }

    if (hasGlobChars) {
      return { type: "glob", pattern: value };
    }

    return { type: "word", value };
  }

  private isWordBreak(char: string): boolean {
    return WORD_BREAK_CHARS.has(char);
  }

  private isVarChar(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char);
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  private skipComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
  }

  private peek(): string {
    return this.source[this.pos] ?? "";
  }

  private peekAhead(n: number): string {
    return this.source[this.pos + n] ?? "";
  }

  private advance(): string {
    const char = this.source[this.pos]!;
    this.pos++;
    if (char === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }
}

export function lex(source: string): Token[] {
  return new Lexer(source).tokenize();
}
