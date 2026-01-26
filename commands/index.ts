import type { Command } from "../src/types.ts";

export { echo } from "./echo.ts";
export { cat } from "./cat.ts";
export { grep } from "./grep.ts";
export { wc } from "./wc.ts";
export { head } from "./head.ts";
export { tail } from "./tail.ts";
export { sort } from "./sort.ts";
export { uniq } from "./uniq.ts";
export { pwd } from "./pwd.ts";
export { ls } from "./ls.ts";
export { mkdir } from "./mkdir.ts";
export { rm } from "./rm.ts";
export { test, bracket } from "./test.ts";
export { trueCmd, falseCmd } from "./true-false.ts";
export { touch } from "./touch.ts";
export { cp } from "./cp.ts";
export { mv } from "./mv.ts";
export { tee } from "./tee.ts";
export { tree } from "./tree.ts";
export { find } from "./find.ts";
export { sed } from "./sed.ts";
export { awk } from "./awk.ts";
export { breakCmd, continueCmd } from "./break-continue.ts";

// Re-export all commands as a bundle
import { echo } from "./echo.ts";
import { cat } from "./cat.ts";
import { grep } from "./grep.ts";
import { wc } from "./wc.ts";
import { head } from "./head.ts";
import { tail } from "./tail.ts";
import { sort } from "./sort.ts";
import { uniq } from "./uniq.ts";
import { pwd } from "./pwd.ts";
import { ls } from "./ls.ts";
import { mkdir } from "./mkdir.ts";
import { rm } from "./rm.ts";
import { test, bracket } from "./test.ts";
import { trueCmd, falseCmd } from "./true-false.ts";
import { touch } from "./touch.ts";
import { cp } from "./cp.ts";
import { mv } from "./mv.ts";
import { tee } from "./tee.ts";
import { tree } from "./tree.ts";
import { find } from "./find.ts";
import { sed } from "./sed.ts";
import { awk } from "./awk.ts";
import { breakCmd, continueCmd } from "./break-continue.ts";

export const builtinCommands: Record<string, Command> = {
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
  "[": bracket,
  true: trueCmd,
  false: falseCmd,
  touch,
  cp,
  mv,
  tee,
  tree,
  find,
  sed,
  awk,
  break: breakCmd,
  continue: continueCmd,
};
