import { test, expect, describe, beforeEach } from "bun:test";
import { win32 as winPath } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS } from "../src/index.ts";
import { VersionControlSystem } from "../src/vcs/index.ts";
import type { VirtualFS, VirtualFSWritable } from "../src/types.ts";
import { FileSystem, type UnderlyingFS } from "../src/fs/real-fs.ts";

function createFS(files: Record<string, string> = {}): VirtualFS {
  const vol = new Volume();
  vol.fromJSON(files);
  return createVirtualFS(createFsFromVolume(vol));
}

describe("VersionControlSystem", () => {
  let fs: VirtualFS;
  let vcs: VersionControlSystem;

  beforeEach(async () => {
    fs = createFS({
      "/project/src/index.ts": 'console.log("hello")',
      "/project/src/utils.ts": "export const add = (a: number, b: number) => a + b;",
      "/project/README.md": "# My Project",
    });
    vcs = new VersionControlSystem({ fs, path: "/project" });
  });

  describe("initialization", () => {
    test("auto-initializes on first operation", async () => {
      await vcs.status();
      expect(await fs.exists("/project/.vcs/HEAD")).toBe(true);
      expect(await fs.exists("/project/.vcs/config.json")).toBe(true);
      expect(await fs.exists("/project/.vcs/counter.json")).toBe(true);
      expect(await fs.exists("/project/.vcs/index.json")).toBe(true);
    });

    test("init is idempotent", async () => {
      await vcs.init();
      await vcs.init();
      const config = JSON.parse(await fs.readFile("/project/.vcs/config.json", "utf8"));
      expect(config.version).toBe(2);
      expect(config.defaultBranch).toBe("main");
    });

    test("HEAD points to main branch initially", async () => {
      await vcs.init();
      const head = JSON.parse(await fs.readFile("/project/.vcs/HEAD", "utf8"));
      expect(head.ref).toBe("refs/heads/main");
    });
  });

  describe("status", () => {
    test("all files show as added before first commit", async () => {
      const changes = await vcs.status();
      expect(changes.length).toBe(3);
      expect(changes.every((c) => c.type === "add")).toBe(true);
      const paths = changes.map((c) => c.path).sort();
      expect(paths).toEqual(["README.md", "src/index.ts", "src/utils.ts"]);
    });

    test("returns empty after committing all files", async () => {
      await vcs.commit("initial");
      const changes = await vcs.status();
      expect(changes.length).toBe(0);
    });

    test("detects added files", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/new.txt", "new file");
      const changes = await vcs.status();
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe("add");
      expect(changes[0]!.path).toBe("new.txt");
    });

    test("detects modified files", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Updated");
      const changes = await vcs.status();
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe("modify");
      expect(changes[0]!.path).toBe("README.md");
    });

    test("detects deleted files", async () => {
      await vcs.commit("initial");
      await fs.rm("/project/README.md");
      const changes = await vcs.status();
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe("delete");
      expect(changes[0]!.path).toBe("README.md");
    });

    test("excludes .vcs directory from status", async () => {
      await vcs.commit("initial");
      const changes = await vcs.status();
      const vcsPaths = changes.filter((c) => c.path.startsWith(".vcs"));
      expect(vcsPaths.length).toBe(0);
    });
  });

  describe("ignore rules", () => {
    test("ignores untracked files in status and full commits", async () => {
      const ignoredFs = createFS({
        "/project/README.md": "# My Project",
        "/project/dist/app.js": "compiled output",
        "/project/debug.log": "verbose logs",
      });
      const ignoredVcs = new VersionControlSystem({
        fs: ignoredFs,
        path: "/project",
        ignore: ["dist", "*.log"],
      });

      const status = await ignoredVcs.status();
      expect(status.map((entry) => entry.path)).toEqual(["README.md"]);

      const rev = await ignoredVcs.commit("initial");
      expect(rev.tree["README.md"]).toBeDefined();
      expect(rev.tree["dist/app.js"]).toBeUndefined();
      expect(rev.tree["debug.log"]).toBeUndefined();
    });

    test("tracked files remain tracked after they match ignore rules", async () => {
      const trackedFs = createFS({
        "/project/README.md": "# My Project",
        "/project/dist/app.js": "compiled output",
      });
      const bootstrapVcs = new VersionControlSystem({ fs: trackedFs, path: "/project" });
      await bootstrapVcs.commit("initial");

      const ignoredVcs = new VersionControlSystem({
        fs: trackedFs,
        path: "/project",
        ignore: ["dist"],
      });

      await trackedFs.writeFile("/project/dist/app.js", "updated output");
      const changes = await ignoredVcs.status();

      expect(changes).toHaveLength(1);
      expect(changes[0]!.path).toBe("dist/app.js");
      expect(changes[0]!.type).toBe("modify");
    });

    test("full checkout preserves ignored untracked files", async () => {
      const ignoredVcs = new VersionControlSystem({
        fs,
        path: "/project",
        ignore: ["*.log"],
      });

      await ignoredVcs.commit("initial");
      await fs.writeFile("/project/debug.log", "keep me");
      await fs.writeFile("/project/README.md", "# Updated");
      await ignoredVcs.commit("update readme");

      await ignoredVcs.checkout(1);

      expect(await fs.readFile("/project/README.md", "utf8")).toBe("# My Project");
      expect(await fs.readFile("/project/debug.log", "utf8")).toBe("keep me");
    });

    test("full checkout still removes tracked files even when they now match ignore rules", async () => {
      const trackedFs = createFS({
        "/project/README.md": "# My Project",
        "/project/dist/app.js": "compiled output",
      });
      const bootstrapVcs = new VersionControlSystem({ fs: trackedFs, path: "/project" });
      await bootstrapVcs.commit("initial");

      const ignoredVcs = new VersionControlSystem({
        fs: trackedFs,
        path: "/project",
        ignore: ["dist"],
      });

      await trackedFs.rm("/project/dist/app.js");
      await ignoredVcs.commit("remove build output");
      expect(await trackedFs.exists("/project/dist/app.js")).toBe(false);

      await ignoredVcs.checkout(1);
      expect(await trackedFs.exists("/project/dist/app.js")).toBe(true);

      await ignoredVcs.checkout(2);
      expect(await trackedFs.exists("/project/dist/app.js")).toBe(false);
    });
  });

  describe("commit", () => {
    test("first commit creates revision 1", async () => {
      const rev = await vcs.commit("initial commit");
      expect(rev.id).toBe(1);
      expect(rev.parent).toBeNull();
      expect(rev.branch).toBe("main");
      expect(rev.message).toBe("initial commit");
      expect(rev.changes.length).toBe(3);
    });

    test("second commit has parent pointing to first", async () => {
      await vcs.commit("first");
      await fs.writeFile("/project/new.txt", "hello");
      const rev = await vcs.commit("second");
      expect(rev.id).toBe(2);
      expect(rev.parent).toBe(1);
    });

    test("throws when nothing to commit", async () => {
      await vcs.commit("initial");
      await expect(vcs.commit("empty")).rejects.toThrow("nothing to commit");
    });

    test("stores correct tree manifest", async () => {
      const rev = await vcs.commit("initial");
      expect(Object.keys(rev.tree).sort()).toEqual([
        "README.md",
        "src/index.ts",
        "src/utils.ts",
      ]);
      const readmeEntry = rev.tree["README.md"];
      const readmeFile = getFileEntry(rev.tree, "README.md");
      expect(readmeFile.blobId).toBeDefined();
      const readmeContent = await vcs.readRevisionFile(rev.id, "README.md", "utf8");
      expect(readmeContent).toBe("# My Project");
    });

    test("records correct changes", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Changed");
      await fs.writeFile("/project/new.txt", "new");
      await fs.rm("/project/src/utils.ts");
      const rev = await vcs.commit("changes");
      const changeTypes = new Map(rev.changes.map((c) => [c.path, c.type]));
      expect(changeTypes.get("README.md")).toBe("modify");
      expect(changeTypes.get("new.txt")).toBe("add");
      expect(changeTypes.get("src/utils.ts")).toBe("delete");
    });

    test("updates branch ref after commit", async () => {
      await vcs.commit("first");
      const headInfo = await vcs.head();
      expect(headInfo.branch).toBe("main");
      expect(headInfo.revision).toBe(1);
    });
  });

  describe("selective commit", () => {
    test("commits only matching files", async () => {
      const rev = await vcs.commit("only src", { paths: ["/src/**"] });
      expect(rev.changes.length).toBe(2);
      const paths = rev.changes.map((c) => c.path).sort();
      expect(paths).toEqual(["src/index.ts", "src/utils.ts"]);
    });

    test("preserves parent tree for unmatched files", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/src/index.ts", "updated");
      await fs.writeFile("/project/README.md", "also updated");
      const rev = await vcs.commit("only src", { paths: ["/src/**"] });
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.path).toBe("src/index.ts");
      expect(rev.tree["README.md"]).toBeDefined();
      const readmeFile = getFileEntry(rev.tree, "README.md");
      expect(readmeFile.blobId).toBeDefined();
      const readmeContent = await vcs.readRevisionFile(rev.id, "README.md", "utf8");
      expect(readmeContent).toBe("# My Project");
    });

    test("selective commit with specific file path", async () => {
      const rev = await vcs.commit("just readme", { paths: ["/README.md"] });
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.path).toBe("README.md");
    });

    test("selective commit detects deletions in matched paths", async () => {
      await vcs.commit("initial");
      await fs.rm("/project/src/utils.ts");
      const rev = await vcs.commit("remove utils", { paths: ["/src/**"] });
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.type).toBe("delete");
      expect(rev.changes[0]!.path).toBe("src/utils.ts");
    });
  });

  describe("checkout by revision", () => {
    test("restores files to a previous revision", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Changed");
      await vcs.commit("changed readme");
      await vcs.checkout(1);
      const content = await fs.readFile("/project/README.md", "utf8");
      expect(content).toBe("# My Project");
    });

    test("removes files not in target revision", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/extra.txt", "extra");
      await vcs.commit("add extra");
      await vcs.checkout(1);
      expect(await fs.exists("/project/extra.txt")).toBe(false);
    });

    test("errors if dirty without force", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "dirty");
      await expect(vcs.checkout(1)).rejects.toThrow("uncommitted changes");
    });

    test("force checkout discards uncommitted changes", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "dirty");
      await vcs.checkout(1, { force: true });
      const content = await fs.readFile("/project/README.md", "utf8");
      expect(content).toBe("# My Project");
    });

    test("sets HEAD to detached state on revision checkout", async () => {
      await vcs.commit("first");
      await fs.writeFile("/project/new.txt", "x");
      await vcs.commit("second");
      await vcs.checkout(1);
      const head = await vcs.head();
      expect(head.branch).toBeNull();
      expect(head.revision).toBe(1);
    });

    test("throws for non-existent revision", async () => {
      await vcs.commit("initial");
      await expect(vcs.checkout(999)).rejects.toThrow("not found");
    });
  });

  describe("partial checkout", () => {
    test("restores specific files without changing HEAD", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/src/index.ts", "modified");
      await fs.writeFile("/project/README.md", "also modified");
      await vcs.commit("changes");

      // Restore only index.ts from revision 1
      await vcs.checkout(1, { paths: ["/src/index.ts"] });

      const indexContent = await fs.readFile("/project/src/index.ts", "utf8");
      expect(indexContent).toBe('console.log("hello")');

      // README should still be modified
      const readmeContent = await fs.readFile("/project/README.md", "utf8");
      expect(readmeContent).toBe("also modified");

      // HEAD should still be on revision 2
      const head = await vcs.head();
      expect(head.revision).toBe(2);
    });

    test("partial checkout does not error on dirty working tree", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "dirty");
      // Should not throw even though working tree is dirty
      await vcs.checkout(1, { paths: ["/src/index.ts"] });
    });

    test("partial checkout with glob pattern", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/src/index.ts", "modified index");
      await fs.writeFile("/project/src/utils.ts", "modified utils");
      await vcs.commit("modify src");

      await vcs.checkout(1, { paths: ["/src/**"] });
      const indexContent = await fs.readFile("/project/src/index.ts", "utf8");
      expect(indexContent).toBe('console.log("hello")');
      const utilsContent = await fs.readFile("/project/src/utils.ts", "utf8");
      expect(utilsContent).toBe("export const add = (a: number, b: number) => a + b;");
    });

    test("partial checkout removes matched files that do not exist in the target revision", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/src/new.txt", "new file");
      await vcs.commit("add new file");

      await vcs.checkout(1, { paths: ["/src/**"] });

      expect(await fs.exists("/project/src/new.txt")).toBe(false);
      const head = await vcs.head();
      expect(head.revision).toBe(2);
    });
  });

  describe("branching", () => {
    test("creates a branch at HEAD", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      const branches = await vcs.branches();
      const featureBranch = branches.find((b) => b.name === "feature");
      expect(featureBranch).toBeDefined();
      expect(featureBranch!.revision).toBe(1);
      expect(featureBranch!.current).toBe(false);
    });

    test("errors on duplicate branch name", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      await expect(vcs.branch("feature")).rejects.toThrow("already exists");
    });

    test("errors when no commits exist", async () => {
      await expect(vcs.branch("feature")).rejects.toThrow("no commits");
    });

    test("lists all branches with current indicator", async () => {
      await vcs.commit("initial");
      await vcs.branch("dev");
      await vcs.branch("staging");
      const branches = await vcs.branches();
      expect(branches.length).toBe(3); // main, dev, staging
      const main = branches.find((b) => b.name === "main");
      expect(main!.current).toBe(true);
    });

    test("switch to branch via checkout", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      await vcs.checkout("feature");
      const head = await vcs.head();
      expect(head.branch).toBe("feature");
    });

    test("commits on branch update branch ref", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      await vcs.checkout("feature");
      await fs.writeFile("/project/feature.txt", "feature work");
      const rev = await vcs.commit("feature commit");
      expect(rev.branch).toBe("feature");

      const branches = await vcs.branches();
      const featureBranch = branches.find((b) => b.name === "feature");
      expect(featureBranch!.revision).toBe(2);

      // main should still be at 1
      const mainBranch = branches.find((b) => b.name === "main");
      expect(mainBranch!.revision).toBe(1);
    });

    test("switching branches restores correct tree", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      await vcs.checkout("feature");
      await fs.writeFile("/project/feature.txt", "feature");
      await vcs.commit("add feature file");

      // Switch back to main
      await vcs.checkout("main");
      expect(await fs.exists("/project/feature.txt")).toBe(false);

      // Switch back to feature
      await vcs.checkout("feature");
      expect(await fs.exists("/project/feature.txt")).toBe(true);
      const content = await fs.readFile("/project/feature.txt", "utf8");
      expect(content).toBe("feature");
    });

    test("checkout unknown branch throws", async () => {
      await vcs.commit("initial");
      await expect(vcs.checkout("nonexistent")).rejects.toThrow("unknown branch");
    });
  });

  describe("log", () => {
    test("returns revision history in reverse order", async () => {
      await vcs.commit("first");
      await fs.writeFile("/project/new.txt", "x");
      await vcs.commit("second");
      await fs.writeFile("/project/another.txt", "y");
      await vcs.commit("third");

      const entries = await vcs.log();
      expect(entries.length).toBe(3);
      expect(entries[0]!.id).toBe(3);
      expect(entries[1]!.id).toBe(2);
      expect(entries[2]!.id).toBe(1);
    });

    test("log with limit", async () => {
      await vcs.commit("first");
      await fs.writeFile("/project/new.txt", "x");
      await vcs.commit("second");
      await fs.writeFile("/project/another.txt", "y");
      await vcs.commit("third");

      const entries = await vcs.log({ limit: 2 });
      expect(entries.length).toBe(2);
      expect(entries[0]!.id).toBe(3);
      expect(entries[1]!.id).toBe(2);
    });

    test("log filtered by path", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/src/index.ts", "updated");
      await vcs.commit("update index");
      await fs.writeFile("/project/README.md", "updated readme");
      await vcs.commit("update readme");

      const entries = await vcs.log({ path: "README.md" });
      expect(entries.length).toBe(2); // initial (added) + update
    });

    test("log filtered by branch", async () => {
      await vcs.commit("initial");
      await vcs.branch("feature");
      await vcs.checkout("feature");
      await fs.writeFile("/project/feature.txt", "x");
      await vcs.commit("feature work");

      const featureLog = await vcs.log({ branch: "feature" });
      expect(featureLog.length).toBe(2); // feature work + initial (via parent)
      expect(featureLog[0]!.message).toBe("feature work");
    });

    test("log includes changed paths", async () => {
      const rev = await vcs.commit("initial");
      const entries = await vcs.log();
      expect(entries[0]!.paths.sort()).toEqual([
        "README.md",
        "src/index.ts",
        "src/utils.ts",
      ]);
    });

    test("empty log when no commits", async () => {
      const entries = await vcs.log();
      expect(entries.length).toBe(0);
    });
  });

  describe("diff", () => {
    test("diff between two revisions", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Updated");
      await fs.writeFile("/project/new.txt", "new file");
      await fs.rm("/project/src/utils.ts");
      await vcs.commit("changes");

      const entries = await vcs.diff(1, 2);
      const changeMap = new Map(entries.map((e) => [e.path, e.type]));
      expect(changeMap.get("README.md")).toBe("modify");
      expect(changeMap.get("new.txt")).toBe("add");
      expect(changeMap.get("src/utils.ts")).toBe("delete");
    });

    test("diff includes blob ids and unified text patches", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/new.txt", "hello");
      await vcs.commit("add file");

      const entries = await vcs.diff(1, 2);
      const addEntry = entries.find((e) => e.path === "new.txt");
      expect(addEntry).toBeDefined();
      expect(addEntry!.blobId).toBeDefined();
      expect(addEntry!.patch).toContain("+hello");
      expect(await vcs.readBlob(addEntry!.blobId!, "utf8")).toBe("hello");
    });

    test("diff includes previous blob ids for modify/delete", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Updated");
      await vcs.commit("update");

      const entries = await vcs.diff(1, 2);
      const modEntry = entries.find((e) => e.path === "README.md");
      expect(modEntry!.previousBlobId).toBeDefined();
      expect(modEntry!.patch).toContain("-# My Project");
      expect(modEntry!.patch).toContain("+# Updated");
      expect(await vcs.readBlob(modEntry!.previousBlobId!, "utf8")).toBe("# My Project");
    });

    test("diff with no changes returns empty array", async () => {
      await vcs.commit("initial");
      const entries = await vcs.diff(1, 1);
      expect(entries.length).toBe(0);
    });
  });

  describe("attributes", () => {
    test("diff metadata marks binary entries from attribute rules", async () => {
      const attributedVcs = new VersionControlSystem({
        fs,
        path: "/project",
        attributes: [{ pattern: "assets/*.png", diff: "binary" }],
      });

      await attributedVcs.commit("initial");
      await fs.mkdir("/project/assets", { recursive: true });
      await fs.writeFile("/project/assets/logo.png", Buffer.from([0, 1, 2, 3]));

      const changes = await attributedVcs.status();
      const pngEntry = changes.find((entry) => entry.path === "assets/logo.png");

      expect(pngEntry).toBeDefined();
      expect(pngEntry!.binary).toBe(true);
      expect(pngEntry!.diff).toBe("binary");
      expect(pngEntry!.blobId).toBeDefined();
      expect(pngEntry!.patch).toBeUndefined();
      expect(pngEntry!.patchSuppressedReason).toBe("binary");
    });

    test('diff "none" suppresses diff payloads without affecting stored trees', async () => {
      const attributedFs = createFS({
        "/project/README.md": "# My Project",
        "/project/secrets/token.txt": "secret-1",
      });
      const attributedVcs = new VersionControlSystem({
        fs: attributedFs,
        path: "/project",
        attributes: [{ pattern: "secrets/**", diff: "none" }],
      });

      const first = await attributedVcs.commit("initial");
      const initialSecretEntry = first.changes.find((entry) => entry.path === "secrets/token.txt");
      expect(initialSecretEntry).toBeDefined();
      expect(initialSecretEntry!.diff).toBe("none");
      expect(initialSecretEntry!.patch).toBeUndefined();
      expect(initialSecretEntry!.patchSuppressedReason).toBe("none");
      expect(first.tree["secrets/token.txt"]).toBeDefined();

      await attributedFs.writeFile("/project/secrets/token.txt", "secret-2");
      const status = await attributedVcs.status();
      const statusEntry = status.find((entry) => entry.path === "secrets/token.txt");
      expect(statusEntry).toBeDefined();
      expect(statusEntry!.patch).toBeUndefined();
      expect(statusEntry!.patchSuppressedReason).toBe("none");

      const second = await attributedVcs.commit("rotate secret");
      const commitEntry = second.changes.find((entry) => entry.path === "secrets/token.txt");
      expect(commitEntry).toBeDefined();
      expect(commitEntry!.patch).toBeUndefined();
      expect(commitEntry!.patchSuppressedReason).toBe("none");

      const diff = await attributedVcs.diff(1, 2);
      const diffEntry = diff.find((entry) => entry.path === "secrets/token.txt");
      expect(diffEntry).toBeDefined();
      expect(diffEntry!.diff).toBe("none");
      expect(diffEntry!.patch).toBeUndefined();
      expect(diffEntry!.patchSuppressedReason).toBe("none");
    });
  });

  describe("blob storage", () => {
    test("deduplicates identical content across paths and commits", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/COPY.md", "# My Project");
      const rev = await vcs.commit("copy readme");

      const readme = rev.tree["README.md"];
      const copy = rev.tree["COPY.md"];
      const readmeFile = getFileEntry(rev.tree, "README.md");
      const copyFile = getFileEntry(rev.tree, "COPY.md");
      expect(readmeFile.blobId).toBe(copyFile.blobId);
      expect(await listBlobObjectPaths(fs, "/project/.vcs")).toHaveLength(3);
    });

    test("stores large replacements as distinct blobs without inline payload duplication", async () => {
      const largeFs = createFS({
        "/project/video.mp4": "a".repeat(256 * 1024),
      });
      const largeVcs = new VersionControlSystem({ fs: largeFs, path: "/project" });

      const first = await largeVcs.commit("first video");
      await largeFs.writeFile("/project/video.mp4", "b".repeat(320 * 1024));
      const second = await largeVcs.commit("second video");

      expect(await listBlobObjectPaths(largeFs, "/project/.vcs")).toHaveLength(2);
      expect((await largeVcs.readRevisionFile(1, "video.mp4")).length).toBe(256 * 1024);
      expect((await largeVcs.readRevisionFile(2, "video.mp4")).length).toBe(320 * 1024);
      const firstVideo = getFileEntry(first.tree, "video.mp4");
      const secondVideo = getFileEntry(second.tree, "video.mp4");
      expect(firstVideo.blobId).not.toBe(secondVideo.blobId);

      const revisionJson = JSON.parse(await largeFs.readFile("/project/.vcs/revisions/2.json", "utf8"));
      expect(revisionJson.tree["video.mp4"].blobId).toBeDefined();
      expect(revisionJson.tree["video.mp4"].content).toBeUndefined();
    });
  });

  describe("streaming and index cache", () => {
    test("uses readStream and writeStream for file content paths", async () => {
      const baseFs = createFS({
        "/project/file.txt": "hello",
      });
      const metrics = {
        readStreamPaths: [] as string[],
        writeStreamPaths: [] as string[],
      };
      const instrumentedFs = createInstrumentedFS(baseFs, metrics);
      const instrumentedVcs = new VersionControlSystem({ fs: instrumentedFs, path: "/project" });

      await instrumentedVcs.commit("initial");
      expect(metrics.readStreamPaths).toContain("/project/file.txt");

      await instrumentedFs.writeFile("/project/file.txt", "updated");
      await instrumentedVcs.commit("update");
      expect(metrics.writeStreamPaths.some((path) => path === "/project/file.txt")).toBe(false);

      metrics.writeStreamPaths.length = 0;
      await instrumentedVcs.checkout(1, { force: true });
      expect(metrics.writeStreamPaths).toContain("/project/file.txt");
    });

    test("skips rehashing unchanged tracked files using the index cache", async () => {
      const baseFs = createFS({
        "/project/file.txt": "hello",
      });
      const metrics = {
        readStreamPaths: [] as string[],
        writeStreamPaths: [] as string[],
      };
      const instrumentedFs = createInstrumentedFS(baseFs, metrics);
      const instrumentedVcs = new VersionControlSystem({ fs: instrumentedFs, path: "/project" });

      await instrumentedVcs.commit("initial");
      metrics.readStreamPaths.length = 0;
      metrics.writeStreamPaths.length = 0;

      await expect(instrumentedVcs.status()).resolves.toEqual([]);
      expect(metrics.writeStreamPaths.filter((path) => path.includes("/.vcs/tmp/"))).toEqual([]);

      await instrumentedFs.writeFile("/project/file.txt", "changed");
      metrics.readStreamPaths.length = 0;
      metrics.writeStreamPaths.length = 0;
      await instrumentedVcs.status();
      expect(metrics.readStreamPaths.filter((path) => !path.includes("/.vcs/"))).toEqual([
        "/project/file.txt",
      ]);
      expect(metrics.writeStreamPaths.some((path) => path.includes("/.vcs/tmp/"))).toBe(true);
    });
  });

  describe("head", () => {
    test("returns null revision before first commit", async () => {
      const h = await vcs.head();
      expect(h.branch).toBe("main");
      expect(h.revision).toBeNull();
    });

    test("returns branch and revision after commit", async () => {
      await vcs.commit("initial");
      const h = await vcs.head();
      expect(h.branch).toBe("main");
      expect(h.revision).toBe(1);
    });

    test("returns detached state after revision checkout", async () => {
      await vcs.commit("first");
      await fs.writeFile("/project/x.txt", "x");
      await vcs.commit("second");
      await vcs.checkout(1);
      const h = await vcs.head();
      expect(h.branch).toBeNull();
      expect(h.revision).toBe(1);
    });
  });

  describe("edge cases", () => {
    test("commit on empty working tree", async () => {
      const emptyFs = createFS({ "/project/.keep": "" });
      const emptyVcs = new VersionControlSystem({ fs: emptyFs, path: "/project" });
      const rev = await emptyVcs.commit("empty");
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.path).toBe(".keep");
    });

    test("detached HEAD commit", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/x.txt", "x");
      await vcs.commit("second");
      await vcs.checkout(1);
      await fs.writeFile("/project/detached.txt", "detached work");
      const rev = await vcs.commit("detached commit");
      expect(rev.parent).toBe(1);
      expect(rev.branch).toBe("detached");
      const h = await vcs.head();
      expect(h.branch).toBeNull();
      expect(h.revision).toBe(3);
    });

    test("separate VCS storage filesystem", async () => {
      const workFs = createFS({
        "/work/file.txt": "hello",
      });
      const metaFs = createFS({});
      await metaFs.mkdir("/meta", { recursive: true });

      const separateVcs = new VersionControlSystem({
        fs: workFs,
        path: "/work",
        vcsPath: { fs: metaFs, path: "/meta/.vcs" },
      });

      const rev = await separateVcs.commit("initial");
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.path).toBe("file.txt");

      // VCS data should be on metaFs, not workFs
      expect(await metaFs.exists("/meta/.vcs/HEAD")).toBe(true);
      expect(await workFs.exists("/work/.vcs")).toBe(false);
    });

    test("full checkout preserves custom metadata stored inside the working tree", async () => {
      const customFs = createFS({
        "/project/file.txt": "hello",
      });
      const customVcs = new VersionControlSystem({
        fs: customFs,
        path: "/project",
        vcsPath: { fs: customFs, path: "/project/history" },
      });

      await customVcs.commit("initial");
      await customFs.writeFile("/project/file.txt", "updated");
      await customVcs.commit("update");
      await customFs.writeFile("/project/dirty.txt", "discard me");

      await customVcs.checkout(1, { force: true });

      expect(await customFs.exists("/project/history/config.json")).toBe(true);
      expect(await customFs.exists("/project/history/counter.json")).toBe(true);
      expect(await customFs.exists("/project/history/revisions/1.json")).toBe(true);
      await expect(customVcs.status()).resolves.toEqual([]);
    });

    test("checkout creates directories for restored files", async () => {
      await vcs.commit("initial");
      await fs.rm("/project/src/index.ts");
      await fs.rm("/project/src/utils.ts");
      await fs.rm("/project/src", { recursive: true });
      await vcs.commit("remove src", { paths: ["/src/**"] });

      expect(await fs.exists("/project/src")).toBe(false);

      await vcs.checkout(1, { force: true });
      expect(await fs.exists("/project/src/index.ts")).toBe(true);
      const content = await fs.readFile("/project/src/index.ts", "utf8");
      expect(content).toBe('console.log("hello")');
    });

    test("tracks empty directories through commit and checkout", async () => {
      await vcs.commit("initial");
      await fs.mkdir("/project/src/empty", { recursive: true });

      const status = await vcs.status();
      const emptyDir = status.find((entry) => entry.path === "src/empty");
      expect(emptyDir).toBeDefined();
      expect(emptyDir!.type).toBe("add");
      expect(emptyDir!.entryKind).toBe("directory");

      const addEmptyDir = await vcs.commit("add empty dir");
      expect(addEmptyDir.tree["src/empty"]?.kind).toBe("directory");

      await fs.rm("/project/src/empty", { recursive: true });
      const removeEmptyDir = await vcs.commit("remove empty dir");
      expect(removeEmptyDir.changes.find((entry) => entry.path === "src/empty")!.type).toBe("delete");

      await vcs.checkout(2, { force: true });

      expect(await fs.exists("/project/src/empty")).toBe(true);
      const stat = await fs.stat("/project/src/empty");
      expect(stat.isDirectory()).toBe(true);
    });

    test("multiple branches diverge independently", async () => {
      await vcs.commit("initial");

      // Create and work on feature-a
      await vcs.branch("feature-a");
      await vcs.checkout("feature-a");
      await fs.writeFile("/project/a.txt", "feature a");
      await vcs.commit("add a");

      // Switch to main, create feature-b
      await vcs.checkout("main");
      await vcs.branch("feature-b");
      await vcs.checkout("feature-b");
      await fs.writeFile("/project/b.txt", "feature b");
      await vcs.commit("add b");

      // Verify branches have different trees
      await vcs.checkout("feature-a");
      expect(await fs.exists("/project/a.txt")).toBe(true);
      expect(await fs.exists("/project/b.txt")).toBe(false);

      await vcs.checkout("feature-b");
      expect(await fs.exists("/project/a.txt")).toBe(false);
      expect(await fs.exists("/project/b.txt")).toBe(true);

      await vcs.checkout("main");
      expect(await fs.exists("/project/a.txt")).toBe(false);
      expect(await fs.exists("/project/b.txt")).toBe(false);
    });

    test("uses repo-relative paths on Windows-style filesystems", async () => {
      const windowsFs = createWindowsFS({
        "C:\\project\\README.md": "# My Project",
        "C:\\project\\src\\index.ts": 'console.log("hello")',
      });
      const windowsVcs = new VersionControlSystem({
        fs: windowsFs,
        path: "C:\\project",
      });

      const initialStatus = await windowsVcs.status();
      expect(initialStatus.map((entry) => entry.path).sort()).toEqual([
        "README.md",
        "src/index.ts",
      ]);

      await windowsVcs.commit("initial");
      await windowsFs.writeFile("C:\\project\\src\\new.txt", "new");

      const changes = await windowsVcs.status();
      expect(changes.find((entry) => entry.path === "src/new.txt")?.type).toBe("add");

      await windowsVcs.checkout(1, { force: true });
      expect(await windowsFs.exists("C:\\project\\src\\new.txt")).toBe(false);
    });
  });
});

function createWindowsFS(files: Record<string, string>): VirtualFS {
  const vol = Volume.fromJSON(Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [toVolumePath(filePath), content]),
  ));
  const basePromises = (createFsFromVolume(vol) as any).promises;
  const underlyingFs: UnderlyingFS = {
    pathOps: {
      separator: "\\",
      resolve: (...paths: string[]) => winPath.resolve(...paths),
      normalize: (filePath: string) => winPath.normalize(filePath),
      join: (...paths: string[]) => winPath.join(...paths),
      relative: (from: string, to: string) => winPath.relative(from, to),
      isAbsolute: (filePath: string) => winPath.isAbsolute(filePath),
      dirname: (filePath: string) => winPath.dirname(filePath),
      basename: (filePath: string) => winPath.basename(filePath),
    },
    promises: {
      readFile: (filePath: string) => basePromises.readFile(toVolumePath(filePath)),
      readdir: (dirPath: string) => basePromises.readdir(toVolumePath(dirPath)),
      stat: (filePath: string) => basePromises.stat(toVolumePath(filePath)),
      writeFile: (filePath: string, data: Buffer | string) =>
        basePromises.writeFile(toVolumePath(filePath), data),
      appendFile: (filePath: string, data: Buffer | string) =>
        basePromises.appendFile(toVolumePath(filePath), data),
      mkdir: (dirPath: string, opts?: { recursive?: boolean }) =>
        basePromises.mkdir(toVolumePath(dirPath), opts),
      rm: async (filePath: string, opts?: { recursive?: boolean; force?: boolean }) => {
        try {
          const stats = await basePromises.stat(toVolumePath(filePath));
          if (stats.isDirectory()) {
            await basePromises.rmdir(toVolumePath(filePath), { recursive: opts?.recursive });
          } else {
            await basePromises.unlink(toVolumePath(filePath));
          }
        } catch (error) {
          if (!opts?.force) throw error;
        }
      },
    },
  };

  return new FileSystem(undefined, {}, underlyingFs);
}

function toVolumePath(filePath: string): string {
  const withoutDrive = filePath.replace(/^[A-Za-z]:/, "");
  const normalized = withoutDrive.replace(/\\/g, "/");
  return normalized || "/";
}

async function listBlobObjectPaths(fs: VirtualFS, basePath: string): Promise<string[]> {
  const root = fs.resolve(basePath, "objects", "blobs");
  if (!(await fs.exists(root))) {
    return [];
  }

  const results: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    for (const entry of await fs.readdir(currentPath)) {
      const fullPath = fs.resolve(currentPath, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await walk(fullPath);
      } else {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results.sort();
}

function createInstrumentedFS(
  baseFs: VirtualFS,
  metrics: {
    readStreamPaths: string[];
    writeStreamPaths: string[];
  },
): VirtualFS {
  return {
    ...baseFs,
    readStream(path: string): AsyncIterable<Uint8Array> {
      metrics.readStreamPaths.push(path);
      return baseFs.readStream(path);
    },
    async writeStream(path: string, opts?: { append?: boolean }): Promise<VirtualFSWritable> {
      metrics.writeStreamPaths.push(path);
      return baseFs.writeStream(path, opts);
    },
  };
}

function getFileEntry(tree: Record<string, unknown>, path: string) {
  const entry = tree[path];
  expect(entry).toBeDefined();
  expect((entry as { kind?: string } | undefined)?.kind).not.toBe("directory");
  return entry as { kind?: "file"; blobId: string; size: number };
}
