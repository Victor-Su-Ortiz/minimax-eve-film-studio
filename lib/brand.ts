import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { binary } from "./config";
import type { Asset } from "./domain";
import { event, getProject, mediaPath, mutateProject } from "./store";

const exec = promisify(execFile);
export const BRAND_NAME = "MiniMax M3.1 Flash";
export const BRAND_SOURCE =
  "https://www.figma.com/design/OBZtbEFlEn8ilGAdqKpk5q?node-id=1311-7298";
export const BRAND_VERSION = "figma-flower-v1";
const files = {
  hero: "hero.png",
  background: "flower-background.png",
  lockup: "m31-flash-lockup.png",
  wordmark: "minimax-wordmark.png",
} as const;

export function brandPath(role: keyof typeof files) {
  return path.join(
    process.env.STUDIO_PROJECT_DIR || process.cwd(),
    "public/brand/m31-flash",
    files[role],
  );
}

export async function brandSignature() {
  const bytes = await Promise.all(
    Object.keys(files)
      .map((role) => brandPath(role as keyof typeof files))
      .map((file) => readFile(file)),
  );
  const hash = createHash("sha256").update(BRAND_VERSION);
  for (const data of bytes) hash.update(data);
  hash.update(
    await readFile(
      path.join(
        process.env.STUDIO_PROJECT_DIR || process.cwd(),
        "public/brand/vercel-white.svg",
      ),
    ),
  );
  hash.update("moving-cobrand-v1");
  return hash.digest("hex");
}

// Exact source logos remain separate from generated scene geometry and lettering.
export async function prepareCoBrandLayer(
  directory: string,
  width: number,
  height: number,
) {
  const output = path.join(directory, "brand-cobrand.png");
  const mini = await sharp(brandPath("lockup"))
    .trim()
    .resize({ width: Math.round(width * 0.39) })
    .png()
    .toBuffer({ resolveWithObject: true });
  const vercel = await sharp(
    path.join(
      process.env.STUDIO_PROJECT_DIR || process.cwd(),
      "public/brand/vercel-white.svg",
    ),
  )
    .resize({ width: Math.round(width * 0.31) })
    .png()
    .toBuffer({ resolveWithObject: true });
  const centerY = Math.round(height * 0.14);
  const scrim = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".65"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${Math.round(height * 0.34)}" fill="url(#s)"/><path d="M ${width * 0.51} ${centerY - width * 0.012} l ${width * 0.024} ${width * 0.024} m 0 ${-width * 0.024} l ${-width * 0.024} ${width * 0.024}" stroke="white" stroke-width="${width * 0.002}"/></svg>`,
  );
  await sharp({
    create: { width, height, channels: 4, background: "#00000000" },
  })
    .composite([
      { input: scrim },
      {
        input: mini.data,
        left: Math.round(width * 0.08),
        top: Math.round(centerY - mini.info.height / 2),
      },
      {
        input: vercel.data,
        left: Math.round(width * 0.59),
        top: Math.round(centerY - vercel.info.height / 2),
      },
    ])
    .png()
    .toFile(output);
  return output;
}

// Keep brand art separate from social campaign evidence and its revision.
// Only the text-free image is registered as an H3 reference. Logos are composited.
export async function loadBrandAssets() {
  const bytes = await readFile(brandPath("background"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = `brand_m31_flower_${sha256.slice(0, 16)}`;
  const metadata = await sharp(bytes).metadata();
  const destination = mediaPath(id);
  const existing = await readFile(destination).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!existing?.equals(bytes)) {
    const temporary = mediaPath(`brand_${randomUUID()}`);
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  }
  const asset: Asset = {
    id,
    name: "MiniMax M3.1 Flash — Figma flower artwork.png",
    mime: "image/png",
    size: bytes.length,
    sha256,
    width: metadata.width,
    height: metadata.height,
    origin: "brand",
    sourceUrl:
      "https://www.figma.com/design/OBZtbEFlEn8ilGAdqKpk5q?node-id=1311-7299",
    createdAt: new Date().toISOString(),
  };
  if (!getProject().assets.some((a) => a.id === id)) {
    mutateProject((p) => {
      if (p.assets.some((a) => a.id === id)) return;
      p.assets.push(asset);
      event(p, "brand.loaded", "Loaded the MiniMax M3.1 Flash Figma artwork");
    });
  }
  const preview = await sharp(brandPath("hero"))
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return {
    name: BRAND_NAME,
    sourceUrl: BRAND_SOURCE,
    previewUrl: "/brand/m31-flash/hero.png",
    reference: {
      assetId: id,
      name: asset.name,
      usage:
        "Use this actual text-free image in relevant shots' referenceIds for orange/pink lighting, purple sculptural petals, or an original brand-world reveal. It is art direction, not dog identity or choreography. Explain its visual role in the H3 prompt.",
    },
    exportBranding:
      "Default exports use the exact MiniMax wordmark and M3.1 Flash flower card. For a moving MiniMax × Vercel finish, plan every shot as footage (no title kind) and call create_cut with finish=moving-cobrand: exact official MiniMax and Vercel logos fade over the final four seconds. Reserve dark sky in the upper third. Do not ask H3 to draw lettering. Accepted takes remain intact.",
    preview: {
      data: preview.toString("base64"),
      mediaType: "image/jpeg" as const,
    },
  };
}

export type BrandLayers = {
  background: string;
  title: string;
  watermark: string;
};

export async function prepareBrandLayers(
  directory: string,
  width: number,
  height: number,
): Promise<BrandLayers> {
  const layers = {
    background: path.join(directory, "brand-background.png"),
    title: path.join(directory, "brand-title.png"),
    watermark: path.join(directory, "brand-watermark.png"),
  };
  await sharp(brandPath("background"))
    .resize(width, height, { fit: "cover" })
    .png()
    .toFile(layers.background);
  const lockup = await sharp(brandPath("lockup"))
    .resize({ width: Math.round(width * (height > width ? 0.82 : 0.54)) })
    .png()
    .toBuffer({ resolveWithObject: true });
  const transparent = {
    create: { width, height, channels: 4 as const, background: "#00000000" },
  };
  await sharp(transparent)
    .composite([
      {
        input: lockup.data,
        left: Math.round((width - lockup.info.width) / 2),
        top: Math.round(height * 0.48 - lockup.info.height / 2),
      },
    ])
    .png()
    .toFile(layers.title);
  const inset = Math.round(Math.min(width, height) * 0.055);
  const mark = await sharp(brandPath("wordmark"))
    .resize({ width: Math.round(Math.min(width, height) * 0.2) })
    .png()
    .toBuffer();
  // A soft top gradient keeps the unmodified white artwork legible on bright takes.
  const scrim = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${inset * 4}" fill="url(#shade)"/></svg>`,
  );
  await sharp(transparent)
    .composite([{ input: scrim }, { input: mark, left: inset, top: inset }])
    .png()
    .toFile(layers.watermark);
  return layers;
}

// Keep the official lettering stationary while the supplied artwork slowly moves.
export async function renderBrandTitle(
  layers: BrandLayers,
  output: string,
  duration: number,
  width: number,
  height: number,
) {
  const frames = Math.max(1, Math.round(duration * 24) - 1);
  await exec(
    binary("ffmpeg"),
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-loop",
      "1",
      "-framerate",
      "24",
      "-i",
      layers.background,
      "-loop",
      "1",
      "-framerate",
      "24",
      "-i",
      layers.title,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex",
      `[0:v]scale=${width * 2}:${height * 2},zoompan=z='1+0.035*min(on/${frames},1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=24,setsar=1[bg];[bg][1:v]overlay=0:0:format=auto,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-map",
      "2:a:0",
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      output,
    ],
    { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
  );
}
