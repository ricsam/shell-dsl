import * as path from "path";
import * as nodeFs from "node:fs/promises";
import type { VirtualFS, FileStat } from "../types.ts";
import { globVirtualFS } from "../utils/glob.ts";
import {
  discardsSpecialFileWrites,
  existsSpecialFile,
  getSpecialPathError,
  readSpecialFile,
  statSpecialFile,
} from "./special-files.ts";

export type Permission = "read-write" | "read-only" | "excluded";
export type PermissionRules = Record<string, Permission>;
export interface PathOps {
  readonly separator: string;
  resolve(...paths: string[]): string;
  normalize(path: string): string;
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  basename(path: string): string;
}

// Minimal interface for the underlying fs (compatible with node:fs and memfs)
export interface UnderlyingFS {
  pathOps?: PathOps;
  promises: {
    readFile(path: string): Promise<Buffer | Uint8Array | string>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{
      isFile(): boolean;
      isDirectory(): boolean;
      size: number;
      mtime: Date;
    }>;
    writeFile(path: string, data: Buffer | string): Promise<void>;
    appendFile(path: string, data: Buffer | string): Promise<void>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<string | undefined | void>;
    rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  };
}

// Default: use real node:fs
const defaultFS: UnderlyingFS = { promises: nodeFs };
const nodePathOps: PathOps = {
  separator: path.sep,
  resolve: (...paths) => path.resolve(...paths),
  normalize: (filePath) => path.normalize(filePath),
  join: (...paths) => path.join(...paths),
  relative: (from, to) => path.relative(from, to),
  isAbsolute: (filePath) => path.isAbsolute(filePath),
  dirname: (filePath) => path.dirname(filePath),
  basename: (filePath) => path.basename(filePath),
};

interface CompiledRule {
  pattern: string;
  permission: Permission;
  specificity: number;
}

export class FileSystem implements VirtualFS {
  private readonly mountBase: string | null;
  private readonly rules: CompiledRule[];
  private readonly pathOps: PathOps;
  protected readonly underlyingFs: UnderlyingFS;

  constructor(mountPath?: string, permissions?: PermissionRules, fs?: UnderlyingFS) {
    const underlyingFs = fs ?? defaultFS;
    this.pathOps = underlyingFs.pathOps ?? nodePathOps;
    this.mountBase = mountPath ? this.pathOps.resolve(mountPath) : null;
    this.rules = this.compileRules(permissions ?? {});
    this.underlyingFs = underlyingFs;
  }

  private compileRules(permissions: PermissionRules): CompiledRule[] {
    return Object.entries(permissions)
      .map(([pattern, permission]) => ({
        pattern,
        permission,
        specificity: this.calculateSpecificity(pattern),
      }))
      .sort((a, b) => b.specificity - a.specificity); // highest first
  }

  private calculateSpecificity(pattern: string): number {
    const segments = pattern.split("/").filter(Boolean);
    let score = segments.length * 1000; // segment count is primary

    for (const seg of segments) {
      if (seg === "**") score += 0;
      else if (seg.includes("*")) score += 1;
      else score += 10; // literal segment
    }
    return score;
  }

  public getPermission(virtualPath: string): Permission {
    const normalized = virtualPath.replace(/^\/+/, ""); // strip leading slashes

    for (const rule of this.rules) {
      if (this.matchGlob(rule.pattern, normalized)) {
        return rule.permission;
      }
    }
    return "read-write"; // default
  }

  private matchGlob(pattern: string, filePath: string): boolean {
    // Convert glob to regex
    // ** matches any path segments, * matches within segment
    const regex = pattern
      .split("/")
      .map((seg) => {
        if (seg === "**") return ".*";
        return seg.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
      })
      .join("/");
    return new RegExp(`^${regex}$`).test(filePath);
  }

  public checkPermission(virtualPath: string, operation: "read" | "write"): void {
    const perm = this.getPermission(virtualPath);

    if (perm === "excluded") {
      throw new Error(`Access denied: "${virtualPath}" is excluded`);
    }
    if (operation === "write" && perm === "read-only") {
      throw new Error(`Access denied: "${virtualPath}" is read-only`);
    }
  }

  private resolveSafePath(virtualPath: string): string {
    if (this.mountBase === null) {
      return this.pathOps.resolve(virtualPath);
    }

    // Check for path traversal by tracking depth
    const segments = virtualPath.split("/").filter(Boolean);
    let depth = 0;
    for (const seg of segments) {
      if (seg === "..") {
        depth--;
        if (depth < 0) {
          throw new Error(`Path traversal blocked: "${virtualPath}" escapes mount point`);
        }
      } else if (seg !== ".") {
        depth++;
      }
    }

    const normalized = this.pathOps.normalize(virtualPath);
    const relativePath = normalized.startsWith("/") ? normalized.slice(1) : normalized;
    const realPath = this.pathOps.join(this.mountBase, relativePath);
    const resolved = this.pathOps.resolve(realPath);

    // Double-check containment (defense in depth), including root mounts.
    const relativeFromMount = this.pathOps.relative(this.mountBase, resolved);
    const escapesMount =
      relativeFromMount === ".." ||
      relativeFromMount.startsWith(`..${this.pathOps.separator}`) ||
      this.pathOps.isAbsolute(relativeFromMount);
    if (escapesMount) {
      throw new Error(`Path traversal blocked: "${virtualPath}" escapes mount point`);
    }

    return resolved;
  }

  // Read operations
  async readFile(filePath: string): Promise<Buffer>;
  async readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  async readFile(filePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
    const specialContent = readSpecialFile(filePath, encoding);
    if (specialContent !== undefined) {
      return specialContent;
    }
    this.checkPermission(filePath, "read");
    const realPath = this.resolveSafePath(filePath);
    const content = await this.underlyingFs.promises.readFile(realPath);
    const buf = Buffer.from(content);
    return encoding ? buf.toString(encoding) : buf;
  }

  async readdir(dirPath: string): Promise<string[]> {
    const specialError = getSpecialPathError(dirPath, "readdir");
    if (specialError) {
      throw specialError;
    }
    this.checkPermission(dirPath, "read");
    const realPath = this.resolveSafePath(dirPath);
    const entries = await this.underlyingFs.promises.readdir(realPath);
    return entries.map(String);
  }

  async stat(filePath: string): Promise<FileStat> {
    const specialStat = statSpecialFile(filePath);
    if (specialStat) {
      return specialStat;
    }
    this.checkPermission(filePath, "read");
    const realPath = this.resolveSafePath(filePath);
    const stats = await this.underlyingFs.promises.stat(realPath);
    return {
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  }

  async exists(filePath: string): Promise<boolean> {
    const specialExists = existsSpecialFile(filePath);
    if (specialExists !== undefined) {
      return specialExists;
    }
    try {
      this.checkPermission(filePath, "read");
      const realPath = this.resolveSafePath(filePath);
      await this.underlyingFs.promises.stat(realPath);
      return true;
    } catch {
      return false;
    }
  }

  // Write operations
  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    if (discardsSpecialFileWrites(filePath)) {
      return;
    }
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.writeFile(realPath, data);
  }

  async appendFile(filePath: string, data: Buffer | string): Promise<void> {
    if (discardsSpecialFileWrites(filePath)) {
      return;
    }
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.appendFile(realPath, data);
  }

  async mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
    const specialError = getSpecialPathError(dirPath, "mkdir");
    if (specialError) {
      throw specialError;
    }
    this.checkPermission(dirPath, "write");
    const realPath = this.resolveSafePath(dirPath);
    await this.underlyingFs.promises.mkdir(realPath, opts);
  }

  async rm(filePath: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const specialError = getSpecialPathError(filePath, "rm");
    if (specialError) {
      throw specialError;
    }
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.rm(realPath, opts);
  }

  // Path utilities (no permission check needed)
  resolve(...paths: string[]): string {
    return this.pathOps.resolve("/", ...paths);
  }

  dirname(filePath: string): string {
    return this.pathOps.dirname(filePath);
  }

  basename(filePath: string): string {
    return this.pathOps.basename(filePath);
  }

  // Glob expansion
  async glob(pattern: string, opts?: { cwd?: string }): Promise<string[]> {
    const cwd = opts?.cwd ?? "/";
    this.checkPermission(cwd, "read");
    return globVirtualFS(this, pattern, { cwd });
  }
}
