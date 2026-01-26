import type { Command } from "../src/types.ts";

export const grep: Command = async (ctx) => {
  let pattern: string | undefined;
  let files: string[] = [];
  let invert = false;
  let ignoreCase = false;
  let showLineNumbers = false;
  let countOnly = false;

  // Parse arguments
  let i = 0;
  while (i < ctx.args.length) {
    const arg = ctx.args[i]!;
    if (arg === "-v") {
      invert = true;
    } else if (arg === "-i") {
      ignoreCase = true;
    } else if (arg === "-n") {
      showLineNumbers = true;
    } else if (arg === "-c") {
      countOnly = true;
    } else if (arg.startsWith("-")) {
      // Handle combined flags like -iv
      for (const flag of arg.slice(1)) {
        if (flag === "v") invert = true;
        else if (flag === "i") ignoreCase = true;
        else if (flag === "n") showLineNumbers = true;
        else if (flag === "c") countOnly = true;
      }
    } else if (!pattern) {
      pattern = arg;
    } else {
      files.push(arg);
    }
    i++;
  }

  if (!pattern) {
    await ctx.stderr.writeText("grep: missing pattern\n");
    return 1;
  }

  const flags = ignoreCase ? "i" : "";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    await ctx.stderr.writeText(`grep: invalid pattern: ${pattern}\n`);
    return 1;
  }

  let found = false;
  let matchCount = 0;
  const showFilenames = files.length > 1;

  const processLine = async (line: string, lineNum: number, filename?: string) => {
    const matches = regex.test(line);
    const shouldOutput = invert ? !matches : matches;

    if (shouldOutput) {
      found = true;
      matchCount++;

      if (!countOnly) {
        let output = "";
        if (filename && showFilenames) {
          output += filename + ":";
        }
        if (showLineNumbers) {
          output += lineNum + ":";
        }
        output += line + "\n";
        await ctx.stdout.writeText(output);
      }
    }
  };

  if (files.length === 0) {
    // Read from stdin
    let lineNum = 1;
    for await (const line of ctx.stdin.lines()) {
      await processLine(line, lineNum++);
    }
  } else {
    // Read from files
    for (const file of files) {
      try {
        const path = ctx.fs.resolve(ctx.cwd, file);
        const content = await ctx.fs.readFile(path);
        const lines = content.toString().split("\n");

        // Remove trailing empty line if file ends with newline
        if (lines[lines.length - 1] === "") {
          lines.pop();
        }

        let lineNum = 1;
        for (const line of lines) {
          await processLine(line, lineNum++, file);
        }
      } catch (err) {
        await ctx.stderr.writeText(`grep: ${file}: No such file or directory\n`);
        return 1;
      }
    }
  }

  if (countOnly) {
    await ctx.stdout.writeText(matchCount + "\n");
  }

  return found ? 0 : 1;
};
