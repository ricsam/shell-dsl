// Re-export everything from src
export * from "./src/index.ts";

// Re-export built-in commands
export { builtinCommands } from "./src/commands/index.ts";
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
  touch,
  cp,
  mv,
  tee,
  tree,
  find,
  sed,
  awk,
  breakCmd,
  continueCmd,
} from "./src/commands/index.ts";
