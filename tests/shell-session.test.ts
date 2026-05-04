import { describe, expect, test } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import {
  createShellDSL,
  createShellSession,
  createVirtualFS,
  type Command,
  type CommandCompleter,
  type VirtualFS,
} from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

function createFs(files: Record<string, string> = {}): VirtualFS {
  const vol = new Volume();
  vol.fromJSON(files);
  return createVirtualFS(createFsFromVolume(vol));
}

describe("ShellSession", () => {
  test("streams stdout and stderr before final exit", async () => {
    const slow: Command = async (ctx) => {
      await ctx.stdout.writeText("first\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await ctx.stderr.writeText("warn\n");
      return 0;
    };
    const session = createShellSession({
      fs: createFs(),
      cwd: "/",
      env: {},
      commands: { ...builtinCommands, slow },
    });

    const execution = session.run("slow");
    const stdout = execution.stdout[Symbol.asyncIterator]();
    const first = await stdout.next();

    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!).toString("utf-8")).toBe("first\n");

    const result = await execution.exit;
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString("utf-8")).toBe("warn\n");
  });

  test("keeps existing buffered ShellDSL behavior", async () => {
    const sh = createShellDSL({
      fs: createFs(),
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });

    await expect(sh`echo ok`.text()).resolves.toBe("ok\n");
  });

  test("persists cwd, env, and last exit code across runs", async () => {
    const session = createShellSession({
      fs: createFs({ "/work/.keep": "" }),
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });

    await session.run("cd /work").exit;
    await session.run("NAME=alice").exit;
    await session.run("false").exit;
    const result = await session.run('echo "$NAME:$?"; pwd').exit;

    expect(result.stdout.toString("utf-8")).toBe("alice:1\n/work\n");
    expect(session.getCwd()).toBe("/work");
    expect(session.getEnv().NAME).toBe("alice");
    expect(session.getLastExitCode()).toBe(0);
  });

  test("passes terminal info while pipes force stdout non-tty", async () => {
    const ttyinfo: Command = async (ctx) => {
      await ctx.stdout.writeText(`${ctx.stdout.isTTY}:${ctx.terminal.columns ?? 0}\n`);
      return 0;
    };
    const session = createShellSession({
      fs: createFs(),
      cwd: "/",
      env: {},
      commands: { ...builtinCommands, ttyinfo },
      terminal: { isTTY: true, columns: 120, rows: 40 },
    });

    const direct = await session.run("ttyinfo").exit;
    const piped = await session.run("ttyinfo | cat").exit;

    expect(direct.stdout.toString("utf-8")).toBe("true:120\n");
    expect(piped.stdout.toString("utf-8")).toBe("false:120\n");
  });

  test("kill aborts commands that observe the signal", async () => {
    const wait: Command = async (ctx) => {
      if (ctx.signal.aborted) {
        return 130;
      }
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return 130;
    };
    const session = createShellSession({
      fs: createFs(),
      cwd: "/",
      env: {},
      commands: { wait },
    });

    const execution = session.run("wait");
    execution.kill();

    const result = await execution.exit;
    expect(result.exitCode).toBe(130);
  });

  test("fallback command receives shell context and can return an exit code", async () => {
    const session = createShellSession({
      fs: createFs(),
      cwd: "/",
      env: { HELLO: "world" },
      commands: {},
      externalCommand: async (ctx) => {
        await ctx.stdout.writeText(`${ctx.name}:${ctx.args.join(",")}:${ctx.cwd}:${ctx.env.HELLO}\n`);
        return 42;
      },
    });

    const result = await session.run("missing one two").exit;

    expect(result.exitCode).toBe(42);
    expect(result.stdout.toString("utf-8")).toBe("missing:one,two:/:world\n");
  });

  test("completes command names, paths, and custom command arguments", async () => {
    const custom: Command = async () => 0;
    let seenArgs: string[] = [];
    const customCompleter: CommandCompleter = (ctx) => {
      seenArgs = ctx.args;
      return {
        replacement: ctx.word,
        matches: ["--json ", "--verbose ", "status "].filter((match) => match.startsWith(ctx.word)),
      };
    };
    const session = createShellSession({
      fs: createFs({ "/README.txt": "", "/src/.keep": "" }),
      cwd: "/",
      env: {},
      commands: { ...builtinCommands, custom },
      completions: { custom: customCompleter },
    });

    await expect(session.complete("ec", 2)).resolves.toMatchObject({
      replacement: "ec",
      matches: expect.arrayContaining(["echo "]),
    });
    await expect(session.complete("cat RE", 6)).resolves.toEqual({
      replacement: "RE",
      matches: ["README.txt "],
    });
    await expect(session.complete("custom --v", 10)).resolves.toEqual({
      replacement: "--v",
      matches: ["--verbose "],
    });
    expect(seenArgs).toEqual(["--v"]);
  });
});
