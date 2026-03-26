import { strict as assert } from "node:assert";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystem, VersionControlSystem } from "../src/index.ts";
import { hashSample, readStreamSample } from "../src/vcs/content.ts";
import type { DiffEntry, Revision } from "../src/vcs/types.ts";

const VERIFY_PREFIX_BYTES = 4 * 1024 * 1024;

interface CliOptions {
  sourceA: string;
  sourceB: string;
  keep: boolean;
  workspaceRoot?: string;
}

interface StepSummary {
  name: string;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssMiB: number;
  heapUsedMiB: number;
  externalMiB: number;
}

interface StoredRevision {
  id: number;
  tree: Record<string, { kind?: "file"; blobId: string; size: number }>;
}

const usage = `Usage:
  bun scripts/vcs-large-file-benchmark.ts --source-a <path> --source-b <path> [--workspace-root <path>] [--keep]

Example:
  bun scripts/vcs-large-file-benchmark.ts \\
    --source-a movie.mov \\
    --source-b movie.mp4
`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sourceAStat = await stat(options.sourceA);
  const sourceBStat = await stat(options.sourceB);

  assert(sourceAStat.isFile(), `source-a is not a file: ${options.sourceA}`);
  assert(sourceBStat.isFile(), `source-b is not a file: ${options.sourceB}`);

  const [sourceAPrefixHash, sourceBPrefixHash] = await Promise.all([
    hashFilePrefix(options.sourceA, VERIFY_PREFIX_BYTES),
    hashFilePrefix(options.sourceB, VERIFY_PREFIX_BYTES),
  ]);

  const workspaceRoot =
    options.workspaceRoot ?? (await mkdtemp(join(tmpdir(), "shell-dsl-vcs-bench-")));
  const repoPath = join(workspaceRoot, "repo");
  const shouldCleanupWorkspace = !options.keep && !options.workspaceRoot;

  try {
    await mkdir(repoPath, { recursive: true });

    const trackedPath = "video-under-test.mov";
    const duplicatePath = "video-copy.mp4";
    const trackedFullPath = join(repoPath, trackedPath);
    const duplicateFullPath = join(repoPath, duplicatePath);

    const setupNotes: string[] = [];
    await linkOrCloneFile(options.sourceA, trackedFullPath, setupNotes);

    const fs = new FileSystem(repoPath);
    const vcs = new VersionControlSystem({ fs, path: "/" });
    const steps: StepSummary[] = [];

    await measureStep("init", steps, async () => {
      await vcs.init();
    });

    const revision1 = await measureStep("commit source A", steps, async () =>
      vcs.commit("commit large source A"),
    );
    assert.equal(revision1.id, 1, "expected first revision to be 1");

    const objectCountAfterRev1 = await countBlobObjects(repoPath);
    assert.equal(objectCountAfterRev1, 1, "expected exactly one stored blob after first commit");

    const revision1File = getFileEntry(revision1, trackedPath);
    assert.equal(revision1File.size, sourceAStat.size, "revision 1 should store source A size");

    await rm(trackedFullPath, { force: true });
    await linkOrCloneFile(options.sourceB, trackedFullPath, setupNotes);

    const revision2 = await measureStep("commit replace same path", steps, async () =>
      vcs.commit("replace with large source B"),
    );
    assert.equal(revision2.id, 2, "expected second revision to be 2");

    const objectCountAfterRev2 = await countBlobObjects(repoPath);
    assert.equal(objectCountAfterRev2, 2, "expected two stored blobs after replacement commit");

    const diff12 = await measureStep("diff revisions 1..2", steps, async () => vcs.diff(1, 2));
    assertReplaceDiff(diff12, trackedPath);

    await linkOrCloneFile(options.sourceB, duplicateFullPath, setupNotes);

    const revision3 = await measureStep("commit duplicate path", steps, async () =>
      vcs.commit("add duplicate path with same bytes"),
    );
    assert.equal(revision3.id, 3, "expected third revision to be 3");

    const objectCountAfterRev3 = await countBlobObjects(repoPath);
    assert.equal(objectCountAfterRev3, 2, "expected duplicate content to reuse existing blob");

    const rev3Tracked = getFileEntry(revision3, trackedPath);
    const rev3Duplicate = getFileEntry(revision3, duplicatePath);
    assert.equal(
      rev3Tracked.blobId,
      rev3Duplicate.blobId,
      "expected duplicate path to reuse blob id",
    );

    await measureStep("partial checkout revision 1", steps, async () => {
      await vcs.checkout(1, { paths: [`/${trackedPath}`] });
    });
    const checkedOutRev1PrefixHash = await hashFilePrefix(trackedFullPath, VERIFY_PREFIX_BYTES);
    assert.equal(
      checkedOutRev1PrefixHash,
      sourceAPrefixHash,
      "partial checkout of revision 1 should restore source A bytes at the start of the file",
    );

    await measureStep("partial checkout revision 2", steps, async () => {
      await vcs.checkout(2, { paths: [`/${trackedPath}`] });
    });
    const checkedOutRev2PrefixHash = await hashFilePrefix(trackedFullPath, VERIFY_PREFIX_BYTES);
    assert.equal(
      checkedOutRev2PrefixHash,
      sourceBPrefixHash,
      "partial checkout of revision 2 should restore source B bytes at the start of the file",
    );

    const finalStatus = await measureStep("status after restore", steps, async () => vcs.status());
    assert.deepEqual(
      finalStatus,
      [],
      "expected clean status after restoring tracked path to HEAD bytes",
    );

    const storedRevision1 = await readStoredRevision(repoPath, 1);
    const storedRevision2 = await readStoredRevision(repoPath, 2);
    const storedRevision3 = await readStoredRevision(repoPath, 3);

    const summary = {
      workspaceRoot,
      keptWorkspace: options.keep,
      repoPath,
      setupNotes,
      sourceA: {
        path: options.sourceA,
        sizeBytes: sourceAStat.size,
        verifyPrefixBytes: VERIFY_PREFIX_BYTES,
        prefixHash: sourceAPrefixHash,
      },
      sourceB: {
        path: options.sourceB,
        sizeBytes: sourceBStat.size,
        verifyPrefixBytes: VERIFY_PREFIX_BYTES,
        prefixHash: sourceBPrefixHash,
      },
      revisionBlobIds: {
        revision1: storedRevision1.tree[trackedPath]?.blobId ?? null,
        revision2: storedRevision2.tree[trackedPath]?.blobId ?? null,
        revision3: storedRevision3.tree[trackedPath]?.blobId ?? null,
        revision3Duplicate: storedRevision3.tree[duplicatePath]?.blobId ?? null,
      },
      objectCounts: {
        afterRevision1: objectCountAfterRev1,
        afterRevision2: objectCountAfterRev2,
        afterRevision3: objectCountAfterRev3,
      },
      steps,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (shouldCleanupWorkspace) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  let sourceA: string | undefined;
  let sourceB: string | undefined;
  let workspaceRoot: string | undefined;
  let keep = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--keep") {
      keep = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }

    const [flag, inlineValue] = arg.split("=", 2);
    const value =
      inlineValue ??
      (args[index + 1]?.startsWith("--") ? undefined : args[index + 1]);

    switch (flag) {
      case "--source-a":
        sourceA = requireValue(flag, value);
        if (!inlineValue) index++;
        break;
      case "--source-b":
        sourceB = requireValue(flag, value);
        if (!inlineValue) index++;
        break;
      case "--workspace-root":
        workspaceRoot = requireValue(flag, value);
        if (!inlineValue) index++;
        break;
      default:
        throw new Error(`unknown argument: ${arg}\n\n${usage}`);
    }
  }

  if (!sourceA || !sourceB) {
    throw new Error(`missing required --source-a/--source-b arguments\n\n${usage}`);
  }

  return { sourceA, sourceB, workspaceRoot, keep };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`missing value for ${flag}\n\n${usage}`);
  }
  return value;
}

async function measureStep<T>(
  name: string,
  steps: StepSummary[],
  action: () => Promise<T>,
): Promise<T> {
  const cpuStart = process.cpuUsage();
  const startedAt = performance.now();
  const result = await action();
  const finishedAt = performance.now();
  const cpu = process.cpuUsage(cpuStart);
  const memory = process.memoryUsage();

  steps.push({
    name,
    wallMs: round2(finishedAt - startedAt),
    cpuUserMs: round2(cpu.user / 1000),
    cpuSystemMs: round2(cpu.system / 1000),
    rssMiB: round2(memory.rss / (1024 * 1024)),
    heapUsedMiB: round2(memory.heapUsed / (1024 * 1024)),
    externalMiB: round2(memory.external / (1024 * 1024)),
  });

  return result;
}

async function hashFilePrefix(filePath: string, bytes: number): Promise<string> {
  const sample = await readStreamSample(createReadStream(filePath), bytes);
  return hashSample(sample);
}

async function linkOrCloneFile(
  fromPath: string,
  toPath: string,
  setupNotes: string[],
): Promise<void> {
  await mkdir(dirname(toPath), { recursive: true });

  try {
    await link(fromPath, toPath);
    setupNotes.push(`linked ${fromPath} -> ${toPath}`);
    return;
  } catch (error) {
    if (!isCrossDeviceLinkError(error)) {
      throw error;
    }
  }

  try {
    await copyFile(fromPath, toPath, fsConstants.COPYFILE_FICLONE);
    setupNotes.push(`cloned ${fromPath} -> ${toPath}`);
    return;
  } catch (error) {
    if (!isCloneUnsupportedError(error)) {
      throw error;
    }
  }

  await copyFile(fromPath, toPath);
  setupNotes.push(`copied ${fromPath} -> ${toPath}`);
}

function isCrossDeviceLinkError(error: unknown): boolean {
  return isErrorWithCode(error, "EXDEV");
}

function isCloneUnsupportedError(error: unknown): boolean {
  return isErrorWithCode(error, "ENOTSUP") || isErrorWithCode(error, "EINVAL");
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

async function countBlobObjects(repoPath: string): Promise<number> {
  const blobsRoot = join(repoPath, ".vcs", "objects", "blobs");
  let count = 0;

  for (const prefix of await readdir(blobsRoot)) {
    const prefixPath = join(blobsRoot, prefix);
    const prefixStat = await stat(prefixPath);
    if (!prefixStat.isDirectory()) continue;
    count += (await readdir(prefixPath)).length;
  }

  return count;
}

function getFileEntry(revision: Revision, relPath: string): { blobId: string; size: number } {
  const entry = revision.tree[relPath];
  assert(entry, `missing tree entry for ${relPath}`);
  assert(entry.kind !== "directory", `expected file entry for ${relPath}`);
  return entry;
}

function assertReplaceDiff(entries: DiffEntry[], relPath: string): void {
  assert.equal(entries.length, 1, "expected exactly one diff entry for replacement commit");
  const entry = entries[0]!;
  assert.equal(entry.type, "modify");
  assert.equal(entry.path, relPath);
  assert.equal(entry.binary, true);
  assert.equal(entry.diff, "binary");
  assert.equal(entry.patchSuppressedReason, "binary");
  assert(entry.previousBlobId, "expected previousBlobId");
  assert(entry.blobId, "expected blobId");
  assert.notEqual(entry.previousBlobId, entry.blobId, "replacement should create a new blob");
}

async function readStoredRevision(repoPath: string, id: number): Promise<StoredRevision> {
  const content = await readFile(join(repoPath, ".vcs", "revisions", `${id}.json`), "utf8");
  return JSON.parse(content) as StoredRevision;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

await main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
