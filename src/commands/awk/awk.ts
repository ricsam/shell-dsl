import type { Command } from "../../types.ts";
import { expandEscapes } from "../../utils/expand-escapes.ts";

interface AwkRule {
  pattern?: RegExp;
  action: string;
}

interface AwkOptions {
  fieldSeparator: RegExp;
  program: AwkRule[];
}

interface ParseArgsResult {
  options: AwkOptions;
  files: string[];
  error?: { type: "unrecognized_option" | "missing_value"; option: string };
}

function parseProgram(programStr: string): AwkRule[] {
  const rules: AwkRule[] = [];
  const trimmed = programStr.trim();

  // Simple parser for patterns like: /regex/ {action} or {action}
  // Handle multiple rules separated by whitespace/newlines

  let remaining = trimmed;

  while (remaining.length > 0) {
    remaining = remaining.trim();
    if (remaining.length === 0) break;

    let pattern: RegExp | undefined;
    let action = "";

    // Check for /pattern/ prefix
    if (remaining.startsWith("/")) {
      const endSlash = remaining.indexOf("/", 1);
      if (endSlash > 1) {
        const patternStr = remaining.slice(1, endSlash);
        try {
          pattern = new RegExp(patternStr);
        } catch {
          // Invalid regex, skip
        }
        remaining = remaining.slice(endSlash + 1).trim();
      }
    }

    // Check for {action} block
    if (remaining.startsWith("{")) {
      let braceCount = 1;
      let i = 1;
      while (i < remaining.length && braceCount > 0) {
        if (remaining[i] === "{") braceCount++;
        else if (remaining[i] === "}") braceCount--;
        i++;
      }
      action = remaining.slice(1, i - 1).trim();
      remaining = remaining.slice(i).trim();
    } else if (pattern) {
      // Pattern without action - default action is print
      action = "print";
    } else {
      // No pattern and no action block, might be malformed
      break;
    }

    if (action || pattern) {
      rules.push({ pattern, action: action || "print" });
    }
  }

  return rules;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args: string[]): ParseArgsResult {
  const options: AwkOptions = {
    fieldSeparator: /[ \t]+/,
    program: [],
  };
  const files: string[] = [];

  let i = 0;
  let programFound = false;

  while (i < args.length) {
    const arg = args[i]!;

    // Handle -- to stop flag parsing
    if (arg === "--") {
      i++;
      while (i < args.length) {
        const remaining = args[i]!;
        if (!programFound) {
          options.program = parseProgram(remaining);
          programFound = true;
        } else {
          files.push(remaining);
        }
        i++;
      }
      break;
    }

    // Long flag handling
    if (arg.startsWith("--")) {
      return {
        options,
        files,
        error: { type: "unrecognized_option", option: arg },
      };
    }

    // Short flag handling
    if (arg.startsWith("-") && arg.length > 1) {
      const char = arg[1]!;

      if (char === "F") {
        // -F takes a field separator argument
        const restOfArg = arg.slice(2);
        let fs: string;

        if (restOfArg.length > 0) {
          fs = restOfArg;
        } else if (i + 1 < args.length) {
          fs = args[++i]!;
        } else {
          return {
            options,
            files,
            error: { type: "missing_value", option: "-F" },
          };
        }

        // Expand escape sequences (e.g. \t → tab)
        fs = expandEscapes(fs);

        // For single character separators, match exactly
        // For patterns, use as regex
        if (fs.length === 1) {
          options.fieldSeparator = new RegExp(escapeRegex(fs));
        } else {
          try {
            options.fieldSeparator = new RegExp(fs);
          } catch {
            options.fieldSeparator = new RegExp(escapeRegex(fs));
          }
        }
        i++;
        continue;
      } else {
        // Unknown flag
        return {
          options,
          files,
          error: { type: "unrecognized_option", option: `-${char}` },
        };
      }
    }

    // Non-flag argument
    if (!programFound) {
      options.program = parseProgram(arg);
      programFound = true;
    } else {
      files.push(arg);
    }
    i++;
  }

  return { options, files };
}

function formatError(error: NonNullable<ParseArgsResult["error"]>): string {
  let message: string;
  if (error.type === "unrecognized_option") {
    if (error.option.startsWith("--")) {
      message = `awk: unrecognized option '${error.option}'\n`;
    } else {
      message = `awk: invalid option -- '${error.option.slice(1)}'\n`;
    }
  } else {
    message = `awk: option '${error.option}' requires an argument\n`;
  }
  return message + `usage: awk [-F fs] 'program' [file ...]\n`;
}

function splitFields(line: string, separator: RegExp): string[] {
  // Split and filter empty strings for whitespace separation
  const parts = line.split(separator);
  // For whitespace separator, filter leading empty string
  if (separator.source === "[ \\t]+" && parts[0] === "") {
    parts.shift();
  }
  return parts;
}

function executeAction(
  action: string,
  fields: string[],
  line: string,
  lineNumber: number
): string | null {
  // Parse and execute the action
  // Supported: print, print $0, print $1, print $1, $2, etc.

  const trimmedAction = action.trim();

  if (trimmedAction === "" || trimmedAction === "print" || trimmedAction === "print $0") {
    return line;
  }

  // Check for print with field references
  if (trimmedAction.startsWith("print")) {
    const printArgs = trimmedAction.slice(5).trim();
    return evaluatePrintArgs(printArgs, fields, line, lineNumber);
  }

  // Just field reference without print (implicit print)
  if (trimmedAction.startsWith("$")) {
    return evaluatePrintArgs(trimmedAction, fields, line, lineNumber);
  }

  return null;
}

function evaluatePrintArgs(
  argsStr: string,
  fields: string[],
  line: string,
  lineNumber: number
): string {
  const results: string[] = [];

  // Split by comma for multiple arguments
  const args = argsStr.split(",").map((a) => a.trim());

  for (const arg of args) {
    const value = evaluateExpression(arg, fields, line, lineNumber);
    results.push(value);
  }

  return results.join(" ");
}

function tokenizeExpression(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const str = expr.trim();

  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i]!)) {
      i++;
    }
    if (i >= str.length) break;

    // String literal
    if (str[i] === '"' || str[i] === "'") {
      const quote = str[i]!;
      let j = i + 1;
      while (j < str.length && str[j] !== quote) {
        j++;
      }
      tokens.push(str.slice(i, j + 1));
      i = j + 1;
    }
    // Field reference or variable
    else if (str[i] === '$' || /[a-zA-Z]/.test(str[i]!)) {
      let j = i;
      while (j < str.length && /[\w$]/.test(str[j]!)) {
        j++;
      }
      tokens.push(str.slice(i, j));
      i = j;
    }
    // Other characters
    else {
      tokens.push(str[i]!);
      i++;
    }
  }

  return tokens;
}

function evaluateExpression(
  expr: string,
  fields: string[],
  line: string,
  lineNumber: number
): string {
  const tokens = tokenizeExpression(expr);

  if (tokens.length === 0) {
    return "";
  }

  // Evaluate each token and concatenate
  const parts: string[] = [];
  for (const token of tokens) {
    // String literal
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))) {
      parts.push(expandEscapes(token.slice(1, -1)));
    }
    // Field reference $0, $1, etc.
    else if (token.match(/^\$(\d+)$/)) {
      const fieldNum = parseInt(token.slice(1), 10);
      if (fieldNum === 0) {
        parts.push(line);
      } else {
        parts.push(fields[fieldNum - 1] ?? "");
      }
    }
    // Built-in variables
    else if (token === "NF") {
      parts.push(String(fields.length));
    }
    else if (token === "NR") {
      parts.push(String(lineNumber));
    }
    // Unknown - return as-is
    else {
      parts.push(token);
    }
  }

  return parts.join("");
}

function processLine(
  line: string,
  lineNumber: number,
  options: AwkOptions
): string[] {
  const fields = splitFields(line, options.fieldSeparator);
  const outputs: string[] = [];

  for (const rule of options.program) {
    // Check pattern match
    if (rule.pattern && !rule.pattern.test(line)) {
      continue;
    }

    const result = executeAction(rule.action, fields, line, lineNumber);
    if (result !== null) {
      outputs.push(result);
    }
  }

  return outputs;
}

export const awk: Command = async (ctx) => {
  const { options, files, error } = parseArgs(ctx.args);

  if (error) {
    await ctx.stderr.writeText(formatError(error));
    return 1;
  }

  if (options.program.length === 0) {
    await ctx.stderr.writeText("awk: missing program\n");
    return 1;
  }

  let lineNumber = 0;

  const processContent = async (content: string): Promise<void> => {
    const lines = content.split("\n");
    // Handle trailing newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    for (const line of lines) {
      lineNumber++;
      const outputs = processLine(line, lineNumber, options);
      for (const output of outputs) {
        await ctx.stdout.writeText(output + "\n");
      }
    }
  };

  if (files.length === 0) {
    // Read from stdin
    const content = await ctx.stdin.text();
    await processContent(content);
  } else {
    // Read from files
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        await processContent(content.toString());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`awk: ${file}: ${message}\n`);
        return 1;
      }
    }
  }

  return 0;
};
