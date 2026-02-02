import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("cat command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/file1.txt": "hello\n",
      "/file2.txt": "world\n",
      "/dir/nested.txt": "nested content\n",
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

  test("reads a single file", async () => {
    const result = await sh`cat /file1.txt`.text();
    expect(result).toBe("hello\n");
  });

  test("reads multiple files", async () => {
    const result = await sh`cat /file1.txt /file2.txt`.text();
    expect(result).toBe("hello\nworld\n");
  });

  test("reads from stdin when no files", async () => {
    const input = Buffer.from("stdin content\n");
    const result = await sh`cat < ${input}`.text();
    expect(result).toBe("stdin content\n");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`cat /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("nonexistent.txt");
  });

  test("reads nested file", async () => {
    const result = await sh`cat /dir/nested.txt`.text();
    expect(result).toBe("nested content\n");
  });

  test("invalid short flag returns error with usage", async () => {
    const result = await sh`cat -z /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("invalid long flag returns error with usage", async () => {
    const result = await sh`cat --invalid /file1.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unrecognized option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  // ============================================================
  // Flag Tests
  // ============================================================

  describe("-n flag (number all lines)", () => {
    test("numbers all lines", async () => {
      vol.writeFileSync("/numtest.txt", "a\nb\nc\n");
      const result = await sh`cat -n /numtest.txt`.text();
      expect(result).toBe("     1\ta\n     2\tb\n     3\tc\n");
    });

    test("numbers empty lines too", async () => {
      vol.writeFileSync("/numtest.txt", "a\n\nb\n");
      const result = await sh`cat -n /numtest.txt`.text();
      expect(result).toBe("     1\ta\n     2\t\n     3\tb\n");
    });

    test("continues numbering across files", async () => {
      const result = await sh`cat -n /file1.txt /file2.txt`.text();
      expect(result).toBe("     1\thello\n     2\tworld\n");
    });
  });

  describe("-b flag (number non-blank lines)", () => {
    test("numbers only non-blank lines", async () => {
      vol.writeFileSync("/numtest.txt", "a\n\nb\n");
      const result = await sh`cat -b /numtest.txt`.text();
      expect(result).toBe("     1\ta\n\n     2\tb\n");
    });

    test("skips multiple blank lines", async () => {
      vol.writeFileSync("/numtest.txt", "a\n\n\nb\n");
      const result = await sh`cat -b /numtest.txt`.text();
      expect(result).toBe("     1\ta\n\n\n     2\tb\n");
    });
  });

  describe("-E flag (show ends)", () => {
    test("shows $ at end of lines", async () => {
      const result = await sh`cat -E /file1.txt`.text();
      expect(result).toBe("hello$\n");
    });

    test("shows $ on empty lines", async () => {
      vol.writeFileSync("/endtest.txt", "a\n\nb\n");
      const result = await sh`cat -E /endtest.txt`.text();
      expect(result).toBe("a$\n$\nb$\n");
    });
  });

  describe("-T flag (show tabs)", () => {
    test("shows tabs as ^I", async () => {
      vol.writeFileSync("/tabtest.txt", "a\tb\tc\n");
      const result = await sh`cat -T /tabtest.txt`.text();
      expect(result).toBe("a^Ib^Ic\n");
    });
  });

  describe("-v flag (show non-printing)", () => {
    test("shows control characters as ^X", async () => {
      vol.writeFileSync("/ctrltest.txt", "a\x01b\x02c\n");
      const result = await sh`cat -v /ctrltest.txt`.text();
      expect(result).toBe("a^Ab^Bc\n");
    });

    test("shows DEL as ^?", async () => {
      vol.writeFileSync("/deltest.txt", "a\x7fb\n");
      const result = await sh`cat -v /deltest.txt`.text();
      expect(result).toBe("a^?b\n");
    });

    test("preserves tabs when only -v is used", async () => {
      vol.writeFileSync("/tabtest.txt", "a\tb\n");
      const result = await sh`cat -v /tabtest.txt`.text();
      expect(result).toBe("a\tb\n");
    });
  });

  describe("-A flag (show all)", () => {
    test("-A is equivalent to -vET", async () => {
      vol.writeFileSync("/alltest.txt", "a\tb\x01c\n");
      const result = await sh`cat -A /alltest.txt`.text();
      expect(result).toBe("a^Ib^Ac$\n");
    });

    test("-A with long flag --show-all", async () => {
      vol.writeFileSync("/alltest.txt", "a\tb\n");
      const result = await sh`cat --show-all /alltest.txt`.text();
      expect(result).toBe("a^Ib$\n");
    });
  });

  describe("combined flags", () => {
    test("-nE numbers and shows ends", async () => {
      vol.writeFileSync("/combo.txt", "a\nb\n");
      const result = await sh`cat -nE /combo.txt`.text();
      expect(result).toBe("     1\ta$\n     2\tb$\n");
    });

    test("-bE numbers non-blank and shows ends", async () => {
      vol.writeFileSync("/combo.txt", "a\n\nb\n");
      const result = await sh`cat -bE /combo.txt`.text();
      expect(result).toBe("     1\ta$\n$\n     2\tb$\n");
    });

    test("-vT shows non-printing and tabs", async () => {
      vol.writeFileSync("/combo.txt", "a\t\x01b\n");
      const result = await sh`cat -vT /combo.txt`.text();
      expect(result).toBe("a^I^Ab\n");
    });
  });
});
