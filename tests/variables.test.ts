import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Variables", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: { USER: "testuser", HOME: "/home/testuser", PATH: "/bin:/usr/bin" },
      commands: builtinCommands,
    });
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
