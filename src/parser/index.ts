export { Parser, parse } from "./parser.ts";
export type {
  ASTNode,
  Redirect,
  RedirectMode,
  CommandNode,
  PipelineNode,
  AndNode,
  OrNode,
  SequenceNode,
  LiteralNode,
  VariableNode,
  SubstitutionNode,
  GlobNode,
  ConcatNode,
} from "./ast.ts";
export {
  isCommandNode,
  isPipelineNode,
  isAndNode,
  isOrNode,
  isSequenceNode,
  isLiteralNode,
  isVariableNode,
  isSubstitutionNode,
  isGlobNode,
  isConcatNode,
} from "./ast.ts";
