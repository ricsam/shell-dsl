import type { Command } from "../../types.ts";
import { createFlagParser, type FlagDefinition } from "../../utils/flag-parser.ts";

interface WcFlags {
  lines: boolean;
  words: boolean;
  chars: boolean;
}

const spec = {
  name: "wc",
  flags: [
    { short: "l", long: "lines" },
    { short: "w", long: "words" },
    { short: "c", long: "bytes" },
    { short: "m", long: "chars" },
  ] as FlagDefinition[],
  usage: "wc [-lwcm] [file ...]",
};

const defaults: WcFlags = { lines: false, words: false, chars: false };

const handler = (flags: WcFlags, flag: FlagDefinition) => {
  if (flag.short === "l") flags.lines = true;
  if (flag.short === "w") flags.words = true;
  if (flag.short === "c" || flag.short === "m") flags.chars = true;
};

const parser = createFlagParser(spec, defaults, handler);

export const wc: Command = async (ctx) => {
  const result = parser.parse(ctx.args);

  if (result.error) {
    await parser.writeError(result.error, ctx.stderr);
    return 1;
  }

  let { lines: showLines, words: showWords, chars: showChars } = result.flags;
  const files = result.args;

  // Default: show all
  if (!showLines && !showWords && !showChars) {
    showLines = true;
    showWords = true;
    showChars = true;
  }

  const countContent = (content: string) => {
    const lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    const chars = content.length;
    return { lines, words, chars };
  };

  const formatOutput = (counts: { lines: number; words: number; chars: number }, filename?: string) => {
    const parts: string[] = [];
    if (showLines) parts.push(String(counts.lines).padStart(8));
    if (showWords) parts.push(String(counts.words).padStart(8));
    if (showChars) parts.push(String(counts.chars).padStart(8));
    if (filename) parts.push(" " + filename);
    return parts.join("") + "\n";
  };

  if (files.length === 0) {
    // Read from stdin
    const content = await ctx.stdin.text();
    const counts = countContent(content);
    await ctx.stdout.writeText(formatOutput(counts));
  } else {
    let totalLines = 0;
    let totalWords = 0;
    let totalChars = 0;

    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = (await ctx.fs.readFile(path)).toString();
        const counts = countContent(content);
        totalLines += counts.lines;
        totalWords += counts.words;
        totalChars += counts.chars;
        await ctx.stdout.writeText(formatOutput(counts, file));
      } catch (err) {
        await ctx.stderr.writeText(`wc: ${file}: No such file or directory\n`);
        return 1;
      }
    }

    if (files.length > 1) {
      await ctx.stdout.writeText(
        formatOutput({ lines: totalLines, words: totalWords, chars: totalChars }, "total")
      );
    }
  }

  return 0;
};
