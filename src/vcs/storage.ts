import type { VirtualFS } from "../types.ts";
import type {
  HeadRef,
  BranchRef,
  RevisionCounter,
  VCSConfigFile,
  VCSIndexEntry,
  VCSIndexFile,
  Revision,
} from "./types.ts";

const VCS_FORMAT_VERSION = 2;

export class VCSStorage {
  constructor(
    private readonly fs: VirtualFS,
    private readonly basePath: string,
  ) {}

  private path(...segments: string[]): string {
    return this.fs.resolve(this.basePath, ...segments);
  }

  // --- Init ---

  async isInitialized(): Promise<boolean> {
    return this.fs.exists(this.path("HEAD"));
  }

  async initialize(defaultBranch: string = "main"): Promise<void> {
    await this.fs.mkdir(this.basePath, { recursive: true });
    await this.fs.mkdir(this.path("refs", "heads"), { recursive: true });
    await this.fs.mkdir(this.path("revisions"), { recursive: true });
    await this.fs.mkdir(this.path("objects", "blobs"), { recursive: true });
    await this.fs.mkdir(this.path("tmp"), { recursive: true });

    await this.writeHead({ ref: `refs/heads/${defaultBranch}` });
    await this.writeJSON(["counter.json"], { next: 1 } satisfies RevisionCounter);
    await this.writeJSON(["config.json"], {
      version: VCS_FORMAT_VERSION,
      defaultBranch,
    } satisfies VCSConfigFile);
    await this.writeJSON(["index.json"], {
      version: VCS_FORMAT_VERSION,
      entries: {},
    } satisfies VCSIndexFile);
  }

  // --- HEAD ---

  async readHead(): Promise<HeadRef> {
    return this.readJSON<HeadRef>("HEAD");
  }

  async writeHead(head: HeadRef): Promise<void> {
    await this.writeJSON(["HEAD"], head);
  }

  // --- Branches ---

  async readBranch(name: string): Promise<BranchRef | null> {
    const branchPath = this.path("refs", "heads", name);
    if (!(await this.fs.exists(branchPath))) return null;
    return this.readJSON<BranchRef>("refs", "heads", name);
  }

  async writeBranch(name: string, ref: BranchRef): Promise<void> {
    await this.writeJSON(["refs", "heads", name], ref);
  }

  async deleteBranch(name: string): Promise<void> {
    const branchPath = this.path("refs", "heads", name);
    await this.fs.rm(branchPath);
  }

  async listBranches(): Promise<string[]> {
    const headsPath = this.path("refs", "heads");
    try {
      return await this.fs.readdir(headsPath);
    } catch {
      return [];
    }
  }

  // --- Revisions ---

  async readRevision(id: number): Promise<Revision> {
    return this.readJSON<Revision>("revisions", `${id}.json`);
  }

  async writeRevision(rev: Revision): Promise<void> {
    await this.writeJSON(["revisions", `${rev.id}.json`], rev);
  }

  // --- Counter ---

  async nextRevisionId(): Promise<number> {
    const counter = await this.readJSON<RevisionCounter>("counter.json");
    const id = counter.next;
    await this.writeJSON(["counter.json"], { next: id + 1 } satisfies RevisionCounter);
    return id;
  }

  // --- Config ---

  async readConfig(): Promise<VCSConfigFile> {
    const config = await this.readJSON<VCSConfigFile>("config.json");
    this.assertSupportedVersion(config.version);
    return config;
  }

  async assertSupportedFormat(): Promise<void> {
    await this.readConfig();
  }

  async readIndex(): Promise<Record<string, VCSIndexEntry>> {
    const indexPath = this.path("index.json");
    if (!(await this.fs.exists(indexPath))) {
      return {};
    }
    const index = await this.readJSON<VCSIndexFile>("index.json");
    this.assertSupportedVersion(index.version);
    return index.entries;
  }

  async writeIndex(entries: Record<string, VCSIndexEntry>): Promise<void> {
    await this.writeJSON(["index.json"], {
      version: VCS_FORMAT_VERSION,
      entries,
    } satisfies VCSIndexFile);
  }

  resolve(...segments: string[]): string {
    return this.path(...segments);
  }

  get fileSystem(): VirtualFS {
    return this.fs;
  }

  // --- Helpers ---

  private async readJSON<T>(...segments: string[]): Promise<T> {
    const filePath = this.path(...segments);
    const content = await this.fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  private async writeJSON(segments: string[], data: unknown): Promise<void> {
    const filePath = this.path(...segments);
    await this.fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  private assertSupportedVersion(version: number | undefined): void {
    if (version !== VCS_FORMAT_VERSION) {
      throw new Error(
        `unsupported VCS format version ${version ?? "unknown"}; reinitialize the repository`,
      );
    }
  }
}
