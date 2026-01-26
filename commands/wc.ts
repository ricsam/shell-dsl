import type { Command } from "../src/types.ts";

export const wc: Command = async (ctx) => {
  let showLines = false;
  let showWords = false;
  let showChars = false;
  const files: string[] = [];

  // Parse arguments
  for (const arg of ctx.args) {
    if (arg === "-l") {
      showLines = true;
    } else if (arg === "-w") {
      showWords = true;
    } else if (arg === "-c" || arg === "-m") {
      showChars = true;
    } else if (arg.startsWith("-")) {
      // Handle combined flags
      for (const flag of arg.slice(1)) {
        if (flag === "l") showLines = true;
        else if (flag === "w") showWords = true;
        else if (flag === "c" || flag === "m") showChars = true;
      }
    } else {
      files.push(arg);
    }
  }

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
