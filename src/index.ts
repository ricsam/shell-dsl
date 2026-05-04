// Main class exports
export { ShellDSL, createShellDSL, type Program } from "./shell-dsl.ts";
export { ShellPromise, type ShellPromiseOptions } from "./shell-promise.ts";
export { ShellSession, createShellSession, type ShellSessionOptions } from "./shell-session.ts";

// Types
export type {
  VirtualFS,
  VirtualFSWritable,
  FileStat,
  Command,
  CommandContext,
  Stdin,
  Stdout,
  Stderr,
  OutputCollector,
  ExecResult,
  ShellConfig,
  ShellCommandApi,
  ShellCommandFallback,
  ExternalCommandContext,
  ShellRunOptions,
  TerminalInfo,
  ShellInputController,
  ShellInputSource,
  ShellExecutionOptions,
  ShellExecution,
  ShellOutputEvent,
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
  WordNode,
  WordPart,
  TextPart,
  VariablePart,
  SubstitutionPart,
  ArithmeticPart,
  IfNode,
  ForNode,
  WhileNode,
  UntilNode,
  CaseNode,
  CaseClause,
} from "./parser/index.ts";
export {
  isWordNode,
  isCommandNode,
  isPipelineNode,
  isAndNode,
  isOrNode,
  isSequenceNode,
  isIfNode,
  isForNode,
  isWhileNode,
  isUntilNode,
  isCaseNode,
} from "./parser/index.ts";

// Interpreter
export { Interpreter, type InterpreterOptions, BreakException, ContinueException, ExitException } from "./interpreter/index.ts";

// Filesystem
export { createVirtualFS } from "./fs/index.ts";
export {
  FileSystem,
  ReadOnlyFileSystem,
  WebFileSystem,
  createWebUnderlyingFS,
  type PathOps,
  type Permission,
  type PermissionRules,
  type UnderlyingFS,
} from "./fs/index.ts";

// I/O
export { createStdin, StdinImpl } from "./io/index.ts";
export {
  createStdout,
  createStderr,
  createPipe,
  createShellInput,
  OutputCollectorImpl,
  PipeBuffer,
  ShellInputControllerImpl,
} from "./io/index.ts";

// Interactive input analysis
export { analyzeInput } from "./input-analysis.ts";
export type { InputAnalysis, InputIncompleteReason } from "./input-analysis.ts";

// Utilities
export { escape, escapeForInterpolation, globVirtualFS } from "./utils/index.ts";
export type { GlobVirtualFS, GlobOptions } from "./utils/index.ts";

// Version Control
export { VersionControlSystem } from "./vcs/index.ts";
export type {
  VCSConfig,
  VCSAttributeRule,
  VCSResolvedAttributes,
  VCSDiffMode,
  VCSPatchSuppressionReason,
  Revision,
  DiffEntry,
  TreeManifest,
  TreeEntry,
  FileEntry,
  DirectoryEntry,
  VCSIndexEntry,
  VCSIndexFile,
  CommitOptions,
  CheckoutOptions,
  LogOptions,
  LogEntry,
  BranchInfo,
} from "./vcs/index.ts";
