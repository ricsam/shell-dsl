import * as path from "path";
import * as nodeFs from "node:fs/promises";
import type { VirtualFS, FileStat } from "../types.ts";

export type Permission = "read-write" | "read-only" | "excluded";
export type PermissionRules = Record<string, Permission>;

// Minimal interface for the underlying fs (compatible with node:fs and memfs)
export interface UnderlyingFS {
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

interface CompiledRule {
  pattern: string;
  permission: Permission;
  specificity: number;
}

export class FileSystem implements VirtualFS {
  private readonly mountBase: string | null;
  private readonly rules: CompiledRule[];
  protected readonly underlyingFs: UnderlyingFS;

  constructor(mountPath?: string, permissions?: PermissionRules, fs?: UnderlyingFS) {
    this.mountBase = mountPath ? path.resolve(mountPath) : null;
    this.rules = this.compileRules(permissions ?? {});
    this.underlyingFs = fs ?? defaultFS;
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
      return path.resolve(virtualPath);
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

    const normalized = path.normalize(virtualPath);
    const relativePath = normalized.startsWith("/") ? normalized.slice(1) : normalized;
    const realPath = path.join(this.mountBase, relativePath);
    const resolved = path.resolve(realPath);

    // Double-check containment (defense in depth)
    if (!resolved.startsWith(this.mountBase + path.sep) && resolved !== this.mountBase) {
      throw new Error(`Path traversal blocked: "${virtualPath}" escapes mount point`);
    }

    return resolved;
  }

  // Read operations
  async readFile(filePath: string): Promise<Buffer> {
    this.checkPermission(filePath, "read");
    const realPath = this.resolveSafePath(filePath);
    const content = await this.underlyingFs.promises.readFile(realPath);
    return Buffer.from(content);
  }

  async readdir(dirPath: string): Promise<string[]> {
    this.checkPermission(dirPath, "read");
    const realPath = this.resolveSafePath(dirPath);
    const entries = await this.underlyingFs.promises.readdir(realPath);
    return entries.map(String);
  }

  async stat(filePath: string): Promise<FileStat> {
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
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.writeFile(realPath, data);
  }

  async appendFile(filePath: string, data: Buffer | string): Promise<void> {
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.appendFile(realPath, data);
  }

  async mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
    this.checkPermission(dirPath, "write");
    const realPath = this.resolveSafePath(dirPath);
    await this.underlyingFs.promises.mkdir(realPath, opts);
  }

  async rm(filePath: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.checkPermission(filePath, "write");
    const realPath = this.resolveSafePath(filePath);
    await this.underlyingFs.promises.rm(realPath, opts);
  }

  // Path utilities (no permission check needed)
  resolve(...paths: string[]): string {
    return path.resolve("/", ...paths);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  // Glob with permission filtering
  async glob(pattern: string, opts?: { cwd?: string }): Promise<string[]> {
    const cwd = opts?.cwd ?? "/";
    this.checkPermission(cwd, "read");

    const matches = await this.expandGlob(pattern, cwd);

    // Filter out excluded paths
    return matches.filter((p) => this.getPermission(p) !== "excluded").sort();
  }

  // Glob expansion (similar to memfs-adapter implementation)
  private async expandGlob(pattern: string, cwd: string): Promise<string[]> {
    // Handle brace expansion first
    const patterns = this.expandBraces(pattern);
    const allMatches: string[] = [];

    for (const pat of patterns) {
      const matches = await this.matchPattern(pat, cwd);
      allMatches.push(...matches);
    }

    // Remove duplicates and sort
    return [...new Set(allMatches)].sort();
  }

  private expandBraces(pattern: string): string[] {
    const braceMatch = pattern.match(/\{([^{}]+)\}/);
    if (!braceMatch) return [pattern];

    const before = pattern.slice(0, braceMatch.index);
    const after = pattern.slice(braceMatch.index! + braceMatch[0].length);
    const options = braceMatch[1]!.split(",");

    const results: string[] = [];
    for (const opt of options) {
      const expanded = this.expandBraces(before + opt + after);
      results.push(...expanded);
    }
    return results;
  }

  private async matchPattern(pattern: string, cwd: string): Promise<string[]> {
    const parts = pattern.split("/").filter((p) => p !== "");
    const isAbsolute = pattern.startsWith("/");
    const startDir = isAbsolute ? "/" : cwd;

    return this.matchParts(parts, startDir);
  }

  private async matchParts(parts: string[], currentPath: string): Promise<string[]> {
    if (parts.length === 0) {
      return [currentPath];
    }

    const [part, ...rest] = parts;

    // Handle ** (recursive glob)
    if (part === "**") {
      const results: string[] = [];

      // Match current directory
      const withoutStar = await this.matchParts(rest, currentPath);
      results.push(...withoutStar);

      // Recurse into subdirectories
      try {
        const realPath = this.resolveSafePath(currentPath);
        const entries = await this.underlyingFs.promises.readdir(realPath);
        for (const entry of entries) {
          const entryPath = path.posix.join(currentPath, String(entry));
          try {
            const entryRealPath = this.resolveSafePath(entryPath);
            const stat = await this.underlyingFs.promises.stat(entryRealPath);
            if (stat.isDirectory()) {
              const subMatches = await this.matchParts(parts, entryPath);
              results.push(...subMatches);
            }
          } catch {
            // Skip inaccessible entries
          }
        }
      } catch {
        // Directory not readable
      }

      return results;
    }

    // Handle regular glob patterns
    const regex = this.globToRegex(part!);

    try {
      const realPath = this.resolveSafePath(currentPath);
      const entries = await this.underlyingFs.promises.readdir(realPath);
      const results: string[] = [];

      for (const entry of entries) {
        const entryName = String(entry);
        if (regex.test(entryName)) {
          const entryPath = path.posix.join(currentPath, entryName);
          if (rest.length === 0) {
            results.push(entryPath);
          } else {
            try {
              const entryRealPath = this.resolveSafePath(entryPath);
              const stat = await this.underlyingFs.promises.stat(entryRealPath);
              if (stat.isDirectory()) {
                const subMatches = await this.matchParts(rest, entryPath);
                results.push(...subMatches);
              }
            } catch {
              // Skip inaccessible entries
            }
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private globToRegex(pattern: string): RegExp {
    let regex = "^";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]!;
      if (char === "*") {
        regex += "[^/]*";
      } else if (char === "?") {
        regex += "[^/]";
      } else if (char === "[") {
        // Character class
        let j = i + 1;
        let classContent = "";
        while (j < pattern.length && pattern[j] !== "]") {
          classContent += pattern[j];
          j++;
        }
        regex += `[${classContent}]`;
        i = j;
      } else if (".+^${}()|\\".includes(char)) {
        regex += "\\" + char;
      } else {
        regex += char;
      }
    }
    regex += "$";
    return new RegExp(regex);
  }
}
