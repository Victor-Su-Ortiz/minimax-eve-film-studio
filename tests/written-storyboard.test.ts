import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "written-storyboard-"));
process.env.STUDIO_DATA_DIR = directory;
const { initialProject } = await import("../lib/domain");
const { getProject, mutateProject } = await import("../lib/store");
const { registerUpload } = await import("../lib/media");
const { submitShot } = await import("../lib/renders");

beforeEach(async () => {
  process.env.MINIMAX_VIDEO_API_KEY = "test-key-no-network";
  await mutateProject((p) => {
    for (const key of Object.keys(p))
      delete (p as unknown as Record<string, unknown>)[key];
    Object.assign(p, initialProject());
    p.production = { mode: "manual" };
    p.shots[0].prompt = "A tiny astronaut plants a garden on the moon.";
    p.shots[0].revision = 2;
  });
});
after(() => rm(directory, { recursive: true, force: true }));

for (const status of ["ready", "failed", "unknown", "generating"] as const) {
  test(`legacy ${status} storyboard cannot block or enter a new H3 render`, async () => {
    await mutateProject((p) => {
      p.storyboards = [
        {
          id: "old-board",
          signature: "old",
          shotId: p.shots[0].id,
          shotRevision: 1,
          ratio: "9:16",
          prompt: "Old plan",
          model: "image-01",
          status,
          assetId: "missing-old-image",
          createdAt: new Date().toISOString(),
        },
      ];
      p.shots[0].referenceIds = ["missing-old-image"];
    });
    const before = await getProject();
    let calls = 0;
    const job = await submitShot(
      before.shots[0].id,
      `legacy-${status}`,
      "768P",
      async (url, init) => {
        calls++;
        assert.equal(url, "https://api.minimax.io/v2/video_generation");
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.content, [
          { type: "text", text: before.shots[0].prompt },
        ]);
        return Response.json({ task_id: "test_h3" });
      },
    );
    assert.equal(calls, 1);
    assert.equal(job.status, "queued");
    assert.deepEqual(job.referenceIds, []);
    const after = await getProject();
    assert.deepEqual(after.storyboards, before.storyboards);
    assert.deepEqual(after.shots, before.shots);
    assert.deepEqual(after.cuts, before.cuts);
  });
}

test("uploaded image references still reach H3 without an image-generation step", async () => {
  const image = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "#ffaa88" },
  })
    .png()
    .toBuffer();
  const asset = await registerUpload(
    new File([image], "character.png", { type: "image/png" }),
  );
  await mutateProject((p) => {
    p.shots[0].referenceIds = [asset.id];
  });
  const before = await getProject();
  const job = await submitShot(
    before.shots[0].id,
    "uploaded-reference",
    "768P",
    async (url, init) => {
      assert.equal(url, "https://api.minimax.io/v2/video_generation");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.content.length, 2);
      assert.equal(body.content[1].type, "image_url");
      assert.match(body.content[1].image_url.url, /^data:image\//);
      return Response.json({ task_id: "test_h3_uploaded_image" });
    },
  );
  assert.deepEqual(job.referenceIds, [asset.id]);
  assert.deepEqual((await getProject()).assets, before.assets);
});
