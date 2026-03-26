import { sha256 } from "@noble/hashes/sha2.js";

export const BINARY_SAMPLE_BYTES = 64 * 1024;
export const MAX_PATCH_BYTES = 1024 * 1024;

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const ALLOWED_CONTROL_BYTES = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d]);

export function detectBinaryFromSample(sample: Uint8Array<ArrayBufferLike>): boolean {
  if (sample.length === 0) {
    return false;
  }

  let controlBytes = 0;

  for (const byte of sample) {
    if (byte === 0x00) {
      return true;
    }
    if (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) {
      controlBytes++;
    }
  }

  try {
    textDecoder.decode(sample);
  } catch {
    return true;
  }

  return controlBytes / sample.length > 0.2;
}

export function appendSample(
  sample: Uint8Array<ArrayBufferLike>,
  chunk: Uint8Array<ArrayBufferLike>,
  limit: number = BINARY_SAMPLE_BYTES,
): Uint8Array<ArrayBufferLike> {
  if (sample.length >= limit || chunk.length === 0) {
    return sample;
  }

  const nextLength = Math.min(limit, sample.length + chunk.length);
  const next = new Uint8Array(nextLength);
  next.set(sample, 0);
  next.set(chunk.subarray(0, nextLength - sample.length), sample.length);
  return next;
}

export async function readStreamSample(
  source: AsyncIterable<Uint8Array>,
  limit: number = BINARY_SAMPLE_BYTES,
): Promise<Uint8Array<ArrayBufferLike>> {
  let sample: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for await (const chunk of source) {
    sample = appendSample(sample, chunk, limit);
    if (sample.length >= limit) {
      break;
    }
  }
  return sample;
}

export function hashSample(sample: Uint8Array<ArrayBufferLike>): string {
  return toHex(sha256(sample));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
