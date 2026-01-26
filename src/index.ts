// Main class exports
export { ShellDSL, createShellDSL, type Program } from "./shell-dsl.ts";
export { ShellPromise, type ShellPromiseOptions } from "./shell-promise.ts";

// Types
export type {
  VirtualFS,
  FileStat,
  Command,
  CommandContext,
  Stdin,
  Stdout,
  Stderr,
  OutputCollector,
  ExecResult,
  ShellConfig,
  RawValue,
} from "./types.ts";
export { isRawValue } from "./types.ts";

// Errors
export { ShellError, LexError, ParseError } from "./errors.ts";

// Lexer
export { Lexer, lex, tokenToString } from "./lexer/index.ts";
export type { Token, RedirectMode } from "./lexer/index.ts";

// Parser
export { Parser, parse } from "./parser/index.ts";
export type {
  ASTNode,
  Redirect,
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
} from "./parser/index.ts";
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
} from "./parser/index.ts";

// Interpreter
export { Interpreter, type InterpreterOptions } from "./interpreter/index.ts";

// Filesystem
export { createVirtualFS } from "./fs/index.ts";
export {
  FileSystem,
  ReadOnlyFileSystem,
  type Permission,
  type PermissionRules,
  type UnderlyingFS,
} from "./fs/index.ts";

// I/O
export { createStdin, StdinImpl } from "./io/index.ts";
export { createStdout, createStderr, createPipe, OutputCollectorImpl, PipeBuffer } from "./io/index.ts";

// Utilities
export { escape, escapeForInterpolation } from "./utils/index.ts";
