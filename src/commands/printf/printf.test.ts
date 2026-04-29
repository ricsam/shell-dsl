import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("printf command", () => {
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

  test("prints the format without adding a newline", async () => {
    const result = await sh`printf hello`.text();
    expect(result).toBe("hello");
  });

  test("expands escapes in the format", async () => {
    const result = await sh`printf '\\n--- frontend tree ---\\n'`.text();
    expect(result).toBe("\n--- frontend tree ---\n");
  });

  test("formats strings and reuses the format for extra arguments", async () => {
    const result = await sh`printf '%s\\n' alpha beta gamma`.text();
    expect(result).toBe("alpha\nbeta\ngamma\n");
  });

  test("prints literal percent signs", async () => {
    const result = await sh`printf 'progress: 100%%'`.text();
    expect(result).toBe("progress: 100%");
  });

  test("%b expands escapes in the argument", async () => {
    const result = await sh`printf '%b' 'one\\ntwo'`.text();
    expect(result).toBe("one\ntwo");
  });

  test("\\c stops output", async () => {
    const result = await sh`printf '%b after' 'before\\c ignored'`.text();
    expect(result).toBe("before");
  });

  test("formats numbers with width and zero padding", async () => {
    const result = await sh`printf '%04d %x' 7 255`.text();
    expect(result).toBe("0007 ff");
  });

  test("applies string width and precision", async () => {
    const result = await sh`printf '[%-5.3s]' abcdef`.text();
    expect(result).toBe("[abc  ]");
  });

  test("missing format returns an error", async () => {
    const result = await sh`printf`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing format operand");
  });

  test("invalid conversion returns an error", async () => {
    const result = await sh`printf '%q' value`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid format character");
  });

  test("incomplete conversion returns an error", async () => {
    const result = await sh`printf '100%'`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing format character");
  });

  test("works in tree-printing command chains", async () => {
    vol.fromJSON({
      "/spec/api.test.ts": "spec",
      "/frontend/src/App.tsx": "frontend",
      "/backend/server.ts": "backend",
      "/shared/types.ts": "shared",
    });

    const result = await sh`find /spec -maxdepth 1 -type f -print | sort && printf '\\n--- frontend tree ---\\n' && find /frontend -maxdepth 3 -type f -print | sort && printf '\\n--- backend tree ---\\n' && find /backend -maxdepth 3 -type f -print 2>/dev/null | sort && printf '\\n--- shared tree ---\\n' && find /shared -maxdepth 3 -type f -print 2>/dev/null | sort`.text();

    expect(result).toBe(
      "/spec/api.test.ts\n" +
      "\n--- frontend tree ---\n" +
      "/frontend/src/App.tsx\n" +
      "\n--- backend tree ---\n" +
      "/backend/server.ts\n" +
      "\n--- shared tree ---\n" +
      "/shared/types.ts\n"
    );
  });
});
