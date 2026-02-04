import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("cut command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/tsv.txt": "name\tage\tcity\nalice\t30\tnew york\nbob\t25\tboston\n",
      "/colon.txt": "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:user:/home/user:/bin/sh\n",
      "/nodelim.txt": "no tabs here\nalso no tabs\nhas\ta\ttab\n",
      "/chars.txt": "abcdefghij\n1234567890\nhello world\n",
      "/multi1.txt": "a\tb\tc\n",
      "/multi2.txt": "x\ty\tz\n",
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

  test("-f1 selects first field (tab-delimited)", async () => {
    const result = await sh`cut -f1 /tsv.txt`.text();
    expect(result).toBe("name\nalice\nbob\n");
  });

  test("-f1,3 selects multiple fields", async () => {
    const result = await sh`cut -f1,3 /tsv.txt`.text();
    expect(result).toBe("name\tcity\nalice\tnew york\nbob\tboston\n");
  });

  test("-f2-4 selects field range", async () => {
    const result = await sh`cut -d: -f2-4 /colon.txt`.text();
    expect(result).toBe("x:0:0\nx:1000:1000\n");
  });

  test("-f3- selects from field 3 to end", async () => {
    const result = await sh`cut -d: -f3- /colon.txt`.text();
    expect(result).toBe("0:0:root:/root:/bin/bash\n1000:1000:user:/home/user:/bin/sh\n");
  });

  test("-f-2 selects fields 1 through 2", async () => {
    const result = await sh`cut -f-2 /tsv.txt`.text();
    expect(result).toBe("name\tage\nalice\t30\nbob\t25\n");
  });

  test("-d: -f1 uses custom delimiter", async () => {
    const result = await sh`cut -d: -f1 /colon.txt`.text();
    expect(result).toBe("root\nuser\n");
  });

  test("-s suppresses lines without delimiter", async () => {
    const result = await sh`cut -f1 -s /nodelim.txt`.text();
    expect(result).toBe("has\n");
  });

  test("lines without delimiter are output unchanged without -s", async () => {
    const result = await sh`cut -f1 /nodelim.txt`.text();
    expect(result).toBe("no tabs here\nalso no tabs\nhas\n");
  });

  test("-c1-5 selects characters", async () => {
    const result = await sh`cut -c1-5 /chars.txt`.text();
    expect(result).toBe("abcde\n12345\nhello\n");
  });

  test("-b1-5 selects bytes (same as characters)", async () => {
    const result = await sh`cut -b1-5 /chars.txt`.text();
    expect(result).toBe("abcde\n12345\nhello\n");
  });

  test("--complement inverts field selection", async () => {
    const result = await sh`cut -f2 --complement /tsv.txt`.text();
    expect(result).toBe("name\tcity\nalice\tnew york\nbob\tboston\n");
  });

  test("--complement inverts character selection", async () => {
    const result = await sh`cut -c1-3 --complement /chars.txt`.text();
    expect(result).toBe("defghij\n4567890\nlo world\n");
  });

  test("--output-delimiter sets output delimiter", async () => {
    const result = await sh`cut -f1,3 --output-delimiter=, /tsv.txt`.text();
    expect(result).toBe("name,city\nalice,new york\nbob,boston\n");
  });

  test("reads from piped stdin", async () => {
    const result = await sh`echo "a:b:c" | cut -d: -f2`.text();
    expect(result).toBe("b\n");
  });

  test("handles multiple file arguments", async () => {
    const result = await sh`cut -f1 /multi1.txt /multi2.txt`.text();
    expect(result).toBe("a\nx\n");
  });

  test("error when no -b/-c/-f flag given", async () => {
    const result = await sh`cut /tsv.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("you must specify");
  });

  test("error when multiple of -b/-c/-f given", async () => {
    const result = await sh`cut -b1 -c1 /tsv.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("only one type");
  });

  test("error on nonexistent file", async () => {
    const result = await sh`cut -f1 /nonexistent.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file");
  });

  test("invalid flag returns error with usage", async () => {
    const result = await sh`cut -x /tsv.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid option");
    expect(result.stderr.toString()).toContain("usage:");
  });

  test("-c with single index", async () => {
    const result = await sh`cut -c3 /chars.txt`.text();
    expect(result).toBe("c\n3\nl\n");
  });

  test("-f with comma-separated and ranges mixed", async () => {
    const result = await sh`cut -d: -f1,5-6 /colon.txt`.text();
    expect(result).toBe("root:root:/root\nuser:user:/home/user\n");
  });
});
