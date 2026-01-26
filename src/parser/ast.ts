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

export interface Redirect {
  mode: RedirectMode;
  target: ASTNode;
  heredocContent?: boolean;
}

export type ASTNode =
  | CommandNode
  | PipelineNode
  | AndNode
  | OrNode
  | SequenceNode
  | LiteralNode
  | VariableNode
  | SubstitutionNode
  | GlobNode
  | ConcatNode
  | IfNode
  | ForNode
  | WhileNode
  | UntilNode
  | CaseNode
  | ArithmeticNode;

export interface CommandNode {
  type: "command";
  name: ASTNode;
  args: ASTNode[];
  redirects: Redirect[];
  assignments: Array<{ name: string; value: ASTNode }>;
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

export interface LiteralNode {
  type: "literal";
  value: string;
}

export interface VariableNode {
  type: "variable";
  name: string;
}

export interface SubstitutionNode {
  type: "substitution";
  command: ASTNode;
}

export interface GlobNode {
  type: "glob";
  pattern: string;
}

export interface ConcatNode {
  type: "concat";
  parts: ASTNode[];
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
  items: ASTNode[];
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
  patterns: ASTNode[];
  body: ASTNode;
}

export interface CaseNode {
  type: "case";
  word: ASTNode;
  clauses: CaseClause[];
}

export interface ArithmeticNode {
  type: "arithmetic";
  expression: string;
}

// Type guards
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

export function isLiteralNode(node: ASTNode): node is LiteralNode {
  return node.type === "literal";
}

export function isVariableNode(node: ASTNode): node is VariableNode {
  return node.type === "variable";
}

export function isSubstitutionNode(node: ASTNode): node is SubstitutionNode {
  return node.type === "substitution";
}

export function isGlobNode(node: ASTNode): node is GlobNode {
  return node.type === "glob";
}

export function isConcatNode(node: ASTNode): node is ConcatNode {
  return node.type === "concat";
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

export function isArithmeticNode(node: ASTNode): node is ArithmeticNode {
  return node.type === "arithmetic";
}
