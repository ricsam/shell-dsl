import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

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

  describe("Nested command substitution", () => {
    test("deeply nested substitution", async () => {
      const result = await sh`echo $(echo $(echo deep))`.text();
      expect(result).toBe("deep\n");
    });

    test("nested substitution with multiple commands", async () => {
      vol.writeFileSync("/test1.txt", "test content");
      const result = await sh`echo "Files in $(pwd): $(ls -1 $(pwd))"`.text();
      expect(result).toContain("Files in /:");
    });

    test("nested substitution with variable expansion", async () => {
      const result = await sh`echo $(echo "User: $USER")`.text();
      expect(result).toBe("User: alice\n");
    });

    test("multiple nested substitutions", async () => {
      const result = await sh`echo $(echo first) $(echo $(echo second))`.text();
      expect(result).toBe("first second\n");
    });

    test("nested substitution in arguments", async () => {
      vol.writeFileSync("/data.txt", "hello world");
      const result = await sh`cat $(echo /data.txt)`.text();
      expect(result).toBe("hello world");
    });

    test("three levels of nesting", async () => {
      const result = await sh`echo $(echo $(echo $(echo triple)))`.text();
      expect(result).toBe("triple\n");
    });

    test("nested substitution with pipeline", async () => {
      vol.writeFileSync("/lines.txt", "line1\nline2\nline3");
      const result = await sh`echo "Count: $(cat /lines.txt | wc -l)"`.text();
      expect(result).toContain("Count:");
    });
  });
});
