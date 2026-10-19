import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { binary } from "./config";
import { ensureMedia, persistMedia } from "./media-storage";
import { event, getProject, mediaPath, mutateProject } from "./store";
import type { Asset } from "./domain";

const exec = promisify(execFile);
export const MAX_UPLOAD = 32 * 1024 * 1024;
const acceptedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

export async function probe(filePath: string) {
  const { stdout } = await exec(
    binary("ffprobe"),
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      width?: number;
      height?: number;
      duration?: string;
    }[];
    format: { duration?: string };
  };
  const visual = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");
  return {
    width: visual?.width,
    height: visual?.height,
    duration: data.format.duration ? Number(data.format.duration) : undefined,
    hasAudio: Boolean(audio),
    audioDuration:
      audio?.duration && Number.isFinite(Number(audio.duration))
        ? Number(audio.duration)
        : audio && data.format.duration
          ? Number(data.format.duration)
          : undefined,
  };
}

export async function registerUpload(file: File, sourceUrl?: string) {
  if (!acceptedTypes.has(file.type))
    throw new Error("Use a PNG, JPG, WebP, MP4, MOV, MP3 or WAV file.");
  if (file.size > MAX_UPLOAD || file.size === 0)
    throw new Error("Files must be between 1 byte and 32 MB.");
  const id = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(mediaPath(id), bytes, { flag: "wx" });
  try {
    const metadata = await probe(mediaPath(id));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const asset: Asset = {
      id,
      name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 150),
      mime: file.type,
      size: bytes.length,
      sha256,
      origin: sourceUrl ? "social" : "upload",
      ...(sourceUrl ? { sourceUrl } : {}),
      createdAt: new Date().toISOString(),
      width: metadata.width,
      height: metadata.height,
      duration: file.type.startsWith("image/") ? undefined : metadata.duration,
    };
    if (file.type.startsWith("video/") && !metadata.width)
      throw new Error("This file has no readable video stream.");
    await persistMedia(id);
    await mutateProject((p) => {
      p.assets.push(asset);
      event(p, "asset.uploaded", `Added ${asset.name}`);
    });
    return asset;
  } catch (error) {
    await unlink(mediaPath(id));
    throw error;
  }
}

export async function referenceContent(ids: string[]) {
  const project = await getProject();
  const content: Record<string, unknown>[] = [];
  let totalBytes = 0;
  let videos = 0,
    images = 0,
    audio = 0,
    videoSeconds = 0,
    audioSeconds = 0;
  for (const id of ids) {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) throw new Error("A reference asset is missing.");
    await ensureMedia(id);
    const isImage = asset.mime.startsWith("image/");
    const isVideo = asset.mime.startsWith("video/");
    const isAudio = asset.mime.startsWith("audio/");
    if (isImage) images++;
    if (isVideo) {
      videos++;
      videoSeconds += asset.duration || 0;
    }
    if (isAudio) {
      audio++;
      audioSeconds += asset.duration || 0;
    }
    if (!isImage && !isVideo && !isAudio)
      throw new Error("Unsupported reference type.");
    if (
      (isVideo || isAudio) &&
      (!asset.duration || asset.duration < 2 || asset.duration > 15)
    )
      throw new Error("H3 reference clips must be 2–15 seconds long.");
    if (isVideo && asset.mime !== "video/mp4")
      throw new Error(
        "Convert MOV references to MP4 before sending them to H3. MOV can still be used as source footage.",
      );
    if (isImage && asset.size > 30 * 1024 * 1024)
      throw new Error("H3 reference images must be at most 30 MB.");
    if (isAudio && asset.size > 15 * 1024 * 1024)
      throw new Error("H3 reference audio must be at most 15 MB.");
    if (
      (isImage || isVideo) &&
      (!asset.width ||
        !asset.height ||
        Math.min(asset.width, asset.height) < 256 ||
        Math.max(asset.width, asset.height) > 5760 ||
        asset.width / asset.height < 0.4 ||
        asset.width / asset.height > 2.5)
    )
      throw new Error(
        "H3 reference dimensions must be 256–5760 pixels, with aspect ratio between 0.4 and 2.5.",
      );
    // Video references are visual inputs. Embedded speech/music must not become
    // an implicit audio reference, including when a previous H3 take is reused.
    const bytes = isVideo
      ? await visualReferenceBytes(mediaPath(id))
      : await readFile(mediaPath(id));
    totalBytes += Math.ceil(bytes.length / 3) * 4;
    if (totalBytes > 60 * 1024 * 1024)
      throw new Error(
        "Combined references are too large for H3. Use fewer or shorter clips.",
      );
    const prefix = isImage ? "image" : isVideo ? "video" : "audio";
    const mime = asset.mime === "audio/x-wav" ? "audio/wav" : asset.mime;
    content.push({
      type: `${prefix}_url`,
      [`${prefix}_url`]: {
        url: `data:${mime};base64,${bytes.toString("base64")}`,
      },
      role: `reference_${prefix}`,
    });
  }
  if (
    images > 9 ||
    videos > 3 ||
    audio > 3 ||
    videoSeconds > 15.01 ||
    audioSeconds > 15.01
  )
    throw new Error(
      "H3 allows 9 images, 3 video references totalling 15 seconds and 3 audio references totalling 15 seconds.",
    );
  return content;
}

export async function visualReferenceBytes(source: string) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "minimax-visual-reference-"),
  );
  const output = path.join(directory, "visual.mp4");
  try {
    await exec(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    if ((await probe(output)).hasAudio)
      throw new Error(
        "Could not remove audio from the visual reference. No H3 request was made.",
      );
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function sampleAsset(
  id: string,
  mode: "review" | "campaign" | "trend" = "review",
) {
  const asset = (await getProject()).assets.find((a) => a.id === id);
  if (!asset) throw new Error("Asset not found.");
  if (!asset.mime.startsWith("image/") && !asset.mime.startsWith("video/"))
    throw new Error(
      "Visual inspection accepts images and video. Audio needs a listening pass.",
    );
  await ensureMedia(id);
  const duration = asset.duration || 1;
  const times = asset.mime.startsWith("image/")
    ? [0]
    : mode === "campaign"
      ? [
          ...new Set([
            0,
            Math.min(0.5, duration * 0.1),
            Math.min(1, duration * 0.2),
            Math.min(2, duration * 0.3),
            ...[0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95].map(
              (f) => duration * f,
            ),
          ]),
        ].sort((a, b) => a - b)
      : (mode === "trend"
          ? [0.02, 0.1, 0.23, 0.36, 0.5, 0.64, 0.78, 0.93]
          : [0.05, 0.35, 0.65, 0.9]
        ).map((f) => duration * f);
  const frames = [];
  for (const seconds of times) {
    const { stdout } = await exec(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-nostdin",
        "-ss",
        String(seconds),
        "-i",
        mediaPath(id),
        "-frames:v",
        "1",
        "-vf",
        "scale=768:-2",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      { encoding: "buffer", timeout: 20_000, maxBuffer: 3 * 1024 * 1024 },
    );
    frames.push({ seconds, data: stdout.toString("base64") });
  }
  return {
    assetId: id,
    name: asset.name,
    duration: asset.duration,
    frames,
    note: "Sampled still frames only. This does not verify audio or all motion between frames.",
  };
}
