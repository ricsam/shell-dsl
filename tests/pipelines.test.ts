import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Pipelines", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/data.txt": "apple\nbanana\ncherry\napricot\nblueberry\n",
      "/numbers.txt": "3\n1\n4\n1\n5\n9\n2\n6\n",
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

  test("simple two-command pipeline", async () => {
    const result = await sh`cat /data.txt | head -n 2`.text();
    expect(result).toBe("apple\nbanana\n");
  });

  test("three-command pipeline", async () => {
    const result = await sh`cat /data.txt | grep ^a | wc -l`.text();
    expect(result.trim()).toBe("2");
  });

  test("pipeline with sort", async () => {
    const result = await sh`cat /data.txt | sort`.text();
    expect(result).toBe("apple\napricot\nbanana\nblueberry\ncherry\n");
  });

  test("pipeline with sort and uniq", async () => {
    const result = await sh`cat /numbers.txt | sort -n | uniq`.text();
    expect(result).toBe("1\n2\n3\n4\n5\n6\n9\n");
  });

  test("pipeline with head and tail", async () => {
    const result = await sh`cat /data.txt | head -n 4 | tail -n 2`.text();
    expect(result).toBe("cherry\napricot\n");
  });

  test("long pipeline", async () => {
    // numbers.txt: 3,1,4,1,5,9,2,6 -> sort -n: 1,1,2,3,4,5,6,9 -> uniq: 1,2,3,4,5,6,9 -> head -n 3: 1,2,3 -> tail -n 1: 3
    const result = await sh`cat /numbers.txt | sort -n | uniq | head -n 3 | tail -n 1`.text();
    expect(result).toBe("3\n");
  });

  test("pipeline preserves exit code of last command", async () => {
    const result = await sh`echo hello | grep world`.nothrow();
    expect(result.exitCode).toBe(1);
  });

  test("pipeline with grep counting", async () => {
    // data.txt has: apple, banana, cherry, apricot, blueberry - only "blueberry" contains "berry"
    const result = await sh`cat /data.txt | grep -c berry`.text();
    expect(result.trim()).toBe("1");
  });
});
