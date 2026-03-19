import type { IFs } from "memfs";
import type { VirtualFS, FileStat } from "../types.ts";
import * as pathModule from "path";
import { globVirtualFS } from "../utils/glob.ts";
import {
  discardsSpecialFileWrites,
  existsSpecialFile,
  getSpecialPathError,
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
