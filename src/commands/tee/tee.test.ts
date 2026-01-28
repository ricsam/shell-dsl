import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("tee command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/existing.txt": "old content\n",
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

  test("basic: stdin to stdout and file", async () => {
    const result = await sh`echo hello | tee /output.txt`.text();
    expect(result).toBe("hello\n");
    expect(vol.readFileSync("/output.txt", "utf8")).toBe("hello\n");
  });

  test("writes to multiple files", async () => {
    await sh`echo hello | tee /a.txt /b.txt /c.txt`;
    expect(vol.readFileSync("/a.txt", "utf8")).toBe("hello\n");
    expect(vol.readFileSync("/b.txt", "utf8")).toBe("hello\n");
    expect(vol.readFileSync("/c.txt", "utf8")).toBe("hello\n");
  });

  test("overwrites file by default", async () => {
    await sh`echo new content | tee /existing.txt`;
    expect(vol.readFileSync("/existing.txt", "utf8")).toBe("new content\n");
  });

  test("-a flag appends instead of overwriting", async () => {
    await sh`echo appended | tee -a /existing.txt`;
    expect(vol.readFileSync("/existing.txt", "utf8")).toBe("old content\nappended\n");
  });

  test("--append flag appends instead of overwriting", async () => {
    await sh`echo appended | tee --append /existing.txt`;
    expect(vol.readFileSync("/existing.txt", "utf8")).toBe("old content\nappended\n");
  });

  test("works in pipeline", async () => {
    const result = await sh`echo hello | tee /out.txt | cat`.text();
    expect(result).toBe("hello\n");
    expect(vol.readFileSync("/out.txt", "utf8")).toBe("hello\n");
  });

  test("tee without file arguments just passes through", async () => {
    const result = await sh`echo hello | tee`.text();
    expect(result).toBe("hello\n");
  });

  test("handles binary content", async () => {
    // Create a file with binary-ish content
    vol.writeFileSync("/binary.dat", Buffer.from([0x00, 0x01, 0x02, 0xff]));
    await sh`cat /binary.dat | tee /copy.dat`;
    const original = vol.readFileSync("/binary.dat");
    const copy = vol.readFileSync("/copy.dat");
    expect(Buffer.compare(original as Buffer, copy as Buffer)).toBe(0);
  });

  test("error when cannot write to file", async () => {
    const result = await sh`echo hi | tee /nonexistent/file.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("tee:");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`echo hi | tee -x /out.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`echo hi | tee --invalid /out.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });
});
