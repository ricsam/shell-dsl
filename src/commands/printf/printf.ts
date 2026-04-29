import type { Command } from "../../types.ts";

interface EscapeResult {
  text: string;
  nextIndex: number;
  stop: boolean;
}

interface FormatResult {
  output: string;
  error?: string;
}

interface ConversionSpec {
  flags: string;
  width?: number;
  precision?: number;
  specifier: string;
}

interface RenderPassResult {
  output: string;
  nextArgIndex: number;
  consumedArgs: number;
  stop: boolean;
  error?: string;
}

const INTEGER_SPECIFIERS = new Set(["d", "i", "u", "o", "x", "X"]);
const FLOAT_SPECIFIERS = new Set(["f", "F", "e", "E", "g", "G"]);
const STRING_SPECIFIERS = new Set(["s", "b", "c"]);
const LENGTH_MODIFIERS = new Set(["h", "l", "L", "j", "z", "t"]);

function isOctalDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "7";
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function readEscape(input: string, index: number): EscapeResult {
  if (index + 1 >= input.length) {
    return { text: "\\", nextIndex: index + 1, stop: false };
  }

  const char = input[index + 1]!;

  if (char === "c") {
    return { text: "", nextIndex: index + 2, stop: true };
  }

  if (isOctalDigit(char)) {
    let digits = "";
    let nextIndex = index + 1;

    if (input[nextIndex] === "0") {
      nextIndex++;
    }

    while (digits.length < 3 && isOctalDigit(input[nextIndex])) {
      digits += input[nextIndex]!;
      nextIndex++;
    }

    const codePoint = digits === "" ? 0 : Number.parseInt(digits, 8);
    return { text: String.fromCharCode(codePoint), nextIndex, stop: false };
  }

  if (char === "x") {
    let digits = "";
    let nextIndex = index + 2;

    while (digits.length < 2 && nextIndex < input.length && /[0-9a-fA-F]/.test(input[nextIndex]!)) {
      digits += input[nextIndex]!;
      nextIndex++;
    }

    if (digits.length > 0) {
      return { text: String.fromCharCode(Number.parseInt(digits, 16)), nextIndex, stop: false };
    }
  }

  switch (char) {
    case "a":
      return { text: "\x07", nextIndex: index + 2, stop: false };
    case "b":
      return { text: "\b", nextIndex: index + 2, stop: false };
    case "f":
      return { text: "\f", nextIndex: index + 2, stop: false };
    case "n":
      return { text: "\n", nextIndex: index + 2, stop: false };
    case "r":
      return { text: "\r", nextIndex: index + 2, stop: false };
    case "t":
      return { text: "\t", nextIndex: index + 2, stop: false };
    case "v":
      return { text: "\v", nextIndex: index + 2, stop: false };
    case "\\":
      return { text: "\\", nextIndex: index + 2, stop: false };
    default:
      return { text: `\\${char}`, nextIndex: index + 2, stop: false };
  }
}

function expandPrintfEscapes(input: string): { text: string; stop: boolean } {
  let text = "";

  for (let i = 0; i < input.length;) {
    if (input[i] !== "\\") {
      text += input[i]!;
      i++;
      continue;
    }

    const escape = readEscape(input, i);
    text += escape.text;
    i = escape.nextIndex;

    if (escape.stop) {
      return { text, stop: true };
    }
  }

  return { text, stop: false };
}

function readNumber(input: string, index: number): { value?: number; nextIndex: number } {
  let digits = "";
  let nextIndex = index;

  while (isDigit(input[nextIndex])) {
    digits += input[nextIndex]!;
    nextIndex++;
  }

  return {
    value: digits === "" ? undefined : Number.parseInt(digits, 10),
    nextIndex,
  };
}

function parseConversion(format: string, index: number): { spec?: ConversionSpec; nextIndex: number; error?: string } {
  let nextIndex = index + 1;
  let flags = "";

  while (true) {
    const flag = format[nextIndex];
    if (flag === undefined || !"-+ #0".includes(flag)) {
      break;
    }
    flags += flag;
    nextIndex++;
  }

  const widthResult = readNumber(format, nextIndex);
  const width = widthResult.value;
  nextIndex = widthResult.nextIndex;

  let precision: number | undefined;
  if (format[nextIndex] === ".") {
    const precisionResult = readNumber(format, nextIndex + 1);
    precision = precisionResult.value ?? 0;
    nextIndex = precisionResult.nextIndex;
  }

  if (LENGTH_MODIFIERS.has(format[nextIndex] ?? "")) {
    const modifier = format[nextIndex]!;
    nextIndex++;
    if ((modifier === "h" && format[nextIndex] === "h") || (modifier === "l" && format[nextIndex] === "l")) {
      nextIndex++;
    }
  }

  const specifier = format[nextIndex];
  if (specifier === undefined) {
    return { nextIndex, error: "missing format character" };
  }

  if (
    !INTEGER_SPECIFIERS.has(specifier) &&
    !FLOAT_SPECIFIERS.has(specifier) &&
    !STRING_SPECIFIERS.has(specifier)
  ) {
    return { nextIndex: nextIndex + 1, error: `invalid format character '${specifier}'` };
  }

  return {
    spec: { flags, width, precision, specifier },
    nextIndex: nextIndex + 1,
  };
}

function pad(value: string, spec: ConversionSpec, numeric = false): string {
  const width = spec.width ?? 0;
  if (value.length >= width) {
    return value;
  }

  const leftAlign = spec.flags.includes("-");
  const useZeroPad = numeric && spec.flags.includes("0") && !leftAlign && spec.precision === undefined;
  const padChar = useZeroPad ? "0" : " ";
  const padding = padChar.repeat(width - value.length);

  if (leftAlign) {
    return value + padding;
  }

  if (useZeroPad && (value.startsWith("-") || value.startsWith("+") || value.startsWith(" "))) {
    return value[0]! + padding + value.slice(1);
  }

  if (useZeroPad && (value.startsWith("0x") || value.startsWith("0X"))) {
    return value.slice(0, 2) + padding + value.slice(2);
  }

  return padding + value;
}

function integerFromArg(arg: string): number {
  const trimmed = arg.trim();
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(trimmed)) {
    const sign = trimmed.startsWith("-") ? -1 : 1;
    return sign * Number.parseInt(trimmed.replace(/^[+-]?0[xX]/, ""), 16);
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function floatFromArg(arg: string): number {
  const parsed = Number.parseFloat(arg.trim());
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatInteger(arg: string, spec: ConversionSpec): string {
  const originalValue = Math.trunc(integerFromArg(arg));
  const unsignedValue = originalValue < 0 ? originalValue >>> 0 : originalValue;
  let value = spec.specifier === "u" || spec.specifier === "o" || spec.specifier === "x" || spec.specifier === "X"
    ? unsignedValue
    : originalValue;

  let sign = "";
  if ((spec.specifier === "d" || spec.specifier === "i") && value < 0) {
    sign = "-";
    value = Math.abs(value);
  } else if ((spec.specifier === "d" || spec.specifier === "i") && spec.flags.includes("+")) {
    sign = "+";
  } else if ((spec.specifier === "d" || spec.specifier === "i") && spec.flags.includes(" ")) {
    sign = " ";
  }

  let digits: string;
  if (spec.specifier === "o") {
    digits = value.toString(8);
  } else if (spec.specifier === "x" || spec.specifier === "X") {
    digits = value.toString(16);
    if (spec.specifier === "X") {
      digits = digits.toUpperCase();
    }
  } else {
    digits = value.toString(10);
  }

  if (spec.precision !== undefined) {
    if (spec.precision === 0 && value === 0) {
      digits = "";
    } else {
      digits = digits.padStart(spec.precision, "0");
    }
  }

  let prefix = "";
  if (spec.flags.includes("#")) {
    if (spec.specifier === "o" && !digits.startsWith("0")) {
      prefix = "0";
    } else if (spec.specifier === "x" && value !== 0) {
      prefix = "0x";
    } else if (spec.specifier === "X" && value !== 0) {
      prefix = "0X";
    }
  }

  return pad(sign + prefix + digits, spec, true);
}

function formatFloat(arg: string, spec: ConversionSpec): string {
  const value = floatFromArg(arg);
  const precision = spec.precision ?? 6;
  let formatted: string;

  switch (spec.specifier) {
    case "e":
    case "E":
      formatted = value.toExponential(precision);
      break;
    case "g":
    case "G":
      formatted = value.toPrecision(precision === 0 ? 1 : precision);
      break;
    default:
      formatted = value.toFixed(precision);
      break;
  }

  if (spec.specifier === "E" || spec.specifier === "G" || spec.specifier === "F") {
    formatted = formatted.toUpperCase();
  }

  if (value >= 0 && spec.flags.includes("+")) {
    formatted = `+${formatted}`;
  } else if (value >= 0 && spec.flags.includes(" ")) {
    formatted = ` ${formatted}`;
  }

  return pad(formatted, spec, true);
}

function formatString(value: string, spec: ConversionSpec): string {
  const truncated = spec.precision === undefined ? value : value.slice(0, spec.precision);
  return pad(truncated, spec);
}

function renderConversion(
  spec: ConversionSpec,
  args: string[],
  argIndex: number
): { output: string; nextArgIndex: number; consumedArg: boolean; stop: boolean } {
  const hasArg = argIndex < args.length;
  const arg = hasArg ? args[argIndex]! : "";
  const nextArgIndex = hasArg ? argIndex + 1 : argIndex;

  if (spec.specifier === "s") {
    return {
      output: formatString(arg, spec),
      nextArgIndex,
      consumedArg: hasArg,
      stop: false,
    };
  }

  if (spec.specifier === "b") {
    const expanded = expandPrintfEscapes(arg);
    return {
      output: formatString(expanded.text, spec),
      nextArgIndex,
      consumedArg: hasArg,
      stop: expanded.stop,
    };
  }

  if (spec.specifier === "c") {
    return {
      output: formatString(arg.slice(0, 1), spec),
      nextArgIndex,
      consumedArg: hasArg,
      stop: false,
    };
  }

  if (INTEGER_SPECIFIERS.has(spec.specifier)) {
    return {
      output: formatInteger(hasArg ? arg : "0", spec),
      nextArgIndex,
      consumedArg: hasArg,
      stop: false,
    };
  }

  return {
    output: formatFloat(hasArg ? arg : "0", spec),
    nextArgIndex,
    consumedArg: hasArg,
    stop: false,
  };
}

function renderPass(format: string, args: string[], startArgIndex: number): RenderPassResult {
  let output = "";
  let argIndex = startArgIndex;
  let consumedArgs = 0;

  for (let i = 0; i < format.length;) {
    const char = format[i]!;

    if (char === "\\") {
      const escape = readEscape(format, i);
      output += escape.text;
      i = escape.nextIndex;

      if (escape.stop) {
        return { output, nextArgIndex: argIndex, consumedArgs, stop: true };
      }
      continue;
    }

    if (char !== "%") {
      output += char;
      i++;
      continue;
    }

    if (format[i + 1] === "%") {
      output += "%";
      i += 2;
      continue;
    }

    const parsed = parseConversion(format, i);
    if (parsed.error || !parsed.spec) {
      return {
        output,
        nextArgIndex: argIndex,
        consumedArgs,
        stop: false,
        error: parsed.error ?? "invalid format",
      };
    }

    const rendered = renderConversion(parsed.spec, args, argIndex);
    output += rendered.output;
    argIndex = rendered.nextArgIndex;
    if (rendered.consumedArg) {
      consumedArgs++;
    }
    i = parsed.nextIndex;

    if (rendered.stop) {
      return { output, nextArgIndex: argIndex, consumedArgs, stop: true };
    }
  }

  return { output, nextArgIndex: argIndex, consumedArgs, stop: false };
}

function formatPrintf(format: string, args: string[]): FormatResult {
  let output = "";
  let argIndex = 0;
  let renderedAtLeastOnce = false;

  while (!renderedAtLeastOnce || argIndex < args.length) {
    const pass = renderPass(format, args, argIndex);
    renderedAtLeastOnce = true;
    output += pass.output;
    argIndex = pass.nextArgIndex;

    if (pass.error) {
      return { output, error: pass.error };
    }

    if (pass.stop) {
      return { output };
    }

    if (pass.consumedArgs === 0) {
      break;
    }
  }

  return { output };
}

export const printf: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    await ctx.stderr.writeText("printf: missing format operand\n");
    return 1;
  }

  const [format, ...args] = ctx.args;
  const result = formatPrintf(format!, args);

  if (result.output.length > 0) {
    await ctx.stdout.writeText(result.output);
  }

  if (result.error) {
    await ctx.stderr.writeText(`printf: ${result.error}\n`);
    return 1;
  }

  return 0;
};
