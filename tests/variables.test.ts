import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";
import type { Command } from "../src/types.ts";

describe("Variables", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;
  const defaultEnv = { USER: "testuser", HOME: "/home/testuser", PATH: "/bin:/usr/bin" };

  const createShell = (extraCommands: Record<string, Command> = {}, env: Record<string, string> = {}) => {
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);
    return createShellDSL({
      fs,
      cwd: "/",
      env: { ...defaultEnv, ...env },
      commands: { ...builtinCommands, ...extraCommands },
    });
  };

  beforeEach(() => {
    vol = new Volume();
    sh = createShell();
  });

  describe("Variable expansion", () => {
    test("expands $VAR syntax", async () => {
      const result = await sh`echo $USER`.text();
      expect(result).toBe("testuser\n");
    });

    test("expands \${VAR} syntax", async () => {
      const result = await sh`echo ${{ raw: "${HOME}" }}`.text();
      expect(result).toBe("/home/testuser\n");
    });

    test("undefined variable expands to empty", async () => {
      const result = await sh`echo $UNDEFINED`.text();
      expect(result).toBe("\n");
    });

    test("multiple variables in one line", async () => {
      const result = await sh`echo $USER at $HOME`.text();
      expect(result).toBe("testuser at /home/testuser\n");
    });
  });

  describe("Quoting semantics", () => {
    test("double quotes allow variable expansion", async () => {
      const result = await sh`echo "Hello $USER"`.text();
      expect(result).toBe("Hello testuser\n");
    });

    test("single quotes prevent variable expansion", async () => {
      const result = await sh`echo 'Hello $USER'`.text();
      expect(result).toBe("Hello $USER\n");
    });

    test("mixed quoting", async () => {
      const result = await sh`echo "user: $USER" 'literal: $USER'`.text();
      expect(result).toBe("user: testuser literal: $USER\n");
    });
  });

  describe("Inline assignment", () => {
    test("assignment affects subsequent commands", async () => {
      const result = await sh`FOO=bar && echo $FOO`.text();
      expect(result).toBe("bar\n");
    });

    test("multiple assignments", async () => {
      const result = await sh`A=1 && B=2 && echo $A $B`.text();
      expect(result).toBe("1 2\n");
    });
  });

  describe("Scoped variable assignment", () => {
    test("command words expand against the pre-assignment environment", async () => {
      const result = await sh`FOO=bar echo $FOO`.text();
      expect(result).toBe("\n");
    });

    test("scoped variable does not persist after command", async () => {
      await sh`TEMP=scoped echo $TEMP`.text();
      const result = await sh`echo $TEMP`.text();
      expect(result).toBe("\n");
    });

    test("scoped variable overrides the executed command environment", async () => {
      const getenv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${ctx.env[ctx.args[0]!] ?? ""}\n`);
        return 0;
      };
      const scopedSh = createShell({ getenv }, { MYVAR: "global" });

      const result = await scopedSh`MYVAR=scoped getenv MYVAR`.text();
      expect(result).toBe("scoped\n");

      const expansionResult = await scopedSh`MYVAR=scoped echo $MYVAR`.text();
      expect(expansionResult).toBe("global\n");

      const globalResult = await scopedSh`echo $MYVAR`.text();
      expect(globalResult).toBe("global\n");
    });

    test("later scoped assignments can read earlier ones", async () => {
      const getenv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${ctx.env[ctx.args[0]!] ?? ""}\n`);
        return 0;
      };
      const scopedSh = createShell({ getenv });
      const result = await scopedSh`A=first B=$A getenv B`.text();
      expect(result).toBe("first\n");
    });

    test("assignment-only commands still evaluate left-to-right", async () => {
      const result = await sh`A=first B=$A && echo $B`.text();
      expect(result).toBe("first\n");
    });

    test("scoped assignment remains invisible to sibling command substitution", async () => {
      const result = await sh`MSG=hello echo "message: $(echo $MSG)"`.text();
      expect(result).toBe("message: \n");
    });
  });

  describe("Field splitting", () => {
    test("unquoted variables split on default IFS whitespace", async () => {
      const argv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
        return 0;
      };
      const splitSh = createShell({ argv }, { LIST: "alpha beta" });
      const result = await splitSh`argv $LIST`.text();
      expect(result).toBe('["alpha","beta"]\n');
    });

    test("quoted variables do not split", async () => {
      const argv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
        return 0;
      };
      const splitSh = createShell({ argv }, { LIST: "alpha beta" });
      const result = await splitSh`argv "$LIST"`.text();
      expect(result).toBe('["alpha beta"]\n');
    });

    test("command substitution output is field-split before for loops consume it", async () => {
      vol.fromJSON({
        "/backend/migrations/a/snapshot.json": "{}\n",
        "/backend/migrations/b/snapshot.json": "{}\n",
      });
      const result = await sh`
        for f in $(find /backend/migrations -name "snapshot.json"); do
          echo $f
        done
      `.text();
      expect(result).toBe(
        "/backend/migrations/a/snapshot.json\n/backend/migrations/b/snapshot.json\n",
      );
    });

    test("custom IFS splits on non-whitespace delimiters and preserves empty fields", async () => {
      const argv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
        return 0;
      };
      const splitSh = createShell({ argv }, { LIST: "alpha,beta,,gamma", IFS: "," });
      const result = await splitSh`argv $LIST`.text();
      expect(result).toBe('["alpha","beta","","gamma"]\n');
    });

    test("IFS empty disables field splitting", async () => {
      const argv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
        return 0;
      };
      const splitSh = createShell({ argv }, { LIST: "alpha beta", IFS: "" });
      const result = await splitSh`argv $LIST`.text();
      expect(result).toBe('["alpha beta"]\n');
    });

    test("whitespace-only delimiters do not create empty fields", async () => {
      const argv: Command = async (ctx) => {
        await ctx.stdout.writeText(`${JSON.stringify(ctx.args)}\n`);
        return 0;
      };
      const splitSh = createShell({ argv }, { LIST: "  alpha   beta  " });
      const result = await splitSh`argv $LIST`.text();
      expect(result).toBe('["alpha","beta"]\n');
    });
  });

  describe("Global env changes", () => {
    test("sh.env() adds variables", async () => {
      sh.env({ CUSTOM: "value" });
      const result = await sh`echo $CUSTOM`.text();
      expect(result).toBe("value\n");
    });

    test("sh.env() overwrites variables", async () => {
      sh.env({ USER: "newuser" });
      const result = await sh`echo $USER`.text();
      expect(result).toBe("newuser\n");
    });

    test("sh.resetEnv() restores initial env", async () => {
      sh.env({ USER: "changed" });
      sh.resetEnv();
      const result = await sh`echo $USER`.text();
      expect(result).toBe("testuser\n");
    });
  });

  describe("Interpolation escaping", () => {
    test("interpolated values are escaped", async () => {
      const dangerous = '$(echo hacked)';
      const result = await sh`echo ${dangerous}`.text();
      expect(result).toBe('$(echo hacked)\n');
    });

    test("raw values bypass escaping", async () => {
      const result = await sh`echo ${{ raw: "$(echo works)" }}`.text();
      expect(result).toBe("works\n");
    });
  });
});
