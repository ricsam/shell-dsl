import type { Command } from "../../types.ts";

interface SedCommand {
  type: "s" | "d" | "p" | "h" | "H" | "g_hold" | "G" | "x" | "n" | "N" | "P" | "D" | "b" | "label" | "group";
  addressPattern?: RegExp;
  negated?: boolean;
  pattern?: RegExp;
  replacement?: string;
  globalFlag: boolean;
  printFlag: boolean;
  label?: string;
  children?: SedCommand[];
}

interface SedOptions {
  suppressOutput: boolean; // -n
  inPlace: boolean; // -i
  commands: SedCommand[];
}

function parseSubstitution(script: string): SedCommand | null {
  const match = script.match(/^s(.)(.+?)\1(.*?)\1([gi]*)$/);
  if (!match) return null;

  const [, , rawPattern, rawReplacement, flags] = match;
  const globalFlag = flags!.includes("g");
  const caseInsensitive = flags!.includes("i");

  const patternStr = rawPattern!.replace(/\\\(/g, "(").replace(/\\\)/g, ")");
  const replacement = rawReplacement!
    .replace(/\\([0-9])/g, "\x00BACKREF$1\x00")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\x00BSLASH\x00")
    .replace(/\$/g, "$$$$")
    .replace(/\x00BACKREF([0-9])\x00/g, "$$$1")
    .replace(/\x00BSLASH\x00/g, "\\");

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

  // Label command :name
  if (trimmed.startsWith(":")) {
    return {
      type: "label",
      label: trimmed.slice(1).trim(),
      globalFlag: false,
      printFlag: false,
    };
  }

  // Branch command: b or b label
  if (trimmed === "b" || trimmed.startsWith("b ") || trimmed.startsWith("b\t")) {
    return {
      type: "b",
      label: trimmed.length > 1 ? trimmed.slice(1).trim() : undefined,
      globalFlag: false,
      printFlag: false,
    };
  }

  // Group { ... }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    const parts = splitScriptParts(inner);
    const children: SedCommand[] = [];
    for (const part of parts) {
      const cmd = parseCommand(part);
      if (cmd) children.push(cmd);
    }
    return {
      type: "group",
      children,
      globalFlag: false,
      printFlag: false,
    };
  }

  // Simple single-char commands (no address)
  const simpleCommands: Record<string, SedCommand["type"]> = {
    h: "h",
    H: "H",
    g: "g_hold",
    G: "G",
    x: "x",
    n: "n",
    N: "N",
    P: "P",
    D: "D",
    d: "d",
    p: "p",
  };
  if (simpleCommands[trimmed]) {
    return {
      type: simpleCommands[trimmed]!,
      globalFlag: false,
      printFlag: false,
    };
  }

  // Check for address pattern: /pattern/ followed by optional ! and command
  const addressWithCmd = trimmed.match(/^\/(.+?)\/(!)?\s*(.*)$/);
  if (addressWithCmd) {
    const [, addressPatternStr, negation, rest] = addressWithCmd;
    const negated = negation === "!";
    const restTrimmed = rest!.trim();

    try {
      const addressPattern = new RegExp(addressPatternStr!);

      // /pattern/ alone — not valid, but handle gracefully
      if (!restTrimmed) return null;

      // /pattern/[!]d or /pattern/[!]p etc (simple commands)
      if (simpleCommands[restTrimmed]) {
        return {
          type: simpleCommands[restTrimmed]!,
          addressPattern,
          negated,
          globalFlag: false,
          printFlag: false,
        };
      }

      // /pattern/[!]b or /pattern/[!]b label
      if (restTrimmed === "b" || restTrimmed.startsWith("b ")) {
        return {
          type: "b",
          addressPattern,
          negated,
          label: restTrimmed.length > 1 ? restTrimmed.slice(1).trim() : undefined,
          globalFlag: false,
          printFlag: false,
        };
      }

      // /pattern/[!]{ ... }
      if (restTrimmed.startsWith("{") && restTrimmed.endsWith("}")) {
        const inner = restTrimmed.slice(1, -1).trim();
        const parts = splitScriptParts(inner);
        const children: SedCommand[] = [];
        for (const part of parts) {
          const cmd = parseCommand(part);
          if (cmd) children.push(cmd);
        }
        return {
          type: "group",
          addressPattern,
          negated,
          children,
          globalFlag: false,
          printFlag: false,
        };
      }

      // /pattern/[!]s/old/new/flags
      const subCmd = parseSubstitution(restTrimmed);
      if (subCmd) {
        subCmd.addressPattern = addressPattern;
        subCmd.negated = negated;
        return subCmd;
      }
    } catch {
      return null;
    }
  }

  // Substitution command (no address)
  const subCmd = parseSubstitution(trimmed);
  if (subCmd) return subCmd;

  return null;
}

function splitScriptParts(script: string): string[] {
  const parts: string[] = [];
  let i = 0;
  let current = "";
  let braceDepth = 0;

  while (i < script.length) {
    if (script[i] === "{") {
      braceDepth++;
      current += script[i];
      i++;
    } else if (script[i] === "}") {
      braceDepth--;
      current += script[i];
      i++;
    } else if (script[i] === "s" && braceDepth === 0 && i + 1 < script.length && !/[a-zA-Z0-9]/.test(script[i + 1]!)) {
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
    } else if (script[i] === ";" && braceDepth === 0) {
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

interface ParseArgsResult {
  options: SedOptions;
  files: string[];
  error?: { type: "unrecognized_option" | "missing_value"; option: string };
}

function parseArgs(args: string[]): ParseArgsResult {
  const options: SedOptions = {
    suppressOutput: false,
    inPlace: false,
    commands: [],
  };
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "--") {
      i++;
      while (i < args.length) {
        const remaining = args[i]!;
        if (options.commands.length === 0) {
          const parts = splitScriptParts(remaining);
          for (const part of parts) {
            const cmd = parseCommand(part);
            if (cmd) options.commands.push(cmd);
          }
        } else {
          files.push(remaining);
        }
        i++;
      }
      break;
    }

    if (arg.startsWith("--")) {
      return {
        options,
        files,
        error: { type: "unrecognized_option", option: arg },
      };
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const flagChars = arg.slice(1);

      for (let j = 0; j < flagChars.length; j++) {
        const char = flagChars[j]!;

        if (char === "n") {
          options.suppressOutput = true;
        } else if (char === "i") {
          options.inPlace = true;
        } else if (char === "e") {
          const restOfArg = flagChars.slice(j + 1);
          let script: string;

          if (restOfArg.length > 0) {
            script = restOfArg;
          } else if (i + 1 < args.length) {
            script = args[++i]!;
          } else {
            return {
              options,
              files,
              error: { type: "missing_value", option: "-e" },
            };
          }

          const parts = splitScriptParts(script);
          for (const part of parts) {
            const cmd = parseCommand(part);
            if (cmd) options.commands.push(cmd);
          }
          break;
        } else {
          return {
            options,
            files,
            error: { type: "unrecognized_option", option: `-${char}` },
          };
        }
      }
      i++;
      continue;
    }

    if (options.commands.length === 0) {
      const parts = splitScriptParts(arg);
      for (const part of parts) {
        const cmd = parseCommand(part);
        if (cmd) options.commands.push(cmd);
      }
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
      message = `sed: unrecognized option '${error.option}'\n`;
    } else {
      message = `sed: invalid option -- '${error.option.slice(1)}'\n`;
    }
  } else {
    message = `sed: option '${error.option}' requires an argument\n`;
  }
  return message + `usage: sed [-ni] [-e script] script [file ...]\n`;
}

function applySubstitution(line: string, cmd: SedCommand): string {
  if (!cmd.pattern) return line;

  if (cmd.globalFlag) {
    return line.replace(new RegExp(cmd.pattern.source, cmd.pattern.flags + "g"), cmd.replacement!);
  } else {
    return line.replace(cmd.pattern, cmd.replacement!);
  }
}

interface SedState {
  patternSpace: string;
  holdSpace: string;
  lineIndex: number;
  lines: string[];
  suppressOutput: boolean;
  output: string[];
  deleted: boolean;
  restart: boolean; // for D command
}

function addressMatches(cmd: SedCommand, state: SedState): boolean {
  if (!cmd.addressPattern) {
    return cmd.negated ? false : true;
  }
  const matches = cmd.addressPattern.test(state.patternSpace);
  return cmd.negated ? !matches : matches;
}

function findLabel(commands: SedCommand[], label: string): number {
  for (let i = 0; i < commands.length; i++) {
    if (commands[i]!.type === "label" && commands[i]!.label === label) {
      return i;
    }
  }
  return -1;
}

interface ExecResult {
  branchToEnd: boolean;
  branchLabel?: string;
  nextLine: boolean; // n command: output and advance
  deleted: boolean;
  restart: boolean; // D command
}

function executeCommands(
  commands: SedCommand[],
  state: SedState,
  topLevel: boolean
): ExecResult {
  let pc = 0;
  while (pc < commands.length) {
    const cmd = commands[pc]!;

    // Labels are no-ops
    if (cmd.type === "label") {
      pc++;
      continue;
    }

    // Check address
    if (!addressMatches(cmd, state)) {
      pc++;
      continue;
    }

    switch (cmd.type) {
      case "s":
        state.patternSpace = applySubstitution(state.patternSpace, cmd);
        break;
      case "d":
        state.deleted = true;
        return { branchToEnd: false, deleted: true, nextLine: false, restart: false };
      case "p":
        state.output.push(state.patternSpace);
        break;
      case "h":
        state.holdSpace = state.patternSpace;
        break;
      case "H":
        state.holdSpace = state.holdSpace + "\n" + state.patternSpace;
        break;
      case "g_hold":
        state.patternSpace = state.holdSpace;
        break;
      case "G":
        state.patternSpace = state.patternSpace + "\n" + state.holdSpace;
        break;
      case "x": {
        const tmp = state.patternSpace;
        state.patternSpace = state.holdSpace;
        state.holdSpace = tmp;
        break;
      }
      case "n":
        // Output current pattern space, then read next line
        if (!state.suppressOutput) {
          state.output.push(state.patternSpace);
        }
        state.lineIndex++;
        if (state.lineIndex < state.lines.length) {
          state.patternSpace = state.lines[state.lineIndex]!;
        } else {
          // No more lines
          state.deleted = true;
          return { branchToEnd: false, deleted: true, nextLine: false, restart: false };
        }
        break;
      case "N":
        // Append next line to pattern space
        state.lineIndex++;
        if (state.lineIndex < state.lines.length) {
          state.patternSpace = state.patternSpace + "\n" + state.lines[state.lineIndex]!;
        } else {
          // No more lines: output pattern space and exit (POSIX behavior)
          if (!state.suppressOutput) {
            state.output.push(state.patternSpace);
          }
          state.deleted = true;
          return { branchToEnd: false, deleted: true, nextLine: false, restart: false };
        }
        break;
      case "P": {
        // Print up to first \n
        const nlIdx = state.patternSpace.indexOf("\n");
        if (nlIdx >= 0) {
          state.output.push(state.patternSpace.slice(0, nlIdx));
        } else {
          state.output.push(state.patternSpace);
        }
        break;
      }
      case "D": {
        // Delete up to first \n, restart; if no \n, delete all
        const nlIdx2 = state.patternSpace.indexOf("\n");
        if (nlIdx2 >= 0) {
          state.patternSpace = state.patternSpace.slice(nlIdx2 + 1);
          state.restart = true;
          return { branchToEnd: false, deleted: false, nextLine: false, restart: true };
        } else {
          state.deleted = true;
          return { branchToEnd: false, deleted: true, nextLine: false, restart: false };
        }
      }
      case "b":
        if (cmd.label) {
          // Branch to label — only works at top level
          if (topLevel) {
            const idx = findLabel(commands, cmd.label);
            if (idx >= 0) {
              pc = idx;
              continue;
            }
          }
          // Label not found or not top-level: branch to end
          return { branchToEnd: true, branchLabel: cmd.label, deleted: false, nextLine: false, restart: false };
        }
        // No label: branch to end of script
        return { branchToEnd: true, deleted: false, nextLine: false, restart: false };
      case "group":
        if (cmd.children) {
          const result = executeCommands(cmd.children, state, false);
          if (result.deleted || result.branchToEnd || result.restart) {
            // Propagate branch labels up for top-level resolution
            if (result.branchLabel && topLevel) {
              const idx = findLabel(commands, result.branchLabel);
              if (idx >= 0) {
                pc = idx;
                continue;
              }
            }
            return result;
          }
        }
        break;
    }
    pc++;
  }
  return { branchToEnd: false, deleted: false, nextLine: false, restart: false };
}

export const sed: Command = async (ctx) => {
  const { options, files, error } = parseArgs(ctx.args);

  if (error) {
    await ctx.stderr.writeText(formatError(error));
    return 1;
  }

  if (options.commands.length === 0) {
    await ctx.stderr.writeText("sed: missing script\n");
    return 1;
  }

  const processContent = async (content: string): Promise<string[]> => {
    const lines = content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const allOutput: string[] = [];
    const state: SedState = {
      patternSpace: "",
      holdSpace: "",
      lineIndex: 0,
      lines,
      suppressOutput: options.suppressOutput,
      output: [],
      deleted: false,
      restart: false,
    };

    while (state.lineIndex < lines.length) {
      state.patternSpace = lines[state.lineIndex]!;
      state.deleted = false;
      state.output = [];

      // Execute commands, possibly restarting on D
      let restarting = true;
      while (restarting) {
        restarting = false;
        state.restart = false;
        const result = executeCommands(options.commands, state, true);

        if (result.restart) {
          restarting = true;
          // output collected so far in this cycle goes out
          allOutput.push(...state.output);
          state.output = [];
          continue;
        }

        if (result.deleted) {
          allOutput.push(...state.output);
          state.lineIndex++;
          break;
        }

        // Normal end: collect printed lines, then auto-print
        allOutput.push(...state.output);
        if (!options.suppressOutput) {
          allOutput.push(state.patternSpace);
        }
        state.lineIndex++;
      }
    }

    return allOutput;
  };

  if (files.length === 0) {
    const content = await ctx.stdin.text();
    const outputLines = await processContent(content);
    for (const line of outputLines) {
      await ctx.stdout.writeText(line + "\n");
    }
  } else if (options.inPlace) {
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        const outputLines = await processContent(content.toString());
        const result = outputLines.length > 0 ? outputLines.join("\n") + "\n" : "";
        await ctx.fs.writeFile(path, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`sed: ${file}: ${message}\n`);
        return 1;
      }
    }
  } else {
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        const outputLines = await processContent(content.toString());
        for (const line of outputLines) {
          await ctx.stdout.writeText(line + "\n");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`sed: ${file}: ${message}\n`);
        return 1;
      }
    }
  }

  return 0;
};
