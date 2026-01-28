import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("touch command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/existing.txt": "content",
      "/dir/file.txt": "nested",
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

  test("creates a new empty file", async () => {
    await sh`touch /newfile.txt`;
    expect(vol.existsSync("/newfile.txt")).toBe(true);
    expect(vol.readFileSync("/newfile.txt", "utf8")).toBe("");
  });

  test("creates multiple files", async () => {
    await sh`touch /a.txt /b.txt /c.txt`;
    expect(vol.existsSync("/a.txt")).toBe(true);
    expect(vol.existsSync("/b.txt")).toBe(true);
    expect(vol.existsSync("/c.txt")).toBe(true);
  });

  test("touch existing file preserves content", async () => {
    await sh`touch /existing.txt`;
    expect(vol.readFileSync("/existing.txt", "utf8")).toBe("content");
  });

  test("creates file in subdirectory", async () => {
    await sh`touch /dir/newfile.txt`;
    expect(vol.existsSync("/dir/newfile.txt")).toBe(true);
  });

  test("-c flag does not create missing file", async () => {
    await sh`touch -c /missing.txt`;
    expect(vol.existsSync("/missing.txt")).toBe(false);
  });

  test("--no-create flag does not create missing file", async () => {
    await sh`touch --no-create /missing.txt`;
    expect(vol.existsSync("/missing.txt")).toBe(false);
  });

  test("-c flag still touches existing file", async () => {
    await sh`touch -c /existing.txt`;
    expect(vol.existsSync("/existing.txt")).toBe(true);
    expect(vol.readFileSync("/existing.txt", "utf8")).toBe("content");
  });

  test("error with missing operand", async () => {
    const result = await sh`touch`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing file operand");
  });

  test("error when parent directory doesn't exist", async () => {
    const result = await sh`touch /nonexistent/file.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("cannot touch");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`touch -x /file.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`touch --invalid /file.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
