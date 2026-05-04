import { createFsFromVolume, Volume } from "memfs";
import { builtinCommands } from "../../src/commands/index.ts";
import { createShellSession, createVirtualFS, type TerminalInfo } from "../../src/index.ts";
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

const session = createShellSession({
  fs,
  cwd: "/home/demo",
  env: { USER: "demo", HOME: "/home/demo" },
  commands: builtinCommands,
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
    const completion = await completeInput(request.source, request.cursor);
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

async function completeInput(
  source: string,
  cursor: number
): Promise<{ replacement: string; matches: string[] }> {
  const prefix = source.slice(0, cursor);
  const { word, start } = getCurrentWord(prefix);

  if (isCommandPosition(prefix, start) && !looksLikePath(word)) {
    const matches = Object.keys(builtinCommands)
      .filter((name) => name.startsWith(word))
      .sort()
      .map((name) => `${name} `);
    return { replacement: word, matches };
  }

  return completePath(word);
}

function getCurrentWord(prefix: string): { word: string; start: number } {
  let start = prefix.length;
  while (start > 0 && !/\s/.test(prefix[start - 1]!)) {
    start--;
  }
  return { word: prefix.slice(start), start };
}

function isCommandPosition(prefix: string, wordStart: number): boolean {
  const beforeWord = prefix.slice(0, wordStart);
  const segmentStart = Math.max(
    beforeWord.lastIndexOf(";"),
    beforeWord.lastIndexOf("|"),
    beforeWord.lastIndexOf("&")
  );
  const segment = beforeWord.slice(segmentStart + 1).trim();
  if (segment === "") {
    return true;
  }
  return segment.split(/\s+/).every((part) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(part));
}

function looksLikePath(word: string): boolean {
  return word.startsWith("/") || word.startsWith(".") || word.includes("/");
}

async function completePath(word: string): Promise<{ replacement: string; matches: string[] }> {
  const slash = word.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : word.slice(0, slash + 1);
  const namePrefix = slash === -1 ? word : word.slice(slash + 1);
  const basePath = dirPart === ""
    ? session.getCwd()
    : dirPart.startsWith("/")
      ? dirPart
      : fs.resolve(session.getCwd(), dirPart);

  let entries: string[];
  try {
    entries = await fs.readdir(basePath);
  } catch {
    return { replacement: word, matches: [] };
  }

  const matches = await Promise.all(
    entries
      .filter((entry) => entry.startsWith(namePrefix))
      .sort()
      .map(async (entry) => {
        const candidate = `${dirPart}${escapeCompletionSegment(entry)}`;
        const path = fs.resolve(basePath, entry);
        try {
          const stat = await fs.stat(path);
          return stat.isDirectory() ? `${candidate}/` : candidate;
        } catch {
          return candidate;
        }
      })
  );

  if (matches.length === 1 && !matches[0]!.endsWith("/")) {
    matches[0] = `${matches[0]} `;
  }

  return { replacement: word, matches };
}

function escapeCompletionSegment(segment: string): string {
  return segment.replace(/([\s\\'"$`!#&;|<>()[\]{}*?])/g, "\\$1");
}
