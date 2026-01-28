import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

describe("/dev/null support", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({});
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  test("stdout redirect to /dev/null discards output", async () => {
    const result = await sh`echo hello > /dev/null`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
  });

  test("stderr redirect to /dev/null discards errors", async () => {
    const result = await sh`cat nonexistent 2>/dev/null`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toBe("");
  });

  test("reading from /dev/null gives empty input", async () => {
    const result = await sh`cat < /dev/null`.text();
    expect(result).toBe("");
  });

  test("&> /dev/null discards both stdout and stderr", async () => {
    const result = await sh`echo hello &>/dev/null`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
  });
});
