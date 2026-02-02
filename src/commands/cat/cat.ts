import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface CatFlags {
  A: boolean; // show all (equivalent to -vET)
  b: boolean; // number non-blank lines
  E: boolean; // show $ at end of lines
  n: boolean; // number all lines
  T: boolean; // show tabs as ^I
  v: boolean; // show non-printing characters
}

const spec = {
  name: "cat",
  flags: [
    { short: "A", long: "show-all" },
    { short: "b", long: "number-nonblank" },
    { short: "E", long: "show-ends" },
    { short: "n", long: "number" },
    { short: "T", long: "show-tabs" },
    { short: "v", long: "show-nonprinting" },
  ] as FlagDefinition[],
  usage: "cat [-AbEnTv] [file ...]",
};

const defaultFlags: CatFlags = {
  A: false,
  b: false,
  E: false,
  n: false,
  T: false,
  v: false,
};

const parser = createFlagParser(spec, defaultFlags, (flags, flagDef) => {
  if (flagDef.short) {
    flags[flagDef.short as keyof CatFlags] = true;
  }
});

function showNonPrintingChar(charCode: number): string {
  if (charCode === 9) {
    // Tab - handled separately
    return "\t";
  } else if (charCode === 10) {
    // Newline - pass through
    return "\n";
  } else if (charCode < 32) {
    // Control characters 0-31 (except tab/newline)
    return "^" + String.fromCharCode(charCode + 64);
  } else if (charCode === 127) {
    // DEL
    return "^?";
  } else if (charCode >= 128 && charCode < 160) {
    // High control characters (M-^@, M-^A, etc.)
    return "M-^" + String.fromCharCode(charCode - 128 + 64);
  } else if (charCode >= 160 && charCode < 255) {
    // High printable characters (M-<space>, etc.)
    return "M-" + String.fromCharCode(charCode - 128);
  } else if (charCode === 255) {
    // M-^?
    return "M-^?";
  }
  return String.fromCharCode(charCode);
}

function processLine(line: string, flags: CatFlags): string {
  let result = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    const charCode = char.charCodeAt(0);

    if (flags.T && charCode === 9) {
      result += "^I";
    } else if (flags.v && (charCode < 32 || charCode >= 127) && charCode !== 9 && charCode !== 10) {
      result += showNonPrintingChar(charCode);
    } else {
      result += char;
    }
  }

  if (flags.E) {
    result += "$";
  }

  return result;
}

function formatLineNumber(num: number): string {
  return num.toString().padStart(6, " ") + "\t";
}

export const cat: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const files = result.args;
  const flags: CatFlags = { ...result.flags };

  // -A is equivalent to -vET
  if (flags.A) {
    flags.v = true;
    flags.E = true;
    flags.T = true;
  }

  const needsProcessing = flags.n || flags.b || flags.E || flags.T || flags.v;
  let lineNumber = 1;

  const processContent = async (content: Buffer | Uint8Array) => {
    if (!needsProcessing) {
      await ctx.stdout.write(new Uint8Array(content));
      return;
    }

    const text = Buffer.from(content).toString("utf-8");
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isLastLine = i === lines.length - 1;
      const isEmpty = line === "";

      // Skip the final empty element from split (no trailing output)
      if (isLastLine && isEmpty) {
        continue;
      }

      let output = processLine(line, flags);

      // Line numbering
      if (flags.b) {
        // Number non-blank lines only
        if (!isEmpty) {
          output = formatLineNumber(lineNumber++) + output;
        }
      } else if (flags.n) {
        // Number all lines
        output = formatLineNumber(lineNumber++) + output;
      }

      await ctx.stdout.writeText(output + "\n");
    }
  };

  if (files.length === 0) {
    // Read from stdin
    if (!needsProcessing) {
      for await (const chunk of ctx.stdin.stream()) {
        await ctx.stdout.write(chunk);
      }
    } else {
      const content = await ctx.stdin.buffer();
      await processContent(content);
    }
  } else {
    // Read from files
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        await processContent(new Uint8Array(content));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.stderr.writeText(`cat: ${file}: ${message}\n`);
        return 1;
      }
    }
  }
  return 0;
};
