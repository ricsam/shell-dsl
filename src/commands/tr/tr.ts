import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";
import { expandEscapes } from "../../utils/expand-escapes.ts";

interface TrFlags {
  delete: boolean;
  squeeze: boolean;
  complement: boolean;
}

const spec = {
  name: "tr",
  flags: [
    { short: "d", long: "delete" },
    { short: "s", long: "squeeze-repeats" },
    { short: "c", long: "complement" },
    { short: "C", long: "complement-values" },
  ] as FlagDefinition[],
  usage: "tr [-cCds] SET1 [SET2]",
};

const defaults: TrFlags = { delete: false, squeeze: false, complement: false };

const handler = (flags: TrFlags, flag: FlagDefinition) => {
  if (flag.short === "d") flags.delete = true;
  if (flag.short === "s") flags.squeeze = true;
  if (flag.short === "c" || flag.short === "C") flags.complement = true;
};

const parser = createFlagParser(spec, defaults, handler);


function expandCharClass(name: string): string {
  switch (name) {
    case "alpha": return expandRange("a-zA-Z");
    case "digit": return "0123456789";
    case "alnum": return expandRange("a-zA-Z") + "0123456789";
    case "lower": return expandRange("a-z");
    case "upper": return expandRange("A-Z");
    case "space": return " \t\n\r\f\v";
    case "blank": return " \t";
    case "print": return expandRange(" -~");
    case "graph": return expandRange("!-~");
    case "punct": return "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    case "cntrl": return Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("") + String.fromCharCode(127);
    case "xdigit": return "0123456789abcdefABCDEF";
    default: return "";
  }
}

function expandRange(s: string): string {
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (i + 2 < s.length && s[i + 1] === "-") {
      const start = s.charCodeAt(i);
      const end = s.charCodeAt(i + 2);
      for (let c = start; c <= end; c++) {
        result += String.fromCharCode(c);
      }
      i += 2;
    } else {
      result += s[i];
    }
  }
  return result;
}

function expandSet(s: string): string {
  // First expand escape sequences
  s = expandEscapes(s);
  // Expand character classes [:name:]
  s = s.replace(/\[:(\w+):\]/g, (_, name) => expandCharClass(name));
  // Expand ranges
  return expandRange(s);
}

export const tr: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  const { delete: deleteMode, squeeze, complement } = result.flags;
  const args = result.args;

  if (args.length < 1) {
    await ctx.stderr.writeText("tr: missing operand\n");
    return 1;
  }

  let set1 = expandSet(args[0]!);
  const set2 = args.length > 1 ? expandSet(args[1]!) : "";

  if (complement) {
    // Build complement: all chars 0-127 not in set1
    const set1Chars = new Set(set1);
    let comp = "";
    for (let i = 0; i < 128; i++) {
      const ch = String.fromCharCode(i);
      if (!set1Chars.has(ch)) comp += ch;
    }
    set1 = comp;
  }

  const input = await ctx.stdin.text();
  let output = "";

  if (deleteMode && squeeze) {
    // -ds: delete chars in SET1, then squeeze chars in SET2
    const deleteSet = new Set(set1);
    const squeezeSet = new Set(set2);
    let lastChar = "";
    for (const ch of input) {
      if (deleteSet.has(ch)) continue;
      if (squeezeSet.has(ch) && ch === lastChar) continue;
      output += ch;
      lastChar = ch;
    }
  } else if (deleteMode) {
    const deleteSet = new Set(set1);
    for (const ch of input) {
      if (!deleteSet.has(ch)) output += ch;
    }
  } else if (squeeze && set2 === "") {
    // -s with only SET1: squeeze chars in SET1
    const squeezeSet = new Set(set1);
    let lastChar = "";
    for (const ch of input) {
      if (squeezeSet.has(ch) && ch === lastChar) continue;
      output += ch;
      lastChar = ch;
    }
  } else {
    // Translation mode (possibly with -s)
    const map = new Map<string, string>();
    for (let i = 0; i < set1.length; i++) {
      const replacement = i < set2.length ? set2[i]! : set2[set2.length - 1] ?? "";
      map.set(set1[i]!, replacement);
    }

    const squeezeSet = squeeze ? new Set(set2) : null;
    let lastChar = "";

    for (const ch of input) {
      const mapped = map.has(ch) ? map.get(ch)! : ch;
      if (squeezeSet && squeezeSet.has(mapped) && mapped === lastChar) continue;
      output += mapped;
      lastChar = mapped;
    }
  }

  await ctx.stdout.writeText(output);
  return 0;
};
