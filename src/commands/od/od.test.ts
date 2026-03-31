import { beforeEach, describe, expect, test } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createShellDSL, createVirtualFS } from "../../index.ts";
import { builtinCommands } from "../index.ts";

describe("od command", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/sample.txt": "ABCD\n",
      "/first.bin": "AB",
      "/second.bin": "CD",
    });

    const fs = createVirtualFS(createFsFromVolume(vol));
    sh = createShellDSL({
      fs,
      cwd: "/",
      env: {},
      commands: builtinCommands,
    });
  });

  test("uses the default o2 output for files", async () => {
    const result = await sh`od /sample.txt`.text();
    expect(result).toBe("0000000    041101  042103  000012\n0000005\n");
  });

  test("uses the default o2 output for stdin", async () => {
    const input = Buffer.from("ABCD\n");
    const result = await sh`od < ${input}`.text();
    expect(result).toBe("0000000    041101  042103  000012\n0000005\n");
  });

  test("supports od -An -t x1", async () => {
    const result = await sh`od -An -t x1 /sample.txt`.text();
    expect(result).toBe("           41  42  43  44  0a\n");
  });

  test("supports decimal, octal, and hexadecimal address radices", async () => {
    vol.writeFileSync("/big.bin", Buffer.alloc(300));

    const octal = await sh`od -A o -j 255 -N 1 /big.bin`.text();
    const decimal = await sh`od -A d -j 255 -N 1 /big.bin`.text();
    const hex = await sh`od -A x -j 255 -N 1 /big.bin`.text();

    expect(octal).toBe("0000377    000000\n0000400\n");
    expect(decimal).toBe("0000255    000000\n0000256\n");
    expect(hex).toBe("00000ff    000000\n0000100\n");
  });

  test("suppresses addresses and the trailing offset with -A n", async () => {
    const result = await sh`od -A n -t x1 /sample.txt`.text();
    expect(result).toBe("           41  42  43  44  0a\n");
  });

  test("supports -j and -N together", async () => {
    const result = await sh`od -t x1 -j 2 -N 3 /sample.txt`.text();
    expect(result).toBe("0000002    43  44  0a\n0000005\n");
  });

  test("concatenates multiple files into one logical stream", async () => {
    const result = await sh`od -t x1 /first.bin /second.bin`.text();
    expect(result).toBe("0000000    41  42  43  44\n0000004\n");
  });

  test("squeezes duplicate rows by default", async () => {
    vol.writeFileSync("/zeros.bin", Buffer.alloc(64));
    const row = Array.from({ length: 16 }, () => "00").join("  ");

    const result = await sh`od -t x1 /zeros.bin`.text();
    expect(result).toBe(`0000000    ${row}\n*\n0000100\n`);
  });

  test("shows every duplicate row with -v", async () => {
    vol.writeFileSync("/zeros.bin", Buffer.alloc(64));
    const row = Array.from({ length: 16 }, () => "00").join("  ");

    const result = await sh`od -v -t x1 /zeros.bin`.text();
    expect(result).toBe(
      `0000000    ${row}\n` +
      `0000020    ${row}\n` +
      `0000040    ${row}\n` +
      `0000060    ${row}\n` +
      "0000100\n"
    );
  });

  test("zero-pads trailing partial words for x2 and o2 output", async () => {
    vol.writeFileSync("/odd.bin", Buffer.from("ABC"));

    const hex = await sh`od -An -t x2 /odd.bin`.text();
    const octal = await sh`od /odd.bin`.text();

    expect(hex).toBe("           4241  0043\n");
    expect(octal).toBe("0000000    041101  000103\n0000003\n");
  });

  test("shorthand format flags match their -t equivalents", async () => {
    const cases = [
      ["-b", "o1"],
      ["-c", "c"],
      ["-o", "o2"],
      ["-x", "x2"],
    ] as const;

    for (const [shortFlag, type] of cases) {
      const shorthand = await sh`od ${shortFlag} /sample.txt`.text();
      const explicit = await sh`od -t ${type} /sample.txt`.text();
      expect(shorthand).toBe(explicit);
    }
  });

  test("rejects repeated format selectors", async () => {
    const result = await sh`od -x -t x1 /sample.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("multiple output formats");
  });

  test("rejects unsupported type strings", async () => {
    const result = await sh`od -t z1 /sample.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid type string");
  });

  test("rejects unsupported address radices", async () => {
    const result = await sh`od -A q /sample.txt`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid address radix");
  });

  test("rejects invalid count and skip values", async () => {
    const badCount = await sh`od -N nope /sample.txt`.nothrow();
    const badSkip = await sh`od -j -1 /sample.txt`.nothrow();

    expect(badCount.exitCode).toBe(1);
    expect(badCount.stderr.toString()).toContain("invalid byte count");
    expect(badSkip.exitCode).toBe(1);
    expect(badSkip.stderr.toString()).toContain("invalid skip");
  });

  test("returns an error for missing files", async () => {
    const result = await sh`od /missing.bin`.nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No such file or directory");
  });
});
