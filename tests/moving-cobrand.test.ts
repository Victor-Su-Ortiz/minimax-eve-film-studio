import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "minimax-cobrand-test-"));
process.env.STUDIO_DATA_DIR = directory;
const { assembleCut } = await import("../lib/assembly");
const { binary } = await import("../lib/config");
const { registerUpload, probe } = await import("../lib/media");
const { getProject, mutateProject, mediaPath } = await import("../lib/store");
after(() => rm(directory, { recursive: true, force: true }));

test("moving co-brand export retains motion, exact duration and previous cuts, and rejects title cards or frozen tails", async () => {
  await assert.rejects(
    assembleCut({ finish: "moving-cobrand" }),
    /actual footage/,
  );
  const fixture = path.join(directory, "moving.mp4");
  execFileSync(binary("ffmpeg"), [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=180x320:r=24:d=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    fixture,
  ]);
  const source = await registerUpload(
    new File([await readFile(fixture)], "moving.mp4", { type: "video/mp4" }),
  );
  mutateProject((p) => {
    p.shots = [
      {
        ...p.shots[0],
        kind: "generated",
        duration: 4,
        takes: [
          {
            id: "take_test",
            assetId: source.id,
            prompt: "motion fixture",
            createdAt: new Date().toISOString(),
          },
        ],
        acceptedTakeId: "take_test",
      },
    ];
    p.soundtrack = { mode: "silent", mood: "cinematic", tempo: 112 };
  });
  const result = await assembleCut({ finish: "moving-cobrand" });
  assert.equal(result.branding?.name, "MiniMax M3.1 Flash × Vercel");
  const metadata = await probe(mediaPath(result.assetId));
  assert.ok(Math.abs(metadata.duration! - 4) < 0.1);
  assert.equal(metadata.hasAudio, false);
  const frame = (second: string) =>
    execFileSync(binary("ffmpeg"), [
      "-v",
      "error",
      "-ss",
      second,
      "-i",
      mediaPath(result.assetId),
      "-frames:v",
      "1",
      "-vf",
      "crop=iw:ih/2:0:ih/2,scale=90:80",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
  assert.notDeepEqual(frame("3.2"), frame("3.8"));
  assert.equal((await assembleCut({ finish: "moving-cobrand" })).id, result.id);
  mutateProject((p) => {
    p.shots[0].duration = 5;
  });
  await assert.rejects(
    assembleCut({ finish: "moving-cobrand" }),
    /cannot freeze/,
  );
  assert.equal(getProject().cuts.length, 1);
});

test("corner mark can be removed without changing the closing co-brand lockup", async () => {
  mutateProject((p) => {
    const first = { ...p.shots[0], duration: 4 };
    p.shots = [first, { ...first, id: "shot_finish" }];
  });
  const marked = await assembleCut({ finish: "moving-cobrand" });
  const clean = await assembleCut({
    finish: "moving-cobrand",
    cornerWatermark: false,
  });
  assert.notEqual(marked.visualSignature, clean.visualSignature);
  assert.equal(clean.branding?.cornerWatermark, false);
  assert.equal(clean.branding?.name, "MiniMax M3.1 Flash × Vercel");
  const crop = (id: string, time: string, area: string) =>
    execFileSync(binary("ffmpeg"), [
      "-v",
      "error",
      "-ss",
      time,
      "-i",
      mediaPath(id),
      "-frames:v",
      "1",
      "-vf",
      area,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
  assert.notDeepEqual(
    crop(marked.assetId, "1", "crop=300:180:0:0"),
    crop(clean.assetId, "1", "crop=300:180:0:0"),
  );
  assert.deepEqual(
    crop(marked.assetId, "7", "crop=1080:500:0:0,scale=540:250"),
    crop(clean.assetId, "7", "crop=1080:500:0:0,scale=540:250"),
  );
  assert.equal(
    (await assembleCut({ finish: "moving-cobrand", cornerWatermark: false }))
      .id,
    clean.id,
  );
});
