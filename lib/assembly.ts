import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  acceptedAsset,
  projectRatio,
  projectSoundtrack,
  type Asset,
  type Cut,
} from "./domain";
import { binary } from "./config";
import { dataDir, event, getProject, mediaPath, mutateProject } from "./store";
import { probe } from "./media";
import { ensureMedia, persistMedia } from "./media-storage";
import { composeScore, SCORE_VERSION } from "./score";
import { resolveSourceSoundtrack } from "./soundtrack";
import { sourceLengthEdit } from "./edit";
import { applyShotEdits } from "./shot-edit";
import { exportStyleInput, type ExportStyle } from "./export-style";
import { customBranding, prepareLogoLayer } from "./brand";
import { assembleNativeAudio } from "./native-audio";

const exec = promisify(execFile);
export async function assembleCut(options?: ExportStyle) {
  const style = exportStyleInput.parse(options || {});
  const project = await getProject();
  if (project.shots.some((s) => s.kind === "title"))
    throw new Error(
      "Exports need real footage for every scene. Replace legacy title-card shots with a source clip or generated continuation, then export again. No brand cards are preloaded.",
    );
  const soundtrack = projectSoundtrack(project);
  const sourceAudio = await resolveSourceSoundtrack(project, soundtrack);
  const baseEdit =
    sourceAudio && soundtrack.fit === "match-source"
      ? sourceLengthEdit(project, sourceAudio.audioDuration)
      : undefined;
  const edit = project.shotEdits?.length
    ? applyShotEdits(
        project,
        baseEdit ||
          project.shots.map((shot) => ({
            shotId: shot.id,
            start: 0,
            duration: shot.duration,
          })),
      )
    : baseEdit;
  const duration = (edit || project.shots).reduce(
    (sum, shot) => sum + shot.duration,
    0,
  );
  const ratio = projectRatio(project);
  const [width, height] = ratio === "9:16" ? [1080, 1920] : [1920, 1080];
  const branding =
    style.finish === "brand-overlay"
      ? await customBranding(project, style.logoAssetId!)
      : undefined;
  const inputs = project.shots.map((original) => {
    const excerpt = edit?.find((s) => s.shotId === original.id);
    const shot = excerpt
      ? { ...original, duration: excerpt.duration }
      : original;
    const assetId = acceptedAsset(shot);
    if (shot.kind !== "title" && !assetId)
      throw new Error(
        `Select a reviewed take for “${shot.title}” before exporting.`,
      );
    return { shot, assetId, start: excerpt?.start || 0 };
  });
  const visualSignature = createHash("sha256")
    .update(
      JSON.stringify({
        ratio,
        branding: branding?.signature || "clean-v1",
        finish: style.finish,
        logoAssetId: style.logoAssetId,
        shots: inputs.map(({ shot, assetId, start }) => [
          shot.id,
          shot.duration,
          shot.kind,
          assetId,
          ...(edit ? [start] : []),
        ]),
      }),
    )
    .digest("hex");
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        visualSignature,
        soundtrack,
        sourceAudio: sourceAudio?.asset.sha256,
        version: `${SCORE_VERSION}:source-audio-v1:native-audio-v1`,
      }),
    )
    .digest("hex");
  const previous = project.cuts.at(-1);
  if (previous?.signature === signature) return previous;
  const existingPictures = project.cuts.findLast(
    (c) =>
      c.visualSignature === visualSignature ||
      (!c.visualSignature && c.signature === visualSignature),
  );
  let pictureSource = existingPictures
    ? await ensureMedia(existingPictures.assetId).catch(() => undefined)
    : undefined;
  if (pictureSource) {
    try {
      await access(pictureSource);
    } catch {
      pictureSource = undefined;
    }
  }
  const id = randomUUID();
  const temporary = path.join(dataDir(), `cut-${id}`);
  await mkdir(temporary, { recursive: true });
  try {
    const nativeAudio =
      soundtrack.mode === "native"
        ? await assembleNativeAudio(
            inputs.map(({ shot, assetId, start }) => ({
              shotId: shot.id,
              assetId: assetId!,
              start,
              duration: shot.duration,
            })),
            temporary,
          )
        : undefined;
    if (!pictureSource) {
      const logoLayer = branding
        ? await prepareLogoLayer(temporary, style.logoAssetId!, width, height)
        : undefined;
      const files: string[] = [];
      for (let i = 0; i < inputs.length; i++) {
        const { shot, assetId, start } = inputs[i];
        const output = path.join(temporary, `${i}.mp4`);
        const source = await ensureMedia(assetId!);
        const metadata = await probe(source);
        const movingFinish = Boolean(logoLayer && i === inputs.length - 1);
        if (
          movingFinish &&
          (!metadata.duration ||
            metadata.duration - start + 1 / 24 < shot.duration)
        )
          throw new Error(
            "The final moving scene is too short for the edit. Adjust its in-point or render enough footage; the logo finish cannot freeze the final frame.",
          );
        const args = [
          "-v",
          "error",
          "-nostdin",
          "-y",
          ...(start ? ["-ss", String(start)] : []),
          "-i",
          source,
        ];
        if (!metadata.hasAudio)
          args.push(
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
          );
        const overlay = movingFinish ? logoLayer : undefined;
        if (overlay) args.push("-loop", "1", "-framerate", "24", "-i", overlay);
        const baseFilter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24${movingFinish ? "" : ",tpad=stop_mode=clone:stop_duration=15"}`;
        args.push(
          "-map",
          "[v]",
          "-map",
          metadata.hasAudio ? "0:a:0" : "1:a:0",
          "-filter_complex",
          overlay
            ? `${baseFilter}[base];[${metadata.hasAudio ? 1 : 2}:v]format=rgba${movingFinish ? `,fade=t=in:st=${Math.max(0, shot.duration - 4)}:d=0.5:alpha=1` : ""}[brand];[base][brand]overlay=0:0:format=auto,format=yuv420p[v]`
            : `${baseFilter},format=yuv420p[v]`,
          "-af",
          "apad",
          "-t",
          String(shot.duration),
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
          output,
        );
        await exec(binary("ffmpeg"), args, {
          timeout: 180_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        files.push(output);
      }
      const listPath = path.join(temporary, "concat.txt");
      await writeFile(
        listPath,
        files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"),
      );
      pictureSource = path.join(temporary, "pictures.mp4");
      await exec(
        binary("ffmpeg"),
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          pictureSource,
        ],
        { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
      );
    }
    const assetId = `cut_${id}`;
    const args = ["-v", "error", "-nostdin", "-y", "-i", pictureSource];
    if (soundtrack.mode === "instrumental") {
      const scorePath = path.join(temporary, "score.wav");
      await writeFile(scorePath, composeScore(duration, soundtrack));
      args.push(
        "-i",
        scorePath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=9",
      );
    } else if (sourceAudio) {
      if (soundtrack.playback === "loop") args.push("-stream_loop", "-1");
      const audioEnd =
        soundtrack.playback === "loop"
          ? duration
          : Math.min(duration, sourceAudio.audioDuration);
      const fade = Math.min(0.15, audioEnd / 2);
      args.push(
        "-i",
        mediaPath(sourceAudio.asset.id),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-af",
        `asetpts=PTS-STARTPTS,aresample=48000,afade=t=out:st=${audioEnd - fade}:d=${fade},apad`,
      );
    } else if (nativeAudio?.file) {
      args.push(
        "-i",
        nativeAudio.file,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
      );
    } else {
      args.push("-map", "0:v:0", "-c:v", "copy", "-an");
    }
    args.push(
      "-t",
      String(duration),
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      mediaPath(assetId),
    );
    await exec(binary("ffmpeg"), args, {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const checked = await probe(mediaPath(assetId));
    if (
      checked.hasAudio !==
        (soundtrack.mode === "native"
          ? Boolean(nativeAudio?.file)
          : soundtrack.mode !== "silent") ||
      !checked.duration ||
      Math.abs(checked.duration - duration) > 0.15
    )
      throw new Error(
        "The final soundtrack check failed. The previous export is preserved.",
      );
    const bytes = await readFile(mediaPath(assetId));
    await persistMedia(assetId);
    const createdAt = new Date().toISOString();
    const cut: Cut = {
      id,
      assetId,
      signature,
      visualSignature,
      branding,
      createdAt,
      soundtrack,
      ...(edit ? { edit } : {}),
      audioCheck: {
        sourceClipAudioIncluded:
          Boolean(sourceAudio) ||
          Boolean(
            nativeAudio?.assetIds.some(
              (id) => project.assets.find((a) => a.id === id)?.origin !== "h3",
            ),
          ),
        generatedClipAudioIncluded: Boolean(
          nativeAudio?.assetIds.some(
            (id) => project.assets.find((a) => a.id === id)?.origin === "h3",
          ),
        ),
        method: sourceAudio
          ? "source-audio"
          : nativeAudio
            ? "native-audio"
            : soundtrack.mode === "silent"
              ? "silent"
              : "synthesized-instruments",
        hasAudio: checked.hasAudio,
        duration: checked.duration,
        ...(nativeAudio
          ? {
              nativeAudioAssetIds: nativeAudio.assetIds,
              silentShotIds: nativeAudio.silentShotIds,
            }
          : {}),
        ...(sourceAudio
          ? {
              sourceAssetId: sourceAudio.asset.id,
              sourceAudioDuration: sourceAudio.audioDuration,
              playback: soundtrack.playback || "once",
              fit: soundtrack.fit || "keep-film",
            }
          : {}),
      },
    };
    const asset: Asset = {
      id: assetId,
      name: `campaign-film-${id.slice(0, 8)}.mp4`,
      mime: "video/mp4",
      origin: "export",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      duration,
      width,
      height,
      createdAt,
    };
    await mutateProject((p) => {
      p.assets.push(asset);
      p.cuts.push(cut);
      event(
        p,
        "cut.exported",
        `Exported a ${asset.duration} second launch cut`,
      );
    });
    return cut;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
