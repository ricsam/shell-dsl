# shell-dsl

A sandboxed shell-style DSL for running scriptable command pipelines where all commands are explicitly registered and executed in-process, without access to the host OS.

```ts
import { createShellDSL, createVirtualFS } from "shell-dsl";
import { createFsFromVolume, Volume } from "memfs";
import { builtinCommands } from "shell-dsl/commands";

const vol = new Volume();
vol.fromJSON({ "/data.txt": "foo\nbar\nbaz\n" });

const sh = createShellDSL({
  fs: createVirtualFS(createFsFromVolume(vol)),
  cwd: "/",
  env: { USER: "alice" },
  commands: builtinCommands,
});

const count = await sh`cat /data.txt | grep foo | wc -l`.text();
console.log(count.trim()); // "1"
```

## Installation

```bash
bun add shell-dsl memfs
```

## Features

- **Sandboxed execution** — No host OS access; all commands run in-process
- **Virtual filesystem** — Uses memfs for complete isolation from the real filesystem
- **Real filesystem** — Optional sandboxed access to real files with path containment and permissions
- **Explicit command registry** — Only registered commands can execute
- **Automatic escaping** — Interpolated values are escaped by default for safety
- **POSIX-inspired syntax** — Pipes, redirects, control flow operators, and more
- **Streaming pipelines** — Commands communicate via async iteration
- **TypeScript-first** — Full type definitions included

## Getting Started

Create a `ShellDSL` instance by providing a virtual filesystem, working directory, environment variables, and a command registry:

```ts
import { createShellDSL, createVirtualFS } from "shell-dsl";
import { createFsFromVolume, Volume } from "memfs";
import { builtinCommands } from "shell-dsl/commands";

const vol = new Volume();
const sh = createShellDSL({
  fs: createVirtualFS(createFsFromVolume(vol)),
  cwd: "/",
  env: { USER: "alice", HOME: "/home/alice" },
  commands: builtinCommands,
});

const greeting = await sh`echo "Hello, $USER"`.text();
console.log(greeting); // "Hello, alice\n"
```

## Output Methods

Every shell command returns a `ShellPromise` that can be consumed in different formats:

```ts
// String output
await sh`echo hello`.text();           // "hello\n"

// Parsed JSON
await sh`cat config.json`.json();      // { key: "value" }

// Async line iterator
for await (const line of sh`cat data.txt`.lines()) {
  console.log(line);
}

// Raw Buffer
await sh`cat binary.dat`.buffer();     // Buffer

// Blob
await sh`cat image.png`.blob();        // Blob
```

## Error Handling

By default, commands with non-zero exit codes throw a `ShellError`:

```ts
import { ShellError } from "shell-dsl";

try {
  await sh`cat /nonexistent`;
} catch (err) {
  if (err instanceof ShellError) {
    console.log(err.exitCode);          // 1
    console.log(err.stderr.toString()); // "cat: /nonexistent: ..."
    console.log(err.stdout.toString()); // ""
  }
}
```

### Disabling Throws

Use `.nothrow()` to suppress throwing for a single command:

```ts
const result = await sh`cat /nonexistent`.nothrow();
console.log(result.exitCode); // 1
```

Use `.throws(boolean)` for explicit control:

```ts
const result = await sh`cat /nonexistent`.throws(false);
```

### Global Throw Setting

Disable throwing globally with `sh.throws(false)`:

```ts
sh.throws(false);
const result = await sh`cat /nonexistent`;
console.log(result.exitCode); // 1

// Per-command override still works
await sh`cat /nonexistent`.throws(true); // This throws
```

## Piping

Use `|` to connect commands. Data flows between commands via async streams:

```ts
const result = await sh`cat /data.txt | grep pattern | wc -l`.text();
```

Each command in the pipeline receives the previous command's stdout as its stdin.

## Control Flow Operators

### Sequential Execution (`;`)

Run commands one after another, regardless of exit codes:

```ts
await sh`echo one; echo two; echo three`.text();
// "one\ntwo\nthree\n"
```

### AND Operator (`&&`)

Run the next command only if the previous one succeeds (exit code 0):

```ts
await sh`test -f /config.json && cat /config.json`;
```

### OR Operator (`||`)

Run the next command only if the previous one fails (non-zero exit code):

```ts
await sh`cat /config.json || echo "default config"`;
```

### Combined Operators

```ts
await sh`mkdir -p /out && echo "created" || echo "failed"`;
```

## Redirection

### Input Redirection (`<`)

Read stdin from a file:

```ts
await sh`cat < /input.txt`.text();
```

### Output Redirection (`>`, `>>`)

Write stdout to a file:

```ts
// Overwrite
await sh`echo "content" > /output.txt`;

// Append
await sh`echo "more" >> /output.txt`;
```

### Stderr Redirection (`2>`, `2>>`)

```ts
await sh`cmd 2> /errors.txt`;    // stderr to file
await sh`cmd 2>> /errors.txt`;   // append stderr
```

### File Descriptor Redirects

| Redirect | Effect |
|----------|--------|
| `2>&1` | Redirect stderr to stdout |
| `1>&2` | Redirect stdout to stderr |
| `&>` | Redirect both stdout and stderr to file |
| `&>>` | Append both stdout and stderr to file |

```ts
// Capture both stdout and stderr
const result = await sh`cmd 2>&1`.text();

// Write both to file
await sh`cmd &> /all-output.txt`;
```

## Environment Variables

### Variable Expansion

Variables are expanded with `$VAR` or `${VAR}` syntax:

```ts
const sh = createShellDSL({
  // ...
  env: { USER: "alice", HOME: "/home/alice" },
});

await sh`echo $USER`.text();        // "alice\n"
await sh`echo "Home: $HOME"`.text(); // "Home: /home/alice\n"
```

### Quoting Semantics

| Quote | Behavior |
|-------|----------|
| `"..."` | Variables expanded, special chars preserved |
| `'...'` | Literal string, no expansion |

```ts
await sh`echo "Hello $USER"`.text();  // "Hello alice\n"
await sh`echo 'Hello $USER'`.text();  // "Hello $USER\n"
```

### Inline Assignment

Assign variables for subsequent commands:

```ts
await sh`FOO=bar && echo $FOO`.text();  // "bar\n"
```

Assign variables for a single command (scoped):

```ts
await sh`FOO=bar echo $FOO`.text();     // "bar\n"
// FOO is not set after this command
```

### Per-Command Environment

Override environment for a single command:

```ts
await sh`echo $CUSTOM`.env({ CUSTOM: "value" }).text();
```

### Global Environment

Set environment variables globally:

```ts
sh.env({ API_KEY: "secret" });
await sh`echo $API_KEY`.text();  // "secret\n"

sh.resetEnv();  // Restore initial environment
```

## Glob Expansion

Globs are expanded by the interpreter before command execution:

```ts
await sh`ls *.txt`;           // Matches: a.txt, b.txt, ...
await sh`cat src/**/*.ts`;    // Recursive glob
await sh`echo file[123].txt`; // Character classes
await sh`echo {a,b,c}.txt`;   // Brace expansion: a.txt b.txt c.txt
```

## Command Substitution

Use `$(command)` to capture command output:

```ts
await sh`echo "Current dir: $(pwd)"`.text();
```

Nested substitution is supported:

```ts
await sh`echo "Files: $(ls $(pwd))"`.text();
```

## Defining Custom Commands

Commands are async functions that receive a `CommandContext` and return an exit code (0 = success):

```ts
import type { Command } from "shell-dsl";

const hello: Command = async (ctx) => {
  const name = ctx.args[0] ?? "World";
  await ctx.stdout.writeText(`Hello, ${name}!\n`);
  return 0;
};

const sh = createShellDSL({
  // ...
  commands: { ...builtinCommands, hello },
});

await sh`hello Alice`.text();  // "Hello, Alice!\n"
```

### CommandContext Interface

```ts
interface CommandContext {
  args: string[];                    // Command arguments
  stdin: Stdin;                      // Input stream
  stdout: Stdout;                    // Output stream
  stderr: Stderr;                    // Error stream
  fs: VirtualFS;                     // Virtual filesystem
  cwd: string;                       // Current working directory
  env: Record<string, string>;       // Environment variables
}
```

### Stdin Interface

```ts
interface Stdin {
  stream(): AsyncIterable<Uint8Array>;  // Raw byte stream
  buffer(): Promise<Buffer>;             // All input as Buffer
  text(): Promise<string>;               // All input as string
  lines(): AsyncIterable<string>;        // Line-by-line iterator
}
```

### Stdout/Stderr Interface

```ts
interface Stdout {
  write(chunk: Uint8Array): Promise<void>;  // Write bytes
  writeText(str: string): Promise<void>;    // Write UTF-8 string
}
```

### Example: echo

```ts
const echo: Command = async (ctx) => {
  await ctx.stdout.writeText(ctx.args.join(" ") + "\n");
  return 0;
};
```

### Example: cat

Read from stdin or files:

```ts
const cat: Command = async (ctx) => {
  if (ctx.args.length === 0) {
    // Read from stdin
    for await (const chunk of ctx.stdin.stream()) {
      await ctx.stdout.write(chunk);
    }
  } else {
    // Read from files
    for (const file of ctx.args) {
      const path = ctx.fs.resolve(ctx.cwd, file);
      const content = await ctx.fs.readFile(path);
      await ctx.stdout.write(new Uint8Array(content));
    }
  }
  return 0;
};
```

### Example: grep

Pattern matching with stdin:

```ts
const grep: Command = async (ctx) => {
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
```

### Example: Custom uppercase command

```ts
const upper: Command = async (ctx) => {
  const text = await ctx.stdin.text();
  await ctx.stdout.writeText(text.toUpperCase());
  return 0;
};

// Usage
await sh`echo "hello" | upper`.text();  // "HELLO\n"
```

### Error Handling in Custom Commands

Report errors by writing to `ctx.stderr` and returning a non-zero exit code. The shell wraps non-zero exits in a `ShellError` (unless `.nothrow()` is used):

```ts
const divide: Command = async (ctx) => {
  const a = Number(ctx.args[0]);
  const b = Number(ctx.args[1]);
  if (isNaN(a) || isNaN(b)) {
    await ctx.stderr.writeText("divide: arguments must be numbers\n");
    return 1;
  }
  if (b === 0) {
    await ctx.stderr.writeText("divide: division by zero\n");
    return 1;
  }
  await ctx.stdout.writeText(String(a / b) + "\n");
  return 0;
};

// ShellError is thrown on non-zero exit
try {
  await sh`divide 1 0`.text();
} catch (err) {
  err.exitCode;                  // 1
  err.stderr.toString();         // "divide: division by zero\n"
}

// Suppress with nothrow
const { exitCode } = await sh`divide 1 0`.nothrow();
```

### Common Patterns

**Dual-mode input (stdin vs files):** Many commands read from stdin when no file arguments are given, or from files otherwise. See the `cat` and `grep` examples above.

**Resolving paths:** Always resolve relative paths against `ctx.cwd`:

```ts
const path = ctx.fs.resolve(ctx.cwd, ctx.args[0]);
const content = await ctx.fs.readFile(path);
```

**Accessing environment variables:**

```ts
const home = ctx.env["HOME"] ?? "/";
```

### Common Pitfalls

- **Always register commands in the `commands` object.** Don't try to match command names with regex on raw input — registered commands work correctly in pipelines, `&&`/`||` chains, redirections, and subshells.
- **Always return an exit code.** Forgetting `return 0` leaves the exit code undefined.
- **Don't forget trailing newlines.** Most shell tools expect lines terminated with `\n`. Use `writeText(value + "\n")` rather than `writeText(value)`.

## Built-in Commands

Import all built-in commands:

```ts
import { builtinCommands } from "shell-dsl/commands";
```

Or import individually:

```ts
import { echo, cat, grep, wc, cp, mv, touch, tee, tree, find, sed, awk } from "shell-dsl/commands";
```

| Command | Description |
|---------|-------------|
| `echo` | Print arguments to stdout |
| `cat` | Concatenate files or stdin to stdout |
| `grep` | Linux-compatible pattern search |
| `wc` | Count lines, words, or characters (`-l`, `-w`, `-c`) |
| `head` | Output first lines (`-n`) |
| `tail` | Output last lines (`-n`) |
| `sort` | Sort lines (`-r` reverse, `-n` numeric) |
| `uniq` | Remove duplicate adjacent lines (`-c` count) |
| `pwd` | Print working directory |
| `ls` | List directory contents |
| `mkdir` | Create directories (`-p` parents) |
| `rm` | Remove files/directories (`-r` recursive, `-f` force) |
| `cp` | Copy files/directories (`-r` recursive, `-n` no-clobber) |
| `mv` | Move/rename files/directories (`-n` no-clobber) |
| `touch` | Create empty files or update timestamps (`-c` no-create) |
| `tee` | Duplicate stdin to stdout and files (`-a` append) |
| `tree` | Display directory structure as tree (`-a` all, `-d` dirs only, `-L <n>` depth) |
| `find` | Search for files (`-name`, `-iname`, `-type f\|d`, `-maxdepth`, `-mindepth`) |
| `sed` | Stream editor (`s///`, `d`, `p`, `-n`, `-e`) |
| `awk` | Pattern scanning (`{print $1}`, `-F`, `NF`, `NR`) |
| `test` / `[` | File and string tests (`-f`, `-d`, `-e`, `-z`, `-n`, `=`, `!=`) |
| `true` | Exit with code 0 |
| `false` | Exit with code 1 |

## Virtual Filesystem

The `VirtualFS` interface wraps memfs for sandboxed file operations:

```ts
import { createVirtualFS } from "shell-dsl";
import { createFsFromVolume, Volume } from "memfs";

const vol = new Volume();
vol.fromJSON({
  "/data.txt": "file content",
  "/config.json": '{"key": "value"}',
});

const fs = createVirtualFS(createFsFromVolume(vol));
```

### VirtualFS Interface

```ts
interface VirtualFS {
  // Reading
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;

  // Writing
  writeFile(path: string, data: Buffer | string): Promise<void>;
  appendFile(path: string, data: Buffer | string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;

  // Deletion
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;

  // Utilities
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  glob(pattern: string, opts?: { cwd?: string }): Promise<string[]>;
}
```

## Real Filesystem Access

For scenarios where you need to access the real filesystem with sandboxing, use `FileSystem` or `ReadOnlyFileSystem`:

```ts
import { createShellDSL, FileSystem } from "shell-dsl";
import { builtinCommands } from "shell-dsl/commands";

// Mount a directory with permission rules
const fs = new FileSystem("./project", {
  ".env": "excluded",           // Cannot read or write
  ".git/**": "excluded",        // Block entire directory
  "config/**": "read-only",     // Can read, cannot write
  "src/**": "read-write",       // Full access (default)
});

const sh = createShellDSL({
  fs,
  cwd: "/",
  env: {},
  commands: builtinCommands,
});

await sh`cat /src/index.ts`.text();      // Works
await sh`cat /.env`.text();              // Throws: excluded
await sh`echo "x" > /config/app.json`;   // Throws: read-only
```

### Permission Types

| Permission | Read | Write |
|------------|------|-------|
| `"read-write"` | Yes | Yes |
| `"read-only"` | Yes | No |
| `"excluded"` | No | No |

### Rule Specificity

When multiple rules match, the most specific wins:

1. More path segments: `a/b/c` beats `a/b`
2. Literal beats wildcard: `config/app.json` beats `config/*`
3. Single wildcard beats double: `src/*` beats `src/**`

```ts
const fs = new FileSystem("./project", {
  "**": "read-only",              // Default: read-only
  "src/**": "read-write",         // Override for src/
  "src/generated/**": "excluded", // But not generated files
});
```

### ReadOnlyFileSystem

Convenience class that defaults all paths to read-only:

```ts
import { ReadOnlyFileSystem } from "shell-dsl";

const fs = new ReadOnlyFileSystem("./docs");

// All writes blocked by default
await fs.writeFile("/file.txt", "x");  // Throws: read-only

// Can still exclude or allow specific paths
const fs2 = new ReadOnlyFileSystem("./docs", {
  "drafts/**": "read-write",  // Allow writes here
  ".internal/**": "excluded", // Block completely
});
```

### Full System Access

Omit the mount path for unrestricted access, but this is the same as just passing `fs` from `node:fs`:

```ts
const fs = new FileSystem();  // Full filesystem access same as fs from node:fs
```


## Low-Level API

For advanced use cases (custom tooling, AST inspection):

```ts
// Tokenize shell source
const tokens = sh.lex("cat foo | grep bar");

// Parse tokens into AST
const ast = sh.parse(tokens);

// Compile AST to executable program
const program = sh.compile(ast);

// Execute a compiled program
const result = await sh.run(program);
```

### Manual Escaping

```ts
sh.escape("hello world");    // "'hello world'"
sh.escape("$(rm -rf /)");    // "'$(rm -rf /)'"
sh.escape("safe");           // "safe"
```

### Raw Escape Hatch

Bypass escaping for trusted input:

```ts
await sh`echo ${{ raw: "$(date)" }}`.text();
```

**Warning:** Use `{ raw: ... }` with extreme caution when handling untrusted input.

## Safety & Security

1. **No host access** — All commands run in-process against a virtual filesystem
2. **Automatic escaping** — Interpolated values are escaped by default
3. **Explicit command registry** — Only registered commands can execute
4. **No shell spawning** — Never invokes `/bin/sh` or similar

The `{ raw: ... }` escape hatch exists for advanced use cases but should be used with extreme caution.

## TypeScript Types

Key exported types:

```ts
import type {
  Command,
  CommandContext,
  Stdin,
  Stdout,
  Stderr,
  VirtualFS,
  FileStat,
  ExecResult,
  ShellConfig,
  RawValue,
  Permission,
  PermissionRules,
  UnderlyingFS,
} from "shell-dsl";
```

## Running Tests

```bash
bun test
```

## Typecheck

```bash
bun run typecheck
```

## License

MIT
