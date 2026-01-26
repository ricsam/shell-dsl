import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";

describe("Command Substitution", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file.txt": "file content",
    });
    const memfs = createFsFromVolume(vol);
    const fs = createVirtualFS(memfs);

    sh = createShellDSL({
      fs,
      cwd: "/",
      env: { USER: "alice" },
      commands: builtinCommands,
    });
  });

  test("simple substitution", async () => {
    const result = await sh`echo $(echo hello)`.text();
    expect(result).toBe("hello\n");
  });

  test("substitution in middle of string", async () => {
    const result = await sh`echo "user: $(echo $USER)"`.text();
    expect(result).toBe("user: alice\n");
  });

  test("substitution with pipeline", async () => {
    const result = await sh`echo "count: $(cat /file.txt | wc -c)"`.text();
    expect(result).toContain("count:");
  });

  test("multiple substitutions", async () => {
    const result = await sh`echo $(echo a) $(echo b) $(echo c)`.text();
    expect(result).toBe("a b c\n");
  });

  test("nested substitution", async () => {
    const result = await sh`echo $(echo $(echo nested))`.text();
    expect(result).toBe("nested\n");
  });

  test("substitution strips trailing newlines", async () => {
    const result = await sh`echo "before$(echo -n middle)after"`.text();
    expect(result).toBe("beforemiddleafter\n");
  });

  test("substitution with pwd", async () => {
    const result = await sh`echo "cwd: $(pwd)"`.text();
    expect(result).toBe("cwd: /\n");
  });
});
