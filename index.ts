// Re-export everything from src
export * from "./src/index.ts";

// Re-export built-in commands
export { builtinCommands } from "./commands/index.ts";
export {
  echo,
  cat,
  grep,
  wc,
  head,
  tail,
  sort,
  uniq,
  pwd,
  ls,
  mkdir,
  rm,
  test,
  bracket,
  trueCmd,
  falseCmd,
} from "./commands/index.ts";
