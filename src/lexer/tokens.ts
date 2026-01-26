export type RedirectMode =
  | ">"
  | ">>"
  | "<"
  | "2>"
  | "2>>"
  | "&>"
  | "&>>"
  | "2>&1"
  | "1>&2";

export type KeywordValue =
  | "if"
  | "then"
  | "elif"
  | "else"
  | "fi"
  | "for"
  | "in"
  | "do"
  | "done"
  | "while"
  | "until"
  | "case"
  | "esac";

export const KEYWORDS = new Set<string>([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "in",
  "do",
  "done",
  "while",
  "until",
  "case",
  "esac",
]);

export type Token =
  | { type: "word"; value: string }
  | { type: "keyword"; value: KeywordValue }
  | { type: "pipe" }
  | { type: "and" }
  | { type: "or" }
  | { type: "semicolon" }
  | { type: "newline" }
  | { type: "redirect"; mode: RedirectMode }
  | { type: "variable"; name: string }
  | { type: "substitution"; command: string }
  | { type: "arithmetic"; expression: string }
  | { type: "glob"; pattern: string }
  | { type: "singleQuote"; value: string }
  | { type: "doubleQuote"; parts: Array<string | Token> }
  | { type: "assignment"; name: string; value: string | Token[] }
  | { type: "heredoc"; content: string; expand: boolean }
  | { type: "openParen" }
  | { type: "closeParen" }
  | { type: "doubleSemicolon" }
  | { type: "eof" };

export function tokenToString(token: Token): string {
  switch (token.type) {
    case "word":
      return token.value;
    case "keyword":
      return token.value;
    case "pipe":
      return "|";
    case "and":
      return "&&";
    case "or":
      return "||";
    case "semicolon":
      return ";";
    case "newline":
      return "\n";
    case "redirect":
      return token.mode;
    case "variable":
      return `$${token.name}`;
    case "substitution":
      return `$(${token.command})`;
    case "arithmetic":
      return `$((${token.expression}))`;
    case "glob":
      return token.pattern;
    case "singleQuote":
      return `'${token.value}'`;
    case "doubleQuote":
      return `"${token.parts.map((p) => (typeof p === "string" ? p : tokenToString(p))).join("")}"`;
    case "assignment":
      return `${token.name}=${typeof token.value === "string" ? token.value : token.value.map(tokenToString).join("")}`;
    case "heredoc":
      return `<<${token.expand ? "EOF" : "'EOF'"}\n${token.content}\nEOF`;
    case "openParen":
      return "(";
    case "closeParen":
      return ")";
    case "doubleSemicolon":
      return ";;";
    case "eof":
      return "<EOF>";
  }
}
