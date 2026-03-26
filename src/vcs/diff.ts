import type { TreeManifest, DiffEntry, TreeEntry, VCSIndexEntry } from "./types.ts";
import { MAX_PATCH_BYTES } from "./content.ts";
import { VCSObjectStore } from "./objects.ts";
import { VCSRules } from "./rules.ts";
import { createUnifiedPatch } from "./text-diff.ts";

interface DiffOptions {
  rules?: VCSRules;
  objectStore: VCSObjectStore;
  beforeIndex?: Record<string, VCSIndexEntry>;
  afterIndex?: Record<string, VCSIndexEntry>;
}

/**
 * Compute diff entries between two tree manifests.
 */
export async function diffManifests(
  before: TreeManifest,
  after: TreeManifest,
  options: DiffOptions,
): Promise<DiffEntry[]> {
  const entries: DiffEntry[] = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const path of [...allPaths].sort((a, b) => a.localeCompare(b))) {
    const prev = before[path];
    const curr = after[path];

    if (!prev && curr) {
      entries.push(await createDiffEntry("add", path, curr, undefined, options));
    } else if (prev && !curr) {
      entries.push(await createDiffEntry("delete", path, undefined, prev, options));
    } else if (prev && curr && !entriesEqual(prev, curr)) {
      entries.push(await createDiffEntry("modify", path, curr, prev, options));
    }
  }

  return entries;
}

async function createDiffEntry(
  type: DiffEntry["type"],
  path: string,
  current: TreeEntry | undefined,
  previous: TreeEntry | undefined,
  options: DiffOptions,
): Promise<DiffEntry> {
  const rules = options.rules ?? new VCSRules();
  const attributes = rules.resolveAttributes(path);
  const entryKind = getEntryKind(current ?? previous);
  const previousEntryKind = previous ? getEntryKind(previous) : undefined;
  const currentFile = isFileEntry(current) ? current : undefined;
  const previousFile = isFileEntry(previous) ? previous : undefined;
  const binary = await resolveBinary(path, currentFile, previousFile, attributes, options);
  const diff = resolveDiffMode(attributes, binary);
  const entry: DiffEntry = {
    type,
    path,
    binary,
    diff,
    entryKind,
    previousEntryKind,
    blobId: currentFile?.blobId,
    previousBlobId: previousFile?.blobId,
  };

  if (!currentFile && !previousFile) {
    return entry;
  }

  if (diff === "none") {
    entry.patchSuppressedReason = "none";
    return entry;
  }

  if (diff === "binary") {
    entry.patchSuppressedReason = "binary";
    return entry;
  }

  const largestSize = Math.max(currentFile?.size ?? 0, previousFile?.size ?? 0);
  if (largestSize > MAX_PATCH_BYTES) {
    entry.patchSuppressedReason = "too-large";
    return entry;
  }

  const previousText = previousFile
    ? await options.objectStore.readBlobText(previousFile.blobId)
    : "";
  const currentText = currentFile
    ? await options.objectStore.readBlobText(currentFile.blobId)
    : "";
  entry.patch = createUnifiedPatch(path, previousText, currentText);
  return entry;
}

async function resolveBinary(
  path: string,
  current: Extract<TreeEntry, { kind?: "file" }> | undefined,
  previous: Extract<TreeEntry, { kind?: "file" }> | undefined,
  attributes: ReturnType<VCSRules["resolveAttributes"]>,
  options: DiffOptions,
): Promise<boolean> {
  if (attributes.diff === "text") {
    return false;
  }
  if (attributes.diff === "binary" || attributes.binary === true) {
    return true;
  }

  const currentBinary = await resolveEntryBinary(
    path,
    current,
    options.afterIndex,
    options.objectStore,
  );
  const previousBinary = await resolveEntryBinary(
    path,
    previous,
    options.beforeIndex,
    options.objectStore,
  );

  return currentBinary || previousBinary;
}

async function resolveEntryBinary(
  path: string,
  entry: Extract<TreeEntry, { kind?: "file" }> | undefined,
  indexEntries: Record<string, VCSIndexEntry> | undefined,
  objectStore: VCSObjectStore,
): Promise<boolean> {
  if (!entry) {
    return false;
  }
  const cached = indexEntries?.[path];
  if (cached?.blobId === entry.blobId) {
    return cached.binary;
  }
  return objectStore.isBinaryBlob(entry.blobId);
}

function resolveDiffMode(
  attributes: ReturnType<VCSRules["resolveAttributes"]>,
  binary: boolean,
): DiffEntry["diff"] {
  if (attributes.diff === "none") {
    return "none";
  }
  if (attributes.diff === "text") {
    return "text";
  }
  if (attributes.diff === "binary" || binary) {
    return "binary";
  }
  return "text";
}

function entriesEqual(a: TreeEntry, b: TreeEntry): boolean {
  if (getEntryKind(a) !== getEntryKind(b)) return false;
  if (!isFileEntry(a) || !isFileEntry(b)) return true;
  return a.blobId === b.blobId && a.size === b.size;
}

function getEntryKind(entry: TreeEntry | undefined): "file" | "directory" {
  return entry?.kind === "directory" ? "directory" : "file";
}

function isFileEntry(entry: TreeEntry | undefined): entry is Extract<TreeEntry, { kind?: "file" }> {
  return !!entry && entry.kind !== "directory";
}
