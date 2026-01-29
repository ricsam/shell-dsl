import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("break and continue", () => {
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    const vol = new Volume();
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  describe("break", () => {
    test("invalid level produces stderr", async () => {
      const result = await sh`for x in a b c; do break abc; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("break: invalid level");
    });

    test("negative level produces stderr", async () => {
      const result = await sh`for x in a b c; do break -1; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("break: invalid level");
    });

    test("zero level produces stderr", async () => {
      const result = await sh`for x in a b c; do break 0; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("break: invalid level");
    });
  });

  describe("continue", () => {
    test("invalid level produces stderr", async () => {
      const result = await sh`for x in a b c; do continue abc; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("continue: invalid level");
    });

    test("negative level produces stderr", async () => {
      const result = await sh`for x in a b c; do continue -1; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("continue: invalid level");
    });

    test("zero level produces stderr", async () => {
      const result = await sh`for x in a b c; do continue 0; done`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("continue: invalid level");
    });
  });
});
