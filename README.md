# shell-dsl

A sandboxed shell-style DSL for running scriptable command pipelines where all commands are explicitly registered and executed in-process, without access to the host OS.

## Features

- POSIX-inspired syntax (pipes, arguments, redirection)
- Virtual filesystem (no host OS access)
- User-defined command registry
- Automatic escaping of interpolated values
- Streaming pipelines via async iteration

## Installation

```bash
bun install
```

## Usage

```ts
import { ShellDSL } from "shell-dsl";
import { memfs } from "memfs";

const sh = new ShellDSL({
  fs: memfs(),
  cwd: "/",
  env: { PATH: "/bin" },
  commands: { grep, cat, echo, wc },
});

const result = await sh`cat data.txt | grep ${pattern} | wc -l`.text();
```

## Output Methods

```ts
await sh`echo hi`.text();           // "hi\n"
await sh`cat config.json`.json();   // { ... }
await sh`cat log.txt`.lines();      // AsyncIterable<string>
await sh`cat data.bin`.buffer();    // Buffer
```

## Pipelines & Control Flow

```ts
// Pipelines
await sh`cat data.txt | grep foo | wc -l`;

// Sequential execution
await sh`echo one; echo two; echo three`;

// AND/OR operators
await sh`test -f config.json && cat config.json`;
await sh`cat config.json || echo "default"`;
```

## Redirection

```ts
await sh`cat < input.txt`;          // stdin from file
await sh`echo hi > out.txt`;        // stdout to file
await sh`echo hi >> out.txt`;       // append
await sh`cmd 2> errors.txt`;        // stderr to file
await sh`cmd &> all.txt`;           // both to file
```

## Error Handling

```ts
try {
  await sh`cat missing.txt`;
} catch (err) {
  if (err instanceof ShellError) {
    console.log(err.exitCode);
    console.log(err.stderr.toString());
  }
}

// Disable throwing
await sh`cmd`.nothrow();
```

## Defining Commands

```ts
const echo: Command = async (ctx) => {
  await ctx.stdout.writeText(ctx.args.join(" ") + "\n");
  return 0;
};
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
