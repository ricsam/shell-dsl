import type { VirtualFS } from "../types.ts";

// === Configuration ===

export interface VCSConfig {
  /** The working tree filesystem */
  fs: VirtualFS;
  /** Root path of the working tree */
  path: string;
  /** Optional separate storage for VCS metadata */
  vcsPath?: {
    /** Filesystem for metadata storage (defaults to config.fs) */
    fs?: VirtualFS;
    /** Path for metadata storage (defaults to `${config.path}/.vcs`) */
    path?: string;
  };
}

// === Storage types ===

export interface HeadRef {
  ref?: string; // e.g. "refs/heads/main"
  revision?: number; // for detached HEAD
}

export interface BranchRef {
  revision: number;
}

export interface RevisionCounter {
  next: number;
}

export interface VCSConfigFile {
  defaultBranch: string;
}

// === Tree manifest ===

export interface FileEntry {
  content: string; // base64-encoded
  size: number;
}

export interface TreeManifest {
  [path: string]: FileEntry;
}

// === Diff ===

export interface DiffEntry {
  type: "add" | "modify" | "delete";
  path: string;
  content?: string; // base64, for add/modify
  previousContent?: string; // base64, for modify
}

// === Revision ===

export interface Revision {
  id: number;
  parent: number | null;
  branch: string;
  message: string;
  timestamp: string;
  changes: DiffEntry[];
  tree: TreeManifest;
}

// === Method options ===

export interface CommitOptions {
  paths?: string[];
}

export interface CheckoutOptions {
  force?: boolean;
  paths?: string[];
}

export interface LogOptions {
  path?: string;
  branch?: string;
  limit?: number;
}

// === Return types ===

export interface LogEntry {
  id: number;
  parent: number | null;
  branch: string;
  message: string;
  timestamp: string;
  paths: string[];
}

export interface BranchInfo {
  name: string;
  revision: number;
  current: boolean;
}
