import type { Command } from "../../types.ts";

export const test: Command = async (ctx) => {
  const args = [...ctx.args];

  // Handle [ ... ] syntax - remove trailing ]
  if (args[args.length - 1] === "]") {
    args.pop();
  }

  if (args.length === 0) {
    return 1; // Empty test is false
  }

  // Single argument: true if non-empty string
  if (args.length === 1) {
    return args[0]!.length > 0 ? 0 : 1;
  }

  // Two arguments: unary operators
  if (args.length === 2) {
    const [op, operand] = args;

    switch (op) {
      case "-n": // Non-zero length
        return operand!.length > 0 ? 0 : 1;
      case "-z": // Zero length
        return operand!.length === 0 ? 0 : 1;
      case "-f": // Is regular file
        try {
          const path = ctx.fs.resolve(ctx.cwd, operand!);
          const stat = await ctx.fs.stat(path);
          return stat.isFile() ? 0 : 1;
        } catch {
          return 1;
        }
      case "-d": // Is directory
        try {
          const path = ctx.fs.resolve(ctx.cwd, operand!);
          const stat = await ctx.fs.stat(path);
          return stat.isDirectory() ? 0 : 1;
        } catch {
          return 1;
        }
      case "-e": // Exists
        try {
          const path = ctx.fs.resolve(ctx.cwd, operand!);
          return (await ctx.fs.exists(path)) ? 0 : 1;
        } catch {
          return 1;
        }
      case "-s": // Has size > 0
        try {
          const path = ctx.fs.resolve(ctx.cwd, operand!);
          const stat = await ctx.fs.stat(path);
          return stat.size > 0 ? 0 : 1;
        } catch {
          return 1;
        }
      case "-r": // Readable (always true in virtual fs)
      case "-w": // Writable (always true in virtual fs)
      case "-x": // Executable (always true in virtual fs)
        try {
          const path = ctx.fs.resolve(ctx.cwd, operand!);
          return (await ctx.fs.exists(path)) ? 0 : 1;
        } catch {
          return 1;
        }
      case "!": // Negation
        return operand!.length > 0 ? 1 : 0;
      default:
        await ctx.stderr.writeText(`test: unknown operator: ${op}\n`);
        return 2;
    }
  }

  // Three arguments: binary operators
  if (args.length === 3) {
    const [left, op, right] = args;

    // Handle negation with two-arg expression
    if (left === "!") {
      const innerResult = await test({
        ...ctx,
        args: [op!, right!],
      });
      return innerResult === 0 ? 1 : 0;
    }

    switch (op) {
      case "=":
      case "==":
        return left === right ? 0 : 1;
      case "!=":
        return left !== right ? 0 : 1;
      case "-eq":
        return parseInt(left!, 10) === parseInt(right!, 10) ? 0 : 1;
      case "-ne":
        return parseInt(left!, 10) !== parseInt(right!, 10) ? 0 : 1;
      case "-lt":
        return parseInt(left!, 10) < parseInt(right!, 10) ? 0 : 1;
      case "-le":
        return parseInt(left!, 10) <= parseInt(right!, 10) ? 0 : 1;
      case "-gt":
        return parseInt(left!, 10) > parseInt(right!, 10) ? 0 : 1;
      case "-ge":
        return parseInt(left!, 10) >= parseInt(right!, 10) ? 0 : 1;
      default:
        await ctx.stderr.writeText(`test: unknown operator: ${op}\n`);
        return 2;
    }
  }

  // Four arguments: handle negation with three-arg expression
  if (args.length === 4 && args[0] === "!") {
    const innerResult = await test({
      ...ctx,
      args: args.slice(1),
    });
    return innerResult === 0 ? 1 : 0;
  }

  await ctx.stderr.writeText("test: too many arguments\n");
  return 2;
};

// Alias for [ command
export const bracket: Command = test;
