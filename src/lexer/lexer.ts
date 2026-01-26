import { LexError } from "../errors.ts";
import type { Token, RedirectMode, KeywordValue } from "./tokens.ts";
import { KEYWORDS } from "./tokens.ts";

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
  private tokenQueue: Token[] = [];
  private preserveNewlines: boolean;

  constructor(source: string, options?: { preserveNewlines?: boolean }) {
    this.source = source;
    this.preserveNewlines = options?.preserveNewlines ?? false;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd() || this.tokenQueue.length > 0) {
      // Drain token queue first (for heredoc handling)
      if (this.tokenQueue.length > 0) {
        tokens.push(this.tokenQueue.shift()!);
        continue;
      }

      this.skipWhitespaceExceptNewlines();
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
    // Check token queue first (used for heredoc handling)
    if (this.tokenQueue.length > 0) {
      return this.tokenQueue.shift()!;
    }

    const char = this.peek();

    // Newlines - significant for control flow
    if (char === "\n") {
      this.advance();
      // Skip consecutive newlines
      while (this.peek() === "\n") {
        this.advance();
      }
      if (this.preserveNewlines) {
        return { type: "newline" };
      }
      return null;
    }

    // Comments
    if (char === "#") {
      this.skipComment();
      return null;
    }

    // Parentheses - for case pattern grouping
    if (char === "(") {
      this.advance();
      return { type: "openParen" };
    }

    if (char === ")") {
      this.advance();
      return { type: "closeParen" };
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
      // Check for double semicolon (case terminator)
      if (this.peek() === ";") {
        this.advance();
        return { type: "doubleSemicolon" };
      }
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
      if (this.peek() === "<") {
        this.advance();
        return this.readHeredoc();
      }
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

    // Arithmetic expansion $((...)) or command substitution $(...)
    if (this.peek() === "(") {
      this.advance(); // consume first (
      // Check for arithmetic expansion $((...))
      if (this.peek() === "(") {
        this.advance(); // consume second (
        const expression = this.readUntilDoubleCloseParen();
        return { type: "arithmetic", expression };
      }
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

  private readUntilDoubleCloseParen(): string {
    let depth = 1;
    let result = "";

    while (!this.isAtEnd() && depth > 0) {
      const char = this.peek();
      if (char === "(" && this.peekAhead(1) === "(") {
        depth++;
        result += this.advance();
        result += this.advance();
      } else if (char === ")" && this.peekAhead(1) === ")") {
        depth--;
        if (depth === 0) {
          this.advance(); // consume first )
          this.advance(); // consume second )
          break;
        }
        result += this.advance();
        result += this.advance();
      } else {
        result += this.advance();
      }
    }

    return result;
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

    // Check if this looks like an assignment with value starting with $ or quote
    // e.g., VAR=$(...) or VAR="..." or VAR='...'
    const assignmentPrefixMatch = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=$/);
    if (assignmentPrefixMatch && (this.peek() === "$" || this.peek() === "'" || this.peek() === '"')) {
      const name = assignmentPrefixMatch[1]!;
      // Read the value part
      const valueTokens = this.readAssignmentValueTokens();
      return {
        type: "assignment",
        name,
        value: valueTokens.length === 1 && valueTokens[0]!.type === "word"
          ? (valueTokens[0] as { type: "word"; value: string }).value
          : valueTokens,
      };
    }

    // Check if this is an assignment (VAR=value)
    const assignmentMatch = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (assignmentMatch) {
      const name = assignmentMatch[1]!;
      const rawValue = assignmentMatch[2]!;

      // Parse the value to handle variables and arithmetic
      const parsedValue = this.parseAssignmentValue(rawValue);
      return {
        type: "assignment",
        name,
        value: parsedValue,
      };
    }

    // Check if this is a keyword
    if (KEYWORDS.has(value)) {
      return { type: "keyword", value: value as KeywordValue };
    }

    if (hasGlobChars) {
      return { type: "glob", pattern: value };
    }

    return { type: "word", value };
  }

  private readAssignmentValueTokens(): Token[] {
    const tokens: Token[] = [];

    // Read tokens until we hit a space, newline, semicolon, etc.
    while (!this.isAtEnd()) {
      const char = this.peek();

      // Stop at whitespace or command terminators
      if (char === " " || char === "\t" || char === "\n" || char === "\r" ||
          char === ";" || char === "|" || char === "&" || char === ">" || char === "<") {
        break;
      }

      if (char === "$") {
        tokens.push(this.readVariable());
      } else if (char === "'") {
        tokens.push(this.readSingleQuote());
      } else if (char === '"') {
        tokens.push(this.readDoubleQuote());
      } else {
        // Read until word break
        let word = "";
        while (!this.isAtEnd() && !this.isWordBreak(this.peek())) {
          word += this.advance();
        }
        if (word) {
          tokens.push({ type: "word", value: word });
        } else {
          break;
        }
      }
    }

    return tokens;
  }

  private parseAssignmentValue(value: string): string | Token[] {
    // If value contains no special characters, return as string
    if (!value.includes("$")) {
      return value;
    }

    // Parse the value to handle $VAR, ${VAR}, $((expr))
    const tokens: Token[] = [];
    let i = 0;
    let currentString = "";

    while (i < value.length) {
      if (value[i] === "$") {
        if (currentString) {
          tokens.push({ type: "word", value: currentString });
          currentString = "";
        }

        i++; // consume $
        if (i >= value.length) {
          tokens.push({ type: "word", value: "$" });
          break;
        }

        // Arithmetic expansion $((expr))
        if (value[i] === "(" && value[i + 1] === "(") {
          i += 2; // consume ((
          let depth = 1;
          let expr = "";
          while (i < value.length && depth > 0) {
            if (value[i] === "(" && value[i + 1] === "(") {
              depth++;
              expr += value[i]! + value[i + 1]!;
              i += 2;
            } else if (value[i] === ")" && value[i + 1] === ")") {
              depth--;
              if (depth > 0) {
                expr += value[i]! + value[i + 1]!;
                i += 2;
              } else {
                i += 2; // consume ))
              }
            } else {
              expr += value[i];
              i++;
            }
          }
          tokens.push({ type: "arithmetic", expression: expr });
        }
        // ${VAR} syntax
        else if (value[i] === "{") {
          i++; // consume {
          let varName = "";
          while (i < value.length && value[i] !== "}") {
            varName += value[i];
            i++;
          }
          if (i < value.length && value[i] === "}") {
            i++; // consume }
          }
          tokens.push({ type: "variable", name: varName });
        }
        // $VAR syntax
        else if (/[a-zA-Z_]/.test(value[i]!)) {
          let varName = "";
          while (i < value.length && /[a-zA-Z0-9_]/.test(value[i]!)) {
            varName += value[i];
            i++;
          }
          tokens.push({ type: "variable", name: varName });
        }
        // $(cmd) command substitution
        else if (value[i] === "(") {
          i++; // consume (
          let depth = 1;
          let cmd = "";
          while (i < value.length && depth > 0) {
            if (value[i] === "(") depth++;
            else if (value[i] === ")") depth--;
            if (depth > 0) {
              cmd += value[i];
            }
            i++;
          }
          tokens.push({ type: "substitution", command: cmd });
        }
        else {
          // Not a variable, just a $
          currentString += "$";
        }
      } else {
        currentString += value[i];
        i++;
      }
    }

    if (currentString) {
      tokens.push({ type: "word", value: currentString });
    }

    if (tokens.length === 1 && tokens[0]!.type === "word") {
      return (tokens[0] as { type: "word"; value: string }).value;
    }

    return tokens.length > 0 ? tokens : value;
  }

  private readHeredoc(): Token {
    // Check for tab-stripping variant (<<-)
    const stripTabs = this.peek() === "-";
    if (stripTabs) {
      this.advance();
    }

    // Skip whitespace before delimiter
    while (this.peek() === " " || this.peek() === "\t") {
      this.advance();
    }

    // Read delimiter and determine if expansion is enabled
    const { delimiter, expand } = this.readHeredocDelimiter();

    // Tokenize the rest of the current line and queue those tokens
    this.tokenizeRestOfLine();

    // Skip the newline that starts the heredoc content
    if (this.peek() === "\n") {
      this.advance();
    }

    // Read content until closing delimiter
    let content = "";
    while (!this.isAtEnd()) {
      const lineStart = this.pos;
      let line = "";

      // Read until end of line or end of input
      while (!this.isAtEnd() && this.peek() !== "\n") {
        line += this.advance();
      }

      // Check if this line is the delimiter (after stripping leading tabs if <<-)
      const strippedLine = stripTabs ? line.replace(/^\t+/, "") : line;
      if (strippedLine === delimiter) {
        // Found closing delimiter, consume newline if present
        if (this.peek() === "\n") {
          this.advance();
        }
        break;
      }

      // Add the line to content
      if (stripTabs) {
        content += line.replace(/^\t+/, "");
      } else {
        content += line;
      }

      // Add newline if present
      if (this.peek() === "\n") {
        content += this.advance();
      }
    }

    return { type: "heredoc", content, expand };
  }

  private readHeredocDelimiter(): { delimiter: string; expand: boolean } {
    const quoteChar = this.peek();

    // Quoted delimiter - no expansion
    if (quoteChar === "'" || quoteChar === '"') {
      this.advance(); // consume opening quote
      let delimiter = "";
      while (!this.isAtEnd() && this.peek() !== quoteChar && this.peek() !== "\n") {
        delimiter += this.advance();
      }
      if (this.peek() === quoteChar) {
        this.advance(); // consume closing quote
      }
      return { delimiter, expand: false };
    }

    // Unquoted delimiter - expansion enabled
    let delimiter = "";
    while (!this.isAtEnd() && !this.isWordBreak(this.peek()) && this.peek() !== "\n") {
      if (this.peek() === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          delimiter += this.advance();
        }
      } else {
        delimiter += this.advance();
      }
    }

    return { delimiter, expand: true };
  }

  private tokenizeRestOfLine(): void {
    // Tokenize the rest of the line (until newline or end)
    while (!this.isAtEnd() && this.peek() !== "\n") {
      // Skip only spaces and tabs, not newlines
      while (this.peek() === " " || this.peek() === "\t") {
        this.advance();
      }
      if (this.isAtEnd() || this.peek() === "\n") break;

      const token = this.readRestOfLineToken();
      if (token) {
        this.tokenQueue.push(token);
      }
    }
  }

  private readRestOfLineToken(): Token | null {
    const char = this.peek();

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
      return { type: "word", value: "&" };
    }

    if (char === ";") {
      this.advance();
      return { type: "semicolon" };
    }

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

    if (char === "$") {
      return this.readVariable();
    }

    if (char === "'") {
      return this.readSingleQuote();
    }

    if (char === '"') {
      return this.readDoubleQuote();
    }

    // Read a word but stop at newline
    let value = "";
    while (!this.isAtEnd() && !this.isWordBreak(this.peek()) && this.peek() !== "\n") {
      if (this.peek() === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          value += this.advance();
        }
      } else {
        value += this.advance();
      }
    }

    if (value === "") return null;
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

  private skipWhitespaceExceptNewlines(): void {
    while (!this.isAtEnd() && /[ \t\r]/.test(this.peek())) {
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

export function lex(source: string, options?: { preserveNewlines?: boolean }): Token[] {
  return new Lexer(source, options).tokenize();
}
