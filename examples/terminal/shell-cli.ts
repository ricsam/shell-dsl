import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { analyzeInput, type TerminalInfo } from "../../src/index.ts";
import type { CliRequest, ExecutorEvent } from "./protocol.ts";

const decoder = new TextDecoder();
const executorPath = `${import.meta.dir}/shell-executor.ts`;
const child = Bun.spawn(["bun", executorPath], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

let cwd = "/";
let nextId = 1;
let currentInput = "";
let readyResolve: (() => void) | undefined;
const ready = new Promise<void>((resolve) => {
  readyResolve = resolve;
});
const pendingRuns = new Map<number, (event: Extract<ExecutorEvent, { type: "exit" }>) => void>();
const pendingCompletions = new Map<
  number,
  (event: Extract<ExecutorEvent, { type: "complete" }>) => void
>();

const readerTask = readExecutorEvents();

const rl = createInterface({
  input: stdin,
  output: stdout,
  terminal: true,
  completer: async (line: string): Promise<[string[], string]> => {
    const source = currentInput === "" ? line : `${currentInput}\n${line}`;
    try {
      const result = await complete(source, source.length);
      return [result.matches, result.replacement];
    } catch {
      return [[], line];
    }
  },
});

rl.on("SIGINT", () => {
  stdout.write("^C\n");
  currentInput = "";
  void prompt();
});

stdout.on("resize", () => {
  send({ type: "resize", terminal: getTerminalInfo() });
});

await ready;
send({ type: "resize", terminal: getTerminalInfo() });
await prompt();

async function prompt(): Promise<void> {
  while (true) {
    const line = await rl.question(currentInput === "" ? `${cwd}$ ` : "> ");
    currentInput = currentInput === "" ? line : `${currentInput}\n${line}`;

    const analysis = analyzeInput(currentInput);
    if (analysis.kind === "incomplete") {
      continue;
    }
    if (analysis.kind === "invalid") {
      stderr.write(`${analysis.error.message}\n`);
      currentInput = "";
      continue;
    }

    const source = currentInput;
    currentInput = "";
    const exit = await run(source);
    if (exit.exitCode !== 0) {
      stdout.write(`[exit ${exit.exitCode}]\n`);
    }
    cwd = exit.cwd;
  }
}

async function run(source: string): Promise<Extract<ExecutorEvent, { type: "exit" }>> {
  const id = nextId++;
  const exit = new Promise<Extract<ExecutorEvent, { type: "exit" }>>((resolve) => {
    pendingRuns.set(id, resolve);
  });
  send({ type: "run", id, source, terminal: getTerminalInfo() });
  return exit;
}

async function complete(source: string, cursor: number): Promise<Extract<ExecutorEvent, { type: "complete" }>> {
  const id = nextId++;
  const completion = new Promise<Extract<ExecutorEvent, { type: "complete" }>>((resolve) => {
    pendingCompletions.set(id, resolve);
  });
  send({ type: "complete", id, source, cursor });
  return completion;
}

async function readExecutorEvents(): Promise<void> {
  let buffer = "";
  for await (const chunk of child.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleEventLine(line);
      newline = buffer.indexOf("\n");
    }
  }
}

function handleEventLine(line: string): void {
  if (line.trim() === "") {
    return;
  }

  const event = JSON.parse(line) as ExecutorEvent;
  switch (event.type) {
    case "ready":
      cwd = event.cwd;
      readyResolve?.();
      break;
    case "output": {
      const chunk = Buffer.from(event.data, "base64");
      (event.fd === 1 ? stdout : stderr).write(chunk);
      break;
    }
    case "exit": {
      pendingRuns.get(event.id)?.(event);
      pendingRuns.delete(event.id);
      break;
    }
    case "complete": {
      pendingCompletions.get(event.id)?.(event);
      pendingCompletions.delete(event.id);
      break;
    }
    case "error":
      stderr.write(`${event.message}\n`);
      break;
  }
}

function send(request: CliRequest): void {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}

function getTerminalInfo(): TerminalInfo {
  return {
    isTTY: Boolean(stdout.isTTY),
    columns: stdout.columns,
    rows: stdout.rows,
    colorDepth: typeof stdout.getColorDepth === "function" ? stdout.getColorDepth() : undefined,
  };
}

process.on("exit", () => {
  send({ type: "exit" });
});

await readerTask;
