import { beforeEach, describe, expect, test } from "bun:test";
import { FileSystem, OPFSFileSystem, createOPFSUnderlyingFS } from "../src/index.ts";

type FakeNode = FakeDirNode | FakeFileNode;

interface FakeDirNode {
  kind: "directory";
  entries: Map<string, FakeNode>;
  mtime: number;
}

interface FakeFileNode {
  kind: "file";
  data: Uint8Array;
  mtime: number;
}

const encoder = new TextEncoder();

describe("OPFSFileSystem", () => {
  let root: FileSystemDirectoryHandle;

  beforeEach(() => {
    root = createFakeOPFS({
      "/docs/readme.txt": "hello",
      "/docs/notes/todo.txt": "line1",
      "/secrets/token.txt": "abc123",
    });
  });

  describe("basic operations", () => {
    test("reads, writes, and appends files", async () => {
      const fs = new OPFSFileSystem(root);

      expect(await fs.readFile("/docs/readme.txt", "utf8")).toBe("hello");

      await fs.writeFile("/docs/new.txt", "new");
      expect(await fs.readFile("/docs/new.txt", "utf8")).toBe("new");

      await fs.appendFile("/docs/new.txt", " content");
      expect(await fs.readFile("/docs/new.txt", "utf8")).toBe("new content");

      await fs.appendFile("/docs/appended-created.txt", "first");
      expect(await fs.readFile("/docs/appended-created.txt", "utf8")).toBe("first");
    });

    test("supports readdir, stat, exists, and glob", async () => {
      const fs = new OPFSFileSystem(root);

      const rootEntries = await fs.readdir("/");
      expect(rootEntries).toContain("docs");
      expect(rootEntries).toContain("secrets");

      const fileStat = await fs.stat("/docs/readme.txt");
      expect(fileStat.isFile()).toBe(true);
      expect(fileStat.isDirectory()).toBe(false);
      expect(fileStat.size).toBe(5);

      const dirStat = await fs.stat("/docs");
      expect(dirStat.isFile()).toBe(false);
      expect(dirStat.isDirectory()).toBe(true);
      expect(dirStat.mtime.getTime()).toBe(0);

      expect(await fs.exists("/docs/readme.txt")).toBe(true);
      expect(await fs.exists("/missing.txt")).toBe(false);

      const matches = await fs.glob("**/*.txt", { cwd: "/" });
      expect(matches).toContain("/docs/readme.txt");
      expect(matches).toContain("/docs/notes/todo.txt");
      expect(matches).toContain("/secrets/token.txt");
    });

    test("supports mkdir and rm semantics", async () => {
      const fs = new OPFSFileSystem(root);

      await fs.mkdir("/new/a/b", { recursive: true });
      expect(await fs.exists("/new/a/b")).toBe(true);

      await expect(fs.mkdir("/docs")).rejects.toThrow(/EEXIST/);
      await expect(fs.mkdir("/missing/child")).rejects.toThrow();

      await fs.rm("/docs/readme.txt");
      expect(await fs.exists("/docs/readme.txt")).toBe(false);

      await expect(fs.rm("/docs")).rejects.toThrow();
      await fs.rm("/docs", { recursive: true });
      expect(await fs.exists("/docs")).toBe(false);

      await expect(fs.rm("/not-there")).rejects.toThrow();
      await fs.rm("/not-there", { force: true });
    });
  });

  describe("permissions and path safety", () => {
    test("honors excluded and read-only permission rules", async () => {
      const fs = new OPFSFileSystem(root, {
        "secrets/**": "excluded",
        "docs/**": "read-only",
        "docs/readme.txt": "read-write",
      });

      await expect(fs.readFile("/secrets/token.txt")).rejects.toThrow(/excluded/);
      await expect(fs.writeFile("/docs/notes/todo.txt", "blocked")).rejects.toThrow(/read-only/);

      await fs.writeFile("/docs/readme.txt", "updated");
      expect(await fs.readFile("/docs/readme.txt", "utf8")).toBe("updated");
    });

    test("keeps mount safety checks at root", async () => {
      const fs = new OPFSFileSystem(root);
      await expect(fs.readFile("/../docs/readme.txt")).rejects.toThrow(/escapes mount/);
      await expect(fs.rm("/", { recursive: true })).rejects.toThrow(/EPERM/);
    });
  });

  describe("adapter usage with FileSystem", () => {
    test("works when injected into FileSystem directly", async () => {
      const fs = new FileSystem("/", {}, createOPFSUnderlyingFS(root));

      await fs.writeFile("/direct.txt", "ok");
      expect(await fs.readFile("/direct.txt", "utf8")).toBe("ok");
    });
  });
});

function createFakeOPFS(files: Record<string, string>): FileSystemDirectoryHandle {
  let tick = 1;
  const now = () => tick++;

  const root: FakeDirNode = {
    kind: "directory",
    entries: new Map(),
    mtime: now(),
  };

  for (const [rawPath, content] of Object.entries(files)) {
    const segments = rawPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let current = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = current.entries.get(segment);
      if (existing && existing.kind !== "directory") {
        throw new Error(`Invalid fixture path "${rawPath}"`);
      }
      if (!existing) {
        const created: FakeDirNode = { kind: "directory", entries: new Map(), mtime: now() };
        current.entries.set(segment, created);
        current = created;
      } else {
        current = existing;
      }
    }

    current.entries.set(segments[segments.length - 1]!, {
      kind: "file",
      data: encoder.encode(content),
      mtime: now(),
    });
  }

  return new FakeDirectoryHandle("", root, now) as unknown as FileSystemDirectoryHandle;
}

class FakeDirectoryHandle {
  public readonly kind = "directory";

  constructor(
    public readonly name: string,
    private readonly node: FakeDirNode,
    private readonly now: () => number
  ) {}

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.node.entries.get(name);
    if (existing) {
      if (existing.kind !== "directory") {
        throw createDomLikeError("TypeMismatchError", `${name} is not a directory`);
      }
      return new FakeDirectoryHandle(name, existing, this.now) as unknown as FileSystemDirectoryHandle;
    }

    if (!options?.create) {
      throw createDomLikeError("NotFoundError", `${name} does not exist`);
    }

    const dir: FakeDirNode = { kind: "directory", entries: new Map(), mtime: this.now() };
    this.node.entries.set(name, dir);
    this.node.mtime = this.now();
    return new FakeDirectoryHandle(name, dir, this.now) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const existing = this.node.entries.get(name);
    if (existing) {
      if (existing.kind !== "file") {
        throw createDomLikeError("TypeMismatchError", `${name} is not a file`);
      }
      return new FakeFileHandle(name, existing, this.now) as unknown as FileSystemFileHandle;
    }

    if (!options?.create) {
      throw createDomLikeError("NotFoundError", `${name} does not exist`);
    }

    const file: FakeFileNode = { kind: "file", data: new Uint8Array(), mtime: this.now() };
    this.node.entries.set(name, file);
    this.node.mtime = this.now();
    return new FakeFileHandle(name, file, this.now) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    const existing = this.node.entries.get(name);
    if (!existing) {
      throw createDomLikeError("NotFoundError", `${name} does not exist`);
    }

    if (existing.kind === "directory" && existing.entries.size > 0 && !options?.recursive) {
      throw createDomLikeError("InvalidModificationError", `Directory "${name}" is not empty`);
    }

    this.node.entries.delete(name);
    this.node.mtime = this.now();
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, node] of this.node.entries.entries()) {
      if (node.kind === "directory") {
        yield [name, new FakeDirectoryHandle(name, node, this.now) as unknown as FileSystemHandle];
      } else {
        yield [name, new FakeFileHandle(name, node, this.now) as unknown as FileSystemHandle];
      }
    }
  }
}

class FakeFileHandle {
  public readonly kind = "file";

  constructor(
    public readonly name: string,
    private readonly node: FakeFileNode,
    private readonly now: () => number
  ) {}

  async getFile(): Promise<File> {
    return new FakeFile(this.node) as unknown as File;
  }

  async createWritable(
    options?: FileSystemCreateWritableOptions
  ): Promise<FileSystemWritableFileStream> {
    return new FakeWritable(this.node, this.now, options) as unknown as FileSystemWritableFileStream;
  }
}

class FakeFile {
  constructor(private readonly node: FakeFileNode) {}

  get size(): number {
    return this.node.data.length;
  }

  get lastModified(): number {
    return this.node.mtime;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const out = new Uint8Array(this.node.data.length);
    out.set(this.node.data);
    return out.buffer;
  }
}

class FakeWritable {
  private data: Uint8Array;
  private closed = false;

  constructor(
    private readonly node: FakeFileNode,
    private readonly now: () => number,
    options?: FileSystemCreateWritableOptions
  ) {
    this.data = options?.keepExistingData ? node.data.slice() : new Uint8Array();
  }

  async write(chunk: FileSystemWriteChunkType): Promise<void> {
    if (this.closed) {
      throw new Error("Stream is closed");
    }

    if (isWriteParams(chunk)) {
      const bytes = await toBytes(chunk.data);
      this.writeAt(chunk.position ?? 0, bytes);
      return;
    }

    if (isTruncateParams(chunk)) {
      this.truncate(chunk.size);
      return;
    }

    if (isSeekParams(chunk)) {
      return;
    }

    if (isBinaryChunk(chunk)) {
      this.data = await toBytes(chunk);
      return;
    }

    throw new Error("Unsupported write payload");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.node.data = this.data;
    this.node.mtime = this.now();
  }

  private writeAt(position: number, bytes: Uint8Array): void {
    const start = Math.max(0, Math.trunc(position));
    const next = new Uint8Array(Math.max(this.data.length, start + bytes.length));
    next.set(this.data, 0);
    next.set(bytes, start);
    this.data = next;
  }

  private truncate(size: number): void {
    const next = new Uint8Array(Math.max(0, Math.trunc(size)));
    next.set(this.data.slice(0, next.length), 0);
    this.data = next;
  }
}

function isWriteParams(chunk: FileSystemWriteChunkType): chunk is FileSystemWriteChunkType & {
  type: "write";
  position?: number;
  data: string | BufferSource | Blob;
} {
  return typeof chunk === "object" && chunk !== null && "type" in chunk && chunk.type === "write";
}

function isTruncateParams(chunk: FileSystemWriteChunkType): chunk is FileSystemWriteChunkType & {
  type: "truncate";
  size: number;
} {
  return typeof chunk === "object" && chunk !== null && "type" in chunk && chunk.type === "truncate";
}

function isSeekParams(chunk: FileSystemWriteChunkType): chunk is FileSystemWriteChunkType & {
  type: "seek";
  position: number;
} {
  return typeof chunk === "object" && chunk !== null && "type" in chunk && chunk.type === "seek";
}

function isBinaryChunk(chunk: FileSystemWriteChunkType): chunk is string | BufferSource | Blob {
  return (
    typeof chunk === "string" ||
    chunk instanceof Blob ||
    chunk instanceof ArrayBuffer ||
    ArrayBuffer.isView(chunk)
  );
}

async function toBytes(value: string | BufferSource | Blob): Promise<Uint8Array> {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.slice();
  }
  throw new Error("Unsupported write payload");
}

function createDomLikeError(name: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { name: string }).name = name;
  return error;
}
