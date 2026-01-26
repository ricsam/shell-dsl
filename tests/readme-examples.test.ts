import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import {
  createVirtualFS,
  createShellDSL,
  ShellError,
  type Command,
} from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";

/**
 * This test file validates all code examples from the README.md
 * to ensure documentation stays in sync with implementation.
 */

describe("README Examples", () => {
  describe("Getting Started", () => {
    test("quickstart example", async () => {
      const vol = new Volume();
      vol.fromJSON({ "/data.txt": "foo\nbar\nbaz\n" });

      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: { USER: "alice" },
        commands: builtinCommands,
      });

      const count = await sh`cat /data.txt | grep foo | wc -l`.text();
      expect(count.trim()).toBe("1");
    });

    test("basic greeting with variable expansion", async () => {
      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: { USER: "alice", HOME: "/home/alice" },
        commands: builtinCommands,
      });

      const greeting = await sh`echo "Hello, $USER"`.text();
      expect(greeting).toBe("Hello, alice\n");
    });
  });

  describe("Output Methods", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/data.txt": "line1\nline2\nline3\n",
        "/config.json": '{"key": "value"}',
        "/binary.dat": Buffer.from([0x00, 0x01, 0x02]),
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test(".text() returns string", async () => {
      const result = await sh`echo hello`.text();
      expect(result).toBe("hello\n");
    });

    test(".json() parses JSON", async () => {
      const result = await sh`cat /config.json`.json<{ key: string }>();
      expect(result).toEqual({ key: "value" });
    });

    test(".lines() returns async iterator", async () => {
      const lines: string[] = [];
      for await (const line of sh`cat /data.txt`.lines()) {
        lines.push(line);
      }
      expect(lines).toEqual(["line1", "line2", "line3"]);
    });

    test(".buffer() returns Buffer", async () => {
      const buf = await sh`cat /binary.dat`.buffer();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf).toEqual(Buffer.from([0x00, 0x01, 0x02]));
    });

    test(".blob() returns Blob", async () => {
      const blob = await sh`echo hello`.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(await blob.text()).toBe("hello\n");
    });
  });

  describe("Error Handling", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("ShellError contains exitCode, stderr, stdout", async () => {
      try {
        await sh`cat /nonexistent`;
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
        if (err instanceof ShellError) {
          expect(err.exitCode).toBe(1);
          expect(err.stderr.toString()).toContain("nonexistent");
          expect(err.stdout.toString()).toBe("");
        }
      }
    });

    test(".nothrow() suppresses throwing", async () => {
      const result = await sh`cat /nonexistent`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test(".throws(false) suppresses throwing", async () => {
      const result = await sh`cat /nonexistent`.throws(false);
      expect(result.exitCode).toBe(1);
    });

    test("sh.throws(false) disables throwing globally", async () => {
      sh.throws(false);
      const result = await sh`cat /nonexistent`;
      expect(result.exitCode).toBe(1);
    });

    test("per-command .throws(true) overrides global", async () => {
      sh.throws(false);
      try {
        await sh`cat /nonexistent`.throws(true);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ShellError);
      }
    });
  });

  describe("Piping", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/data.txt": "foo\nbar\nbaz\nfoo bar\n",
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("pipe connects commands", async () => {
      const result = await sh`cat /data.txt | grep foo | wc -l`.text();
      expect(result.trim()).toBe("2");
    });
  });

  describe("Control Flow Operators", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/config.json": '{"key": "value"}',
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("sequential execution (;)", async () => {
      const result = await sh`echo one; echo two; echo three`.text();
      expect(result).toBe("one\ntwo\nthree\n");
    });

    test("AND operator (&&) runs on success", async () => {
      const result = await sh`test -f /config.json && echo exists`.text();
      expect(result).toBe("exists\n");
    });

    test("AND operator (&&) skips on failure", async () => {
      const result = await sh`test -f /nonexistent && echo exists`.nothrow();
      expect(result.stdout.toString()).toBe("");
    });

    test("OR operator (||) runs on failure", async () => {
      const result = await sh`cat /nonexistent || echo "default config"`.text();
      expect(result).toBe("default config\n");
    });

    test("OR operator (||) skips on success", async () => {
      const result = await sh`cat /config.json || echo "default"`.text();
      expect(result).toBe('{"key": "value"}');
    });

    test("combined operators", async () => {
      const result = await sh`mkdir -p /out && echo "created" || echo "failed"`.text();
      expect(result).toBe("created\n");
    });
  });

  describe("Redirection", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/input.txt": "hello world",
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("input redirection (<)", async () => {
      const result = await sh`cat < /input.txt`.text();
      expect(result).toBe("hello world");
    });

    test("output redirection (>) overwrites", async () => {
      await sh`echo "content" > /output.txt`;
      expect(vol.readFileSync("/output.txt", "utf8")).toBe("content\n");
    });

    test("append redirection (>>)", async () => {
      vol.writeFileSync("/output.txt", "line1\n");
      await sh`echo "more" >> /output.txt`;
      expect(vol.readFileSync("/output.txt", "utf8")).toBe("line1\nmore\n");
    });

    test("stderr redirection (2>)", async () => {
      await sh`cat /nonexistent 2> /errors.txt`.nothrow();
      const errors = vol.readFileSync("/errors.txt", "utf8");
      expect(errors).toContain("nonexistent");
    });

    test("2>&1 redirects stderr to stdout", async () => {
      const result = await sh`cat /nonexistent 2>&1`.nothrow();
      expect(result.stdout.toString()).toContain("nonexistent");
      expect(result.stderr.toString()).toBe("");
    });

    test("1>&2 redirects stdout to stderr", async () => {
      const result = await sh`echo "message" 1>&2`;
      expect(result.stderr.toString()).toBe("message\n");
      expect(result.stdout.toString()).toBe("");
    });

    test("&> redirects both to file", async () => {
      vol.writeFileSync("/data.txt", "content");
      await sh`cat /data.txt /nonexistent &> /all.txt`.nothrow();
      const output = vol.readFileSync("/all.txt", "utf8");
      expect(output).toContain("content");
      expect(output).toContain("nonexistent");
    });
  });

  describe("Environment Variables", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: { USER: "alice", HOME: "/home/alice" },
        commands: builtinCommands,
      });
    });

    test("$VAR expansion", async () => {
      const result = await sh`echo $USER`.text();
      expect(result).toBe("alice\n");
    });

    test("variable in double quotes", async () => {
      const result = await sh`echo "Home: $HOME"`.text();
      expect(result).toBe("Home: /home/alice\n");
    });

    test("double quotes expand variables", async () => {
      const result = await sh`echo "Hello $USER"`.text();
      expect(result).toBe("Hello alice\n");
    });

    test("single quotes are literal", async () => {
      const result = await sh`echo 'Hello $USER'`.text();
      expect(result).toBe("Hello $USER\n");
    });

    test("inline assignment with &&", async () => {
      const result = await sh`FOO=bar && echo $FOO`.text();
      expect(result).toBe("bar\n");
    });

    test("scoped variable assignment", async () => {
      const result = await sh`FOO=bar echo $FOO`.text();
      expect(result).toBe("bar\n");
    });

    test("per-command .env() override", async () => {
      const result = await sh`echo $CUSTOM`.env({ CUSTOM: "value" }).text();
      expect(result).toBe("value\n");
    });

    test("sh.env() sets global variables", async () => {
      sh.env({ API_KEY: "secret" });
      const result = await sh`echo $API_KEY`.text();
      expect(result).toBe("secret\n");
    });

    test("sh.resetEnv() restores initial environment", async () => {
      sh.env({ USER: "bob" });
      sh.resetEnv();
      const result = await sh`echo $USER`.text();
      expect(result).toBe("alice\n");
    });
  });

  describe("Glob Expansion", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/a.txt": "a",
        "/b.txt": "b",
        "/c.txt": "c",
        "/file1.txt": "1",
        "/file2.txt": "2",
        "/file3.txt": "3",
        "/src/index.ts": "index",
        "/src/lib/utils.ts": "utils",
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("* wildcard matches files", async () => {
      const result = await sh`ls *.txt`.text();
      expect(result).toContain("a.txt");
      expect(result).toContain("b.txt");
      expect(result).toContain("c.txt");
    });

    test("character class [123]", async () => {
      const result = await sh`echo file[123].txt`.text();
      expect(result.trim()).toContain("file1.txt");
      expect(result.trim()).toContain("file2.txt");
      expect(result.trim()).toContain("file3.txt");
    });

    test("brace expansion {a,b,c}", async () => {
      const result = await sh`echo {a,b,c}.txt`.text();
      // Brace expansion returns absolute paths when files exist
      expect(result.trim()).toBe("/a.txt /b.txt /c.txt");
    });

    test("** recursive glob", async () => {
      const result = await sh`cat /src/**/*.ts`.text();
      expect(result).toContain("index");
      expect(result).toContain("utils");
    });
  });

  describe("Command Substitution", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/file.txt": "content",
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("$(command) substitution", async () => {
      const result = await sh`echo "Current dir: $(pwd)"`.text();
      expect(result).toBe("Current dir: /\n");
    });

    test("nested substitution", async () => {
      const result = await sh`echo "Files: $(ls $(pwd))"`.text();
      expect(result).toContain("file.txt");
    });
  });

  describe("Defining Custom Commands", () => {
    test("custom hello command", async () => {
      const hello: Command = async (ctx) => {
        const name = ctx.args[0] ?? "World";
        await ctx.stdout.writeText(`Hello, ${name}!\n`);
        return 0;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { ...builtinCommands, hello },
      });

      const result = await sh`hello Alice`.text();
      expect(result).toBe("Hello, Alice!\n");
    });

    test("custom echo implementation", async () => {
      const myEcho: Command = async (ctx) => {
        await ctx.stdout.writeText(ctx.args.join(" ") + "\n");
        return 0;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { myEcho },
      });

      const result = await sh`myEcho foo bar baz`.text();
      expect(result).toBe("foo bar baz\n");
    });

    test("custom cat reading from stdin", async () => {
      const myCat: Command = async (ctx) => {
        if (ctx.args.length === 0) {
          for await (const chunk of ctx.stdin.stream()) {
            await ctx.stdout.write(chunk);
          }
        } else {
          for (const file of ctx.args) {
            const path = ctx.fs.resolve(ctx.cwd, file);
            const content = await ctx.fs.readFile(path);
            await ctx.stdout.write(new Uint8Array(content));
          }
        }
        return 0;
      };

      const vol = new Volume();
      vol.fromJSON({ "/test.txt": "file content" });
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { ...builtinCommands, myCat },
      });

      // Test reading from file
      const fileResult = await sh`myCat /test.txt`.text();
      expect(fileResult).toBe("file content");

      // Test reading from stdin via pipe
      const pipeResult = await sh`echo "piped" | myCat`.text();
      expect(pipeResult).toBe("piped\n");
    });

    test("custom grep with stdin.lines()", async () => {
      const myGrep: Command = async (ctx) => {
        const pattern = ctx.args[0];
        if (!pattern) {
          await ctx.stderr.writeText("grep: missing pattern\n");
          return 1;
        }

        const regex = new RegExp(pattern);
        let found = false;

        for await (const line of ctx.stdin.lines()) {
          if (regex.test(line)) {
            await ctx.stdout.writeText(line + "\n");
            found = true;
          }
        }

        return found ? 0 : 1;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { ...builtinCommands, myGrep },
      });

      const result = await sh`echo "foo\nbar\nfoo bar" | myGrep foo`.text();
      expect(result).toBe("foo\nfoo bar\n");
    });

    test("custom uppercase command", async () => {
      const upper: Command = async (ctx) => {
        const text = await ctx.stdin.text();
        await ctx.stdout.writeText(text.toUpperCase());
        return 0;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { ...builtinCommands, upper },
      });

      const result = await sh`echo "hello" | upper`.text();
      expect(result).toBe("HELLO\n");
    });

    test("command returning non-zero exit code", async () => {
      const fail: Command = async (ctx) => {
        await ctx.stderr.writeText("Error occurred\n");
        return 42;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { fail },
      });

      const result = await sh`fail`.nothrow();
      expect(result.exitCode).toBe(42);
      expect(result.stderr.toString()).toBe("Error occurred\n");
    });

    test("command accessing filesystem", async () => {
      const writeFile: Command = async (ctx) => {
        const [filename, ...content] = ctx.args;
        if (!filename) {
          await ctx.stderr.writeText("Usage: writeFile <filename> <content>\n");
          return 1;
        }
        const path = ctx.fs.resolve(ctx.cwd, filename);
        await ctx.fs.writeFile(path, content.join(" "));
        return 0;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: { ...builtinCommands, writeFile },
      });

      await sh`writeFile /test.txt hello world`;
      expect(vol.readFileSync("/test.txt", "utf8")).toBe("hello world");
    });

    test("command using environment variables", async () => {
      const greet: Command = async (ctx) => {
        const user = ctx.env.USER ?? "stranger";
        await ctx.stdout.writeText(`Hello, ${user}!\n`);
        return 0;
      };

      const vol = new Volume();
      const sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: { USER: "bob" },
        commands: { greet },
      });

      const result = await sh`greet`.text();
      expect(result).toBe("Hello, bob!\n");
    });
  });

  describe("Built-in Commands", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.fromJSON({
        "/data.txt": "foo\nfoo\nbar\nbaz\n",
        "/numbers.txt": "3\n1\n2\n",
      });
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("echo prints arguments", async () => {
      const result = await sh`echo hello world`.text();
      expect(result).toBe("hello world\n");
    });

    test("cat reads files", async () => {
      const result = await sh`cat /data.txt`.text();
      expect(result).toBe("foo\nfoo\nbar\nbaz\n");
    });

    test("grep searches patterns", async () => {
      const result = await sh`grep foo /data.txt`.text();
      expect(result).toBe("foo\nfoo\n");
    });

    test("wc -l counts lines", async () => {
      const result = await sh`wc -l /data.txt`.text();
      // wc includes filename in output
      expect(result.trim()).toBe("4 /data.txt");
    });

    test("head outputs first lines", async () => {
      const result = await sh`head -n 2 /data.txt`.text();
      expect(result).toBe("foo\nfoo\n");
    });

    test("tail outputs last lines", async () => {
      const result = await sh`tail -n 2 /data.txt`.text();
      expect(result).toBe("bar\nbaz\n");
    });

    test("sort sorts lines", async () => {
      const result = await sh`sort /data.txt`.text();
      expect(result).toBe("bar\nbaz\nfoo\nfoo\n");
    });

    test("sort -n sorts numerically", async () => {
      const result = await sh`sort -n /numbers.txt`.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("uniq removes duplicates", async () => {
      const result = await sh`cat /data.txt | sort | uniq`.text();
      expect(result).toBe("bar\nbaz\nfoo\n");
    });

    test("pwd prints working directory", async () => {
      const result = await sh`pwd`.text();
      expect(result).toBe("/\n");
    });

    test("ls lists directory", async () => {
      const result = await sh`ls /`.text();
      expect(result).toContain("data.txt");
      expect(result).toContain("numbers.txt");
    });

    test("mkdir creates directory", async () => {
      await sh`mkdir /newdir`;
      expect(vol.statSync("/newdir").isDirectory()).toBe(true);
    });

    test("mkdir -p creates parent directories", async () => {
      await sh`mkdir -p /a/b/c`;
      expect(vol.statSync("/a/b/c").isDirectory()).toBe(true);
    });

    test("rm removes files", async () => {
      await sh`rm /data.txt`;
      expect(vol.existsSync("/data.txt")).toBe(false);
    });

    test("test -f checks file existence", async () => {
      const result1 = await sh`test -f /data.txt && echo yes`.text();
      expect(result1).toBe("yes\n");

      const result2 = await sh`test -f /nonexistent && echo yes || echo no`.text();
      expect(result2).toBe("no\n");
    });

    test("true exits with 0", async () => {
      const result = await sh`true`;
      expect(result.exitCode).toBe(0);
    });

    test("false exits with 1", async () => {
      const result = await sh`false`.nothrow();
      expect(result.exitCode).toBe(1);
    });
  });

  describe("Virtual Filesystem", () => {
    test("createVirtualFS wraps memfs", async () => {
      const vol = new Volume();
      vol.fromJSON({
        "/data.txt": "file content",
        "/config.json": '{"key": "value"}',
      });

      const fs = createVirtualFS(createFsFromVolume(vol));

      expect(await fs.exists("/data.txt")).toBe(true);
      expect((await fs.readFile("/data.txt")).toString()).toBe("file content");
      expect(await fs.exists("/nonexistent")).toBe(false);
    });

    test("VirtualFS methods work correctly", async () => {
      const vol = new Volume();
      const fs = createVirtualFS(createFsFromVolume(vol));

      // writeFile
      await fs.writeFile("/test.txt", "hello");
      expect(vol.readFileSync("/test.txt", "utf8")).toBe("hello");

      // appendFile
      await fs.appendFile("/test.txt", " world");
      expect(vol.readFileSync("/test.txt", "utf8")).toBe("hello world");

      // mkdir
      await fs.mkdir("/newdir");
      expect(vol.statSync("/newdir").isDirectory()).toBe(true);

      // mkdir recursive
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(vol.statSync("/a/b/c").isDirectory()).toBe(true);

      // readdir
      const entries = await fs.readdir("/");
      expect(entries).toContain("test.txt");
      expect(entries).toContain("newdir");

      // stat
      const stat = await fs.stat("/test.txt");
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);

      // rm
      await fs.rm("/test.txt");
      expect(vol.existsSync("/test.txt")).toBe(false);

      // resolve, dirname, basename
      expect(fs.resolve("/a", "b", "c")).toBe("/a/b/c");
      expect(fs.dirname("/a/b/c")).toBe("/a/b");
      expect(fs.basename("/a/b/c")).toBe("c");
    });
  });

  describe("Low-Level API", () => {
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      const vol = new Volume();
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("sh.lex() tokenizes source", () => {
      const tokens = sh.lex("cat foo | grep bar");
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some((t) => t.type === "word")).toBe(true);
      expect(tokens.some((t) => t.type === "pipe")).toBe(true);
    });

    test("sh.parse() creates AST", () => {
      const tokens = sh.lex("cat foo | grep bar");
      const ast = sh.parse(tokens);
      expect(ast.type).toBe("pipeline");
    });

    test("sh.compile() creates program", () => {
      const tokens = sh.lex("echo hello");
      const ast = sh.parse(tokens);
      const program = sh.compile(ast);
      expect(program.ast).toBe(ast);
    });

    test("sh.run() executes program", async () => {
      const tokens = sh.lex("echo hello");
      const ast = sh.parse(tokens);
      const program = sh.compile(ast);
      const result = await sh.run(program);
      expect(result.stdout.toString()).toBe("hello\n");
    });

    test("sh.escape() escapes special characters", () => {
      expect(sh.escape("hello world")).toBe("'hello world'");
      expect(sh.escape("$(rm -rf /)")).toBe("'$(rm -rf /)'");
      expect(sh.escape("safe")).toBe("safe");
    });
  });

  describe("Safety & Security", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: {},
        commands: builtinCommands,
      });
    });

    test("interpolated values are escaped by default", async () => {
      const dangerous = '$(echo hacked)';
      const result = await sh`echo ${dangerous}`.text();
      expect(result).toBe('$(echo hacked)\n');
    });

    test("semicolons in interpolation are escaped", async () => {
      const dangerous = 'foo; echo injected';
      const result = await sh`echo ${dangerous}`.text();
      expect(result).toBe('foo; echo injected\n');
    });

    test("raw escape hatch bypasses escaping", async () => {
      const result = await sh`echo ${{ raw: "$(echo works)" }}`.text();
      expect(result).toBe("works\n");
    });

    test("unregistered commands fail", async () => {
      try {
        await sh`unknownCommand arg1 arg2`;
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  describe("Context Overrides", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      vol.mkdirSync("/subdir");
      sh = createShellDSL({
        fs: createVirtualFS(createFsFromVolume(vol)),
        cwd: "/",
        env: { INITIAL: "value" },
        commands: builtinCommands,
      });
    });

    test(".cwd() overrides working directory", async () => {
      const result = await sh`pwd`.cwd("/subdir").text();
      expect(result).toBe("/subdir\n");
    });

    test("sh.cwd() sets global working directory", async () => {
      sh.cwd("/subdir");
      const result = await sh`pwd`.text();
      expect(result).toBe("/subdir\n");
    });

    test("sh.resetCwd() restores initial cwd", async () => {
      sh.cwd("/subdir");
      sh.resetCwd();
      const result = await sh`pwd`.text();
      expect(result).toBe("/\n");
    });
  });
});
