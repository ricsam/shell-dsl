import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Control Flow", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/exists.txt": "content",
    });
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  describe("&& (AND)", () => {
    test("executes second command when first succeeds", async () => {
      const result = await sh`true && echo success`.text();
      expect(result).toBe("success\n");
    });

    test("skips second command when first fails", async () => {
      const result = await sh`false && echo should-not-run`.nothrow();
      expect(result.stdout.toString()).toBe("");
    });

    test("chains multiple && operators", async () => {
      const result = await sh`true && true && echo all-passed`.text();
      expect(result).toBe("all-passed\n");
    });

    test("stops at first failure in chain", async () => {
      const result = await sh`true && false && echo should-not-run`.nothrow();
      expect(result.stdout.toString()).toBe("");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("|| (OR)", () => {
    test("skips second command when first succeeds", async () => {
      const result = await sh`true || echo should-not-run`.text();
      expect(result).toBe("");
    });

    test("executes second command when first fails", async () => {
      const result = await sh`false || echo fallback`.text();
      expect(result).toBe("fallback\n");
    });

    test("chains multiple || operators", async () => {
      const result = await sh`false || false || echo finally`.text();
      expect(result).toBe("finally\n");
    });

    test("stops at first success in chain", async () => {
      const result = await sh`false || true || echo should-not-run`.text();
      expect(result).toBe("");
    });
  });

  describe("; (Sequence)", () => {
    test("executes all commands regardless of exit code", async () => {
      const result = await sh`false; echo still-runs`.nothrow();
      expect(result.stdout.toString()).toBe("still-runs\n");
    });

    test("returns exit code of last command", async () => {
      const result = await sh`true; false`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("multiple sequences", async () => {
      const result = await sh`echo one; echo two; echo three`.text();
      expect(result).toBe("one\ntwo\nthree\n");
    });
  });

  describe("Combined operators", () => {
    test("&& and || together", async () => {
      const result = await sh`test -f /exists.txt && echo found || echo missing`.text();
      expect(result).toBe("found\n");
    });

    test("&& and || with missing file", async () => {
      const result = await sh`test -f /missing.txt && echo found || echo missing`.text();
      expect(result).toBe("missing\n");
    });

    test("mkdir with -p and &&", async () => {
      const result = await sh`mkdir -p /a/b/c && echo created`.text();
      expect(result).toBe("created\n");
      expect(vol.existsSync("/a/b/c")).toBe(true);
    });

    test("complex control flow", async () => {
      const result = await sh`test -d /dir || mkdir /dir && echo ready`.text();
      expect(result).toBe("ready\n");
      expect(vol.existsSync("/dir")).toBe(true);
    });
  });
});
