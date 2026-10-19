import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "campaign-brand-test-"));
process.env.STUDIO_DATA_DIR = directory;
const { assembleCut } = await import("../lib/assembly");
const { binary } = await import("../lib/config");
const { registerUpload, probe } = await import("../lib/media");
const { getProject, mutateProject, mediaPath } = await import("../lib/store");
const { setBrandAssets, getBrandAssets } = await import("../lib/brand");
after(() => rm(directory, { recursive: true, force: true }));
let logoId: string;

test("a new studio has no brand assets and clean exports need no bundled kit", async () => {
  const initial = await getProject();
  assert.equal(initial.brief, "");
  assert.equal(initial.brandKit, undefined);
  assert.equal(initial.assets.length, 0);
  assert.ok(initial.shots.every((s) => !s.prompt && s.kind === "generated"));
  assert.equal((await getBrandAssets()).assets.length, 0);
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
  await mutateProject((p) => {
    p.shots = [
      {
        ...p.shots[0],
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
  const clean = await assembleCut();
  assert.equal(clean.branding, undefined);
  assert.equal((await assembleCut()).id, clean.id);
  const metadata = await probe(mediaPath(clean.assetId));
  assert.ok(Math.abs(metadata.duration! - 4) < 0.1);
  assert.equal(metadata.hasAudio, false);
  assert.equal(
    (await getProject()).assets.some((a) => a.origin === "brand"),
    false,
  );
});

test("only the uploaded logo is applied over the moving ending; it can be removed and earlier exports stay intact", async () => {
  const bytes = await sharp({
    create: { width: 180, height: 60, channels: 4, background: "#ff1800" },
  })
    .png()
    .toBuffer();
  const logo = await registerUpload(
    new File([new Uint8Array(bytes)], "acme-logo.png", { type: "image/png" }),
  );
  logoId = logo.id;
  await assert.rejects(
    assembleCut({ finish: "brand-overlay", logoAssetId: logoId }),
    /user-supplied brand kit/,
  );
  await setBrandAssets({ name: "Acme", assetIds: [logoId] });
  await mutateProject((p) => {
    p.shots = [p.shots[0], { ...p.shots[0], id: "shot_finish" }];
  });
  const clean = await assembleCut();
  const branded = await assembleCut({
    finish: "brand-overlay",
    logoAssetId: logoId,
  });
  assert.equal(branded.branding?.name, "Acme");
  assert.equal(branded.branding?.cornerWatermark, false);
  assert.notEqual(clean.visualSignature, branded.visualSignature);
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
  assert.deepEqual(
    crop(clean.assetId, "1", "crop=500:300:250:0"),
    crop(branded.assetId, "1", "crop=500:300:250:0"),
  );
  assert.notDeepEqual(
    crop(clean.assetId, "7", "crop=500:300:250:0"),
    crop(branded.assetId, "7", "crop=500:300:250:0"),
  );
  assert.notDeepEqual(
    crop(branded.assetId, "7.2", "crop=400:400:750:600"),
    crop(branded.assetId, "7.8", "crop=400:400:750:600"),
  );
  assert.equal(
    (await assembleCut({ finish: "brand-overlay", logoAssetId: logoId })).id,
    branded.id,
  );
  const removed = await assembleCut();
  assert.equal(removed.branding, undefined);
  assert.ok((await getProject()).cuts.some((c) => c.id === branded.id));
  assert.deepEqual(
    crop(clean.assetId, "7", "scale=100:100"),
    crop(removed.assetId, "7", "scale=100:100"),
  );
});

test("a logo finish cannot hide missing footage with a frozen tail or a preloaded title card", async () => {
  await mutateProject((p) => {
    p.shots.at(-1)!.duration = 5;
  });
  await assert.rejects(
    assembleCut({ finish: "brand-overlay", logoAssetId: logoId }),
    /cannot freeze/,
  );
  await mutateProject((p) => {
    p.shots.at(-1)!.kind = "title";
  });
  await assert.rejects(assembleCut(), /real footage/);
});
