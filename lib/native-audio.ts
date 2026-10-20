import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { binary } from "./config";
import { probe } from "./media";
import { ensureMedia } from "./media-storage";

const exec = promisify(execFile);

// Read the accepted originals, never an earlier export: its audio may have
// already been replaced. Keep trims and silent intervals aligned to the edit.
export async function assembleNativeAudio(
  clips: { shotId: string; assetId: string; start: number; duration: number }[],
  directory: string,
) {
  const args = ["-v", "error", "-nostdin", "-y"];
  const filters: string[] = [];
  const assetIds: string[] = [];
  const silentShotIds: string[] = [];
  for (const [i, clip] of clips.entries()) {
    const file = await ensureMedia(clip.assetId);
    const metadata = await probe(file);
    const hasAudio =
      metadata.hasAudio && (metadata.audioDuration || 0) > clip.start;
    if (hasAudio) {
      args.push("-ss", String(clip.start), "-i", file);
      assetIds.push(clip.assetId);
    } else {
      args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      silentShotIds.push(clip.shotId);
    }
    filters.push(
      `[${i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`,
    );
  }
  if (!assetIds.length) return { assetIds, silentShotIds };
  filters.push(
    `${clips.map((_, i) => `[a${i}]`).join("")}concat=n=${clips.length}:v=0:a=1[out]`,
  );
  const file = path.join(directory, "native-audio.wav");
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    file,
  );
  await exec(binary("ffmpeg"), args, {
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { file, assetIds, silentShotIds };
}
