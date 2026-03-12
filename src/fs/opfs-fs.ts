import { FileSystem, type PermissionRules, type UnderlyingFS } from "./real-fs.ts";

const DIRECTORY_MTIME = new Date(0);

export function createOPFSUnderlyingFS(root: FileSystemDirectoryHandle): UnderlyingFS {
  return {
    promises: {
      async readFile(path: string): Promise<Buffer> {
        const { parentSegments, name } = splitParent(path);
        const parent = await walkDirectory(root, parentSegments, false);
        const fileHandle = await parent.getFileHandle(name, { create: false });
        const file = await fileHandle.getFile();
        return Buffer.from(await file.arrayBuffer());
      },

      async readdir(path: string): Promise<string[]> {
        const dir = await walkDirectory(root, getPathSegments(path), false);
        const entries: string[] = [];
        for await (const [name] of dir.entries()) {
          entries.push(name);
        }
        return entries;
      },

      async stat(path: string): Promise<{
        isFile(): boolean;
        isDirectory(): boolean;
        size: number;
        mtime: Date;
      }> {
        const segments = getPathSegments(path);

        if (segments.length === 0) {
          return createDirectoryStat();
        }

        const { parentSegments, name } = splitParent(path);
        const parent = await walkDirectory(root, parentSegments, false);

        try {
          const fileHandle = await parent.getFileHandle(name, { create: false });
          const file = await fileHandle.getFile();
          return {
            isFile: () => true,
            isDirectory: () => false,
            size: file.size,
            mtime: new Date(file.lastModified ?? 0),
          };
        } catch (error) {
          if (!isNotFoundOrTypeMismatch(error)) throw error;
        }

        try {
          await parent.getDirectoryHandle(name, { create: false });
          return createDirectoryStat();
        } catch (error) {
          if (!isNotFoundOrTypeMismatch(error)) throw error;
          throw error;
        }
      },

      async writeFile(path: string, data: Buffer | string): Promise<void> {
        const { parentSegments, name } = splitParent(path);
        const parent = await walkDirectory(root, parentSegments, false);
        const fileHandle = await parent.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(toWritableData(data));
        await writable.close();
      },

      async appendFile(path: string, data: Buffer | string): Promise<void> {
        const { parentSegments, name } = splitParent(path);
        const parent = await walkDirectory(root, parentSegments, false);
        const fileHandle = await parent.getFileHandle(name, { create: true });
        const file = await fileHandle.getFile();
        const writable = await fileHandle.createWritable({ keepExistingData: true });
        await writable.write({
          type: "write",
          position: file.size,
          data: toWritableData(data),
        });
        await writable.close();
      },

      async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
        const segments = getPathSegments(path);
        if (segments.length === 0) {
          return;
        }

        if (opts?.recursive) {
          await walkDirectory(root, segments, true);
          return;
        }

        const parent = await walkDirectory(root, segments.slice(0, -1), false);
        const name = segments[segments.length - 1]!;
        const exists = await entryExists(parent, name);
        if (exists) {
          throw new Error(`EEXIST: file already exists, mkdir '${normalizeOpfsPath(path)}'`);
        }
        await parent.getDirectoryHandle(name, { create: true });
      },

      async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
        const segments = getPathSegments(path);
        if (segments.length === 0) {
          throw new Error("EPERM: operation not permitted, rm '/'");
        }

        const parent = await walkDirectory(root, segments.slice(0, -1), false);
        const name = segments[segments.length - 1]!;
        try {
          await parent.removeEntry(name, { recursive: opts?.recursive });
        } catch (error) {
          if (opts?.force && isNotFoundError(error)) {
            return;
          }
          throw error;
        }
      },
    },
  };
}

export class OPFSFileSystem extends FileSystem {
  constructor(root: FileSystemDirectoryHandle, permissions?: PermissionRules) {
    super("/", permissions, createOPFSUnderlyingFS(root));
  }
}

function createDirectoryStat() {
  return {
    isFile: () => false,
    isDirectory: () => true,
    size: 0,
    mtime: DIRECTORY_MTIME,
  };
}

function normalizeOpfsPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const rawSegments = (normalized.startsWith("/") ? normalized : `/${normalized}`)
    .split("/")
    .filter(Boolean);

  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

function getPathSegments(path: string): string[] {
  const normalized = normalizeOpfsPath(path);
  return normalized.split("/").filter(Boolean);
}

function splitParent(path: string): { parentSegments: string[]; name: string } {
  const segments = getPathSegments(path);
  if (segments.length === 0) {
    throw new Error(`Invalid file path: "${path}"`);
  }
  return {
    parentSegments: segments.slice(0, -1),
    name: segments[segments.length - 1]!,
  };
}

async function walkDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

async function entryExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if (isTypeMismatchError(error)) return true;
    if (!isNotFoundError(error)) throw error;
  }

  try {
    await dir.getDirectoryHandle(name, { create: false });
    return true;
  } catch (error) {
    if (isTypeMismatchError(error)) return true;
    if (!isNotFoundError(error)) throw error;
    return false;
  }
}

function isNotFoundOrTypeMismatch(error: unknown): boolean {
  return isNotFoundError(error) || isTypeMismatchError(error);
}

function isNotFoundError(error: unknown): boolean {
  return getErrorName(error) === "NotFoundError";
}

function isTypeMismatchError(error: unknown): boolean {
  return getErrorName(error) === "TypeMismatchError";
}

function getErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const named = error as { name?: unknown };
  return typeof named.name === "string" ? named.name : undefined;
}

function toWritableData(data: Buffer | string): string | ArrayBuffer {
  if (typeof data === "string") {
    return data;
  }
  const out = new Uint8Array(data.length);
  out.set(data);
  return out.buffer;
}
