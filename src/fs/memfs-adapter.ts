import type { IFs } from "memfs";
import type { VirtualFS, VirtualFSWritable, FileStat } from "../types.ts";
import * as pathModule from "path";
import { globVirtualFS } from "../utils/glob.ts";
import {
  discardsSpecialFileWrites,
  existsSpecialFile,
  getSpecialPathError,
  isDevNullPath,
  readSpecialFile,
  statSpecialFile,
} from "./special-files.ts";

export function createVirtualFS(memfs: IFs): VirtualFS {
  const { promises: fs } = memfs;

  return {
    readFile: (async (path: string, encoding?: BufferEncoding): Promise<Buffer | string> => {
      const specialContent = readSpecialFile(path, encoding);
      if (specialContent !== undefined) return specialContent;
      const content = await fs.readFile(path);
      const buf = Buffer.from(content);
      return encoding ? buf.toString(encoding) : buf;
    }) as VirtualFS["readFile"],

    readStream(path: string): AsyncIterable<Uint8Array> {
      if (isDevNullPath(path)) {
        return emptyIterable();
      }
      return {
        async *[Symbol.asyncIterator]() {
          const content = await fs.readFile(path);
          yield Buffer.from(content);
        },
      };
    },

    async readdir(path: string): Promise<string[]> {
      const specialError = getSpecialPathError(path, "readdir");
      if (specialError) throw specialError;
      const entries = await fs.readdir(path);
      return entries.map(String);
    },

    async stat(path: string): Promise<FileStat> {
      const specialStat = statSpecialFile(path);
      if (specialStat) return specialStat;
      const stats = await fs.stat(path);
      return {
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        size: Number(stats.size),
        mtime: new Date(stats.mtime),
        mtimeMs: Number((stats as { mtimeMs?: number }).mtimeMs ?? stats.mtime),
      };
    },

    async exists(path: string): Promise<boolean> {
      const specialExists = existsSpecialFile(path);
      if (specialExists !== undefined) return specialExists;
      try {
        await fs.stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async writeFile(path: string, data: Buffer | string): Promise<void> {
      if (discardsSpecialFileWrites(path)) {
        return;
      }
      await fs.writeFile(path, data);
    },

    async appendFile(path: string, data: Buffer | string): Promise<void> {
      if (discardsSpecialFileWrites(path)) {
        return;
      }
      await fs.appendFile(path, data);
    },

    async writeStream(path: string, opts?: { append?: boolean }): Promise<VirtualFSWritable> {
      if (discardsSpecialFileWrites(path)) {
        return createDiscardingWritable();
      }

      const chunks: Uint8Array[] = [];
      let closed = false;

      return {
        async write(chunk: Uint8Array): Promise<void> {
          if (closed) {
            throw new Error("stream is closed");
          }
          chunks.push(Buffer.from(chunk));
        },
        async close(): Promise<void> {
          if (closed) return;
          closed = true;
          const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
          if (opts?.append) {
            await fs.appendFile(path, data);
          } else {
            await fs.writeFile(path, data);
          }
        },
        async abort(_reason?: unknown): Promise<void> {
          closed = true;
          chunks.length = 0;
        },
      };
    },

    async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      const specialError = getSpecialPathError(path, "mkdir");
      if (specialError) throw specialError;
      await fs.mkdir(path, opts);
    },

    async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
      const specialError = getSpecialPathError(path, "rm");
      if (specialError) throw specialError;
      try {
        const stats = await fs.stat(path);
        if (stats.isDirectory()) {
          await fs.rmdir(path, { recursive: opts?.recursive });
        } else {
          await fs.unlink(path);
        }
      } catch (err) {
        if (!opts?.force) throw err;
      }
    },

    resolve(...paths: string[]): string {
      return pathModule.resolve(...paths);
    },

    dirname(path: string): string {
      return pathModule.dirname(path);
    },

    basename(path: string): string {
      return pathModule.basename(path);
    },

    async glob(pattern: string, opts?: { cwd?: string }): Promise<string[]> {
      const cwd = opts?.cwd ?? "/";
      return globVirtualFS(
        {
          readdir: (filePath: string) => this.readdir(filePath),
          stat: (filePath: string) => this.stat(filePath),
          resolve: (...paths: string[]) => this.resolve(...paths),
        },
        pattern,
        { cwd }
      );
    },
  };
}

function emptyIterable(): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {},
  };
}

function createDiscardingWritable(): VirtualFSWritable {
  return {
    async write(_chunk: Uint8Array): Promise<void> {},
    async close(): Promise<void> {},
    async abort(_reason?: unknown): Promise<void> {},
  };
}
