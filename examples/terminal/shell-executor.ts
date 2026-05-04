import { createFsFromVolume, Volume } from "memfs";
import { builtinCommands } from "../../src/commands/index.ts";
import {
  createShellSession,
  createVirtualFS,
  type Command,
  type CommandCompleter,
  type TerminalInfo,
} from "../../src/index.ts";
import type { CliRequest, ExecutorEvent } from "./protocol.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let terminal: TerminalInfo = { isTTY: true, columns: 80, rows: 24 };

const vol = new Volume();
vol.fromJSON({
  "/home/demo/README.txt": "Welcome to the shell-dsl terminal demo.\nTry: pwd, ls, cat README.txt, cd /tmp\n",
  "/tmp/.keep": "",
});

const fs = createVirtualFS(createFsFromVolume(vol));
const demo: Command = async (ctx) => {
  await ctx.stdout.writeText(`demo ${ctx.args.join(" ")}\n`);
  return 0;
};
const demoCompleter: CommandCompleter = (ctx) => ({
  replacement: ctx.word,
  matches: ["--json ", "--verbose ", "status ", "run "].filter((match) =>
    match.startsWith(ctx.word)
  ),
});
const commands = { ...builtinCommands, demo };

const session = createShellSession({
  fs,
  cwd: "/home/demo",
  env: { USER: "demo", HOME: "/home/demo" },
  commands,
  completions: { demo: demoCompleter },
  terminal,
});

send({ type: "ready", cwd: session.getCwd() });

let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    await handleLine(line);
    newline = buffer.indexOf("\n");
  }
}

async function handleLine(line: string): Promise<void> {
  if (line.trim() === "") {
    return;
  }

  let request: CliRequest;
  try {
    request = JSON.parse(line) as CliRequest;
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (request.type === "exit") {
    await session.dispose();
    process.exit(0);
  }

  if (request.type === "resize") {
    terminal = request.terminal;
    return;
  }

  if (request.type === "complete") {
    const completion = await session.complete(request.source, request.cursor);
    send({ type: "complete", id: request.id, ...completion });
    return;
  }

  terminal = request.terminal;
  const execution = session.run(request.source, { terminal });

  const outputTask = (async () => {
    for await (const event of execution.output) {
      send({
        type: "output",
        id: request.id,
        fd: event.fd,
        data: Buffer.from(event.chunk).toString("base64"),
      });
    }
  })();

  const result = await execution.exit;
  await outputTask;

  send({
    type: "exit",
    id: request.id,
    exitCode: result.exitCode,
    cwd: session.getCwd(),
  });
}

function send(event: ExecutorEvent): void {
  Bun.stdout.write(encoder.encode(`${JSON.stringify(event)}\n`));
}
