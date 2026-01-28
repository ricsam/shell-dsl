import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

describe("grep --include/--exclude", () => {
  let vol: InstanceType<typeof Volume>;
  let sh: ReturnType<typeof createShellDSL>;

  beforeEach(() => {
    vol = new Volume();
    vol.fromJSON({
      "/src/app.ts": "const hello = 'world';\n",
      "/src/app.js": "const hello = 'world';\n",
      "/src/style.css": "/* hello */\n",
      "/src/readme.md": "hello docs\n",
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

  test("--include filters to matching files", async () => {
    const result = await sh`grep -r hello /src --include "*.ts"`.text();
    expect(result).toContain("app.ts");
    expect(result).not.toContain("app.js");
    expect(result).not.toContain("style.css");
  });

  test("--include with multiple patterns", async () => {
    const result = await sh`grep -r hello /src --include "*.ts" --include "*.js"`.text();
    expect(result).toContain("app.ts");
    expect(result).toContain("app.js");
    expect(result).not.toContain("style.css");
  });

  test("--exclude filters out matching files", async () => {
    const result = await sh`grep -r hello /src --exclude "*.css"`.text();
    expect(result).not.toContain("style.css");
    expect(result).toContain("app.ts");
  });
});
