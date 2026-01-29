import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("tr command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/hello.txt": "hello world\n",
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

  test("basic character translation", async () => {
    const result = await sh`echo hello | tr el x`.text();
    expect(result).toBe("hxxxo\n");
  });

  test("translate character ranges (lowercase to uppercase)", async () => {
    const result = await sh`echo hello | tr a-z A-Z`.text();
    expect(result).toBe("HELLO\n");
  });

  test("delete mode (-d)", async () => {
    const result = await sh`echo hello | tr -d l`.text();
    expect(result).toBe("heo\n");
  });

  test("delete vowels", async () => {
    const result = await sh`echo "hello world" | tr -d aeiou`.text();
    expect(result).toBe("hll wrld\n");
  });

  test("squeeze mode (-s) with single set", async () => {
    const result = await sh`echo "heeello" | tr -s e`.text();
    expect(result).toBe("hello\n");
  });

  test("squeeze spaces", async () => {
    const result = await sh`echo "a   b   c" | tr -s ' '`.text();
    expect(result).toBe("a b c\n");
  });

  test("translate and squeeze (-s with two sets)", async () => {
    const result = await sh`echo "aabbbcc" | tr -s ab xy`.text();
    expect(result).toBe("xycc\n");
  });

  test("complement mode (-c) with delete", async () => {
    const result = await sh`echo "hello 123 world" | tr -cd a-z`.text();
    expect(result).toBe("helloworld");
  });

  test("complement mode (-C) with delete", async () => {
    const result = await sh`echo "hello 123" | tr -Cd 0-9`.text();
    expect(result).toBe("123");
  });

  test("combined -ds flags", async () => {
    const result = await sh`echo "aabbccdd" | tr -ds ab cd`.text();
    expect(result).toBe("cd\n");
  });

  test("character class [:lower:] to [:upper:]", async () => {
    const result = await sh`echo hello | tr '[:lower:]' '[:upper:]'`.text();
    expect(result).toBe("HELLO\n");
  });

  test("character class [:digit:] delete", async () => {
    const result = await sh`echo "abc123def" | tr -d '[:digit:]'`.text();
    expect(result).toBe("abcdef\n");
  });

  test("empty input", async () => {
    const result = await sh`echo -n "" | tr a-z A-Z`.text();
    expect(result).toBe("");
  });

  test("no matching chars", async () => {
    const result = await sh`echo hello | tr xyz ABC`.text();
    expect(result).toBe("hello\n");
  });

  test("SET2 shorter than SET1 extends last char", async () => {
    const result = await sh`echo "abcde" | tr a-e xy`.text();
    expect(result).toBe("xyyyy\n");
  });

  test("pipeline with tr", async () => {
    const result = await sh`cat /hello.txt | tr a-z A-Z`.text();
    expect(result).toBe("HELLO WORLD\n");
  });

  test("missing operand shows error", async () => {
    const result = await sh`echo hi | tr`.nothrow();
    expect(result.exitCode).not.toBe(0);
  });
});
