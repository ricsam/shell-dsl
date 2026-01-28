import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

describe("File truncation", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "hello world\n",
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

  test(": > file truncates file", async () => {
    const result = await sh`: > /data.txt`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(vol.readFileSync("/data.txt", "utf8")).toBe("");
  });

  test("> file truncates file (bare redirect)", async () => {
    const result = await sh`> /data.txt`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(vol.readFileSync("/data.txt", "utf8")).toBe("");
  });

  test("cat /dev/null > file truncates file", async () => {
    const result = await sh`cat /dev/null > /data.txt`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(vol.readFileSync("/data.txt", "utf8")).toBe("");
  });
});
