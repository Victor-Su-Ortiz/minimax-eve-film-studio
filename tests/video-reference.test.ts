import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "minimax-excerpt-test-"));
process.env.STUDIO_DATA_DIR = directory;
const { binary } = await import("../lib/config");
const { registerUpload, probe, referenceContent } =
  await import("../lib/media");
const { getProject, mediaPath } = await import("../lib/store");
const { prepareVideoReference } = await import("../lib/video-reference");
after(() => rm(directory, { recursive: true, force: true }));

test("prepare a real H3-compatible excerpt without altering the original or soundtrack", async () => {
  const fixture = path.join(directory, "source.mp4");
  execFileSync(binary("ffmpeg"), [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x320:r=12:d=18",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=18",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    fixture,
  ]);
  const originalBytes = await readFile(fixture);
  const source = await registerUpload(
    new File([originalBytes], "source.mp4", { type: "video/mp4" }),
  );
  const before = getProject();
  const prepared = await prepareVideoReference({
    assetId: source.id,
    start: 4,
    duration: 5,
  });
  assert.deepEqual(prepared.asset.derivedFrom, {
    assetId: source.id,
    start: 4,
    duration: 5,
  });
  assert.equal(prepared.asset.origin, "derived");
  const metadata = await probe(mediaPath(prepared.asset.id));
  assert.equal(metadata.hasAudio, false);
  assert.ok(Math.abs(metadata.duration! - 5) < 0.05);
  assert.ok((await referenceContent([prepared.asset.id])).length === 1);
  assert.deepEqual(await readFile(mediaPath(source.id)), originalBytes);
  assert.equal((await probe(mediaPath(source.id))).hasAudio, true);
  const after = getProject();
  assert.deepEqual(after.campaign, before.campaign);
  assert.deepEqual(after.soundtrack, before.soundtrack);
  assert.deepEqual(after.shots, before.shots);
  const repeated = await prepareVideoReference({
    assetId: source.id,
    start: 4,
    duration: 5,
  });
  assert.equal(repeated.asset.id, prepared.asset.id);
  assert.equal(getProject().assets.length, after.assets.length);
  await assert.rejects(
    prepareVideoReference({ assetId: source.id, start: 16, duration: 5 }),
    /within/,
  );
  await assert.rejects(
    prepareVideoReference({ assetId: source.id, start: 0, duration: 16 }),
  );
  await assert.rejects(
    prepareVideoReference({ assetId: source.id, start: -1, duration: 5 }),
  );
  await assert.rejects(
    prepareVideoReference({ assetId: "missing", start: 0, duration: 5 }),
    /existing video/,
  );
});
