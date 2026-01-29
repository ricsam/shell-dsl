// Virtual Filesystem Interface
export interface VirtualFS {
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;

  writeFile(path: string, data: Buffer | string): Promise<void>;
  appendFile(path: string, data: Buffer | string): Promise<void>;
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
}

// Command Interfaces
export type Command = (ctx: CommandContext) => Promise<number>;

export interface CommandContext {
  args: string[];
  stdin: Stdin;
  stdout: Stdout;
  stderr: Stderr;
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  setCwd: (path: string) => void;
}

export interface Stdin {
  stream(): AsyncIterable<Uint8Array>;
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
  lines(): AsyncIterable<string>;
}

export interface Stdout {
  write(chunk: Uint8Array): Promise<void>;
  writeText(str: string): Promise<void>;
}

export interface Stderr {
  write(chunk: Uint8Array): Promise<void>;
  writeText(str: string): Promise<void>;
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

// Shell Configuration
export interface ShellConfig {
  fs: VirtualFS;
  cwd: string;
  env: Record<string, string>;
  commands: Record<string, Command>;
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
