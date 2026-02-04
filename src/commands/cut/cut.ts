import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface CutFlags {
  bytes: string | null;
  characters: string | null;
  delimiter: string;
  fields: string | null;
  onlyDelimited: boolean;
  complement: boolean;
  outputDelimiter: string | null;
}

const spec = {
  name: "cut",
  flags: [
    { short: "b", long: "bytes", takesValue: true },
    { short: "c", long: "characters", takesValue: true },
    { short: "d", long: "delimiter", takesValue: true },
    { short: "f", long: "fields", takesValue: true },
    { short: "s", long: "only-delimited" },
    { long: "complement" },
    { long: "output-delimiter", takesValue: true },
  ] as FlagDefinition[],
  usage: "cut -b list [-n] [file ...]\n       cut -c list [file ...]\n       cut -f list [-d delim] [-s] [file ...]",
};

const defaults: CutFlags = {
  bytes: null,
  characters: null,
  delimiter: "\t",
  fields: null,
  onlyDelimited: false,
  complement: false,
  outputDelimiter: null,
};

const handler = (flags: CutFlags, flag: FlagDefinition, value?: string) => {
  if (flag.short === "b") flags.bytes = value ?? null;
  if (flag.short === "c") flags.characters = value ?? null;
  if (flag.short === "d") flags.delimiter = value ?? "\t";
  if (flag.short === "f") flags.fields = value ?? null;
  if (flag.short === "s") flags.onlyDelimited = true;
  if (flag.long === "complement") flags.complement = true;
  if (flag.long === "output-delimiter") flags.outputDelimiter = value ?? null;
};

const parser = createFlagParser(spec, defaults, handler);

/**
 * Parse a list specification like "1", "1,3,5", "1-3", "1-", "-3", "1-3,7,9-"
 * Returns a function that checks if a 1-based index is selected.
 */
function parseListSpec(
  listStr: string
): (index: number, total: number) => boolean {
  const ranges: Array<{ start: number | null; end: number | null }> = [];

  for (const part of listStr.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-", 2);
      const start = startStr === "" ? null : parseInt(startStr!, 10);
      const end = endStr === "" ? null : parseInt(endStr!, 10);
      ranges.push({ start, end });
    } else {
      const n = parseInt(trimmed, 10);
      ranges.push({ start: n, end: n });
    }
  }

  return (index: number, total: number): boolean => {
    for (const { start, end } of ranges) {
      const s = start ?? 1;
      const e = end ?? total;
      if (index >= s && index <= e) return true;
    }
    return false;
  };
}

export const cut: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { bytes, characters, fields, delimiter, onlyDelimited, complement, outputDelimiter } =
    result.flags;

  // Validate: exactly one of -b, -c, -f must be given
  const modeCount = [bytes, characters, fields].filter((v) => v !== null).length;
  if (modeCount === 0) {
    await ctx.stderr.writeText(
      "cut: you must specify a list of bytes, characters, or fields\n"
    );
    return 1;
  }
  if (modeCount > 1) {
    await ctx.stderr.writeText(
      "cut: only one type of list may be specified\n"
    );
    return 1;
  }

  const listStr = (bytes ?? characters ?? fields)!;
  const selector = parseListSpec(listStr);
  const mode = bytes !== null ? "bytes" : characters !== null ? "chars" : "fields";

  const processLine = async (line: string) => {
    if (mode === "fields") {
      // Check if delimiter exists in line
      if (!line.includes(delimiter)) {
        if (onlyDelimited) return;
        await ctx.stdout.writeText(line + "\n");
        return;
      }

      const parts = line.split(delimiter);
      const total = parts.length;
      const selected: string[] = [];

      for (let i = 0; i < total; i++) {
        const idx = i + 1; // 1-based
        const isSelected = selector(idx, total);
        if (complement ? !isSelected : isSelected) {
          selected.push(parts[i]!);
        }
      }

      const outDelim = outputDelimiter ?? delimiter;
      await ctx.stdout.writeText(selected.join(outDelim) + "\n");
    } else {
      // bytes/chars mode (equivalent for simplicity)
      const chars = [...line];
      const total = chars.length;
      const selected: string[] = [];

      for (let i = 0; i < total; i++) {
        const idx = i + 1; // 1-based
        const isSelected = selector(idx, total);
        if (complement ? !isSelected : isSelected) {
          selected.push(chars[i]!);
        }
      }

      const outDelim = outputDelimiter ?? "";
      await ctx.stdout.writeText(selected.join(outDelim) + "\n");
    }
  };

  const files = result.args;

  if (files.length === 0) {
    // Read from stdin
    for await (const line of ctx.stdin.lines()) {
      await processLine(line);
    }
  } else {
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = (await ctx.fs.readFile(path)).toString();
        const lines = content.split("\n");
        // Remove trailing empty line from final newline
        if (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop();
        }
        for (const line of lines) {
          await processLine(line);
        }
      } catch {
        await ctx.stderr.writeText(`cut: ${file}: No such file or directory\n`);
        return 1;
      }
    }
  }

  return 0;
};
