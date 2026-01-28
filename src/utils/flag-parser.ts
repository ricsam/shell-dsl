import type { Stderr } from "../types.ts";

export interface FlagDefinition {
  short?: string; // e.g., "a" for -a
  long?: string; // e.g., "all" for --all
  takesValue?: boolean; // true if flag requires a value
}

export interface CommandSpec {
  name: string;
  flags: FlagDefinition[];
  usage: string;
  /** If true, stop parsing flags after the first positional argument (like echo) */
  stopAfterFirstPositional?: boolean;
}

export interface FlagError {
  type: "unrecognized_option" | "missing_value";
  option: string;
}

export interface ParseResult<T> {
  flags: T;
  args: string[];
  error?: FlagError;
}

export interface FlagParser<T> {
  parse: (args: string[]) => ParseResult<T>;
  formatError: (error: FlagError) => string;
  writeError: (error: FlagError, stderr: Stderr) => Promise<void>;
}

/**
 * Creates a flag parser for a command with consistent error handling.
 *
 * @param spec - Command specification with name, valid flags, and usage string
 * @param defaults - Default values for the flags object
 * @param handler - Function to handle setting a flag value
 * @returns Parser object with parse, formatError, and writeError methods
 */
export function createFlagParser<T>(
  spec: CommandSpec,
  defaults: T,
  handler: (flags: T, flag: FlagDefinition, value?: string) => void
): FlagParser<T> {
  // Build lookup maps for efficient flag matching
  const shortMap = new Map<string, FlagDefinition>();
  const longMap = new Map<string, FlagDefinition>();

  for (const flag of spec.flags) {
    if (flag.short) shortMap.set(flag.short, flag);
    if (flag.long) longMap.set(flag.long, flag);
  }

  function parse(args: string[]): ParseResult<T> {
    const flags = { ...defaults };
    const remainingArgs: string[] = [];
    let i = 0;
    let parsingFlags = true;

    while (i < args.length) {
      const arg = args[i]!;

      // Handle -- to stop flag parsing
      if (arg === "--") {
        remainingArgs.push(...args.slice(i + 1));
        break;
      }

      // If we've stopped parsing flags, just collect remaining args
      if (!parsingFlags) {
        remainingArgs.push(arg);
        i++;
        continue;
      }

      // Handle long flags --flag or --flag=value
      if (arg.startsWith("--")) {
        const eqIndex = arg.indexOf("=");
        let flagName: string;
        let flagValue: string | undefined;

        if (eqIndex !== -1) {
          flagName = arg.slice(2, eqIndex);
          flagValue = arg.slice(eqIndex + 1);
        } else {
          flagName = arg.slice(2);
        }

        const flagDef = longMap.get(flagName);
        if (!flagDef) {
          return {
            flags,
            args: remainingArgs,
            error: { type: "unrecognized_option", option: arg },
          };
        }

        if (flagDef.takesValue) {
          if (flagValue === undefined) {
            // Value should be next argument
            if (i + 1 >= args.length) {
              return {
                flags,
                args: remainingArgs,
                error: { type: "missing_value", option: arg },
              };
            }
            flagValue = args[++i];
          }
          handler(flags, flagDef, flagValue);
        } else {
          handler(flags, flagDef);
        }

        i++;
        continue;
      }

      // Handle short flags -a or -abc (combined) or -n10 (value attached)
      if (arg.startsWith("-") && arg.length > 1) {
        const flagChars = arg.slice(1);

        for (let j = 0; j < flagChars.length; j++) {
          const char = flagChars[j]!;
          const flagDef = shortMap.get(char);

          if (!flagDef) {
            return {
              flags,
              args: remainingArgs,
              error: { type: "unrecognized_option", option: `-${char}` },
            };
          }

          if (flagDef.takesValue) {
            // Rest of string is the value, or next arg
            const restOfArg = flagChars.slice(j + 1);
            let flagValue: string;

            if (restOfArg.length > 0) {
              flagValue = restOfArg;
            } else if (i + 1 < args.length) {
              flagValue = args[++i]!;
            } else {
              return {
                flags,
                args: remainingArgs,
                error: { type: "missing_value", option: `-${char}` },
              };
            }

            handler(flags, flagDef, flagValue);
            break; // Value consumed rest of this arg
          } else {
            handler(flags, flagDef);
          }
        }

        i++;
        continue;
      }

      // Not a flag, add to remaining args
      remainingArgs.push(arg);
      if (spec.stopAfterFirstPositional) {
        parsingFlags = false;
      }
      i++;
    }

    return { flags, args: remainingArgs };
  }

  function formatError(error: FlagError): string {
    let message: string;
    if (error.type === "unrecognized_option") {
      if (error.option.startsWith("--")) {
        message = `${spec.name}: unrecognized option '${error.option}'\n`;
      } else {
        message = `${spec.name}: invalid option -- '${error.option.slice(1)}'\n`;
      }
    } else {
      message = `${spec.name}: option '${error.option}' requires an argument\n`;
    }
    return message + `usage: ${spec.usage}\n`;
  }

  async function writeError(error: FlagError, stderr: Stderr): Promise<void> {
    await stderr.writeText(formatError(error));
  }

  return { parse, formatError, writeError };
}
