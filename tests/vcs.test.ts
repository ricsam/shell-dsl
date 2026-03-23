import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS } from "../src/index.ts";
import { VersionControlSystem } from "../src/vcs/index.ts";
import type { VirtualFS } from "../src/types.ts";

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
    });

    test("init is idempotent", async () => {
      await vcs.init();
      await vcs.init();
      const config = JSON.parse(await fs.readFile("/project/.vcs/config.json", "utf8"));
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
      // Verify content is base64 encoded
      const readmeContent = Buffer.from(rev.tree["README.md"]!.content, "base64").toString();
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
      // Only src/index.ts should be in changes
      expect(rev.changes.length).toBe(1);
      expect(rev.changes[0]!.path).toBe("src/index.ts");
      // But README.md should still be in tree from parent
      expect(rev.tree["README.md"]).toBeDefined();
      const readmeContent = Buffer.from(rev.tree["README.md"]!.content, "base64").toString();
      expect(readmeContent).toBe("# My Project"); // original content
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

    test("diff includes content for add/modify", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/new.txt", "hello");
      await vcs.commit("add file");

      const entries = await vcs.diff(1, 2);
      const addEntry = entries.find((e) => e.path === "new.txt");
      expect(addEntry).toBeDefined();
      expect(addEntry!.content).toBeDefined();
      const decoded = Buffer.from(addEntry!.content!, "base64").toString();
      expect(decoded).toBe("hello");
    });

    test("diff includes previousContent for modify/delete", async () => {
      await vcs.commit("initial");
      await fs.writeFile("/project/README.md", "# Updated");
      await vcs.commit("update");

      const entries = await vcs.diff(1, 2);
      const modEntry = entries.find((e) => e.path === "README.md");
      expect(modEntry!.previousContent).toBeDefined();
      const prev = Buffer.from(modEntry!.previousContent!, "base64").toString();
      expect(prev).toBe("# My Project");
    });

    test("diff with no changes returns empty array", async () => {
      await vcs.commit("initial");
      const entries = await vcs.diff(1, 1);
      expect(entries.length).toBe(0);
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
  });
});
