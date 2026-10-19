import { createReadStream, createWriteStream } from "node:fs";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { get, put } from "@vercel/blob";
import { cloudStorage, mediaPath } from "./store";

function objectPath(id: string) {
  mediaPath(id);
  return `media/${id}`;
}
const downloads = new Map<string, Promise<string>>();
export async function persistMedia(id: string) {
  if (!cloudStorage()) return;
  await put(objectPath(id), createReadStream(mediaPath(id)), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/octet-stream",
  });
}
export async function writeMedia(id: string, bytes: Uint8Array) {
  await writeFile(mediaPath(id), bytes);
  await persistMedia(id);
}
export async function ensureMedia(id: string): Promise<string> {
  const local = mediaPath(id);
  try {
    await access(local);
    return local;
  } catch {
    /* Recover from durable storage. */
  }
  if (!cloudStorage()) throw new Error("The media file is missing.");
  const existing = downloads.get(id);
  if (existing) return existing;
  const operation = (async () => {
    const result = await get(objectPath(id), { access: "private" });
    if (!result || result.statusCode !== 200)
      throw new Error("The media file could not be retrieved from storage.");
    const temporary = `${local}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        Readable.fromWeb(
          result.stream as import("node:stream/web").ReadableStream,
        ),
        createWriteStream(temporary),
      );
      await rename(temporary, local);
      return local;
    } finally {
      await rm(temporary, { force: true });
    }
  })();
  downloads.set(id, operation);
  try {
    return await operation;
  } finally {
    downloads.delete(id);
  }
}
export async function readMedia(id: string) {
  return readFile(/* turbopackIgnore: true */ await ensureMedia(id));
}
