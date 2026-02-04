import type { Command } from "../types.ts";

export { echo } from "./echo/echo.ts";
export { cat } from "./cat/cat.ts";
export { grep } from "./grep/grep.ts";
export { wc } from "./wc/wc.ts";
export { head } from "./head/head.ts";
export { tail } from "./tail/tail.ts";
export { sort } from "./sort/sort.ts";
export { uniq } from "./uniq/uniq.ts";
export { pwd } from "./pwd/pwd.ts";
export { ls } from "./ls/ls.ts";
export { mkdir } from "./mkdir/mkdir.ts";
export { rm } from "./rm/rm.ts";
export { test, bracket } from "./test/test.ts";
export { trueCmd, falseCmd } from "./true-false/true-false.ts";
export { touch } from "./touch/touch.ts";
export { cp } from "./cp/cp.ts";
export { mv } from "./mv/mv.ts";
export { tee } from "./tee/tee.ts";
export { tree } from "./tree/tree.ts";
export { find } from "./find/find.ts";
export { sed } from "./sed/sed.ts";
export { awk } from "./awk/awk.ts";
export { breakCmd, continueCmd } from "./break-continue/break-continue.ts";
export { colon } from "./colon/colon.ts";
export { cd } from "./cd/cd.ts";
export { tr } from "./tr/tr.ts";
export { cut } from "./cut/cut.ts";

// Re-export all commands as a bundle
import { echo } from "./echo/echo.ts";
import { cat } from "./cat/cat.ts";
import { grep } from "./grep/grep.ts";
import { wc } from "./wc/wc.ts";
import { head } from "./head/head.ts";
import { tail } from "./tail/tail.ts";
import { sort } from "./sort/sort.ts";
import { uniq } from "./uniq/uniq.ts";
import { pwd } from "./pwd/pwd.ts";
import { ls } from "./ls/ls.ts";
import { mkdir } from "./mkdir/mkdir.ts";
import { rm } from "./rm/rm.ts";
import { test, bracket } from "./test/test.ts";
import { trueCmd, falseCmd } from "./true-false/true-false.ts";
import { touch } from "./touch/touch.ts";
import { cp } from "./cp/cp.ts";
import { mv } from "./mv/mv.ts";
import { tee } from "./tee/tee.ts";
import { tree } from "./tree/tree.ts";
import { find } from "./find/find.ts";
import { sed } from "./sed/sed.ts";
import { awk } from "./awk/awk.ts";
import { breakCmd, continueCmd } from "./break-continue/break-continue.ts";
import { colon } from "./colon/colon.ts";
import { cd } from "./cd/cd.ts";
import { tr } from "./tr/tr.ts";
import { cut } from "./cut/cut.ts";

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
  ":": colon,
  cd,
  tr,
  cut,
};
