I want a sandboxed shell-style DSL for running scriptable command pipelines where all commands are explicitly registered and executed in-process, without access to the host OS. The language provides lexing, parsing, and interpretation of a minimal POSIX-inspired syntax (pipes, arguments, redirection), backed by a virtual filesystem and user-defined command registry. 

memfs is installed for a virtual fs. I want plenty of tests to verify functionality.


# Shell DSL Specification

A sandboxed shell-style DSL for running scriptable command pipelines where all commands are explicitly registered and executed in-process, without access to the host OS.

---

## Overview

```ts
import { ShellDSL } from "shell-dsl";

const sh = new ShellDSL({
  fs: memfs(),
  cwd: "/",
  env: { PATH: "/bin" },
  commands: { grep, cat, echo, wc },
});

const result = await sh`cat data.txt | grep ${pattern} | wc -l`.text();
```

---

## Constructor

```ts
class ShellDSL {
  constructor(config: ShellConfig);
}

interface ShellConfig {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
}
```

---

## Execution Result

```ts
interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}
```

### Chainable Output Methods

```ts
interface ShellPromise extends Promise<ExecResult> {
  // Output formats
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  lines(): AsyncIterable<string>;
  blob(): Promise<Blob>;
  buffer(): Promise<Buffer>;

  // Behavior modifiers
  quiet(): ShellPromise;
  nothrow(): ShellPromise;
  throws(enable: boolean): ShellPromise;

  // Context overrides
  cwd(path: string): ShellPromise;
  env(vars: Record<string, string>): ShellPromise;
}
```

### Examples

```ts
await sh`echo hi`.text();           // "hi\n"
await sh`cat config.json`.json();   // { ... }
await sh`cat log.txt`.lines();      // AsyncIterable<string>
await sh`cat image.png`.blob();     // Blob
await sh`cat data.bin`.buffer();    // Buffer

await sh`echo hi`.quiet();          // ExecResult, no output printed
await sh`exit 1`.nothrow();         // ExecResult, no throw on non-zero

await sh`pwd`.cwd("/tmp");          // runs in /tmp
await sh`echo $FOO`.env({ FOO: "bar" }); // FOO=bar
```

---

## Global Defaults

```ts
class ShellDSL {
  // Set global defaults
  cwd(path: string): void;
  env(vars: Record<string, string>): void;
  throws(enable: boolean): void;

  // Reset to initial config
  resetCwd(): void;
  resetEnv(): void;
}
```

---

## Error Handling

Non-zero exit codes throw `ShellError` by default:

```ts
class ShellError extends Error {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}
```

```ts
try {
  await sh`grep foo missing.txt`.text();
} catch (err) {
  if (err instanceof ShellError) {
    console.log(err.exitCode);        // 1
    console.log(err.stderr.toString()); // "grep: missing.txt: No such file"
  }
}
```

Disable throwing:

```ts
// Per-command
const { exitCode } = await sh`grep foo`.nothrow();

// Global default
sh.throws(false);
```

---

## Stdin / Stdout / Stderr Redirection

### Input Redirection (`<`)

```ts
// From JavaScript objects
await sh`cat < ${Buffer.from("hello")}`;
await sh`cat < ${new Response("hey")}`;
await sh`cat < ${new Blob(["data"])}`;
await sh`cat < ${"raw string input"}`;

// From virtual filesystem
await sh`cat < input.txt`;
```

### Output Redirection (`>`, `>>`)

```ts
// To JavaScript objects
const buf = Buffer.alloc(1024);
await sh`echo hi > ${buf}`;

// To virtual filesystem
await sh`echo hi > out.txt`;      // overwrite
await sh`echo hi >> out.txt`;     // append
```

### Stderr Redirection

```ts
await sh`cmd 2> errors.txt`;      // stderr to file
await sh`cmd 2>&1`;               // stderr to stdout
await sh`cmd 1>&2`;               // stdout to stderr
await sh`cmd &> all.txt`;         // both to file
await sh`cmd &>> all.txt`;        // both to file (append)
```

---

## Pipelines

```ts
const count = await sh`
  cat data.txt |
  grep ${pattern} |
  wc -l
`.text();
```

Pipelines stream data between commands via async iteration.

---

## Control Flow Operators

```ts
// Sequential execution
await sh`echo one; echo two; echo three`;

// AND (short-circuit on failure)
await sh`test -f config.json && cat config.json`;

// OR (short-circuit on success)  
await sh`cat config.json || echo "default config"`;

// Combined
await sh`mkdir -p out && echo "created" || echo "failed"`;
```

---

## Environment Variables

### Expansion (interpreter-level)

```ts
await sh`echo $HOME`;                    // expands $HOME
await sh`echo ${HOME}`;                  // same
await sh`echo "$HOME/subdir"`;           // expands within double quotes
await sh`echo '$HOME'`;                  // literal $HOME (single quotes)
```

### Inline Assignment

```ts
await sh`FOO=bar && echo $FOO`;          // bar
await sh`FOO=bar echo $FOO`;             // bar (for that command)
```

### Interpolation (escaped by default)

```ts
const userInput = "foo; rm -rf /";
await sh`echo ${userInput}`;             // safe: "foo; rm -rf /"
```

---

## Glob Expansion

Globs are expanded by the interpreter before command invocation:

```ts
await sh`cat *.txt`;                     // expands to matching files
await sh`ls src/**/*.ts`;                // recursive glob
await sh`echo {a,b,c}.txt`;              // brace expansion
```

---

## Quoting Semantics (Bash-like)

| Syntax | Behavior |
|--------|----------|
| `"..."` | Variable expansion, glob expansion disabled |
| `'...'` | Literal string, no expansion |
| `\x` | Escape single character |
| `` `...` `` | Not supported (use `$(...)`) |

```ts
await sh`echo "hello $USER"`;            // expands $USER
await sh`echo 'hello $USER'`;            // literal $USER
await sh`echo hello\ world`;             // "hello world" (one arg)
```

---

## Command Substitution

```ts
await sh`echo "Current dir: $(pwd)"`;
await sh`echo "Hash: $(git rev-parse HEAD)"`;

// Nested
await sh`echo "Files: $(ls $(pwd))"`;
```

---

## Command Definition

### Command Type

```ts
type Command = (ctx: CommandContext) => Promise<number>;
```

The returned number is the exit code.

### CommandContext

```ts
interface CommandContext {
  args: string[];
  stdin: Stdin;
  stdout: Stdout;
  stderr: Stderr;
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
}
```

### Stdin Interface

```ts
interface Stdin {
  /** Raw async byte stream */
  stream(): AsyncIterable<Uint8Array>;
  
  /** Consume all input as Buffer */
  buffer(): Promise<Buffer>;
  
  /** Consume all input as string */
  text(): Promise<string>;
  
  /** Iterate lines (strips newlines) */
  lines(): AsyncIterable<string>;
}
```

### Stdout / Stderr Interface (Command-facing)

```ts
interface Stdout {
  /** Write bytes (async for backpressure) */
  write(chunk: Uint8Array): Promise<void>;
  
  /** Write string as UTF-8 */
  writeText(str: string): Promise<void>;
}

interface Stderr {
  write(chunk: Uint8Array): Promise<void>;
  writeText(str: string): Promise<void>;
}
```

### Internal Collector (Runtime-facing)

```ts
interface OutputCollector extends Stdout {
  close(): void;
  collect(): Promise<Buffer>;
}
```

---

## Example Command Implementations

### echo

```ts
const echo: Command = async (ctx) => {
  const output = ctx.args.join(" ") + "\n";
  await ctx.stdout.writeText(output);
  return 0;
};
```

### cat

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
      await ctx.stdout.write(content);
    }
  }
  return 0;
};
```

### grep

```ts
const grep: Command = async (ctx) => {
  const [pattern, ...files] = ctx.args;
  if (!pattern) {
    await ctx.stderr.writeText("grep: missing pattern\n");
    return 1;
  }

  const regex = new RegExp(pattern);
  let found = false;

  const processLine = async (line: string) => {
    if (regex.test(line)) {
      await ctx.stdout.writeText(line + "\n");
      found = true;
    }
  };

  if (files.length === 0) {
    for await (const line of ctx.stdin.lines()) {
      await processLine(line);
    }
  } else {
    for (const file of files) {
      const path = ctx.fs.resolve(ctx.cwd, file);
      const content = await ctx.fs.readFile(path);
      for (const line of content.toString().split("\n")) {
        await processLine(line);
      }
    }
  }

  return found ? 0 : 1;
};
```

---

## Virtual Filesystem Interface

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

interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
}
```

---

## Utilities

### Escape

```ts
sh.escape(str: string): string;
```

Exposes the interpreter's escaping logic:

```ts
sh.escape('$(rm -rf /)');  // "\$(rm -rf /)"
sh.escape('hello world');  // "hello\ world"
```

### Raw (Bypass Escaping)

```ts
await sh`echo ${{ raw: '$(date)' }}`;  // executes $(date)
```

⚠️ Use with caution—bypasses injection protection.

---

## Low-Level API

For advanced use cases (custom tooling, AST inspection, etc.):

```ts
class ShellDSL {
  /** Tokenize shell source */
  lex(source: string): Token[];

  /** Parse tokens into AST */
  parse(tokens: Token[]): ASTNode;

  /** Compile AST to executable program */
  compile(ast: ASTNode): Program;

  /** Execute a compiled program */
  run(program: Program): Promise<ExecResult>;
}
```

### Token Types

```ts
type Token =
  | { type: "word"; value: string }
  | { type: "pipe" }
  | { type: "and" }
  | { type: "or" }
  | { type: "semicolon" }
  | { type: "redirect"; mode: ">" | ">>" | "<" | "2>" | "2>>" | "&>" | "&>>" | "2>&1" | "1>&2" }
  | { type: "variable"; name: string }
  | { type: "substitution"; command: string }
  | { type: "glob"; pattern: string }
  | { type: "singleQuote"; value: string }
  | { type: "doubleQuote"; parts: Array<string | Token> }
  | { type: "eof" };
```

### AST Nodes

```ts
type ASTNode =
  | { type: "command"; name: string; args: ASTNode[]; redirects: Redirect[] }
  | { type: "pipeline"; commands: ASTNode[] }
  | { type: "and"; left: ASTNode; right: ASTNode }
  | { type: "or"; left: ASTNode; right: ASTNode }
  | { type: "sequence"; commands: ASTNode[] }
  | { type: "literal"; value: string }
  | { type: "variable"; name: string }
  | { type: "substitution"; command: ASTNode }
  | { type: "glob"; pattern: string };

interface Redirect {
  mode: ">" | ">>" | "<" | "2>" | "2>>" | "&>" | "&>>";
  target: ASTNode | Buffer | Response | Blob;
}
```

---

## Complete Example

```ts
import { ShellDSL } from "shell-dsl";
import { createMemoryFS } from "./memfs";

// Setup
const fs = createMemoryFS();
await fs.writeFile("/data.txt", "foo\nbar\nbaz\nfoo bar\n");

const sh = new ShellDSL({
  fs,
  cwd: "/",
  env: { USER: "alice" },
  commands: { cat, grep, wc, echo, head, sort, uniq },
});

// Basic usage
const greeting = await sh`echo "Hello, $USER"`.text();
console.log(greeting); // "Hello, alice\n"

// Pipeline
const count = await sh`cat data.txt | grep foo | wc -l`.text();
console.log(count.trim()); // "2"

// Error handling
try {
  await sh`cat nonexistent.txt`;
} catch (err) {
  console.log(err.exitCode); // 1
}

// Redirection
await sh`echo "new content" > /output.txt`;
const content = await fs.readFile("/output.txt");

// Control flow
await sh`test -f /data.txt && echo "exists" || echo "missing"`;

// Low-level inspection
const tokens = sh.lex("cat foo | grep bar");
const ast = sh.parse(tokens);
console.log(JSON.stringify(ast, null, 2));
```

---

## Security Considerations

1. **No host access**: All commands run in-process against a virtual filesystem
2. **Automatic escaping**: Interpolated values are escaped by default
3. **Explicit command registry**: Only registered commands can execute
4. **No shell spawning**: Never invokes `/bin/sh` or similar

The `{ raw: ... }` escape hatch exists for advanced use cases but should be used with extreme caution when handling untrusted input.