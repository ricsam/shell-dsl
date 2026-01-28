import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("pwd command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/home/user/file.txt": "content",
      "/tmp/test.txt": "test",
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

  describe("Basic Output", () => {
    test("prints root directory", async () => {
      const result = await sh`pwd`.text();
      expect(result).toBe("/\n");
    });

    test("prints changed directory", async () => {
      sh.cwd("/home/user");
      const result = await sh`pwd`.text();
      expect(result).toBe("/home/user\n");
    });

    test("prints tmp directory", async () => {
      sh.cwd("/tmp");
      const result = await sh`pwd`.text();
      expect(result).toBe("/tmp\n");
    });
  });

  describe("Pipeline Integration", () => {
    test("pwd piped to cat", async () => {
      const result = await sh`pwd | cat`.text();
      expect(result).toBe("/\n");
    });
  });

  describe("Invalid Flags", () => {
    test("invalid short flag returns error with usage", async () => {
      const result = await sh`pwd -x`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("invalid option");
      expect(result.stderr.toString()).toContain("usage:");
    });

    test("invalid long flag returns error with usage", async () => {
      const result = await sh`pwd --invalid`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("unrecognized option");
      expect(result.stderr.toString()).toContain("usage:");
    });
  });
});
