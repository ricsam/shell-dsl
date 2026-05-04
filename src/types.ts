// Virtual Filesystem Interface
export interface VirtualFSWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface VirtualFS {
  readFile(path: string): Promise<Buffer>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readStream(path: string): AsyncIterable<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;

  writeFile(path: string, data: Buffer | string): Promise<void>;
  appendFile(path: string, data: Buffer | string): Promise<void>;
  writeStream(path: string, opts?: { append?: boolean }): Promise<VirtualFSWritable>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;

  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;

  resolve(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  glob(pattern: string, opts?: { cwd?: string }): Promise<string[]>;
}

export interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
  mtimeMs: number;
}

// Command Interfaces
export type Command = (ctx: CommandContext) => Promise<number>;

export interface ShellRunOptions {
  argv0?: string;
  args?: string[];
}

export interface ShellCommandApi {
  eval(source: string): Promise<number>;
  source(path: string, args?: string[]): Promise<number>;
  runScript(path: string, args?: string[]): Promise<number>;
  runShell(source: string, options?: ShellRunOptions): Promise<number>;
  getLastExitCode(): number;
  exit(exitCode?: number): never;
}

export interface TerminalInfo {
  isTTY: boolean;
  columns?: number;
  rows?: number;
  colorDepth?: number;
}

export interface CommandContext {
  args: string[];
  stdin: Stdin;
  stdout: Stdout;
  stderr: Stderr;
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  terminal: TerminalInfo;
  signal: AbortSignal;
  setCwd: (path: string) => void;
  exec?: (name: string, args: string[]) => Promise<ExecResult>;
  shell?: ShellCommandApi;
}

export interface ExternalCommandContext extends CommandContext {
  name: string;
}

export type ShellCommandFallback = (ctx: ExternalCommandContext) => Promise<number>;

export interface Stdin {
  stream(): AsyncIterable<Uint8Array>;
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
  lines(): AsyncIterable<string>;
}

export interface ShellInputController extends AsyncIterable<Uint8Array> {
  write(chunk: Uint8Array | string): Promise<void>;
  close(): void;
  abort(reason?: unknown): void;
}

export interface Stdout {
  write(chunk: Uint8Array): Promise<void>;
  writeText(str: string): Promise<void>;
  isTTY: boolean;
}

export interface Stderr {
  write(chunk: Uint8Array): Promise<void>;
  writeText(str: string): Promise<void>;
  isTTY: boolean;
}

export interface OutputCollector extends Stdout {
  close(): void;
  collect(): Promise<Buffer>;
  getReadableStream(): AsyncIterable<Uint8Array>;
}

// Execution Result
export interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export interface ShellOutputEvent {
  fd: 1 | 2;
  chunk: Uint8Array;
}

export type ShellInputSource = AsyncIterable<Uint8Array> | Buffer | string | null;

export interface ShellExecutionOptions {
  stdin?: ShellInputSource;
  stdout?: Stdout;
  stderr?: Stderr;
  terminal?: TerminalInfo;
  signal?: AbortSignal;
  outputMode?: "separate" | "merged";
}

export interface ShellExecution {
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  output: AsyncIterable<ShellOutputEvent>;
  exit: Promise<ExecResult>;
  kill(reason?: unknown): void;
}

// Shell Configuration
export interface ShellConfig {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
  isTTY?: boolean;
  terminal?: TerminalInfo;
  externalCommand?: ShellCommandFallback;
}

// Raw escape hatch type
export interface RawValue {
  raw: string;
}

export function isRawValue(value: unknown): value is RawValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    typeof (value as RawValue).raw === "string"
  );
}

// JS Object Redirection types
export type RedirectObject = Buffer | Blob | Response | string;

export interface RedirectObjectMap {
  [marker: string]: RedirectObject;
}

export function isRedirectObject(value: unknown): value is RedirectObject {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Blob ||
    value instanceof Response ||
    typeof value === "string"
  );
}
