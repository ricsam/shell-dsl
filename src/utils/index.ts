export { escape, escapeForInterpolation } from "./escape.ts";
export { expandEscapes } from "./expand-escapes.ts";
export { globVirtualFS, type GlobVirtualFS, type GlobOptions } from "./glob.ts";
export {
  createFlagParser,
  type FlagDefinition,
  type CommandSpec,
  type FlagError,
  type ParseResult,
  type FlagParser,
} from "./flag-parser.ts";
export { matchGlob } from "./match-glob.ts";
