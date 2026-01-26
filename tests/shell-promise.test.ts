import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL, ShellError } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("ShellPromise", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.json": '{"name": "test", "value": 42}',
      "/lines.txt": "one\ntwo\nthree\n",
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

  describe("Output methods", () => {
    test("text() returns string", async () => {
      const result = await sh`echo hello`.text();
      expect(typeof result).toBe("string");
      expect(result).toBe("hello\n");
    });

    test("json() parses JSON output", async () => {
      const result = await sh`cat /data.json`.json<{ name: string; value: number }>();
      expect(result.name).toBe("test");
      expect(result.value).toBe(42);
    });

    test("lines() iterates over lines", async () => {
      const lines: string[] = [];
      for await (const line of sh`cat /lines.txt`.lines()) {
        lines.push(line);
      }
      expect(lines).toEqual(["one", "two", "three"]);
    });

    test("buffer() returns Buffer", async () => {
      const buf = await sh`echo hello`.buffer();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString()).toBe("hello\n");
    });

    test("blob() returns Blob", async () => {
      const blob = await sh`echo hello`.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(await blob.text()).toBe("hello\n");
    });
  });

  describe("Behavior modifiers", () => {
    test("nothrow() prevents throwing on error", async () => {
      const result = await sh`false`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test("throws() can re-enable throwing", async () => {
      sh.throws(false);
      try {
        await sh`false`.throws(true);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
      }
      sh.throws(true);
    });

    test("quiet() still returns result", async () => {
      const result = await sh`echo hello`.quiet();
      expect(result.stdout.toString()).toBe("hello\n");
    });
  });

  describe("Error handling", () => {
    test("throws ShellError on non-zero exit", async () => {
      try {
        await sh`false`;
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
        expect((err as ShellError).exitCode).toBe(1);
      }
    });

    test("ShellError contains stdout and stderr", async () => {
      try {
        await sh`cat /nonexistent`;
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
        expect((err as ShellError).stderr.toString()).toContain("nonexistent");
      }
    });
  });

  describe("Promise interface", () => {
    test("works with await", async () => {
      const result = await sh`echo hello`;
      expect(result.exitCode).toBe(0);
    });

    test("works with .then()", async () => {
      const exitCode = await sh`echo hello`.then((r) => r.exitCode);
      expect(exitCode).toBe(0);
    });

    test("works with .catch()", async () => {
      const caught = await sh`false`.catch((err) => err);
      expect(caught).toBeInstanceOf(ShellError);
    });

    test("works with .finally()", async () => {
      let finallyCalled = false;
      await sh`echo hello`.finally(() => {
        finallyCalled = true;
      });
      expect(finallyCalled).toBe(true);
    });
  });
});
