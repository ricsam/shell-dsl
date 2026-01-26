import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS } from "../src/fs/index.ts";
import { Interpreter } from "../src/interpreter/index.ts";
import { lex } from "../src/lexer/index.ts";
import { parse } from "../src/parser/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Interpreter", () => {
  let vol: InstanceType<typeof Volume>;
  let interpreter: Interpreter;

  beforeEach(() => {
    vol = new Volume();
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    interpreter = new Interpreter({
      fs,
      cwd: "/",
      env: { USER: "testuser", HOME: "/home/testuser" },
      commands: builtinCommands,
    });
  });

  const run = async (source: string) => {
    const tokens = lex(source);
    const ast = parse(tokens);
    return interpreter.execute(ast);
  };

  test("executes echo command", async () => {
    const result = await run("echo hello world");
    expect(result.stdout.toString()).toBe("hello world\n");
    expect(result.exitCode).toBe(0);
  });

  test("expands variables", async () => {
    const result = await run("echo $USER");
    expect(result.stdout.toString()).toBe("testuser\n");
  });

  test("executes pipeline", async () => {
    vol.fromJSON({ "/file.txt": "foo\nbar\nfoo bar\n" });
    const result = await run("cat /file.txt | grep foo");
    expect(result.stdout.toString()).toBe("foo\nfoo bar\n");
  });

  test("executes and operator - both succeed", async () => {
    const result = await run("echo one && echo two");
    expect(result.stdout.toString()).toBe("one\ntwo\n");
    expect(result.exitCode).toBe(0);
  });

  test("executes and operator - first fails", async () => {
    const result = await run("false && echo should-not-run");
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).toBe(1);
  });

  test("executes or operator - first succeeds", async () => {
    const result = await run("true || echo should-not-run");
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("executes or operator - first fails", async () => {
    const result = await run("false || echo fallback");
    expect(result.stdout.toString()).toBe("fallback\n");
    expect(result.exitCode).toBe(0);
  });

  test("executes sequence", async () => {
    const result = await run("echo one; echo two; echo three");
    expect(result.stdout.toString()).toBe("one\ntwo\nthree\n");
  });

  test("handles command not found", async () => {
    const result = await run("nonexistent-command");
    expect(result.exitCode).toBe(127);
    expect(result.stderr.toString()).toContain("command not found");
  });

  test("executes command substitution", async () => {
    const result = await run("echo $(echo hello)");
    expect(result.stdout.toString()).toBe("hello\n");
  });

  test("handles inline assignments", async () => {
    const result = await run("FOO=bar && echo $FOO");
    expect(result.stdout.toString()).toBe("bar\n");
  });

  test("handles pwd command", async () => {
    const result = await run("pwd");
    expect(result.stdout.toString()).toBe("/\n");
  });

  test("handles test command with file checks", async () => {
    vol.fromJSON({ "/existing.txt": "content" });

    const existsResult = await run("test -f /existing.txt && echo exists");
    expect(existsResult.stdout.toString()).toBe("exists\n");

    const notExistsResult = await run("test -f /nonexistent.txt || echo missing");
    expect(notExistsResult.stdout.toString()).toBe("missing\n");
  });

  test("handles string comparison in test", async () => {
    const equalResult = await run('test "foo" = "foo" && echo equal');
    expect(equalResult.stdout.toString()).toBe("equal\n");

    const notEqualResult = await run('test "foo" != "bar" && echo different');
    expect(notEqualResult.stdout.toString()).toBe("different\n");
  });
});
