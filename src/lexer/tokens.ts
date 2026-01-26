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

export type Token =
  | { type: "word"; value: string }
  | { type: "pipe" }
  | { type: "and" }
  | { type: "or" }
  | { type: "semicolon" }
  | { type: "redirect"; mode: RedirectMode }
  | { type: "variable"; name: string }
  | { type: "substitution"; command: string }
  | { type: "glob"; pattern: string }
  | { type: "singleQuote"; value: string }
  | { type: "doubleQuote"; parts: Array<string | Token> }
  | { type: "assignment"; name: string; value: string | Token[] }
  | { type: "eof" };

export function tokenToString(token: Token): string {
  switch (token.type) {
    case "word":
      return token.value;
    case "pipe":
      return "|";
    case "and":
      return "&&";
    case "or":
      return "||";
    case "semicolon":
      return ";";
    case "redirect":
      return token.mode;
    case "variable":
      return `$${token.name}`;
    case "substitution":
      return `$(${token.command})`;
    case "glob":
      return token.pattern;
    case "singleQuote":
      return `'${token.value}'`;
    case "doubleQuote":
      return `"${token.parts.map((p) => (typeof p === "string" ? p : tokenToString(p))).join("")}"`;
    case "assignment":
      return `${token.name}=${typeof token.value === "string" ? token.value : token.value.map(tokenToString).join("")}`;
    case "eof":
      return "<EOF>";
  }
}
