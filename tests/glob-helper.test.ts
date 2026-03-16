import { beforeEach, describe, expect, test } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import path from "node:path";
import { createVirtualFS, globVirtualFS, type GlobVirtualFS } from "../src/index.ts";

describe("globVirtualFS", () => {
  let mountedFs: GlobVirtualFS;

  beforeEach(() => {
    const projectVolume = Volume.fromJSON({
      "/workspace.md": "workspace",
      "/notes.txt": "notes",
    });
    const docsVolume = Volume.fromJSON({
      "/@tanstack/router/file-based-routing.md": "docs",
      "/@tanstack/router/guide.txt": "guide",
    });

    const projectFs = createVirtualFS(createFsFromVolume(projectVolume));
    const docsFs = createVirtualFS(createFsFromVolume(docsVolume));

    mountedFs = {
      resolve: (...paths: string[]) => path.posix.resolve("/", ...paths),
      async readdir(dirPath: string): Promise<string[]> {
        const normalized = path.posix.resolve("/", dirPath);

        if (normalized === "/") {
          return ["workspace.md", "notes.txt", "docs"];
        }
        if (normalized === "/docs") {
          return docsFs.readdir("/");
        }
        if (normalized.startsWith("/docs/")) {
          const relative = normalized.slice("/docs".length) || "/";
          return docsFs.readdir(relative);
        }

        return projectFs.readdir(normalized);
      },
      async stat(filePath: string) {
        const normalized = path.posix.resolve("/", filePath);

        if (normalized === "/docs") {
          return {
            isFile: () => false,
            isDirectory: () => true,
            size: 0,
            mtime: new Date(0),
          };
        }
        if (normalized.startsWith("/docs/")) {
          const relative = normalized.slice("/docs".length) || "/";
          return docsFs.stat(relative);
        }

        return projectFs.stat(normalized);
      },
    };
  });

  test("matches absolute paths across mounted virtual roots", async () => {
    const matches = await globVirtualFS(mountedFs, "/docs/@tanstack/router/*.md", { cwd: "/" });
    expect(matches).toEqual(["/docs/@tanstack/router/file-based-routing.md"]);
  });

  test("matches relative paths from a mounted cwd", async () => {
    const matches = await globVirtualFS(mountedFs, "*.md", { cwd: "/docs/@tanstack/router" });
    expect(matches).toEqual(["/docs/@tanstack/router/file-based-routing.md"]);
  });

  test("can scan across both default and mounted trees", async () => {
    const matches = await globVirtualFS(mountedFs, "/**/*.md", { cwd: "/" });
    expect(matches).toEqual(["/docs/@tanstack/router/file-based-routing.md", "/workspace.md"]);
  });
});
