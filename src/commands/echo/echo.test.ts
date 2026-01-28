import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("echo command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  describe("Basic Output", () => {
    test("echoes single argument", async () => {
      const result = await sh`echo hello`.text();
      expect(result).toBe("hello\n");
    });

    test("echoes multiple arguments with spaces", async () => {
      const result = await sh`echo hello world`.text();
      expect(result).toBe("hello world\n");
    });

    test("echoes empty string with no arguments", async () => {
      const result = await sh`echo`.text();
      expect(result).toBe("\n");
    });

    test("echoes quoted string", async () => {
      const result = await sh`echo "hello world"`.text();
      expect(result).toBe("hello world\n");
    });
  });

  describe("-n flag (no newline)", () => {
    test("-n suppresses trailing newline", async () => {
      const result = await sh`echo -n hello`.text();
      expect(result).toBe("hello");
    });

    test("-n with multiple arguments", async () => {
      const result = await sh`echo -n hello world`.text();
      expect(result).toBe("hello world");
    });

    test("-n with no arguments outputs nothing", async () => {
      const result = await sh`echo -n`.text();
      expect(result).toBe("");
    });
  });

  describe("Pipeline Integration", () => {
    test("echo piped to cat", async () => {
      const result = await sh`echo hello | cat`.text();
      expect(result).toBe("hello\n");
    });

    test("echo piped to grep", async () => {
      const result = await sh`echo "foo bar baz" | grep bar`.text();
      expect(result).toBe("foo bar baz\n");
    });
  });

  describe("Invalid Flags", () => {
    test("invalid short flag returns error with usage", async () => {
      const result = await sh`echo -x hello`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("invalid option");
      expect(result.stderr.toString()).toContain("usage:");
    });

    test("invalid long flag returns error with usage", async () => {
      const result = await sh`echo --invalid hello`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("unrecognized option");
      expect(result.stderr.toString()).toContain("usage:");
    });
  });
});
