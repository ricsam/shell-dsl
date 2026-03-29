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

export interface TextPart {
  type: "text";
  value: string;
  quoted: boolean;
}

export interface VariablePart {
  type: "variable";
  name: string;
  quoted: boolean;
}

export interface SubstitutionPart {
  type: "substitution";
  command: ASTNode;
  quoted: boolean;
}

export interface ArithmeticPart {
  type: "arithmetic";
  expression: string;
  quoted: boolean;
}

export type WordPart = TextPart | VariablePart | SubstitutionPart | ArithmeticPart;

export interface WordNode {
  type: "word";
  parts: WordPart[];
}

export interface Redirect {
  mode: RedirectMode;
  target: WordNode;
  heredocContent?: boolean;
}

export type ASTNode =
  | CommandNode
  | PipelineNode
  | AndNode
  | OrNode
  | SequenceNode
  | IfNode
  | ForNode
  | WhileNode
  | UntilNode
  | CaseNode;

export interface CommandNode {
  type: "command";
  name: WordNode;
  args: WordNode[];
  redirects: Redirect[];
  assignments: Array<{ name: string; value: WordNode }>;
}

export interface PipelineNode {
  type: "pipeline";
  commands: ASTNode[];
}

export interface AndNode {
  type: "and";
  left: ASTNode;
  right: ASTNode;
}

export interface OrNode {
  type: "or";
  left: ASTNode;
  right: ASTNode;
}

export interface SequenceNode {
  type: "sequence";
  commands: ASTNode[];
}

export interface IfNode {
  type: "if";
  condition: ASTNode;
  thenBranch: ASTNode;
  elifBranches: Array<{ condition: ASTNode; body: ASTNode }>;
  elseBranch?: ASTNode;
}

export interface ForNode {
  type: "for";
  variable: string;
  items: WordNode[];
  body: ASTNode;
}

export interface WhileNode {
  type: "while";
  condition: ASTNode;
  body: ASTNode;
}

export interface UntilNode {
  type: "until";
  condition: ASTNode;
  body: ASTNode;
}

export interface CaseClause {
  patterns: WordNode[];
  body: ASTNode;
}

export interface CaseNode {
  type: "case";
  word: WordNode;
  clauses: CaseClause[];
}

// Type guards
export function isWordNode(node: ASTNode | WordNode): node is WordNode {
  return node.type === "word";
}

export function isCommandNode(node: ASTNode): node is CommandNode {
  return node.type === "command";
}

export function isPipelineNode(node: ASTNode): node is PipelineNode {
  return node.type === "pipeline";
}

export function isAndNode(node: ASTNode): node is AndNode {
  return node.type === "and";
}

export function isOrNode(node: ASTNode): node is OrNode {
  return node.type === "or";
}

export function isSequenceNode(node: ASTNode): node is SequenceNode {
  return node.type === "sequence";
}

export function isIfNode(node: ASTNode): node is IfNode {
  return node.type === "if";
}

export function isForNode(node: ASTNode): node is ForNode {
  return node.type === "for";
}

export function isWhileNode(node: ASTNode): node is WhileNode {
  return node.type === "while";
}

export function isUntilNode(node: ASTNode): node is UntilNode {
  return node.type === "until";
}

export function isCaseNode(node: ASTNode): node is CaseNode {
  return node.type === "case";
}
