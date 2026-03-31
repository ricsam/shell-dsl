import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

type AddressRadix = "o" | "d" | "x" | "n";
type OutputFormat = "x1" | "x2" | "o1" | "o2" | "c";

interface OdFlags {
  addressRadix: string;
  format: OutputFormat | null;
  formatConflict: string | null;
  invalidType: string | null;
  verbose: boolean;
  skip: string | null;
  count: string | null;
}

const ADDRESS_WIDTH = 7;
const ADDRESS_SEPARATOR = "    ";
const NO_ADDRESS_PREFIX = " ".repeat(ADDRESS_WIDTH + ADDRESS_SEPARATOR.length);
const LINE_BYTES = 16;

const spec = {
  name: "od",
  flags: [
    { short: "A", takesValue: true },
    { short: "b" },
    { short: "c" },
    { short: "j", takesValue: true },
    { short: "N", takesValue: true },
    { short: "o" },
    { short: "t", takesValue: true },
    { short: "v" },
    { short: "x" },
  ] as FlagDefinition[],
  usage: "od [-bcovx] [-A radix] [-j skip] [-N count] [-t type] [file ...]",
};

const defaults: OdFlags = {
  addressRadix: "o",
  format: null,
  formatConflict: null,
  invalidType: null,
  verbose: false,
  skip: null,
  count: null,
};

function selectFormat(flags: OdFlags, format: OutputFormat, source: string): void {
  if (flags.format === null) {
    flags.format = format;
    return;
  }

  flags.formatConflict = source;
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === "x1" || value === "x2" || value === "o1" || value === "o2" || value === "c";
}

const parser = createFlagParser(spec, defaults, (flags, flag, value) => {
  switch (flag.short) {
    case "A":
      flags.addressRadix = value ?? "o";
      break;
    case "b":
      selectFormat(flags, "o1", "-b");
      break;
    case "c":
      selectFormat(flags, "c", "-c");
      break;
    case "j":
      flags.skip = value ?? null;
      break;
    case "N":
      flags.count = value ?? null;
      break;
    case "o":
      selectFormat(flags, "o2", "-o");
      break;
    case "t":
      if (value && isOutputFormat(value)) {
        selectFormat(flags, value, "-t");
      } else if (value) {
        flags.invalidType = value;
      }
      break;
    case "v":
      flags.verbose = true;
      break;
    case "x":
      selectFormat(flags, "x2", "-x");
      break;
  }
});

function isAddressRadix(value: string): value is AddressRadix {
  return value === "o" || value === "d" || value === "x" || value === "n";
}

function parseNonNegativeInteger(value: string, label: "skip" | "count"): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

function formatAddress(offset: number, radix: Exclude<AddressRadix, "n">): string {
  const base = radix === "o" ? 8 : radix === "d" ? 10 : 16;
  return offset.toString(base).padStart(ADDRESS_WIDTH, "0");
}

function formatCharacter(byte: number): string {
  let token: string;

  if (byte === 0) {
    token = "\\0";
  } else if (byte === 9) {
    token = "\\t";
  } else if (byte === 10) {
    token = "\\n";
  } else if (byte >= 32 && byte <= 126) {
    token = String.fromCharCode(byte);
  } else {
    token = `\\${byte.toString(8).padStart(3, "0")}`;
  }

  return token.length < 3 ? token.padStart(3, " ") : token;
}

function formatWord(bytes: Uint8Array, index: number, radix: "hex" | "octal"): string {
  const low = bytes[index] ?? 0;
  const high = bytes[index + 1] ?? 0;
  const value = low | (high << 8);
  const base = radix === "hex" ? 16 : 8;
  const width = radix === "hex" ? 4 : 6;
  return value.toString(base).padStart(width, "0");
}

function formatRow(bytes: Uint8Array, format: OutputFormat): string {
  const values: string[] = [];

  if (format === "x1") {
    for (const byte of bytes) {
      values.push(byte.toString(16).padStart(2, "0"));
    }
  } else if (format === "o1") {
    for (const byte of bytes) {
      values.push(byte.toString(8).padStart(3, "0"));
    }
  } else if (format === "c") {
    for (const byte of bytes) {
      values.push(formatCharacter(byte));
    }
  } else if (format === "x2") {
    for (let i = 0; i < bytes.length; i += 2) {
      values.push(formatWord(bytes, i, "hex"));
    }
  } else {
    for (let i = 0; i < bytes.length; i += 2) {
      values.push(formatWord(bytes, i, "octal"));
    }
  }

  return values.join("  ");
}

async function readInput(ctx: Parameters<Command>[0], files: string[]): Promise<Buffer | null> {
  if (files.length === 0) {
    return await ctx.stdin.buffer();
  }

  const chunks: Buffer[] = [];

  for (const file of files) {
    try {
      const path = ctx.fs.resolve(ctx.cwd, file);
      chunks.push(await ctx.fs.readFile(path));
    } catch {
      await ctx.stderr.writeText(`od: ${file}: No such file or directory\n`);
      return null;
    }
  }

  return Buffer.concat(chunks);
}

export const od: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { addressRadix, formatConflict, invalidType, skip, count, verbose } = result.flags;

  if (!isAddressRadix(addressRadix)) {
    await ctx.stderr.writeText(`od: invalid address radix '${addressRadix}'\n`);
    return 1;
  }

  if (invalidType !== null) {
    await ctx.stderr.writeText(`od: invalid type string '${invalidType}'\n`);
    return 1;
  }

  if (formatConflict !== null) {
    await ctx.stderr.writeText("od: multiple output formats are not supported\n");
    return 1;
  }

  const skipBytes = skip === null ? 0 : parseNonNegativeInteger(skip, "skip");
  if (skipBytes === null) {
    await ctx.stderr.writeText(`od: invalid skip '${skip}'\n`);
    return 1;
  }

  const countBytes = count === null ? null : parseNonNegativeInteger(count, "count");
  if (count !== null && countBytes === null) {
    await ctx.stderr.writeText(`od: invalid byte count '${count}'\n`);
    return 1;
  }

  const input = await readInput(ctx, result.args);
  if (input === null) {
    return 1;
  }

  const start = Math.min(skipBytes, input.length);
  const sliced = countBytes === null
    ? input.subarray(start)
    : input.subarray(start, Math.min(start + countBytes, input.length));

  if (sliced.length === 0) {
    return 0;
  }

  const format = result.flags.format ?? "o2";

  let previousRow: string | null = null;
  let emittedSqueezeMarker = false;
  let offset = start;

  for (let i = 0; i < sliced.length; i += LINE_BYTES) {
    const rowBytes = sliced.subarray(i, Math.min(i + LINE_BYTES, sliced.length));
    const row = formatRow(rowBytes, format);

    if (!verbose && row === previousRow) {
      if (!emittedSqueezeMarker) {
        await ctx.stdout.writeText("*\n");
        emittedSqueezeMarker = true;
      }
      offset += rowBytes.length;
      continue;
    }

    previousRow = row;
    emittedSqueezeMarker = false;

    const prefix = addressRadix === "n"
      ? NO_ADDRESS_PREFIX
      : `${formatAddress(offset, addressRadix)}${ADDRESS_SEPARATOR}`;

    await ctx.stdout.writeText(`${prefix}${row}\n`);
    offset += rowBytes.length;
  }

  if (addressRadix !== "n") {
    await ctx.stdout.writeText(`${formatAddress(offset, addressRadix)}\n`);
  }

  return 0;
};
