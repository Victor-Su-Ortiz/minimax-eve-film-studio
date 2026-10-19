import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { binary } from "./config";
import type { Asset } from "./domain";
import { MAX_UPLOAD, probe } from "./media";
import { ensureMedia, persistMedia, readMedia } from "./media-storage";
import { event, getProject, mediaPath, mutateProject } from "./store";

const exec = promisify(execFile);
export const videoReferenceInput = z.object({
  assetId: z.string().min(1),
  start: z.number().finite().min(0),
  duration: z.number().finite().min(2).max(15),
});

// A visual excerpt is separate from campaign evidence and the full soundtrack.
export async function prepareVideoReference(
  input: z.infer<typeof videoReferenceInput>,
) {
  const { assetId, start, duration } = videoReferenceInput.parse(input);
  const project = await getProject();
  const source = project.assets.find((asset) => asset.id === assetId);
  if (!source?.mime.startsWith("video/") || !source.duration)
    throw new Error("Choose an existing video asset with a known duration.");
  if (start + duration > source.duration)
    throw new Error("The excerpt must stay within the source video.");
  const signature = createHash("sha256")
    .update(
      JSON.stringify([
        "visual-excerpt-v1",
        assetId,
        source.sha256,
        start,
        duration,
      ]),
    )
    .digest("hex");
  const id = `excerpt_${signature.slice(0, 32)}`;
  const existing = project.assets.find((asset) => asset.id === id);
  if (existing) {
    await readMedia(id);
    return result(existing);
  }
  const directory = await mkdtemp(path.join(tmpdir(), "minimax-excerpt-"));
  const output = path.join(directory, "visual.mp4");
  try {
    await exec(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        String(start),
        "-i",
        await ensureMedia(assetId),
        "-t",
        String(duration),
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-r",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    const metadata = await probe(output);
    if (
      metadata.hasAudio ||
      !metadata.width ||
      !metadata.height ||
      !metadata.duration ||
      metadata.duration < 2 ||
      metadata.duration > 15
    )
      throw new Error(
        "Could not prepare a 2–15 second silent visual reference.",
      );
    const bytes = await readFile(output);
    if (!bytes.length || bytes.length > MAX_UPLOAD)
      throw new Error("The visual excerpt exceeds the 32 MB reference limit.");
    const asset: Asset = {
      id,
      name: `${source.name.replace(/\.[^.]+$/, "")} — ${start.toFixed(2)}-${(start + duration).toFixed(2)}s.mp4`,
      mime: "video/mp4",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      origin: "derived",
      sourceUrl: source.sourceUrl,
      derivedFrom: { assetId, start, duration },
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      createdAt: new Date().toISOString(),
    };
    await writeFile(mediaPath(id), bytes);
    await persistMedia(id);
    await mutateProject((p) => {
      if (!p.assets.some((a) => a.id === assetId && a.sha256 === source.sha256))
        throw new Error(
          "The source campaign changed while preparing the excerpt.",
        );
      if (!p.assets.some((a) => a.id === id)) {
        p.assets.push(asset);
        event(
          p,
          "reference.prepared",
          `Prepared ${start.toFixed(1)}–${(start + duration).toFixed(1)}s of the source for H3`,
        );
      }
    });
    return result(asset);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function result(asset: Asset) {
  return {
    asset,
    next: "Use this excerpt asset ID in relevant shots' referenceIds. Keep sourceBasis tied to the inspected original. All H3 video references combined must total at most 15 seconds. Use the full original asset for the final soundtrack; this excerpt contains no audio. The original source, campaign revision and selected takes are unchanged.",
  };
}
