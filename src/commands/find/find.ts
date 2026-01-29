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

interface FindOptions {
  namePattern?: string;
  nameIgnoreCase?: boolean;
  type?: "f" | "d";
  maxDepth?: number;
  minDepth?: number;
}

export const find: Command = async (ctx) => {
  const args = [...ctx.args];
  const paths: string[] = [];
  const options: FindOptions = {};

  // Parse arguments: paths come before first flag, then expressions
  let i = 0;

  // Collect paths (args before first -)
  while (i < args.length && !args[i]!.startsWith("-")) {
    paths.push(args[i]!);
    i++;
  }

  // Default to current directory if no paths
  if (paths.length === 0) {
    paths.push(".");
  }

  // Parse expression flags
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "-name") {
      i++;
      if (i >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-name'\n");
        return 1;
      }
      options.namePattern = args[i]!;
      options.nameIgnoreCase = false;
    } else if (arg === "-iname") {
      i++;
      if (i >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-iname'\n");
        return 1;
      }
      options.namePattern = args[i]!;
      options.nameIgnoreCase = true;
    } else if (arg === "-type") {
      i++;
      if (i >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-type'\n");
        return 1;
      }
      const typeArg = args[i]!;
      if (typeArg !== "f" && typeArg !== "d") {
        await ctx.stderr.writeText(`find: Unknown argument to -type: ${typeArg}\n`);
        return 1;
      }
      options.type = typeArg;
    } else if (arg === "-maxdepth") {
      i++;
      if (i >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-maxdepth'\n");
        return 1;
      }
      const depth = parseInt(args[i]!, 10);
      if (isNaN(depth) || depth < 0) {
        await ctx.stderr.writeText(`find: Invalid argument '${args[i]}' to -maxdepth\n`);
        return 1;
      }
      options.maxDepth = depth;
    } else if (arg === "-mindepth") {
      i++;
      if (i >= args.length) {
        await ctx.stderr.writeText("find: missing argument to '-mindepth'\n");
        return 1;
      }
      const depth = parseInt(args[i]!, 10);
      if (isNaN(depth) || depth < 0) {
        await ctx.stderr.writeText(`find: Invalid argument '${args[i]}' to -mindepth\n`);
        return 1;
      }
      options.minDepth = depth;
    } else if (arg.startsWith("-")) {
      await ctx.stderr.writeText(`find: unknown predicate '${arg}'\n`);
      return 1;
    } else {
      // This shouldn't happen since paths are parsed first, but treat as path
      paths.push(arg);
    }

    i++;
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
      if (options.maxDepth !== undefined && depth > options.maxDepth) {
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

      // Check if this entry matches filters
      let matches = true;

      // Type filter
      if (options.type === "f" && !isFile) {
        matches = false;
      } else if (options.type === "d" && !isDir) {
        matches = false;
      }

      // Name filter (only check basename)
      if (matches && options.namePattern !== undefined) {
        if (!matchGlob(options.namePattern, basename, options.nameIgnoreCase)) {
          matches = false;
        }
      }

      // Output if matches and above mindepth
      if (matches && (options.minDepth === undefined || depth >= options.minDepth)) {
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
    // For a single file, it's at depth 0
    // For a directory, the directory itself is depth 0, contents are depth 1+
    if (stat.isFile()) {
      // Starting from a file - depth 0
      let matches = true;

      if (options.type === "d") {
        matches = false;
      }

      if (matches && options.namePattern !== undefined) {
        const basename = ctx.fs.basename(resolvedStart);
        if (!matchGlob(options.namePattern, basename, options.nameIgnoreCase)) {
          matches = false;
        }
      }

      if (options.maxDepth !== undefined && options.maxDepth < 0) {
        matches = false;
      }

      if (matches && (options.minDepth === undefined || options.minDepth <= 0)) {
        await ctx.stdout.writeText(normalizedPath + "\n");
      }
    } else {
      await traverse(resolvedStart, normalizedPath, 0);
    }
  }

  return hasError ? 1 : 0;
};
