import type { Command, CommandContext, ExecResult } from "../../types.ts";

/**
 * Simple glob pattern matching (fnmatch-style)
 * Supports: * (any chars), ? (single char), [...] (character class)
 */
function matchGlob(pattern: string, str: string, caseInsensitive = false): boolean {
  if (caseInsensitive) {
    pattern = pattern.toLowerCase();
    str = str.toLowerCase();
  }

  // Convert glob to regex
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    switch (c) {
      case "*":
        regex += ".*";
        break;
      case "?":
        regex += ".";
        break;
      case "[": {
        // Find closing bracket
        let j = i + 1;
        // Handle negation
        if (pattern[j] === "!" || pattern[j] === "^") j++;
        // Handle ] as first char in class
        if (pattern[j] === "]") j++;
        while (j < pattern.length && pattern[j] !== "]") j++;
        if (j >= pattern.length) {
          // No closing bracket, treat [ as literal
          regex += "\\[";
        } else {
          let charClass = pattern.slice(i, j + 1);
          // Convert ! to ^ for negation in regex
          charClass = charClass.replace(/^\[!/, "[^");
          regex += charClass;
          i = j;
        }
        break;
      }
      case ".":
      case "^":
      case "$":
      case "+":
      case "{":
      case "}":
      case "(":
      case ")":
      case "|":
      case "\\":
        regex += "\\" + c;
        break;
      default:
        regex += c;
    }
  }
  regex += "$";

  try {
    return new RegExp(regex).test(str);
  } catch {
    return false;
  }
}

// Expression tree types
type FindExpr =
  | { type: "name"; pattern: string; ignoreCase: boolean }
  | { type: "ftype"; value: "f" | "d" }
  | { type: "and"; left: FindExpr; right: FindExpr }
  | { type: "or"; left: FindExpr; right: FindExpr }
  | { type: "not"; expr: FindExpr }
  | { type: "true" }
  | { type: "exec"; cmdName: string; cmdArgs: string[]; batchMode: boolean };

async function evalExpr(
  expr: FindExpr,
  basename: string,
  isFile: boolean,
  isDir: boolean,
  entryPath: string,
  ctx: CommandContext,
): Promise<boolean> {
  switch (expr.type) {
    case "true":
      return true;
    case "name":
      return matchGlob(expr.pattern, basename, expr.ignoreCase);
    case "ftype":
      return expr.value === "f" ? isFile : isDir;
    case "and": {
      const leftResult = await evalExpr(expr.left, basename, isFile, isDir, entryPath, ctx);
      if (!leftResult) return false;
      return evalExpr(expr.right, basename, isFile, isDir, entryPath, ctx);
    }
    case "or": {
      const leftResult = await evalExpr(expr.left, basename, isFile, isDir, entryPath, ctx);
      if (leftResult) return true;
      return evalExpr(expr.right, basename, isFile, isDir, entryPath, ctx);
    }
    case "not":
      return !(await evalExpr(expr.expr, basename, isFile, isDir, entryPath, ctx));
    case "exec": {
      if (expr.batchMode) {
        // In batch mode, always return true during traversal; paths are collected externally
        return true;
      }
      // Per-file mode: execute command with {} replaced by entryPath
      if (!ctx.exec) {
        await ctx.stderr.writeText("find: -exec not supported (no exec capability)\n");
        return false;
      }
      const resolvedArgs = expr.cmdArgs.map(a => a === "{}" ? entryPath : a);
      const result: ExecResult = await ctx.exec(expr.cmdName, resolvedArgs);
      // Pass stdout/stderr through to find's streams
      if (result.stdout.length > 0) {
        await ctx.stdout.write(result.stdout);
      }
      if (result.stderr.length > 0) {
        await ctx.stderr.write(result.stderr);
      }
      return result.exitCode === 0;
    }
  }
}

/** Check if expression tree contains any -exec node */
function hasActionExpr(expr: FindExpr): boolean {
  switch (expr.type) {
    case "exec":
      return true;
    case "and":
    case "or":
      return hasActionExpr(expr.left) || hasActionExpr(expr.right);
    case "not":
      return hasActionExpr(expr.expr);
    default:
      return false;
  }
}

/** Collect all batch-mode -exec nodes from the expression tree */
function collectBatchExecNodes(expr: FindExpr): Array<{ type: "exec"; cmdName: string; cmdArgs: string[]; batchMode: boolean }> {
  switch (expr.type) {
    case "exec":
      return expr.batchMode ? [expr] : [];
    case "and":
    case "or":
      return [...collectBatchExecNodes(expr.left), ...collectBatchExecNodes(expr.right)];
    case "not":
      return collectBatchExecNodes(expr.expr);
    default:
      return [];
  }
}

class ParseError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

function parseExprArgs(args: string[]): FindExpr {
  if (args.length === 0) return { type: "true" };

  let pos = 0;

  function peek(): string | undefined {
    return args[pos];
  }

  function advance(): string {
    return args[pos++]!;
  }

  function parseOr(): FindExpr {
    let left = parseAnd();
    while (peek() === "-o") {
      advance();
      const right = parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  function parseAnd(): FindExpr {
    let left = parseUnary();
    while (pos < args.length) {
      const next = peek();
      if (next === "-o" || next === ")" || next === undefined) break;
      if (next === "-a") {
        advance();
      }
      const right = parseUnary();
      left = { type: "and", left, right };
    }
    return left;
  }

  function parseUnary(): FindExpr {
    const next = peek();
    if (next === "!" || next === "-not") {
      advance();
      const expr = parseUnary();
      return { type: "not", expr };
    }
    return parsePrimary();
  }

  function parsePrimary(): FindExpr {
    const tok = peek();
    if (tok === undefined) {
      throw new ParseError("find: expected expression");
    }

    if (tok === "(") {
      advance();
      const expr = parseOr();
      if (peek() !== ")") {
        throw new ParseError("find: missing closing ')'");
      }
      advance();
      return expr;
    }

    if (tok === "-name" || tok === "-iname") {
      advance();
      const pattern = peek();
      if (pattern === undefined) {
        throw new ParseError(`find: missing argument to '${tok}'`);
      }
      advance();
      return { type: "name", pattern, ignoreCase: tok === "-iname" };
    }

    if (tok === "-type") {
      advance();
      const val = peek();
      if (val === undefined) {
        throw new ParseError("find: missing argument to '-type'");
      }
      if (val !== "f" && val !== "d") {
        throw new ParseError(`find: Unknown argument to -type: ${val}`);
      }
      advance();
      return { type: "ftype", value: val };
    }

    if (tok === "-exec") {
      advance();
      const cmdName = peek();
      if (cmdName === undefined || cmdName === ";" || cmdName === "+") {
        throw new ParseError("find: -exec: missing command");
      }
      advance();

      const cmdArgs: string[] = [];
      let batchMode = false;
      let foundTerminator = false;

      while (pos < args.length) {
        const a = args[pos]!;
        if (a === ";") {
          advance();
          foundTerminator = true;
          break;
        }
        if (a === "+") {
          advance();
          batchMode = true;
          foundTerminator = true;
          break;
        }
        cmdArgs.push(a);
        advance();
      }

      if (!foundTerminator) {
        throw new ParseError("find: -exec: missing terminator (';' or '+')");
      }

      return { type: "exec", cmdName, cmdArgs, batchMode };
    }

    throw new ParseError(`find: unknown predicate '${tok}'`);
  }

  const expr = parseOr();
  if (pos < args.length) {
    throw new ParseError(`find: unexpected '${args[pos]}'`);
  }
  return expr;
}

export const find: Command = async (ctx) => {
  const args = [...ctx.args];
  const paths: string[] = [];

  // Parse arguments: paths come before first flag/operator
  let i = 0;

  // Collect paths (args before first -, !, or ()
  while (i < args.length && !args[i]!.startsWith("-") && args[i] !== "!" && args[i] !== "(" && args[i] !== ")") {
    paths.push(args[i]!);
    i++;
  }

  // Default to current directory if no paths
  if (paths.length === 0) {
    paths.push(".");
  }

  // Extract global options (-maxdepth, -mindepth) from remaining args
  let maxDepth: number | undefined;
  let minDepth: number | undefined;
  const exprArgs: string[] = [];

  let j = i;
  while (j < args.length) {
    const arg = args[j]!;
    if (arg === "-maxdepth") {
      j++;
      if (j >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-maxdepth'\n");
        return 1;
      }
      const depth = parseInt(args[j]!, 10);
      if (isNaN(depth) || depth < 0) {
        await ctx.stderr.writeText(`find: Invalid argument '${args[j]}' to -maxdepth\n`);
        return 1;
      }
      maxDepth = depth;
    } else if (arg === "-mindepth") {
      j++;
      if (j >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-mindepth'\n");
        return 1;
      }
      const depth = parseInt(args[j]!, 10);
      if (isNaN(depth) || depth < 0) {
        await ctx.stderr.writeText(`find: Invalid argument '${args[j]}' to -mindepth\n`);
        return 1;
      }
      minDepth = depth;
    } else {
      exprArgs.push(arg);
    }
    j++;
  }

  // Parse expression tree
  let expr: FindExpr;
  try {
    expr = parseExprArgs(exprArgs);
  } catch (e) {
    if (e instanceof ParseError) {
      await ctx.stderr.writeText(e.message + "\n");
      return 1;
    }
    throw e;
  }

  const hasAction = hasActionExpr(expr);
  const batchExecNodes = collectBatchExecNodes(expr);
  const batchPaths: string[] = [];

  let hasError = false;

  // Process each starting path
  for (const startPath of paths) {
    const normalizedPath = startPath === "/" ? "/" : startPath.replace(/\/+$/, '');
    const resolvedStart = ctx.fs.resolve(ctx.cwd, startPath);

    // Check if path exists
    let stat;
    try {
      stat = await ctx.fs.stat(resolvedStart);
    } catch {
      await ctx.stderr.writeText(`find: '${startPath}': No such file or directory\n`);
      hasError = true;
      continue;
    }

    // Recursive traversal function
    async function traverse(path: string, displayPath: string, depth: number): Promise<void> {
      // Check maxdepth
      if (maxDepth !== undefined && depth > maxDepth) {
        return;
      }

      let entryStat;
      try {
        entryStat = await ctx.fs.stat(path);
      } catch {
        return;
      }

      const isDir = entryStat.isDirectory();
      const isFile = entryStat.isFile();
      const basename = ctx.fs.basename(path);

      // Check if this entry matches the expression
      const matches = await evalExpr(expr, basename, isFile, isDir, displayPath, ctx);

      if (matches && (minDepth === undefined || depth >= minDepth)) {
        if (batchExecNodes.length > 0) {
          batchPaths.push(displayPath);
        } else if (!hasAction) {
          // No action expressions: default print behavior
          await ctx.stdout.writeText(displayPath + "\n");
        }
        // If has per-file -exec actions, output was already handled in evalExpr
      }

      // Recurse into directories
      if (isDir) {
        try {
          const entries = await ctx.fs.readdir(path);
          entries.sort();
          for (const entry of entries) {
            const childPath = ctx.fs.resolve(path, entry);
            const childDisplayPath = displayPath === "." ? entry : `${displayPath}/${entry}`;
            await traverse(childPath, childDisplayPath, depth + 1);
          }
        } catch {
          // Ignore errors reading directory contents
        }
      }
    }

    // Start traversal
    if (stat.isFile()) {
      const basename = ctx.fs.basename(resolvedStart);
      const matches = await evalExpr(expr, basename, true, false, normalizedPath, ctx);

      if (maxDepth !== undefined && maxDepth < 0) {
        // skip
      } else if (matches && (minDepth === undefined || minDepth <= 0)) {
        if (batchExecNodes.length > 0) {
          batchPaths.push(normalizedPath);
        } else if (!hasAction) {
          await ctx.stdout.writeText(normalizedPath + "\n");
        }
      }
    } else {
      await traverse(resolvedStart, normalizedPath, 0);
    }
  }

  // Execute batch -exec nodes with all collected paths
  if (batchExecNodes.length > 0 && batchPaths.length > 0 && ctx.exec) {
    for (const node of batchExecNodes) {
      // Replace {} in cmdArgs with all paths
      const resolvedArgs: string[] = [];
      for (const a of node.cmdArgs) {
        if (a === "{}") {
          resolvedArgs.push(...batchPaths);
        } else {
          resolvedArgs.push(a);
        }
      }
      const result = await ctx.exec(node.cmdName, resolvedArgs);
      if (result.stdout.length > 0) {
        await ctx.stdout.write(result.stdout);
      }
      if (result.stderr.length > 0) {
        await ctx.stderr.write(result.stderr);
      }
    }
  }

  return hasError ? 1 : 0;
};
