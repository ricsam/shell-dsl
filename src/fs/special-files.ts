import type { FileStat } from "../types.ts";

export const DEV_NULL_PATH = "/dev/null";

function normalizeSpecialPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function isDevNullPath(path: string): boolean {
  return normalizeSpecialPath(path) === DEV_NULL_PATH;
}

export function readSpecialFile(
  path: string,
  encoding?: BufferEncoding
): Buffer | string | undefined {
  if (!isDevNullPath(path)) {
    return undefined;
  }

  return encoding ? "" : Buffer.alloc(0);
}

export function statSpecialFile(path: string): FileStat | undefined {
  if (!isDevNullPath(path)) {
    return undefined;
  }

  return {
    isFile: () => true,
    isDirectory: () => false,
    size: 0,
    mtime: new Date(0),
    mtimeMs: 0,
  };
}

export function existsSpecialFile(path: string): boolean | undefined {
  if (!isDevNullPath(path)) {
    return undefined;
  }

  return true;
}

export function discardsSpecialFileWrites(path: string): boolean {
  return isDevNullPath(path);
}

export function getSpecialPathError(
  path: string,
  operation: "mkdir" | "readdir" | "rm"
): Error | undefined {
  if (!isDevNullPath(path)) {
    return undefined;
  }

  switch (operation) {
    case "mkdir":
      return new Error(`EEXIST: file already exists, mkdir '${DEV_NULL_PATH}'`);
    case "readdir":
      return new Error(`ENOTDIR: not a directory, scandir '${DEV_NULL_PATH}'`);
    case "rm":
      return new Error(`EPERM: operation not permitted, rm '${DEV_NULL_PATH}'`);
  }
}
