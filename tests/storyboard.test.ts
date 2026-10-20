import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "minimax-storyboard-"));
process.env.STUDIO_DATA_DIR = directory;
const { generateStoryboard } = await import("../lib/storyboard");
const { initialProject, currentStoryboard } = await import("../lib/domain");
const { getProject, mutateProject } = await import("../lib/store");
const { readMedia } = await import("../lib/media-storage");
const { submitShot } = await import("../lib/renders");
const image = await sharp({
  create: { width: 1280, height: 720, channels: 3, background: "#ffaa88" },
})
  .png()
  .toBuffer();
const key = "test-image-key-never-sent-to-network";
const input = {
  shotId: "shot_brief",
  prompt:
    "A tiny astronaut bunny plants a glowing carrot on the moon, cinematic single frame.",
};
const success = () =>
  Response.json({
    base_resp: { status_code: 0 },
    data: { image_base64: [image.toString("base64")] },
  });
beforeEach(async () => {
  process.env.MINIMAX_VIDEO_API_KEY = key;
  delete process.env.MINIMAX_IMAGE_API_KEY;
  await mutateProject((p) => {
    for (const key of Object.keys(p))
      delete (p as unknown as Record<string, unknown>)[key];
    Object.assign(p, initialProject());
    p.production = { mode: "manual" };
    p.shots[0].prompt =
      "Bunny plants a carrot, then the garden blooms. Track back slowly.";
    p.shots[0].revision = 1;
  });
});
after(() => rm(directory, { recursive: true, force: true }));

test("real image bytes are stored, replayed without another charge, and sent to H3", async () => {
  const before = await getProject();
  const board = await generateStoryboard(input, async (url, init) => {
    assert.equal(url, "https://api.minimax.io/v1/image_generation");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      `Bearer ${key}`,
    );
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "image-01");
    assert.equal(payload.n, 1);
    assert.equal(payload.response_format, "base64");
    assert.equal(payload.aspect_ratio, "16:9");
    return success();
  });
  assert.equal(board.status, "ready");
  const saved = await getProject();
  assert.deepEqual(saved.shots, before.shots);
  assert.deepEqual(saved.campaign, before.campaign);
  assert.deepEqual(saved.soundtrack, before.soundtrack);
  assert.deepEqual(saved.jobs, before.jobs);
  assert.deepEqual(saved.cuts, before.cuts);
  assert.equal(
    currentStoryboard(saved, saved.shots[0])?.assetId,
    board.assetId,
  );
  assert.equal(saved.assets[0].origin, "storyboard");
  assert.equal(
    (await sharp(await readMedia(board.assetId!)).metadata()).width,
    1280,
  );
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.equal(
    (
      await generateStoryboard(input, async () =>
        assert.fail("No repeat request"),
      )
    ).id,
    board.id,
  );
  const job = await submitShot(
    input.shotId,
    "board-to-video",
    "768P",
    async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.content[1].type, "image_url");
      assert.match(
        payload.content[1].image_url.url,
        /^data:image\/png;base64,/,
      );
      return Response.json({ task_id: "test_h3_with_board" });
    },
  );
  assert.deepEqual(job.referenceIds, [board.assetId]);
});

test("character reference is sent server-side while image credentials can be separate", async () => {
  const first = await generateStoryboard(input, async () => success());
  process.env.MINIMAX_IMAGE_API_KEY = "separate-image-credential";
  const second = await generateStoryboard(
    { ...input, shotId: "shot_leap", subjectAssetId: first.assetId },
    async () => assert.fail("Unplanned shot must not charge"),
  ).catch((e) => e);
  assert.match(second.message, /Plan this generated shot/);
  await mutateProject((p) => {
    p.shots[1].prompt = "The same bunny presses a triangle shaped button.";
    p.shots[1].revision = 1;
  });
  const frame = await generateStoryboard(
    { ...input, shotId: "shot_leap", subjectAssetId: first.assetId },
    async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer separate-image-credential",
      );
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.subject_reference.length, 1);
      assert.equal(payload.subject_reference[0].type, "character");
      assert.match(
        payload.subject_reference[0].image_file,
        /^data:image\/jpeg;base64,/,
      );
      return success();
    },
  );
  assert.equal(frame.status, "ready");
  assert.ok(!JSON.stringify(await getProject()).includes("data:image"));
});

test("lost image responses are not resubmitted, including with a changed prompt", async () => {
  const frame = await generateStoryboard(input, async () => {
    throw new Error(key);
  });
  assert.equal(frame.status, "unknown");
  assert.ok(!frame.error?.includes(key));
  assert.equal(
    (
      await generateStoryboard(input, async () =>
        assert.fail("No duplicate charge"),
      )
    ).id,
    frame.id,
  );
  await assert.rejects(
    generateStoryboard(
      { ...input, prompt: `${input.prompt} Different camera angle.` },
      async () => assert.fail("No ambiguous retry"),
    ),
    /uncertain/,
  );
});

test("concurrent calls reserve one image operation", async () => {
  let calls = 0;
  const results = await Promise.all(
    [1, 2].map(() =>
      generateStoryboard(input, async () => {
        calls++;
        return success();
      }),
    ),
  );
  assert.equal(calls, 1);
  assert.equal(results[0].id, results[1].id);
});

test("changed plans and aspect ratios cannot reuse a stale storyboard", async () => {
  await generateStoryboard(input, async () => success());
  await mutateProject((p) => {
    p.shots[0].revision++;
  });
  let saved = await getProject();
  assert.equal(currentStoryboard(saved, saved.shots[0]), undefined);
  await assert.rejects(
    submitShot(input.shotId, "stale-board", "768P", async () =>
      assert.fail("No H3 charge for a stale board"),
    ),
    /ready storyboard/,
  );
  const fresh = await generateStoryboard(input, async () => success());
  assert.equal(fresh.status, "ready");
  await mutateProject((p) => {
    p.campaign = { ...p.campaign, ratio: "9:16" } as NonNullable<
      typeof p.campaign
    >;
  });
  saved = await getProject();
  assert.equal(currentStoryboard(saved, saved.shots[0]), undefined);
});

test("provider access errors and malformed responses preserve the film without leaking provider bodies", async () => {
  const first = await generateStoryboard(input, async () =>
    Response.json({ base_resp: { status_code: 1008, status_msg: key } }),
  );
  assert.equal(first.status, "failed");
  assert.match(first.error!, /1008/);
  assert.ok(!first.error?.includes(key));
  const malformed = await generateStoryboard(
    { ...input, prompt: `${input.prompt} Wide angle.` },
    async () => Response.json({ base_resp: { status_code: 0 }, data: {} }),
  );
  assert.equal(malformed.status, "unknown");
  assert.equal((await getProject()).assets.length, 0);
  assert.equal((await getProject()).jobs.length, 0);
});
