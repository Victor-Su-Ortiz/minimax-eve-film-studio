import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { binary } from "../lib/config";
import { mediaPath, getProject } from "../lib/store";
import { assembleNativeAudio } from "../lib/native-audio";
import {
  initialProject,
  projectSoundtrack,
  soundtrackInput,
} from "../lib/domain";

const exec = promisify(execFile);
test("native soundtrack trims actual audio and keeps silent scenes and padding silent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-audio-"));
  process.env.STUDIO_DATA_DIR = directory;
  try {
    await getProject();
    await exec(binary("ffmpeg"), [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=1",
      "-filter_complex",
      "[0:a][1:a]concat=n=2:v=0:a=1[out]",
      "-map",
      "[out]",
      "-f",
      "wav",
      mediaPath("tone"),
    ]);
    await exec(binary("ffmpeg"), [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=64x64:d=1",
      "-an",
      "-f",
      "mp4",
      mediaPath("silent"),
    ]);
    const result = await assembleNativeAudio(
      [
        { shotId: "trimmed", assetId: "tone", start: 1, duration: 1 },
        { shotId: "silent", assetId: "silent", start: 0, duration: 1 },
        { shotId: "padded", assetId: "tone", start: 1.5, duration: 1 },
      ],
      directory,
    );
    assert.deepEqual(result.silentShotIds, ["silent"]);
    const { stdout } = await exec(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-i",
        result.file!,
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "-",
      ],
      { encoding: "buffer" },
    );
    const power = (start: number, end: number) => {
      let p = 0;
      for (let i = start * 8000; i < end * 8000; i++)
        p += stdout.readFloatLE(i * 4) ** 2;
      return p / ((end - start) * 8000);
    };
    assert.ok(power(0.1, 0.9) > 0.001);
    assert.ok(power(1.1, 1.9) < 1e-8, "No fallback music in the silent scene");
    assert.ok(power(2.1, 2.4) > 0.001);
    assert.ok(
      power(2.6, 2.9) < 1e-8,
      "Short audio must pad with silence, never repeat",
    );
    let crossings = 0;
    for (let i = 801; i < 7200; i++)
      if (stdout.readFloatLE((i - 1) * 4) < 0 && stdout.readFloatLE(i * 4) >= 0)
        crossings++;
    assert.ok(
      Math.abs(crossings / 0.8 - 880) < 3,
      "Trim must select the 880Hz interval",
    );
    const silent = await assembleNativeAudio(
      [{ shotId: "silent", assetId: "silent", start: 0, duration: 1 }],
      directory,
    );
    assert.equal(
      silent.file,
      undefined,
      "All-silent footage must not get a generated audio track",
    );
    assert.equal(initialProject().soundtrack?.mode, "native");
    assert.equal(projectSoundtrack({}).mode, "native");
    assert.equal(soundtrackInput.parse({}).mode, "native");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
