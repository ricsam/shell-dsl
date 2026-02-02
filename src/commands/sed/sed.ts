import type { Command } from "../../types.ts";

interface SedAddress {
  type: "line" | "regex" | "last";
  lineNumber?: number;
  pattern?: RegExp;
}

interface SedCommand {
  type: "s" | "d" | "p" | "h" | "H" | "g_hold" | "G" | "x" | "n" | "N" | "P" | "D" | "b" | "label" | "group";
  address1?: SedAddress;
  address2?: SedAddress;
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

function parseAddress(str: string): { address: SedAddress; remaining: string } | null {
  // Match $ (last line)
  if (str.startsWith("$")) {
    return { address: { type: "last" }, remaining: str.slice(1) };
  }
  // Match line number
  const lineMatch = str.match(/^(\d+)/);
  if (lineMatch) {
    return {
      address: { type: "line", lineNumber: parseInt(lineMatch[1]!, 10) },
      remaining: str.slice(lineMatch[0].length),
    };
  }
  // Match regex /pattern/
  // Handle escaped slashes in pattern
  let i = 1; // start after opening /
  if (!str.startsWith("/")) return null;

  let pattern = "";
  while (i < str.length) {
    if (str[i] === "\\") {
      // Escape sequence
      if (i + 1 < str.length) {
        pattern += str[i]! + str[i + 1]!;
        i += 2;
      } else {
        break;
      }
    } else if (str[i] === "/") {
      // End of pattern
      try {
        return {
          address: { type: "regex", pattern: new RegExp(pattern) },
          remaining: str.slice(i + 1),
        };
      } catch {
        return null;
      }
    } else {
      pattern += str[i];
      i++;
    }
  }
  return null;
}

function parseAddressRange(script: string): { address1?: SedAddress; address2?: SedAddress; remaining: string; negated: boolean } {
  let trimmed = script.trim();

  // Try to parse first address
  const first = parseAddress(trimmed);
  if (!first) {
    return { remaining: trimmed, negated: false };
  }

  trimmed = first.remaining;
  const address1 = first.address;

  // Check for comma (range)
  if (trimmed.startsWith(",")) {
    const second = parseAddress(trimmed.slice(1));
    if (second) {
      let remaining = second.remaining;
      const negated = remaining.startsWith("!");
      if (negated) remaining = remaining.slice(1);
      return { address1, address2: second.address, remaining: remaining.trim(), negated };
    }
  }

  // Check for negation
  const negated = trimmed.startsWith("!");
  if (negated) trimmed = trimmed.slice(1);

  return { address1, remaining: trimmed.trim(), negated };
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

  // Branch command: b or b label (no address)
  if (trimmed === "b" || trimmed.startsWith("b ") || trimmed.startsWith("b\t")) {
    return {
      type: "b",
      label: trimmed.length > 1 ? trimmed.slice(1).trim() : undefined,
      globalFlag: false,
      printFlag: false,
    };
  }

  // Group { ... } (no address)
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

  // Simple command without address
  if (simpleCommands[trimmed]) {
    return {
      type: simpleCommands[trimmed]!,
      globalFlag: false,
      printFlag: false,
    };
  }

  // Try to parse address(es) followed by command
  const { address1, address2, remaining, negated } = parseAddressRange(trimmed);

  if (address1) {
    const restTrimmed = remaining.trim();

    // Address alone — not valid, but handle gracefully
    if (!restTrimmed) return null;

    // [address][!]d or [address][!]p etc (simple commands)
    if (simpleCommands[restTrimmed]) {
      return {
        type: simpleCommands[restTrimmed]!,
        address1,
        address2,
        negated,
        globalFlag: false,
        printFlag: false,
      };
    }

    // [address][!]b or [address][!]b label
    if (restTrimmed === "b" || restTrimmed.startsWith("b ")) {
      return {
        type: "b",
        address1,
        address2,
        negated,
        label: restTrimmed.length > 1 ? restTrimmed.slice(1).trim() : undefined,
        globalFlag: false,
        printFlag: false,
      };
    }

    // [address][!]{ ... }
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
        address1,
        address2,
        negated,
        children,
        globalFlag: false,
        printFlag: false,
      };
    }

    // [address][!]s/old/new/flags
    const subCmd = parseSubstitution(restTrimmed);
    if (subCmd) {
      subCmd.address1 = address1;
      subCmd.address2 = address2;
      subCmd.negated = negated;
      return subCmd;
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
  rangeState: Map<SedCommand, boolean>; // tracks active ranges
}

function singleAddressMatches(address: SedAddress, state: SedState): boolean {
  const lineNum = state.lineIndex + 1; // 1-based line numbers
  switch (address.type) {
    case "line":
      return lineNum === address.lineNumber;
    case "last":
      return state.lineIndex === state.lines.length - 1;
    case "regex":
      return address.pattern!.test(state.patternSpace);
    default:
      return false;
  }
}

function addressMatches(cmd: SedCommand, state: SedState): boolean {
  // No address - matches all
  if (!cmd.address1) {
    return cmd.negated ? false : true;
  }

  // Range address (addr1,addr2)
  if (cmd.address2) {
    const isInRange = state.rangeState.get(cmd) ?? false;

    if (!isInRange) {
      // Not in range yet - check if we should start
      if (singleAddressMatches(cmd.address1, state)) {
        state.rangeState.set(cmd, true);
        const matches = true;
        return cmd.negated ? !matches : matches;
      }
      return cmd.negated ? true : false;
    } else {
      // In range - check if we should end
      if (singleAddressMatches(cmd.address2, state)) {
        state.rangeState.set(cmd, false);
      }
      const matches = true;
      return cmd.negated ? !matches : matches;
    }
  }

  // Single address
  const matches = singleAddressMatches(cmd.address1, state);
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
      rangeState: new Map(),
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
