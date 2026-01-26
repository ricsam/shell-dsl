import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL, ShellError } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("ShellDSL Integration", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "foo\nbar\nbaz\nfoo bar\n",
      "/config.json": '{"key": "value"}',
    });
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: { USER: "alice", HOME: "/home/alice" },
      commands: builtinCommands,
    });
  });

  test("basic echo", async () => {
    const result = await sh`echo hi`.text();
    expect(result).toBe("hi\n");
  });

  test("variable expansion", async () => {
    const result = await sh`echo "Hello, $USER"`.text();
    expect(result).toBe("Hello, alice\n");
  });

  test("pipeline with grep and wc", async () => {
    const result = await sh`cat /data.txt | grep foo | wc -l`.text();
    expect(result.trim()).toBe("2");
  });

  test("json output", async () => {
    const result = await sh`cat /config.json`.json<{ key: string }>();
    expect(result.key).toBe("value");
  });

  test("lines iterator", async () => {
    const lines: string[] = [];
    for await (const line of sh`cat /data.txt`.lines()) {
      lines.push(line);
    }
    expect(lines).toEqual(["foo", "bar", "baz", "foo bar"]);
  });

  test("buffer output", async () => {
    const buf = await sh`echo hello`.buffer();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString()).toBe("hello\n");
  });

  test("blob output", async () => {
    const blob = await sh`echo hello`.blob();
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("hello\n");
  });

  test("nothrow modifier", async () => {
    const result = await sh`false`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("throws on non-zero exit by default", async () => {
    try {
      await sh`false`;
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ShellError);
      expect((err as ShellError).exitCode).toBe(1);
    }
  });

  test("interpolation is escaped by default", async () => {
    const userInput = "foo; echo injected";
    const result = await sh`echo ${userInput}`.text();
    expect(result).toBe("foo; echo injected\n");
  });

  test("raw escape hatch", async () => {
    const result = await sh`echo ${{ raw: "$(echo nested)" }}`.text();
    expect(result).toBe("nested\n");
  });

  test("global cwd setting", async () => {
    vol.mkdirSync("/subdir");
    sh.cwd("/subdir");
    const result = await sh`pwd`.text();
    expect(result).toBe("/subdir\n");
    sh.resetCwd();
    const result2 = await sh`pwd`.text();
    expect(result2).toBe("/\n");
  });

  test("global env setting", async () => {
    sh.env({ FOO: "bar" });
    const result = await sh`echo $FOO`.text();
    expect(result).toBe("bar\n");
  });

  test("control flow with and/or", async () => {
    const result = await sh`test -f /data.txt && echo exists || echo missing`.text();
    expect(result).toBe("exists\n");

    const result2 = await sh`test -f /nonexistent && echo exists || echo missing`.text();
    expect(result2).toBe("missing\n");
  });

  test("sequence execution", async () => {
    const result = await sh`echo one; echo two; echo three`.text();
    expect(result).toBe("one\ntwo\nthree\n");
  });

  describe("Global throws setting", () => {
    test("sh.throws(false) disables throwing globally", async () => {
      sh.throws(false);
      const result = await sh`false`;
      expect(result.exitCode).toBe(1);
      sh.throws(true); // restore default
    });

    test("sh.throws(false) affects all subsequent commands", async () => {
      sh.throws(false);
      const result1 = await sh`false`;
      const result2 = await sh`cat /nonexistent`;
      expect(result1.exitCode).toBe(1);
      expect(result2.exitCode).not.toBe(0);
      sh.throws(true); // restore default
    });

    test("per-command .throws(true) overrides global throws(false)", async () => {
      sh.throws(false);
      try {
        await sh`false`.throws(true);
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
      }
      sh.throws(true); // restore default
    });

    test("sh.throws(true) restores throwing behavior", async () => {
      sh.throws(false);
      sh.throws(true);
      try {
        await sh`false`;
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
      }
    });
  });

  test("escape utility", () => {
    expect(sh.escape("hello world")).toBe("'hello world'");
    expect(sh.escape("safe")).toBe("safe");
    expect(sh.escape("$(rm -rf /)")).toBe("'$(rm -rf /)'");
  });

  test("low-level lex API", () => {
    const tokens = sh.lex("echo hello");
    expect(tokens.length).toBe(3); // word, word, eof
  });

  test("low-level parse API", () => {
    const tokens = sh.lex("echo hello | cat");
    const ast = sh.parse(tokens);
    expect(ast.type).toBe("pipeline");
  });

  test("low-level compile and run API", async () => {
    const tokens = sh.lex("echo hello");
    const ast = sh.parse(tokens);
    const program = sh.compile(ast);
    const result = await sh.run(program);
    expect(result.stdout.toString()).toBe("hello\n");
  });
});
