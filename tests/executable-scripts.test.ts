import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createShellDSL, createVirtualFS } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";
import type { Command, VirtualFS } from "../src/types.ts";

describe("executable scripts", () => {
  let vol: InstanceType<typeof Volume>;
  let fs: VirtualFS;

  const createShell = (commands: Record<string, Command> = {}) => {
    fs = createVirtualFS(createFsFromVolume(vol));
    return createShellDSL({
      fs,
      cwd: "/",
      env: { PATH: "/bin:/usr/bin" },
      commands: { ...builtinCommands, ...commands },
    });
  };

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/work/.gitkeep": "",
      "/data/a.txt": "a\n",
      "/data/b.txt": "b\n",
      "/data/skip.log": "skip\n",
    });
    fs = createVirtualFS(createFsFromVolume(vol));
  });

  test("./script runs shell-dsl source with positional parameters", async () => {
    const sh = createShell();
    await fs.writeFile("/script", 'echo "$0:$1:$2:$#:$*"\n');

    const result = await sh`./script one two`.text();

    expect(result).toBe("./script:one:two:2:one two\n");
  });

  test('quoted "$@" expands to separate arguments', async () => {
    const argv: Command = async (ctx) => {
      await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
      return 0;
    };
    const sh = createShell({ argv });
    await fs.writeFile("/script", 'argv "$@"\n');

    const result = await sh`./script "two words" end`.text();

    expect(result).toBe('["two words","end"]\n');
  });

  test("./script runs in subprocess-like shell state", async () => {
    const sh = createShell();
    await fs.writeFile("/script", 'FOO=inside\ncd /work\necho "script:$FOO:$(pwd)"\n');

    const result = await sh`./script; echo "after:$FOO"; pwd`.text();

    expect(result).toBe("script:inside:/work\nafter:\n/\n");
  });

  test("source and dot execute in the current shell state", async () => {
    const sh = createShell();
    await fs.writeFile("/source-me", "FOO=sourced\ncd /work\n");
    await fs.writeFile("/work/dot-me", 'BAR=dot\n');

    const result = await sh`source ./source-me; . ./dot-me; echo "$FOO:$BAR"; pwd`.text();

    expect(result).toBe("sourced:dot\n/work\n");
  });

  test("sh -c uses argv0 and positional arguments like a child shell", async () => {
    const sh = createShell();

    const result = await sh`sh -c 'echo "$0:$1:$#"' name value`.text();

    expect(result).toBe("name:value:1\n");
  });

  test("no-shebang scripts run as shell-dsl scripts", async () => {
    const sh = createShell();
    await fs.writeFile("/plain", "echo plain\n");

    await expect(sh`./plain`.text()).resolves.toBe("plain\n");
  });

  test("#!/bin/sh and #!/usr/bin/env sh run as shell-dsl scripts", async () => {
    const sh = createShell();
    await fs.writeFile("/bin-sh", "#!/bin/sh\necho bin:$1\n");
    await fs.writeFile("/env-sh", "#!/usr/bin/env sh\necho env:$1\n");

    const result = await sh`./bin-sh one; ./env-sh two`.text();

    expect(result).toBe("bin:one\nenv:two\n");
  });

  test("non-sh shebang dispatches to registered commands with script path first", async () => {
    const customCommand: Command = async (ctx) => {
      await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
      return 0;
    };
    const sh = createShell({ custom_command: customCommand });
    await fs.writeFile("/cat-script", "#!/bin/cat\nbody\n");
    await fs.writeFile("/custom-script", "#!/bin/custom_command\nignored\n");

    const catResult = await sh`./cat-script`.text();
    const customResult = await sh`./custom-script arg`.text();

    expect(catResult).toBe("#!/bin/cat\nbody\n");
    expect(customResult).toBe('["./custom-script","arg"]\n');
  });

  test("script execution reports missing files, directories, unknown shebangs, and parse errors", async () => {
    const sh = createShell();
    await fs.mkdir("/dir");
    await fs.writeFile("/bash-script", "#!/bin/bash\necho no\n");
    await fs.writeFile("/bad-script", "if true; then\n  echo nope\n");

    const missing = await sh`./missing`.nothrow();
    const directory = await sh`./dir`.nothrow();
    const bash = await sh`./bash-script`.nothrow();
    const bad = await sh`./bad-script`.nothrow();

    expect(missing.exitCode).toBe(127);
    expect(missing.stderr.toString()).toContain("No such file or directory");
    expect(directory.exitCode).toBe(126);
    expect(directory.stderr.toString()).toContain("is a directory");
    expect(bash.exitCode).toBe(126);
    expect(bash.stderr.toString()).toContain("unsupported interpreter: /bin/bash");
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toContain("Expected 'fi'");
  });

  test("find -exec can run script paths", async () => {
    const sh = createShell();
    await fs.writeFile("/script", 'echo "hit:$1"\n');

    const result = await sh`find /data -name "*.txt" -exec ./script {} \\;`.text();
    const lines = result.trim().split("\n").sort();

    expect(lines).toEqual(["hit:/data/a.txt", "hit:/data/b.txt"]);
  });
});
