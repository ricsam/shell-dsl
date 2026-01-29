import type { Command } from "../../types.ts";

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
  | { type: "true" };

function evalExpr(expr: FindExpr, basename: string, isFile: boolean, isDir: boolean): boolean {
  switch (expr.type) {
    case "true":
      return true;
    case "name":
      return matchGlob(expr.pattern, basename, expr.ignoreCase);
    case "ftype":
      return expr.value === "f" ? isFile : isDir;
    case "and":
      return evalExpr(expr.left, basename, isFile, isDir) && evalExpr(expr.right, basename, isFile, isDir);
    case "or":
      return evalExpr(expr.left, basename, isFile, isDir) || evalExpr(expr.right, basename, isFile, isDir);
    case "not":
      return !evalExpr(expr.expr, basename, isFile, isDir);
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
      const matches = evalExpr(expr, basename, isFile, isDir);

      // Output if matches and above mindepth
      if (matches && (minDepth === undefined || depth >= minDepth)) {
        await ctx.stdout.writeText(displayPath + "\n");
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
      const matches = evalExpr(expr, basename, true, false);

      if (maxDepth !== undefined && maxDepth < 0) {
        // skip
      } else if (matches && (minDepth === undefined || minDepth <= 0)) {
        await ctx.stdout.writeText(normalizedPath + "\n");
      }
    } else {
      await traverse(resolvedStart, normalizedPath, 0);
    }
  }

  return hasError ? 1 : 0;
};
