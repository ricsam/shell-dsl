import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition, type FlagError } from "../../utils/flag-parser.ts";

interface GrepOptions {
  patterns: string[];
  extendedRegex: boolean;      // -E (default for JS)
  fixedStrings: boolean;       // -F
  ignoreCase: boolean;         // -i
  wholeWord: boolean;          // -w
  wholeLine: boolean;          // -x
  invert: boolean;             // -v
  countOnly: boolean;          // -c
  filesWithMatches: boolean;   // -l
  filesWithoutMatches: boolean; // -L
  showLineNumbers: boolean;    // -n
  onlyMatching: boolean;       // -o
  quiet: boolean;              // -q
  maxMatches: number;          // -m (0 = unlimited)
  showFilename: boolean | null; // null=auto, true=-H, false=-h
  beforeContext: number;       // -B
  afterContext: number;        // -A
  recursive: boolean;          // -r/-R
  include: string[];           // --include
  exclude: string[];           // --exclude
}

const spec = {
  name: "grep",
  flags: [
    { short: "E", long: "extended-regexp" },
    { short: "F", long: "fixed-strings" },
    { short: "i", long: "ignore-case" },
    { short: "w", long: "word-regexp" },
    { short: "x", long: "line-regexp" },
    { short: "v", long: "invert-match" },
    { short: "c", long: "count" },
    { short: "l", long: "files-with-matches" },
    { short: "L", long: "files-without-match" },
    { short: "n", long: "line-number" },
    { short: "o", long: "only-matching" },
    { short: "q", long: "quiet" },
    { short: "H", long: "with-filename" },
    { short: "h", long: "no-filename" },
    { short: "r", long: "recursive" },
    { short: "R" },
    { short: "e", long: "regexp", takesValue: true },
    { short: "m", long: "max-count", takesValue: true },
    { short: "A", long: "after-context", takesValue: true },
    { short: "B", long: "before-context", takesValue: true },
    { short: "C", long: "context", takesValue: true },
    { long: "include", takesValue: true },
    { long: "exclude", takesValue: true },
  ] as FlagDefinition[],
  usage: "grep [-ivnclLqHhEFwxorR] [-e pattern] [-m num] pattern [file ...]",
};

function createDefaults(): GrepOptions {
  return {
    patterns: [],
    extendedRegex: true,  // JS regex is extended by default
    fixedStrings: false,
    ignoreCase: false,
    wholeWord: false,
    wholeLine: false,
    invert: false,
    countOnly: false,
    filesWithMatches: false,
    filesWithoutMatches: false,
    showLineNumbers: false,
    onlyMatching: false,
    quiet: false,
    maxMatches: 0,
    showFilename: null,
    beforeContext: 0,
    afterContext: 0,
    recursive: false,
    include: [],
    exclude: [],
  };
}

const handler = (flags: GrepOptions, flag: FlagDefinition, value?: string) => {
  switch (flag.short) {
    case "E": flags.extendedRegex = true; break;
    case "F": flags.fixedStrings = true; break;
    case "i": flags.ignoreCase = true; break;
    case "w": flags.wholeWord = true; break;
    case "x": flags.wholeLine = true; break;
    case "v": flags.invert = true; break;
    case "c": flags.countOnly = true; break;
    case "l": flags.filesWithMatches = true; break;
    case "L": flags.filesWithoutMatches = true; break;
    case "n": flags.showLineNumbers = true; break;
    case "o": flags.onlyMatching = true; break;
    case "q": flags.quiet = true; break;
    case "H": flags.showFilename = true; break;
    case "h": flags.showFilename = false; break;
    case "r":
    case "R": flags.recursive = true; break;
    case "e": if (value) flags.patterns.push(value); break;
    case "m": if (value) flags.maxMatches = parseInt(value, 10); break;
    case "A": if (value) flags.afterContext = parseInt(value, 10); break;
    case "B": if (value) flags.beforeContext = parseInt(value, 10); break;
    case "C":
      if (value) {
        const num = parseInt(value, 10);
        flags.beforeContext = num;
        flags.afterContext = num;
      }
      break;
    default:
      // Handle long-only flags
      if (flag.long === "include" && value) flags.include.push(value);
      else if (flag.long === "exclude" && value) flags.exclude.push(value);
      break;
  }
};

function matchGlob(str: string, pattern: string): boolean {
  // Convert shell glob to regex: * -> .*, ? -> ., rest escaped
  let re = "^";
  for (const ch of pattern) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (/[.+^${}()|[\]\\]/.test(ch)) re += "\\" + ch;
    else re += ch;
  }
  re += "$";
  return new RegExp(re).test(str);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(options: GrepOptions): RegExp {
  let patterns = options.patterns;

  // If fixed strings mode, escape regex metacharacters
  if (options.fixedStrings) {
    patterns = patterns.map(escapeRegex);
  } else {
    // Support BRE-style \| \( \) even in ERE mode for compatibility
    patterns = patterns.map(p => p.replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")"));
  }

  // Combine multiple patterns with OR
  let combined = patterns.length > 1 ? patterns.map(p => `(?:${p})`).join("|") : patterns[0] || "";

  // Whole word match
  if (options.wholeWord) {
    combined = `\\b(?:${combined})\\b`;
  }

  // Whole line match
  if (options.wholeLine) {
    combined = `^(?:${combined})$`;
  }

  const flags = options.ignoreCase ? "gi" : "g";
  return new RegExp(combined, flags);
}

export const grep: Command = async (ctx) => {
  // Create fresh parser with fresh defaults for each invocation
  const parser = createFlagParser(spec, createDefaults(), handler);
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const options = result.flags;
  const args = result.args;

  // First positional arg is pattern if no -e patterns
  let files: string[];
  if (options.patterns.length === 0) {
    if (args.length === 0) {
      await ctx.stderr.writeText("grep: missing pattern\n");
      return 1;
    }
    options.patterns.push(args[0]!);
    files = args.slice(1);
  } else {
    files = args;
  }

  let regex: RegExp;
  try {
    regex = buildMatcher(options);
  } catch (err) {
    await ctx.stderr.writeText(`grep: invalid pattern: ${options.patterns.join(", ")}\n`);
    return 1;
  }

  let globalFound = false;
  let globalMatchCount = 0;
  let earlyExit = false;

  // Determine filename display mode
  let showFilenames = options.showFilename;

  // Expand files if recursive
  let expandedFiles = files;
  if (options.recursive && files.length > 0) {
    expandedFiles = [];
    for (const file of files) {
      const path = ctx.fs.resolve(ctx.cwd, file);
      try {
        const stat = await ctx.fs.stat(path);
        if (stat.isDirectory()) {
          // Glob all files in directory
          const globbed = await ctx.fs.glob("**/*", { cwd: path });
          for (const f of globbed) {
            const fullPath = ctx.fs.resolve(path, f);
            try {
              const s = await ctx.fs.stat(fullPath);
              if (s.isFile()) {
                expandedFiles.push(fullPath);
              }
            } catch {
              // Skip if can't stat
            }
          }
        } else {
          expandedFiles.push(path);
        }
      } catch {
        expandedFiles.push(path); // Will error later
      }
    }
    // Filter by include/exclude patterns
    if (options.include.length > 0 || options.exclude.length > 0) {
      expandedFiles = expandedFiles.filter((f) => {
        const basename = ctx.fs.basename(f);
        if (options.include.length > 0) {
          const included = options.include.some((pat) => matchGlob(basename, pat));
          if (!included) return false;
        }
        if (options.exclude.length > 0) {
          const excluded = options.exclude.some((pat) => matchGlob(basename, pat));
          if (excluded) return false;
        }
        return true;
      });
    }

    // Default to showing filenames for recursive
    if (showFilenames === null) {
      showFilenames = true;
    }
  }

  // Default: show filenames if multiple files
  if (showFilenames === null) {
    showFilenames = expandedFiles.length > 1;
  }

  const processContent = async (
    lines: string[],
    filename?: string
  ): Promise<{ found: boolean; count: number }> => {
    let fileFound = false;
    let fileMatchCount = 0;

    // For context lines, we need a buffer approach
    const hasContext = options.beforeContext > 0 || options.afterContext > 0;

    if (hasContext) {
      return await processWithContext(lines, filename);
    }

    for (let lineIdx = 0; lineIdx < lines.length && !earlyExit; lineIdx++) {
      const line = lines[lineIdx]!;
      const lineNum = lineIdx + 1;

      // Reset regex lastIndex for each line
      regex.lastIndex = 0;
      const matches = regex.test(line);
      const shouldOutput = options.invert ? !matches : matches;

      if (shouldOutput) {
        fileFound = true;
        fileMatchCount++;

        // Quiet mode: exit immediately on first match
        if (options.quiet) {
          earlyExit = true;
          return { found: true, count: 1 };
        }

        // -l mode: we found a match in this file, stop processing this file
        if (options.filesWithMatches) {
          return { found: true, count: 1 };
        }

        // Output the match (unless countOnly or filesWithoutMatches)
        if (!options.countOnly && !options.filesWithoutMatches) {
          if (options.onlyMatching && !options.invert) {
            // Output only the matched parts
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(line)) !== null) {
              let output = "";
              if (filename && showFilenames) output += filename + ":";
              if (options.showLineNumbers) output += lineNum + ":";
              output += match[0] + "\n";
              await ctx.stdout.writeText(output);
              // Prevent infinite loop for zero-width matches
              if (match[0].length === 0) regex.lastIndex++;
            }
          } else {
            let output = "";
            if (filename && showFilenames) output += filename + ":";
            if (options.showLineNumbers) output += lineNum + ":";
            output += line + "\n";
            await ctx.stdout.writeText(output);
          }
        }

        // Check max matches
        if (options.maxMatches > 0 && fileMatchCount >= options.maxMatches) {
          earlyExit = true;
          return { found: true, count: fileMatchCount };
        }
      }
    }

    return { found: fileFound, count: fileMatchCount };
  };

  const processWithContext = async (
    lines: string[],
    filename?: string
  ): Promise<{ found: boolean; count: number }> => {
    let fileFound = false;
    let fileMatchCount = 0;
    let lastPrintedLine = -1;

    // First pass: find all matching lines
    const matchingLines = new Set<number>();
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      regex.lastIndex = 0;
      const matches = regex.test(line);
      const shouldOutput = options.invert ? !matches : matches;
      if (shouldOutput) {
        matchingLines.add(lineIdx);
      }
    }

    // Determine which lines to print (matches + context)
    const linesToPrint = new Set<number>();
    for (const matchIdx of matchingLines) {
      // Add before context
      for (let i = Math.max(0, matchIdx - options.beforeContext); i < matchIdx; i++) {
        linesToPrint.add(i);
      }
      // Add the match itself
      linesToPrint.add(matchIdx);
      // Add after context
      for (let i = matchIdx + 1; i <= Math.min(lines.length - 1, matchIdx + options.afterContext); i++) {
        linesToPrint.add(i);
      }
    }

    // Sort and print
    const sortedLines = Array.from(linesToPrint).sort((a, b) => a - b);

    for (let i = 0; i < sortedLines.length && !earlyExit; i++) {
      const lineIdx = sortedLines[i]!;
      const line = lines[lineIdx]!;
      const lineNum = lineIdx + 1;
      const isMatch = matchingLines.has(lineIdx);

      // Print separator if there's a gap
      if (lastPrintedLine >= 0 && lineIdx > lastPrintedLine + 1) {
        await ctx.stdout.writeText("--\n");
      }

      if (isMatch) {
        fileFound = true;
        fileMatchCount++;

        if (options.quiet) {
          earlyExit = true;
          return { found: true, count: 1 };
        }

        if (options.filesWithMatches) {
          return { found: true, count: 1 };
        }

        if (!options.countOnly && !options.filesWithoutMatches) {
          if (options.onlyMatching && !options.invert) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(line)) !== null) {
              let output = "";
              if (filename && showFilenames) output += filename + ":";
              if (options.showLineNumbers) output += lineNum + ":";
              output += match[0] + "\n";
              await ctx.stdout.writeText(output);
              if (match[0].length === 0) regex.lastIndex++;
            }
          } else {
            let output = "";
            if (filename && showFilenames) output += filename + ":";
            if (options.showLineNumbers) output += lineNum + ":";
            output += line + "\n";
            await ctx.stdout.writeText(output);
          }
        }

        if (options.maxMatches > 0 && fileMatchCount >= options.maxMatches) {
          // Still need to output remaining context lines after this match
          // Continue to output context but mark we should stop looking for more matches
          const remainingContextLines = sortedLines.slice(i + 1).filter(idx => !matchingLines.has(idx));
          for (const contextIdx of remainingContextLines) {
            const contextLine = lines[contextIdx]!;
            const contextLineNum = contextIdx + 1;
            // Check if it's within after-context of current match
            if (contextIdx <= lineIdx + options.afterContext) {
              if (lastPrintedLine >= 0 && contextIdx > lastPrintedLine + 1) {
                await ctx.stdout.writeText("--\n");
              }
              if (!options.countOnly && !options.filesWithoutMatches) {
                let output = "";
                if (filename && showFilenames) output += filename + "-";
                if (options.showLineNumbers) output += contextLineNum + "-";
                output += contextLine + "\n";
                await ctx.stdout.writeText(output);
              }
              lastPrintedLine = contextIdx;
            }
          }
          earlyExit = true;
          return { found: true, count: fileMatchCount };
        }
      } else {
        // Context line
        if (!options.countOnly && !options.filesWithoutMatches) {
          let output = "";
          if (filename && showFilenames) output += filename + "-";
          if (options.showLineNumbers) output += lineNum + "-";
          output += line + "\n";
          await ctx.stdout.writeText(output);
        }
      }

      lastPrintedLine = lineIdx;
    }

    return { found: fileFound, count: fileMatchCount };
  };

  if (expandedFiles.length === 0) {
    // Read from stdin
    const content = await ctx.stdin.text();
    const lines = content.split("\n");
    // Remove trailing empty line if content ends with newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const { found, count } = await processContent(lines);
    globalFound = found;
    globalMatchCount = count;

    if (options.countOnly && !options.quiet && !options.filesWithMatches && !options.filesWithoutMatches) {
      await ctx.stdout.writeText(globalMatchCount + "\n");
    }
  } else {
    // Read from files
    const perFileResults: Map<string, { found: boolean; count: number }> = new Map();

    for (const file of expandedFiles) {
      if (earlyExit && options.quiet) break;

      try {
        const path = file.startsWith("/") ? file : ctx.fs.resolve(ctx.cwd, file);
        const stat = await ctx.fs.stat(path);

        if (stat.isDirectory()) {
          if (!options.recursive) {
            await ctx.stderr.writeText(`grep: ${file}: Is a directory\n`);
          }
          continue;
        }

        const content = await ctx.fs.readFile(path);
        const lines = content.toString().split("\n");

        // Remove trailing empty line if file ends with newline
        if (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop();
        }

        // Use original filename for display, not resolved path
        const displayName = files.includes(file) ? file :
          (options.recursive ? path : file);

        const { found, count } = await processContent(lines, displayName);
        perFileResults.set(displayName, { found, count });

        if (found) {
          globalFound = true;
          globalMatchCount += count;
        }
      } catch (err) {
        await ctx.stderr.writeText(`grep: ${file}: No such file or directory\n`);
        // Continue to other files instead of immediately returning
        if (expandedFiles.length === 1) {
          return 1;
        }
      }
    }

    // Handle -l, -L, -c output modes
    let hasFilesWithoutMatches = false;
    if (options.filesWithMatches) {
      for (const [filename, result] of perFileResults) {
        if (result.found && !options.quiet) {
          await ctx.stdout.writeText(filename + "\n");
        }
      }
    } else if (options.filesWithoutMatches) {
      for (const [filename, result] of perFileResults) {
        if (!result.found) {
          hasFilesWithoutMatches = true;
          await ctx.stdout.writeText(filename + "\n");
        }
      }
    } else if (options.countOnly && !options.quiet) {
      for (const [filename, result] of perFileResults) {
        if (showFilenames) {
          await ctx.stdout.writeText(`${filename}:${result.count}\n`);
        } else {
          await ctx.stdout.writeText(result.count + "\n");
        }
      }
    }

    // Determine exit code for file processing
    if (options.filesWithoutMatches) {
      // -L: success if any file had NO matches
      return hasFilesWithoutMatches ? 0 : 1;
    }
  }

  // Determine exit code
  return globalFound ? 0 : 1;
};
