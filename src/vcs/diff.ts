import type { VirtualFS } from "../types.ts";
import type { TreeManifest, DiffEntry, TreeEntry } from "./types.ts";
import { VCSRules } from "./rules.ts";
import { buildTreeManifest } from "./snapshot.ts";

/**
 * Compute diff entries between two tree manifests.
 */
export function diffManifests(
  before: TreeManifest,
  after: TreeManifest,
  rules: VCSRules = new VCSRules(),
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const path of allPaths) {
    const prev = before[path];
    const curr = after[path];

    if (!prev && curr) {
      entries.push(createDiffEntry("add", path, curr, undefined, rules));
    } else if (prev && !curr) {
      entries.push(createDiffEntry("delete", path, undefined, prev, rules));
    } else if (prev && curr && !entriesEqual(prev, curr)) {
      entries.push(createDiffEntry("modify", path, curr, prev, rules));
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compute diff between a tree manifest and the current working tree.
 */
export async function diffWorkingTree(
  fs: VirtualFS,
  rootPath: string,
  manifest: TreeManifest,
  rules: VCSRules = new VCSRules({ internalDirName: ".vcs" }),
): Promise<DiffEntry[]> {
  const workingManifest = await buildTreeManifest(fs, rootPath, {
    rules,
    trackedPaths: Object.keys(manifest),
  });
  return diffManifests(manifest, workingManifest, rules);
}

function createDiffEntry(
  type: DiffEntry["type"],
  path: string,
  current: TreeEntry | undefined,
  previous: TreeEntry | undefined,
  rules: VCSRules,
): DiffEntry {
  const attributes = rules.resolveAttributes(path);
  const entryKind = getEntryKind(current ?? previous);
  const previousEntryKind = previous ? getEntryKind(previous) : undefined;
  const entry: DiffEntry = {
    type,
    path,
    binary: attributes.binary,
    diff: attributes.diff,
    entryKind,
    previousEntryKind,
  };

  if (attributes.diff !== "none") {
    if (isFileEntry(current)) {
      entry.content = current.content;
    }
    if (isFileEntry(previous)) {
      entry.previousContent = previous.content;
    }
  }

  return entry;
}

function entriesEqual(a: TreeEntry, b: TreeEntry): boolean {
  if (getEntryKind(a) !== getEntryKind(b)) return false;
  if (!isFileEntry(a) || !isFileEntry(b)) return true;
  return a.content === b.content;
}

function getEntryKind(entry: TreeEntry | undefined): "file" | "directory" {
  return entry?.kind === "directory" ? "directory" : "file";
}

function isFileEntry(entry: TreeEntry | undefined): entry is Extract<TreeEntry, { kind?: "file" }> {
  return !!entry && entry.kind !== "directory";
}
