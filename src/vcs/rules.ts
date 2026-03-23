import { matchGlobPath } from "./match.ts";
import type { VCSAttributeRule, VCSResolvedAttributes } from "./types.ts";

interface VCSRulesConfig {
  internalPath?: string;
  internalDirName?: string;
  ignore?: string[];
  attributes?: VCSAttributeRule[];
}

export class VCSRules {
  private readonly internalPath: string;
  private readonly ignorePatterns: string[];
  private readonly attributeRules: VCSAttributeRule[];

  constructor(config: VCSRulesConfig = {}) {
    this.internalPath = normalizePath(config.internalPath ?? config.internalDirName ?? "");
    this.ignorePatterns = [...(config.ignore ?? [])];
    this.attributeRules = [...(config.attributes ?? [])];
  }

  isInternalPath(relPath: string): boolean {
    if (!this.internalPath) return false;
    const normalizedPath = normalizePath(relPath);
    if (!normalizedPath) return false;
    return normalizedPath === this.internalPath || normalizedPath.startsWith(`${this.internalPath}/`);
  }

  isIgnored(relPath: string): boolean {
    if (this.isInternalPath(relPath)) return true;
    return this.ignorePatterns.some((pattern) => matchVCSPath(pattern, relPath));
  }

  shouldEnterDirectory(relPath: string, trackedPaths: Iterable<string>): boolean {
    if (this.isInternalPath(relPath)) return false;
    if (!this.isIgnored(relPath)) return true;
    return hasTrackedPathAtOrBelow(relPath, trackedPaths);
  }

  shouldIncludeWorkingFile(relPath: string, trackedPaths: ReadonlySet<string>): boolean {
    if (this.isInternalPath(relPath)) return false;
    if (trackedPaths.has(relPath)) return true;
    return !this.isIgnored(relPath);
  }

  shouldIncludeEmptyDirectory(relPath: string, trackedPaths: ReadonlySet<string>): boolean {
    if (this.isInternalPath(relPath)) return false;
    if (trackedPaths.has(relPath)) return true;
    return !this.isIgnored(relPath);
  }

  shouldIncludeRestoreScanFile(relPath: string): boolean {
    return !this.isInternalPath(relPath);
  }

  shouldPreserveUntrackedIgnored(relPath: string, trackedPaths: ReadonlySet<string>): boolean {
    if (trackedPaths.has(relPath)) return false;
    return this.isIgnored(relPath);
  }

  resolveAttributes(relPath: string): VCSResolvedAttributes {
    let binary = false;
    let diff: VCSResolvedAttributes["diff"] = "text";

    for (const rule of this.attributeRules) {
      if (!matchVCSPath(rule.pattern, relPath)) continue;
      if (rule.binary !== undefined) {
        binary = rule.binary;
      }
      if (rule.diff !== undefined) {
        diff = rule.diff;
      }
    }

    if (diff === "binary") {
      binary = true;
    }

    return { binary, diff };
  }
}

export function matchVCSPath(pattern: string, relPath: string): boolean {
  const normalizedPattern = normalizePattern(pattern);
  const normalizedPath = normalizePath(relPath);

  if (!normalizedPattern || !normalizedPath) return false;

  if (normalizedPattern.mode === "root-path") {
    return matchGlobPath(normalizedPattern.pattern, normalizedPath);
  }

  if (normalizedPattern.mode === "root-segment") {
    const [firstSegment] = normalizedPath.split("/");
    return firstSegment ? matchGlobPath(normalizedPattern.pattern, firstSegment) : false;
  }

  if (normalizedPattern.mode === "root-prefix") {
    return (
      matchGlobPath(normalizedPattern.pattern, normalizedPath) ||
      matchGlobPath(`${normalizedPattern.pattern}/**`, normalizedPath)
    );
  }

  const segments = normalizedPath.split("/");
  return segments.some((segment) => matchGlobPath(normalizedPattern.pattern, segment));
}

function normalizePath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizePattern(pattern: string): {
  pattern: string;
  mode: "root-path" | "root-prefix" | "root-segment" | "segment";
} | null {
  let normalized = pattern.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/\\/g, "/");
  const anchored = normalized.startsWith("/");
  const directoryOnly = normalized.endsWith("/");
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) return null;

  if (normalized.includes("/")) {
    return {
      pattern: normalized,
      mode: directoryOnly ? "root-prefix" : "root-path",
    };
  }

  if (anchored) {
    return {
      pattern: normalized,
      mode: "root-segment",
    };
  }

  return {
    pattern: normalized,
    mode: "segment",
  };
}

function hasTrackedPathAtOrBelow(relPath: string, trackedPaths: Iterable<string>): boolean {
  const normalizedPath = normalizePath(relPath);
  if (!normalizedPath) return false;

  const prefix = normalizedPath + "/";
  for (const trackedPath of trackedPaths) {
    const normalizedTrackedPath = normalizePath(trackedPath);
    if (
      normalizedTrackedPath === normalizedPath ||
      normalizedTrackedPath.startsWith(prefix)
    ) {
      return true;
    }
  }
  return false;
}
