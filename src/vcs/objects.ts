import { sha256 } from "@noble/hashes/sha2.js";
import type { VirtualFS } from "../types.ts";
import {
  appendSample,
  detectBinaryFromSample,
  hashSample,
  readStreamSample,
} from "./content.ts";

export interface StoredBlob {
  blobId: string;
  size: number;
  binary: boolean;
  sampleHash: string;
}

export class VCSObjectStore {
  constructor(
    private readonly fs: VirtualFS,
    private readonly basePath: string,
  ) {}

  async initialize(): Promise<void> {
    await this.fs.mkdir(this.path("objects", "blobs"), { recursive: true });
    await this.fs.mkdir(this.path("tmp"), { recursive: true });
  }

  async hasBlob(blobId: string): Promise<boolean> {
    return this.fs.exists(this.blobPath(blobId));
  }

  async store(source: AsyncIterable<Uint8Array>): Promise<StoredBlob> {
    const tempPath = this.path("tmp", `${Date.now()}-${Math.random().toString(36).slice(2)}.blob`);
    const writer = await this.fs.writeStream(tempPath);
    const hash = sha256.create();
    let size = 0;
    let sample: Uint8Array<ArrayBufferLike> = new Uint8Array();

    try {
      for await (const chunk of source) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        hash.update(bytes);
        size += bytes.byteLength;
        sample = appendSample(sample, bytes);
        await writer.write(bytes);
      }
      await writer.close();

      const blobId = toHex(hash.digest());
      const finalPath = this.blobPath(blobId);
      await this.fs.mkdir(this.fs.dirname(finalPath), { recursive: true });

      if (!(await this.fs.exists(finalPath))) {
        await copyStream(this.fs, tempPath, finalPath);
      }

      await this.fs.rm(tempPath, { force: true });
      return {
        blobId,
        size,
        binary: detectBinaryFromSample(sample),
        sampleHash: hashSample(sample),
      };
    } catch (error) {
      await writer.abort?.(error);
      await this.fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  async readBlob(blobId: string): Promise<Buffer> {
    return this.fs.readFile(this.blobPath(blobId));
  }

  async readBlobText(blobId: string): Promise<string> {
    return this.fs.readFile(this.blobPath(blobId), "utf8");
  }

  readBlobStream(blobId: string): AsyncIterable<Uint8Array> {
    return this.fs.readStream(this.blobPath(blobId));
  }

  async isBinaryBlob(blobId: string): Promise<boolean> {
    const sample = await readStreamSample(this.readBlobStream(blobId));
    return detectBinaryFromSample(sample);
  }

  async deleteTempFiles(): Promise<void> {
    await this.fs.rm(this.path("tmp"), { recursive: true, force: true });
    await this.fs.mkdir(this.path("tmp"), { recursive: true });
  }

  private blobPath(blobId: string): string {
    return this.path("objects", "blobs", blobId.slice(0, 2), blobId.slice(2));
  }

  private path(...segments: string[]): string {
    return this.fs.resolve(this.basePath, ...segments);
  }
}

async function copyStream(fs: VirtualFS, fromPath: string, toPath: string): Promise<void> {
  const writer = await fs.writeStream(toPath);
  try {
    for await (const chunk of fs.readStream(fromPath)) {
      await writer.write(chunk);
    }
    await writer.close();
  } catch (error) {
    await writer.abort?.(error);
    await fs.rm(toPath, { force: true });
    throw error;
  }
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
