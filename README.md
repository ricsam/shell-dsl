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
- **Executable scripts** — Run virtual-filesystem scripts with `./script`, `sh`, `source`, and shebang dispatch
- **Automatic escaping** — Interpolated values are escaped by default for safety
- **POSIX-inspired syntax** — Pipes, redirects, control flow operators, and more
- **Streaming pipelines** — Commands communicate via async iteration
- **Version control** — Built-in VCS with commits, branches, checkout, and diffs on any virtual filesystem
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

`$?` expands to the previous command's exit code:

```ts
await sh`false; echo exit:$?; true; echo ok:$?`.text();
// "exit:1\nok:0\n"

await sh`logs clear backend; restart-backend; echo exit:$?; logs backend 100`;
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
await sh`FOO=bar echo ok`.text();       // "ok\n"
await sh`FOO=bar echo $FOO`.text();     // "\n"
// FOO is available to the executed command via ctx.env,
// but sibling shell expansion still uses the previous shell env
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

## TTY Detection

Commands can check `ctx.stdout.isTTY` to vary their output format depending on whether they're writing to a terminal or a pipe/file, just like real shell commands do (e.g. `ls` uses columnar output on a terminal but one-per-line when piped).

Enable TTY mode via the `isTTY` config option (default `false`):

```ts
const sh = createShellDSL({
  fs: createVirtualFS(createFsFromVolume(vol)),
  cwd: "/",
  env: {},
  commands: builtinCommands,
  isTTY: true,
});

// Standalone command — stdout.isTTY is true
await sh`ls /dir`.text();             // "file1.txt  file2.txt  subdir\n"

// Piped command — intermediate stdout.isTTY is always false
await sh`ls /dir | grep file`.text(); // "file1.txt\nfile2.txt\n"
```

| Context | `stdout.isTTY` |
|---------|----------------|
| Standalone command, shell has `isTTY: true` | `true` |
| Intermediate command in pipeline | `false` |
| Output redirected to file (`> file`) | `false` |
| Command substitution (`$(cmd)`) | `false` |
| Shell has `isTTY: false` (default) | `false` |

### Using isTTY in Custom Commands

```ts
const myls: Command = async (ctx) => {
  const entries = await ctx.fs.readdir(ctx.cwd);
  if (ctx.stdout.isTTY) {
    await ctx.stdout.writeText(entries.join("  ") + "\n");
  } else {
    for (const entry of entries) {
      await ctx.stdout.writeText(entry + "\n");
    }
  }
  return 0;
};
```

## Field Splitting

Unquoted parameter, command, and arithmetic expansions follow shell-style word expansion:

1. Expand variables / `$(...)` / `$((...))`
2. Split unquoted results using `IFS` (default: space, tab, newline)
3. Apply pathname expansion (globbing) to the resulting fields

Quoted expansions stay single-field, and assignment values plus redirect targets use scalar expansion only.

```ts
await sh`LIST="alpha beta" && for item in $LIST; do echo $item; done`.text();
// "alpha\nbeta\n"

await sh`LIST="alpha,beta,,gamma" && IFS=, && for item in $LIST; do echo "[$item]"; done`.text();
// "[alpha]\n[beta]\n[]\n[gamma]\n"
```

## Glob Expansion

Globs run after field splitting, and only wildcard characters from unquoted text or unquoted expansions participate:

```ts
await sh`ls *.txt`;           // Matches: a.txt, b.txt, ...
await sh`cat src/**/*.ts`;    // Recursive glob
await sh`echo file[123].txt`; // Character classes
await sh`echo {a,b,c}.txt`;   // Brace expansion: a.txt b.txt c.txt
await sh`pattern='*.txt'; echo $pattern`;   // Expands matches
await sh`pattern='*.txt'; echo "$pattern"`; // Literal "*.txt"
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

## Executable Scripts

Command names containing `/` are treated as virtual-filesystem script paths when no registered command matches. Scripts run inside shell-dsl, not through the host OS:

```ts
await fs.writeFile("/hello", `
echo "script: $0"
echo "args: $1 / $#"
`.trimStart());

await sh`./hello Alice`.text();
// "script: ./hello\nargs: Alice / 1\n"
```

Scripts without a shebang run as shell-dsl scripts. `#!/bin/sh` and `#!/usr/bin/env sh` do the same thing:

```ts
await fs.writeFile("/greet", `
#!/bin/sh
echo "Hello, $1"
`.trimStart());

await sh`./greet Alice`.text(); // "Hello, Alice\n"
```

Script execution is subprocess-like: variables and `cd` inside `./script` do not leak back to the caller. Use `source` or `.` when you want the script to mutate the current shell state:

```ts
await fs.writeFile("/env", "NAME=Alice\ncd /work\n");

await sh`source ./env; echo "$NAME"; pwd`.text();
// "Alice\n/work\n"
```

### Positional Parameters

Scripts and `sh -c` support common shell parameters:

| Parameter | Meaning |
|-----------|---------|
| `$0` | Script name or `sh -c` argv0 |
| `$1`, `$2`, ... | Positional arguments |
| `$#` | Number of positional arguments |
| `$*` | Positional arguments joined with spaces |
| `$@` | Positional arguments; quoted `"$@"` expands as separate fields |
| `$?` | Previous command's exit code |

```ts
await sh`sh -c 'echo "$0:$1:$#"' name value`.text();
// "name:value:1\n"
```

Scripts can stop with an explicit status via `exit`:

```ts
await fs.writeFile("/restart", "restart-backend\nexit $?\n");

const result = await sh`./restart`.nothrow();
result.exitCode; // restart-backend's exit code
```

### Shebang Dispatch

Non-`sh` shebangs dispatch to registered commands by interpreter basename. For example, `#!/bin/cat` runs the registered `cat` command with the script path as its first argument:

```ts
await fs.writeFile("/show", "#!/bin/cat\nhello\n");
await sh`./show`.text(); // "#!/bin/cat\nhello\n"
```

Custom shebangs work the same way:

```ts
const customCommand: Command = async (ctx) => {
  await ctx.stdout.writeText(JSON.stringify(ctx.args) + "\n");
  return 0;
};

const sh = createShellDSL({
  fs,
  cwd: "/",
  env: {},
  commands: { ...builtinCommands, custom_command: customCommand },
});

await fs.writeFile("/run", "#!/bin/custom_command\n");
await sh`./run arg`.text(); // "[\"./run\",\"arg\"]\n"
```

`#!/bin/bash` is not enabled by default. If you intentionally want that alias, register one explicitly:

```ts
commands: { ...builtinCommands, bash: builtinCommands.sh }
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
  setCwd(path: string): void;         // Change current working directory
  exec?: (name: string, args: string[]) => Promise<ExecResult>;
  shell?: ShellCommandApi;            // Evaluate shell-dsl source from commands
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
  isTTY: boolean;                           // Whether output is a terminal
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
import { echo, printf, cat, grep, wc, cp, mv, touch, tee, tree, find, sed, awk, cut, od, sh, evalCmd, source, dot, exitCmd } from "shell-dsl/commands";
```

| Command | Description |
|---------|-------------|
| `echo` | Print arguments to stdout |
| `printf` | Format output without an implicit trailing newline (`%s`, `%b`, numeric formats, escapes) |
| `cat` | Concatenate files or stdin to stdout |
| `grep` | Linux-compatible pattern search |
| `wc` | Count lines, words, or characters (`-l`, `-w`, `-c`) |
| `head` | Output first lines (`-n`) |
| `tail` | Output last lines (`-n`) |
| `sort` | Sort lines (`-r` reverse, `-n` numeric) |
| `uniq` | Remove duplicate adjacent lines (`-c` count) |
| `pwd` | Print working directory |
| `ls` | List directory contents (TTY-aware: space-separated on TTY, one-per-line when piped) |
| `mkdir` | Create directories (`-p` parents) |
| `rm` | Remove files/directories (`-r` recursive, `-f` force) |
| `cp` | Copy files/directories (`-r` recursive, `-n` no-clobber) |
| `mv` | Move/rename files/directories (`-n` no-clobber) |
| `touch` | Create empty files or update timestamps (`-c` no-create) |
| `tee` | Duplicate stdin to stdout and files (`-a` append) |
| `tree` | Display directory structure as tree (`-a` all, `-d` dirs only, `-L <n>` depth, `-I <pattern>` ignore, `--prune` remove empty dirs, `--noreport` hide summary) |
| `find` | Search for files (`-name`, `-iname`, `-type f\|d`, `-maxdepth`, `-mindepth`, `-print`) |
| `sed` | Stream editor (`s///`, `d`, `p`, `-n`, `-e`) |
| `awk` | Pattern scanning (`{print $1}`, `-F`, `NF`, `NR`) |
| `cut` | Select fields/characters (`-f`, `-d`, `-c`, `-b`, `-s`, `--complement`) |
| `od` | Dump binary/text data (`-A`, `-t x1/x2/o1/o2/c`, `-j`, `-N`, `-v`) |
| `sh` | Run shell-dsl source from a file, stdin, or `-c` string |
| `eval` | Evaluate arguments as shell-dsl source in the current shell state |
| `source` / `.` | Execute a script in the current shell state |
| `exit` | Stop the current shell with an optional exit code |
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

### `globVirtualFS` Helper

If you're implementing a custom `VirtualFS`, especially a composite or mounted filesystem, you can reuse `globVirtualFS()` instead of writing glob traversal yourself:

```ts
import { globVirtualFS, type VirtualFS } from "shell-dsl";

class CompositeFileSystem implements VirtualFS {
  // ... implement readFile/readdir/stat/etc.

  async glob(pattern: string, opts?: { cwd?: string }): Promise<string[]> {
    return globVirtualFS(this, pattern, opts);
  }
}
```

`globVirtualFS()` walks the visible virtual tree using only `readdir()`, `stat()`, and `resolve()`, so it works correctly for filesystems that mount different host directories under one virtual namespace.

It supports the same shell-style patterns used by the interpreter:

- `*.txt` for segment wildcards
- `**/*.ts` for recursive matches
- `file-?.md` for single-character matches
- `{a,b}.json` for brace expansion
- `[ab].txt` for character classes

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

### Web Filesystem

Use `WebFileSystem` when you already have a `FileSystemDirectoryHandle` in the browser, including an OPFS root from `navigator.storage.getDirectory()`:

```ts
import { WebFileSystem } from "shell-dsl";

const root = await navigator.storage.getDirectory();
const fs = new WebFileSystem(root, {
  "secrets/**": "excluded",
  "docs/**": "read-only",
});
```

For advanced use, you can inject the web adapter into `FileSystem` directly:

```ts
import { FileSystem, createWebUnderlyingFS } from "shell-dsl";

const root = await navigator.storage.getDirectory();
const fs = new FileSystem("/", {}, createWebUnderlyingFS(root));
```


## Version Control

`VersionControlSystem` adds git-like version control to any `VirtualFS`. It tracks revisions as lightweight tree manifests, stores file bytes in a content-addressed blob store under `.vcs`, and supports branching, checkout, and metadata-plus-patch diffs.

Ignore and attribute rules are configured directly on the constructor:

```ts
import { VersionControlSystem, createVirtualFS } from "shell-dsl";
import { createFsFromVolume, Volume } from "memfs";

const vol = new Volume();
vol.fromJSON({
  "/project/src/index.ts": 'console.log("hello")',
  "/project/README.md": "# My Project",
});
const fs = createVirtualFS(createFsFromVolume(vol));

const vcs = new VersionControlSystem({
  fs,
  path: "/project",
  ignore: ["dist", "*.log"],
  attributes: [
    { pattern: "assets/*.png", diff: "binary" },
    { pattern: "secrets/**", diff: "none" },
  ],
});
```

Ignore patterns apply only to untracked paths:

- Ignored untracked files are skipped by `status()` and full `commit()`
- Files already tracked by VCS remain tracked even if they later match an ignore rule
- Full `checkout()` preserves ignored untracked files

Attribute rules are applied in declaration order, with later matches winning. By default, VCS auto-detects text vs binary content from the file bytes and only generates unified text patches for text files up to 1 MiB. Supported properties:

- `binary?: boolean`
- `diff?: "text" | "binary" | "none"`

### Committing Changes

```ts
// Commit all pending changes
const rev = await vcs.commit("initial commit");

// Selective commit with glob patterns (relative to root path)
await vcs.commit("update src only", { paths: ["/src/**"] });
```

### Checking Status

`status()` returns a `DiffEntry[]` describing uncommitted changes:

```ts
const changes = await vcs.status();
for (const entry of changes) {
  console.log(entry.type, entry.path, entry.diff, entry.binary);
  // "add" | "modify" | "delete", "text" | "binary" | "none", boolean

  if (entry.patch) {
    console.log(entry.patch);
  } else {
    console.log(entry.patchSuppressedReason);
    // "binary" | "none" | "too-large"
  }
}
```

Each file entry includes `blobId` and `previousBlobId` when applicable. Text diffs are returned as unified patches in `patch`; binary files, `diff: "none"` paths, and oversized text files return metadata only with `patchSuppressedReason`.

### Checkout

```ts
// Checkout a specific revision (errors if working tree is dirty)
await vcs.checkout(1);

// Force checkout, discarding uncommitted changes
await vcs.checkout(1, { force: true });

// Partial checkout — restore specific files without changing HEAD
await vcs.checkout(1, { paths: ["/src/index.ts", "/**/*.txt"] });
```

### Branching

```ts
// Create a branch at HEAD
await vcs.branch("feature");

// Switch to a branch
await vcs.checkout("feature");

// List all branches
const branches = await vcs.branches();
// [{ name: "main", revision: 1, current: false },
//  { name: "feature", revision: 1, current: true }]
```

### History and Diffs

```ts
// Revision history
const entries = await vcs.log();
const filtered = await vcs.log({ path: "src/index.ts", limit: 10 });

// Diff between two revisions
const diff = await vcs.diff(1, 2);
for (const entry of diff) {
  console.log(entry.type, entry.path, entry.diff);
}

// Read stored file bytes lazily
const readme = await vcs.readRevisionFile(2, "README.md", "utf8");
const blob = await vcs.readBlob(diff[0]!.blobId!);

// Current HEAD info
const head = await vcs.head();
// { branch: "main", revision: 2 }
```

Blob objects are deduplicated by SHA-256, so replacing a large file stores a new blob only when the content changes instead of embedding the full file in every revision record.

### Separate VCS Storage

By default, metadata lives in `{path}/.vcs`. You can store it on a different filesystem:

```ts
const vcs = new VersionControlSystem({
  fs: workingTreeFs,
  path: "/project",
  vcsPath: {
    fs: metadataFs,          // different VirtualFS instance
    path: "/meta/.vcs",      // custom location
  },
});
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
3. **Explicit command registry** — Only registered commands can execute, including shebang-dispatched interpreters
4. **No shell spawning** — Never invokes `/bin/sh` or similar; `#!/bin/sh` maps to shell-dsl's in-process `sh`

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
  ShellCommandApi,
  ShellRunOptions,
  RawValue,
  Permission,
  PermissionRules,
  UnderlyingFS,
  VCSConfig,
  Revision,
  DiffEntry,
  LogEntry,
  BranchInfo,
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
