import type { Command } from "../../types.ts";

interface SedCommand {
  type: "s" | "d" | "p";
  addressPattern?: RegExp;
  pattern?: RegExp;
  replacement?: string;
  globalFlag: boolean;
  printFlag: boolean;
}

interface SedOptions {
  suppressOutput: boolean; // -n
  inPlace: boolean; // -i
  commands: SedCommand[];
}

function parseSubstitution(script: string): SedCommand | null {
  // Match s/pattern/replacement/flags format
  // Support different delimiters (first char after 's')
  const match = script.match(/^s(.)(.+?)\1(.*?)\1([gi]*)$/);
  if (!match) return null;

  const [, , rawPattern, rawReplacement, flags] = match;
  const globalFlag = flags!.includes("g");
  const caseInsensitive = flags!.includes("i");

  // Convert sed-style \( \) to JS ( ) for capture groups
  const patternStr = rawPattern!.replace(/\\\(/g, "(").replace(/\\\)/g, ")");
  // Convert sed replacement to JS String.replace format:
  // 1. Mark backreferences \1..\9 with placeholders
  // 2. Escape $ so String.replace doesn't treat $$ as special
  // 3. Restore backreference placeholders as $1..$9
  const replacement = rawReplacement!
    .replace(/\\([0-9])/g, "\x00BACKREF$1\x00")
    .replace(/\$/g, "$$$$")
    .replace(/\x00BACKREF([0-9])\x00/g, "$$$1");

  try {
    const regexFlags = caseInsensitive ? "i" : "";
    return {
      type: "s",
      pattern: new RegExp(patternStr, regexFlags),
      replacement,
      globalFlag,
      printFlag: false,
    };
  } catch {
    return null;
  }
}

function parseCommand(script: string): SedCommand | null {
  const trimmed = script.trim();

  // Check for address pattern (e.g., /foo/d or /foo/p)
  const addressMatch = trimmed.match(/^\/(.+?)\/([dp])$/);
  if (addressMatch) {
    const [, addressPatternStr, cmd] = addressMatch;
    try {
      return {
        type: cmd as "d" | "p",
        addressPattern: new RegExp(addressPatternStr!),
        globalFlag: false,
        printFlag: false,
      };
    } catch {
      return null;
    }
  }

  // Simple d or p command (applies to all lines)
  if (trimmed === "d") {
    return { type: "d", globalFlag: false, printFlag: false };
  }
  if (trimmed === "p") {
    return { type: "p", globalFlag: false, printFlag: false };
  }

  // Address pattern with substitution: /pattern/s/old/new/flags
  const addressSubMatch = trimmed.match(/^\/(.+?)\/s(.)(.+?)\2(.*?)\2([gi]*)$/);
  if (addressSubMatch) {
    const [, addressPatternStr, , patternStr, replacement, flags] = addressSubMatch;
    const globalFlag = flags!.includes("g");
    const caseInsensitive = flags!.includes("i");
    try {
      return {
        type: "s",
        addressPattern: new RegExp(addressPatternStr!),
        pattern: new RegExp(patternStr!, caseInsensitive ? "i" : ""),
        replacement: replacement!,
        globalFlag,
        printFlag: false,
      };
    } catch {
      return null;
    }
  }

  // Substitution command
  const subCmd = parseSubstitution(trimmed);
  if (subCmd) return subCmd;

  return null;
}

function splitScriptParts(script: string): string[] {
  // Split on ';' that are outside of s/// delimiters
  const parts: string[] = [];
  let i = 0;
  let current = "";
  while (i < script.length) {
    if (script[i] === "s" && i + 1 < script.length) {
      // Detect substitution command — consume s/pattern/replacement/flags
      const delim = script[i + 1]!;
      let j = i + 2;
      let delimCount = 0;
      while (j < script.length && delimCount < 2) {
        if (script[j] === "\\") {
          j += 2;
          continue;
        }
        if (script[j] === delim) delimCount++;
        j++;
      }
      // Consume trailing flags
      while (j < script.length && /[gi]/.test(script[j]!)) j++;
      current += script.slice(i, j);
      i = j;
    } else if (script[i] === ";") {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      i++;
    } else {
      current += script[i];
      i++;
    }
  }
  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function parseArgs(args: string[]): { options: SedOptions; files: string[] } {
  const options: SedOptions = {
    suppressOutput: false,
    inPlace: false,
    commands: [],
  };
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "-n") {
      options.suppressOutput = true;
      i++;
      continue;
    }

    if (arg === "-i") {
      options.inPlace = true;
      i++;
      continue;
    }

    if (arg === "-e" && args[i + 1] !== undefined) {
      const cmd = parseCommand(args[i + 1]!);
      if (cmd) {
        options.commands.push(cmd);
      }
      i += 2;
      continue;
    }

    // Non-flag argument: either a script or a file
    if (!arg.startsWith("-")) {
      if (options.commands.length === 0) {
        // First non-flag is the script — may contain ;-separated commands
        const parts = splitScriptParts(arg);
        for (const part of parts) {
          const cmd = parseCommand(part);
          if (cmd) {
            options.commands.push(cmd);
          }
        }
      } else {
        // Subsequent non-flags are files
        files.push(arg);
      }
    }
    i++;
  }

  return { options, files };
}

function applySubstitution(line: string, cmd: SedCommand): string {
  if (!cmd.pattern) return line;

  if (cmd.globalFlag) {
    return line.replace(new RegExp(cmd.pattern.source, cmd.pattern.flags + "g"), cmd.replacement!);
  } else {
    return line.replace(cmd.pattern, cmd.replacement!);
  }
}

function processLine(
  line: string,
  commands: SedCommand[],
  suppressOutput: boolean
): { output: string | null; deleted: boolean } {
  let currentLine = line;
  let deleted = false;
  let printed = false;

  for (const cmd of commands) {
    // Check address pattern first
    if (cmd.addressPattern && !cmd.addressPattern.test(currentLine)) {
      continue; // Skip this command if address doesn't match
    }

    switch (cmd.type) {
      case "s":
        currentLine = applySubstitution(currentLine, cmd);
        break;
      case "d":
        deleted = true;
        return { output: null, deleted: true };
      case "p":
        printed = true;
        break;
    }
  }

  if (deleted) {
    return { output: null, deleted: true };
  }

  if (suppressOutput) {
    // With -n, only output if explicitly printed
    return { output: printed ? currentLine : null, deleted: false };
  }

  // Without -n, always output (plus extra if printed)
  if (printed) {
    return { output: currentLine + "\n" + currentLine, deleted: false };
  }
  return { output: currentLine, deleted: false };
}

export const sed: Command = async (ctx) => {
  const { options, files } = parseArgs(ctx.args);

  if (options.commands.length === 0) {
    await ctx.stderr.writeText("sed: missing script\n");
    return 1;
  }

  const processContent = async (content: string): Promise<void> => {
    const lines = content.split("\n");
    // Handle trailing newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    for (const line of lines) {
      const { output } = processLine(line, options.commands, options.suppressOutput);
      if (output !== null) {
        await ctx.stdout.writeText(output + "\n");
      }
    }
  };

  if (files.length === 0) {
    // Read from stdin
    const content = await ctx.stdin.text();
    await processContent(content);
  } else if (options.inPlace) {
    // In-place editing: write results back to each file
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        const lines = content.toString().split("\n");
        if (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop();
        }
        const outputLines: string[] = [];
        for (const line of lines) {
          const { output } = processLine(line, options.commands, options.suppressOutput);
          if (output !== null) {
            outputLines.push(output);
          }
        }
        const result = outputLines.length > 0 ? outputLines.join("\n") + "\n" : "";
        await ctx.fs.writeFile(path, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`sed: ${file}: ${message}\n`);
        return 1;
      }
    }
  } else {
    // Read from files
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        await processContent(content.toString());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`sed: ${file}: ${message}\n`);
        return 1;
      }
    }
  }

  return 0;
};
