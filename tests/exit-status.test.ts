import { describe, expect, test, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createShellDSL, createVirtualFS } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";
import type { Command, VirtualFS } from "../src/types.ts";

describe("exit status", () => {
  let vol: InstanceType<typeof Volume>;
  let fs: VirtualFS;

  const createShell = (commands: Record<string, Command> = {}) => {
    fs = createVirtualFS(createFsFromVolume(vol));
    return createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: { ...builtinCommands, ...commands },
    });
  };

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({ "/work/.gitkeep": "" });
    fs = createVirtualFS(createFsFromVolume(vol));
  });

  test("$? expands to the previous command exit code", async () => {
    const sh = createShell();

    const result = await sh`false; echo exit:$?; true; echo ok:$?`.text();

    expect(result).toBe("exit:1\nok:0\n");
  });

  test("$? works for project-style command chains", async () => {
    const logs: Command = async (ctx) => {
      await ctx.stdout.writeText(`logs:${ctx.args.join(":")}\n`);
      return 0;
    };
    const restartBackend: Command = async () => 42;
    const sh = createShell({ logs, "restart-backend": restartBackend });

    const result = await sh`logs clear backend; restart-backend; echo exit:$?; logs backend 100`.text();

    expect(result).toBe("logs:clear:backend\nexit:42\nlogs:backend:100\n");
  });

  test("$? reflects pipeline, and/or, and compound command statuses", async () => {
    const sh = createShell();

    const result = await sh`
      true | false
      echo pipe:$?
      false && echo skipped
      echo and:$?
      if false; then echo no; fi
      echo if:$?
    `.text();

    expect(result).toBe("pipe:1\nand:1\nif:0\n");
  });

  test("scripts return exit codes and parent shell can inspect them", async () => {
    const sh = createShell();
    await fs.writeFile("/script", "false\necho script:$?\nexit 7\necho never\n");

    const result = await sh`./script; echo parent:$?`.text();

    expect(result).toBe("script:1\nparent:7\n");
  });

  test("sh -c returns child shell exit without exiting the parent", async () => {
    const sh = createShell();

    const result = await sh`sh -c 'exit 9'; echo child:$?`.text();

    expect(result).toBe("child:9\n");
  });

  test("exit stops the current shell with an explicit code", async () => {
    const sh = createShell();

    const result = await sh`echo before; exit 5; echo after`.nothrow();

    expect(result.exitCode).toBe(5);
    expect(result.stdout.toString()).toBe("before\n");
  });

  test("exit without an argument uses the previous exit code", async () => {
    const sh = createShell();

    const result = await sh`false; exit`.nothrow();

    expect(result.exitCode).toBe(1);
  });

  test("source exit stops the current shell", async () => {
    const sh = createShell();
    await fs.writeFile("/stop", "echo sourced\nexit 6\necho never\n");

    const result = await sh`source ./stop; echo after`.nothrow();

    expect(result.exitCode).toBe(6);
    expect(result.stdout.toString()).toBe("sourced\n");
  });

  test("invalid exit arguments report shell-like errors", async () => {
    const sh = createShell();

    const nonNumeric = await sh`exit nope`.nothrow();
    const tooMany = await sh`exit 1 2; echo status:$?`.nothrow();

    expect(nonNumeric.exitCode).toBe(2);
    expect(nonNumeric.stderr.toString()).toContain("numeric argument required");
    expect(tooMany.exitCode).toBe(0);
    expect(tooMany.stderr.toString()).toContain("too many arguments");
    expect(tooMany.stdout.toString()).toBe("status:1\n");
  });
});
