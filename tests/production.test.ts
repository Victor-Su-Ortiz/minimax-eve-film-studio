import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { binary, videoKey } from "../lib/config";
import {
  socialUrl,
  socialMediaUrl,
  normalizeTweet,
  searchTrendVideos,
  importCampaignVideo,
  downloadSocialVideo,
} from "../lib/social";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { initialProject, sourceBasisInput } from "../lib/domain";
import { MAX_CAMPAIGN_REFERENCES } from "../lib/reference-limits";
import { getProject, mediaPath, mutateProject } from "../lib/store";
import {
  registerUpload,
  sampleAsset,
  probe,
  visualReferenceBytes,
  referenceContent,
} from "../lib/media";
import { loadBrandAssets, brandPath, brandSignature } from "../lib/brand";
import { setSoundtrack } from "../lib/soundtrack";
import {
  inspectTrendCandidate,
  recordTrendVisualMatch,
} from "../lib/trend-vision";
import { selectTrendPosts } from "../lib/trend-selection";
import { refreshJob, submitShot } from "../lib/renders";
import { saveShotPlan } from "../lib/shot-plan";
import { planUsesCurrentSources } from "../lib/domain";
import {
  assertProductionReference,
  chooseProductionReference,
  finishTakeSelection,
  inspectTakeAsset,
  recordTakeReview,
  selectReviewedTake,
} from "../lib/production";
import { GET, POST } from "../app/api/project/route";
import { GET as getMedia } from "../app/api/media/[id]/route";
import { assertLocalRequest } from "../lib/http";
import {
  dancingDogsExample,
  type CampaignAnalysisInput,
} from "../lib/campaign";
import {
  inspectCampaignReference,
  saveCampaignAnalysis,
  saveCampaignBrief,
} from "../lib/campaign-store";

let directory: string;
let fixture: Buffer;
const exec = promisify(execFile);
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "minimax-studio-test-"));
  process.env.STUDIO_DATA_DIR = directory;
  process.env.MINIMAX_VIDEO_API_KEY = "test-credential-never-sent-to-network";
  const file = path.join(directory, "fixture.mp4");
  await exec(binary("ffmpeg"), [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    file,
  ]);
  fixture = await readFile(file);
});
beforeEach(() => {
  // Existing tests cover the original manual studio as well as the new flow below.
  mutateProject((p) =>
    Object.assign(p, initialProject(), { production: { mode: "manual" } }),
  );
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://127.0.0.1:3000/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function socialTweet(
  id = "123",
  views: number | null = 12000,
  createdAt = new Date(Date.now() - 3_600_000).toISOString(),
) {
  return {
    id,
    author: { userName: "creator" },
    text: "A dancing dog",
    createdAt,
    viewCount: views,
    extendedEntities: {
      media: [
        {
          type: "video",
          media_url_https: "https://pbs.twimg.com/media/thumb.jpg",
          video_info: {
            duration_millis: 4000,
            variants: [
              {
                content_type: "video/mp4",
                bitrate: 1000000,
                url: "https://video.twimg.com/clip.mp4",
              },
            ],
          },
        },
      ],
    },
  };
}

test("social retrieval accepts only exact public post links and trusted media redirects", async () => {
  assert.equal(
    socialUrl("https://www.tiktok.com/@creator/video/123?share=1").url,
    "https://www.tiktok.com/@creator/video/123",
  );
  assert.equal(
    socialUrl("https://twitter.com/creator/status/456/video/1").id,
    "x:456",
  );
  for (const url of [
    "http://127.0.0.1:3000",
    "https://tiktok.com.evil.test/@a/video/123",
    "https://user:pass@x.com/a/status/123",
    "https://x.com/a/status/123/../../settings",
    "https://www.tiktok.com/@creator",
  ])
    assert.throws(() => socialUrl(url));
  assert.equal(
    socialMediaUrl("https://video.twimg.com.evil.test/clip.mp4"),
    undefined,
  );
  assert.equal(socialMediaUrl("file:///etc/passwd"), undefined);
  let calls = 0;
  await assert.rejects(
    () =>
      downloadSocialVideo("https://video.twimg.com/clip.mp4", async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        });
      }),
    /outside the allowed/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      downloadSocialVideo(
        "https://video.twimg.com/clip.mp4",
        async () =>
          new Response("x", {
            headers: { "content-length": String(33 * 1024 * 1024) },
          }),
      ),
    /32 MB/,
  );
});

test("trend search filters low and unknown views, ranks actual views and enforces the time window", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const unknown = normalizeTweet(
    socialTweet("123", null),
    new Date().toISOString(),
  )!;
  assert.equal(unknown.metrics.views, null);
  assert.equal(unknown.metrics.likes, null);
  const result = await searchTrendVideos(
    { query: "dancing dogs", days: 14 },
    async (url, init) => {
      assert.match(String(url), /filter%3Avideos/);
      assert.equal(init?.redirect, "error");
      return Response.json({
        tweets: [
          socialTweet("123", 100_001),
          socialTweet("456", 500_000),
          socialTweet("100", 100_000),
          socialTweet("101", 1_964),
          socialTweet("102", null),
          socialTweet("789", 999_999, "2020-01-01T00:00:00.000Z"),
          socialTweet(
            "999",
            999_999,
            new Date(Date.now() + 86_400_000).toISOString(),
          ),
          socialTweet("456", 500_000),
        ],
      });
    },
  );
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ["x:456", "x:123"],
  );
  assert.equal(getProject().trendSearches?.at(-1)?.status, "complete");
  const failed = await searchTrendVideos(
    { query: "dancing dogs" },
    async () => new Response(null, { status: 401 }),
  );
  assert.equal(failed.posts.length, 0);
  assert.equal(getProject().trendSearches?.at(-1)?.status, "failed");
});

test("trend search paginates past low-view results and stops on a repeated cursor", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  const result = await searchTrendVideos(
    { query: "dancing dogs" },
    async (url) => {
      const u = new URL(String(url));
      assert.match(
        u.searchParams.get("query")!,
        /since_time:\d+ until_time:\d+/,
      );
      assert.equal(u.searchParams.get("cursor"), calls ? "page-two" : "");
      calls++;
      return Response.json({
        tweets:
          calls === 1
            ? [socialTweet("123", 1_964)]
            : [socialTweet("456", 250_000)],
        has_next_page: true,
        next_cursor: "page-two",
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.pagesScanned, 2);
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ["x:456"],
  );
  assert.equal(
    getProject().socialPosts?.some((p) => p.id === "x:123"),
    false,
  );
});

test("trend search stays empty after three pages of low and unreported views", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  const result = await searchTrendVideos(
    { query: "dancing dogs" },
    async () => {
      calls++;
      return Response.json({
        tweets: [socialTweet("123", null), socialTweet("456", 100_000)],
        has_next_page: true,
        next_cursor: `page-${calls + 1}`,
      });
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(getProject().trendSearches?.at(-1)?.postIds, []);
});

test("later-page failure keeps qualifying evidence with an explicit partial-search warning", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  const result = await searchTrendVideos(
    { query: "dancing dogs" },
    async () => {
      calls++;
      return calls === 1
        ? Response.json({
            tweets: [socialTweet("123", 500_000)],
            has_next_page: true,
            next_cursor: "next",
          })
        : new Response(null, { status: 429 });
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ["x:123"],
  );
  assert.match(result.warning!, /stopped after 1 page.*429/);
  assert.equal(getProject().trendSearches?.at(-1)?.warning, result.warning);
});

test("keyword-free discovery can visually review a generic-caption video without changing the campaign", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const tweet = { ...socialTweet("123", 200_000), text: "Wait for it 😂" };
  let calls = 0;
  const provider: typeof fetch = async (url) => {
    calls++;
    if (String(url).includes("advanced_search")) {
      const query = new URL(String(url)).searchParams.get("query")!;
      assert.equal(query.startsWith("filter:videos"), true);
      assert.doesNotMatch(query, /test pattern|undefined|\(\)/);
    }
    return String(url).startsWith("https://api.twitterapi.io/")
      ? Response.json({ tweets: [tweet] })
      : new Response(new Uint8Array(fixture), {
          headers: { "content-type": "video/mp4" },
        });
  };
  const found = await searchTrendVideos(
    { query: "", visualTarget: "a changing test pattern", days: 30 },
    provider,
  );
  const searchId = found.searchId!;
  assert.equal(found.posts[0].text, "Wait for it 😂");
  const saved = getProject();
  const before = JSON.stringify({
    campaign: saved.campaign,
    shots: saved.shots,
    jobs: saved.jobs,
  });
  const match = {
    searchId,
    postId: "x:123",
    inspectionId: "fabricated",
    verdict: "matched" as const,
    reason: "Visible test-pattern changes across sampled frames.",
    evidence: [
      {
        seconds: 0.08,
        observation: "The first frame shows the generated test pattern.",
      },
      {
        seconds: 0.4,
        observation: "The second frame has a different moving pattern.",
      },
    ],
  };
  assert.throws(
    () => recordTrendVisualMatch(match),
    /Inspect this exact candidate/,
  );
  const inspected = await inspectTrendCandidate(
    { searchId, postId: "x:123" },
    provider,
  );
  assert.equal(inspected.error, undefined);
  assert.equal(inspected.seconds!.length, 8);
  assert.ok(Buffer.from(inspected.sheet!.data, "base64").length > 1000);
  const reviewed = getProject();
  assert.equal(
    JSON.stringify({
      campaign: reviewed.campaign,
      shots: reviewed.shots,
      jobs: reviewed.jobs,
    }),
    before,
  );
  assert.throws(
    () =>
      selectTrendPosts(reviewed.trendSearches!.at(-1)!, reviewed.socialPosts!, [
        "x:123",
      ]),
    /record a visual match/,
  );
  match.inspectionId = inspected.inspectionId;
  match.evidence = inspected.seconds!.slice(0, 2).map((seconds) => ({
    seconds,
    observation: "Visible colored test-pattern shapes at this sampled time.",
  }));
  assert.throws(
    () =>
      recordTrendVisualMatch({
        ...match,
        evidence: [
          {
            seconds: 100,
            observation: "Invented timestamp that was never inspected.",
          },
        ],
      }),
    /timestamps from this inspection/,
  );
  assert.throws(
    () =>
      recordTrendVisualMatch({
        ...match,
        evidence: [match.evidence[0], match.evidence[0]],
      }),
    /two distinct/,
  );
  assert.equal(recordTrendVisualMatch(match).status, "matched");
  const matched = getProject();
  assert.deepEqual(
    selectTrendPosts(matched.trendSearches!.at(-1)!, matched.socialPosts!, [
      "x:123",
    ]),
    ["x:123"],
  );
  assert.equal(calls, 3);
  const attached = await importCampaignVideo(found.posts[0].url, provider);
  assert.equal(attached.error, undefined);
  assert.equal(
    calls,
    3,
    "Selecting the inspected clip reuses its cached media",
  );
  assert.ok(getProject().campaign?.assetIds.includes(inspected.assetId!));
});

test("unavailable candidate footage records a failed visual check without creating a reference", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const found = await searchTrendVideos({ query: "dogs" }, async () =>
    Response.json({ tweets: [socialTweet("123", 200_000)] }),
  );
  const campaign = getProject().campaign;
  const result = await inspectTrendCandidate(
    { searchId: found.searchId!, postId: "x:123" },
    async (url) =>
      String(url).startsWith("https://api.twitterapi.io/")
        ? Response.json({ tweets: [socialTweet("123", 200_000)] })
        : new Response(null, { status: 403 }),
  );
  assert.match(result.error!, /403/);
  assert.equal(
    getProject().trendSearches!.at(-1)!.visualChecks![0].status,
    "failed",
  );
  assert.deepEqual(getProject().campaign, campaign);
});

test("an exact social video is saved, attributed, attached, inspected and reused without duplicate downloads", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  let calls = 0;
  const provider: typeof fetch = async (url) => {
    calls++;
    if (String(url).startsWith("https://api.twitterapi.io/"))
      return Response.json({ tweets: [socialTweet()] });
    return new Response(new Uint8Array(fixture), {
      headers: { "content-type": "video/mp4" },
    });
  };
  const result = await importCampaignVideo(
    "https://x.com/creator/status/123",
    provider,
  );
  assert.equal(result.post.importStatus, "imported");
  const asset = getProject().assets.find((a) => a.id === result.post.assetId)!;
  assert.equal(asset.origin, "social");
  assert.equal(asset.sourceUrl, "https://x.com/creator/status/123");
  assert.ok(asset.duration! >= 4);
  assert.deepEqual(getProject().campaign?.assetIds, [asset.id]);
  const inspected = await inspectCampaignReference(asset.id);
  assert.ok(inspected.frames.length >= 8);
  assert.ok(inspected.frames.every((f) => f.data.length > 100));
  const repeated = await importCampaignVideo(
    "https://x.com/creator/status/123",
    provider,
  );
  assert.equal(repeated.post.assetId, asset.id);
  assert.equal(calls, 2);
  assert.equal(getProject().assets.length, 1);
  assert.equal(getProject().jobs.length, 0);
});

test("an unavailable social video stays visibly unavailable with no fabricated asset", async () => {
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const result = await importCampaignVideo(
    "https://x.com/creator/status/123",
    async () => Response.json({ tweets: [socialTweet("999")] }),
  );
  assert.equal(result.post.importStatus, "unavailable");
  assert.equal(result.post.assetId, undefined);
  assert.equal(getProject().assets.length, 0);
  assert.equal(getProject().socialPosts?.[0].importStatus, "unavailable");
});

test("the agent reads newly added and rotated local keys despite a stale inherited environment", async () => {
  const before = {
    mode: process.env.NODE_ENV,
    root: process.env.STUDIO_PROJECT_DIR,
    key: process.env.MINIMAX_VIDEO_API_KEY,
    fallback: process.env.MINIMAX_API_KEY,
  };
  try {
    Object.assign(process.env, { NODE_ENV: "development" });
    process.env.STUDIO_PROJECT_DIR = directory;
    process.env.MINIMAX_VIDEO_API_KEY = "";
    delete process.env.MINIMAX_API_KEY;
    await writeFile(
      path.join(directory, ".env.local"),
      "MINIMAX_VIDEO_API_KEY=added-test-key\n",
    );
    assert.equal(videoKey(), "added-test-key");
    await writeFile(
      path.join(directory, ".env.local"),
      "MINIMAX_VIDEO_API_KEY=rotated-test-key\n",
    );
    assert.equal(videoKey(), "rotated-test-key");
    await writeFile(
      path.join(directory, ".env.local"),
      "MINIMAX_VIDEO_API_KEY=\n",
    );
    assert.equal(videoKey(), undefined);
  } finally {
    for (const [key, value] of Object.entries({
      NODE_ENV: before.mode,
      STUDIO_PROJECT_DIR: before.root,
      MINIMAX_VIDEO_API_KEY: before.key,
      MINIMAX_API_KEY: before.fallback,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("provider writes are deduplicated across concurrent and replayed calls", async () => {
  let calls = 0;
  const provider: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.method, "POST");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "MiniMax-H3");
    assert.equal(body.ratio, "16:9");
    assert.equal(body.content[0].type, "text");
    return Response.json({ task_id: "task_123" });
  };
  const [first, second] = await Promise.all([
    submitShot("shot_leap", "same-operation", "768P", provider),
    submitShot("shot_leap", "same-operation", "768P", provider),
  ]);
  assert.equal(first.id, second.id);
  const replay = await submitShot(
    "shot_leap",
    "same-operation",
    "768P",
    provider,
  );
  assert.equal(replay.taskId, "task_123");
  assert.equal(calls, 1);
});

test("the configured video model is sent directly to the existing MiniMax endpoint", async () => {
  const previous = process.env.MINIMAX_VIDEO_MODEL;
  // A fixture ID verifies forwarding; it is not an advertised provider model.
  process.env.MINIMAX_VIDEO_MODEL = "configured-h3-test-model";
  try {
    let calls = 0;
    const job = await submitShot(
      "shot_leap",
      "configured-model",
      "768P",
      async (url, init) => {
        calls++;
        assert.equal(String(url), "https://api.minimax.io/v2/video_generation");
        assert.equal(
          JSON.parse(init!.body as string).model,
          "configured-h3-test-model",
        );
        return Response.json({ task_id: "configured-model-task" });
      },
    );
    assert.equal(calls, 1);
    assert.equal(job.taskId, "configured-model-task");
  } finally {
    if (previous === undefined) delete process.env.MINIMAX_VIDEO_MODEL;
    else process.env.MINIMAX_VIDEO_MODEL = previous;
  }
});

test("campaign format reaches the H3 request and stays attached to its job", async () => {
  saveCampaignBrief(dancingDogsExample());
  const provider: typeof fetch = async (_url, init) => {
    assert.equal(JSON.parse(init!.body as string).ratio, "9:16");
    return Response.json({ task_id: "portrait_task" });
  };
  const job = await submitShot(
    "shot_leap",
    "portrait-operation",
    "768P",
    provider,
  );
  assert.equal(job.ratio, "9:16");
  saveCampaignBrief({ ...dancingDogsExample(), ratio: "16:9" });
  assert.equal(getProject().jobs[0].ratio, "9:16");
});

test("one natural-language prompt persists with references and retries do not duplicate it", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "my-reference.mp4", {
      type: "video/mp4",
    }),
  );
  const body = {
    action: "prompt",
    id: "7ec05040-e140-438c-b9b3-a7ef1fbbbf02",
    text: "Use this reference to make a cinematic MiniMax launch. You choose the direction.",
    assetIds: [asset.id],
  };
  assert.equal((await post(body)).status, 200);
  assert.equal((await post(body)).status, 200);
  const p = getProject();
  assert.equal(p.requests?.length, 1);
  assert.equal(p.requests[0].text, body.text);
  assert.deepEqual(p.requests[0].assetIds, [asset.id]);
  assert.equal(p.brief, body.text);
  assert.equal(
    (
      await post({
        ...body,
        id: "e486a976-9b28-4bc2-a42a-34bcf0ea3a54",
        text: "Make the ending more surprising.",
      })
    ).status,
    200,
  );
  assert.equal(getProject().requests?.length, 2);
  assert.equal(
    getProject().brief,
    body.text,
    "Follow-up notes must not replace the original brief",
  );
  assert.equal(
    (
      await post({
        ...body,
        id: "73683778-5f17-4a31-9dd9-a9b16c642eae",
        assetIds: ["not-in-this-project"],
      })
    ).status,
    400,
  );
  assert.equal(getProject().requests?.length, 2);
});

function analysisInput(sourceRevision: number): CampaignAnalysisInput {
  return {
    sourceRevision,
    hook: "Proposed unexpected pet entrance",
    visualPattern: "Proposed repeated pose",
    pacing: "Proposed escalation, not measured source timing",
    payoff: "A MiniMax title reveal",
    loop: "Return to the opening pose",
    audioPlan:
      "New original rhythmic soundtrack; source audio has not been inspected",
    launchAngle: "An idea becomes an original production",
    observations: [],
    hypotheses: ["An unexpected lead may invite a second watch"],
    keep: ["A repeatable visual motif"],
    change: ["New characters and setting"],
    beats: [
      { start: 0, end: 5, label: "Hook", adaptation: "An unexpected lead" },
      { start: 5, end: 15, label: "Escalation", adaptation: "A new world" },
      { start: 15, end: 30, label: "Reveal", adaptation: "An authored title" },
    ],
  };
}

test("campaign notes persist, uninspected claims fail, and revisions invalidate old analysis", async () => {
  const response = await post({
    action: "campaign",
    campaign: dancingDogsExample(),
  });
  assert.equal(response.status, 200);
  const revision = getProject().campaign!.revision;
  const analysis = saveCampaignAnalysis(analysisInput(revision));
  assert.equal(analysis.basis, "notes_only");
  assert.equal(getProject().campaignAnalyses!.length, 1);
  assert.throws(
    () =>
      saveCampaignAnalysis({
        ...analysisInput(revision),
        observations: [
          { assetId: "invented", seconds: 1, detail: "Not inspected" },
        ],
      }),
    /must cite a timestamp/,
  );
  saveCampaignBrief({
    ...dancingDogsExample(),
    notes: "A changed source description",
  });
  assert.throws(
    () => saveCampaignAnalysis(analysisInput(revision)),
    /reference changed/,
  );
  const unsafe = await post({
    action: "campaign",
    campaign: { ...dancingDogsExample(), urls: ["javascript:alert(1)"] },
  });
  assert.equal(unsafe.status, 400);
});

test("campaign visual observations require real frames from the saved reference revision", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "campaign.mp4", { type: "video/mp4" }),
  );
  const campaign = saveCampaignBrief({
    ...dancingDogsExample(),
    assetIds: [asset.id],
  });
  const inspected = await inspectCampaignReference(asset.id);
  assert.ok(inspected.frames.length >= 10);
  assert.equal(inspected.frames[0].seconds, 0);
  const observation = {
    assetId: asset.id,
    seconds: inspected.frames[0].seconds,
    detail: "The sampled frame shows the test-only color pattern",
  };
  const result = saveCampaignAnalysis({
    ...analysisInput(campaign.revision),
    observations: [observation],
  });
  assert.equal(result.basis, "sampled_frames");
  assert.throws(
    () =>
      saveCampaignAnalysis({
        ...analysisInput(campaign.revision),
        observations: [{ ...observation, seconds: 300 }],
      }),
    /must cite a timestamp/,
  );
});

test("a source change blocks stale renders and carries inspected influence plus video into H3", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "source.mp4", { type: "video/mp4" }),
  );
  const campaign = saveCampaignBrief({
    ...dancingDogsExample(),
    assetIds: [asset.id],
  });
  const inspection = await inspectCampaignReference(asset.id);
  const input = {
    ...analysisInput(campaign.revision),
    observations: [
      {
        assetId: asset.id,
        seconds: inspection.frames[0].seconds,
        detail: "The reference has a colorful foreground pattern.",
      },
    ],
  };
  const analysis = saveCampaignAnalysis(input);
  let calls = 0;
  const adaptation =
    "Keep the source's colorful foreground composition, translated into an original film set.";
  const provider: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    assert.ok(body.content[0].text.includes(adaptation));
    assert.equal(body.content[1].type, "video_url");
    assert.equal(body.content[1].role, "reference_video");
    const visualPath = path.join(directory, "submitted-visual-reference.mp4");
    const visualBytes = Buffer.from(
      body.content[1].video_url.url.split(",")[1],
      "base64",
    );
    await writeFile(visualPath, visualBytes);
    assert.equal((await probe(visualPath)).hasAudio, false);
    assert.equal((await probe(mediaPath(asset.id))).hasAudio, true);
    assert.deepEqual(await readFile(mediaPath(asset.id)), fixture);
    const videoHash = async (file: string) =>
      (
        await exec(binary("ffmpeg"), [
          "-v",
          "error",
          "-i",
          file,
          "-map",
          "0:v:0",
          "-c:v",
          "copy",
          "-f",
          "hash",
          "-hash",
          "sha256",
          "-",
        ])
      ).stdout;
    assert.equal(
      await videoHash(visualPath),
      await videoHash(mediaPath(asset.id)),
    );
    return Response.json({ task_id: "source_based_task" });
  };
  await assert.rejects(
    submitShot("shot_leap", "stale-source", "768P", provider),
    /predates the current reference/,
  );
  assert.equal(calls, 0);
  const plan = saveShotPlan({
    ...getProject().shots[1],
    prompt: "A colorful film set, a foreground performer, and a steady camera.",
    referenceIds: [asset.id],
    sourceBasis: { analysisId: analysis.id, assetIds: [asset.id], adaptation },
  });
  assert.equal(planUsesCurrentSources(getProject(), plan), true);
  const job = await submitShot(plan.id, "source-based", "768P", provider);
  assert.deepEqual(job.sourceBasis, plan.sourceBasis);
  assert.deepEqual(job.referenceIds, [asset.id]);
  assert.equal(job.shotTitle, plan.title);
  saveCampaignAnalysis(input);
  assert.equal(planUsesCurrentSources(getProject(), plan), false);
  await assert.rejects(
    submitShot(plan.id, "new-analysis", "768P", provider),
    /predates the current reference/,
  );
  assert.throws(() => saveShotPlan(plan), /latest campaign analysis/);
  assert.equal(calls, 1);
  assert.equal(getProject().jobs[0].sourceBasis?.analysisId, analysis.id);
});

test("unchanged source frames remain usable after adding another reference without making old plans current", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "first.mp4", { type: "video/mp4" }),
  );
  const second = await registerUpload(
    new File([new Uint8Array(fixture)], "second.mp4", { type: "video/mp4" }),
  );
  const campaign = saveCampaignBrief({
    ...dancingDogsExample(),
    assetIds: [asset.id],
  });
  const inspected = await inspectCampaignReference(asset.id);
  const observation = {
    assetId: asset.id,
    seconds: inspected.frames[0].seconds,
    detail: "The sampled color pattern remains byte-identical.",
  };
  const original = saveCampaignAnalysis({
    ...analysisInput(campaign.revision),
    observations: [observation],
  });
  const plan = saveShotPlan({
    ...getProject().shots[1],
    sourceBasis: {
      analysisId: original.id,
      assetIds: [asset.id],
      adaptation:
        "Use the observed color arrangement to compose the foreground.",
    },
  });
  const updated = saveCampaignBrief({
    ...campaign,
    assetIds: [asset.id, second.id],
  });
  assert.equal(planUsesCurrentSources(getProject(), plan), false);
  assert.equal(
    getProject().campaignInspections?.[0].sourceRevision,
    updated.revision,
  );
  const current = saveCampaignAnalysis({
    ...analysisInput(updated.revision),
    observations: [observation],
  });
  assert.equal(current.basis, "sampled_frames");
  assert.throws(
    () =>
      saveCampaignAnalysis({
        ...analysisInput(updated.revision),
        observations: [{ ...observation, assetId: second.id }],
      }),
    /must cite a timestamp/,
  );
});

test("an ambiguous response is preserved and a new operation cannot charge again", async () => {
  let calls = 0;
  const provider: typeof fetch = async () => {
    calls++;
    throw new Error("connection reset after submit");
  };
  const first = await submitShot(
    "shot_leap",
    "lost-response",
    "768P",
    provider,
  );
  assert.equal(first.status, "unknown");
  assert.equal(
    (await submitShot("shot_leap", "lost-response", "768P", provider)).id,
    first.id,
  );
  await assert.rejects(
    submitShot("shot_leap", "new-operation", "768P", provider),
    /pending or uncertain/,
  );
  assert.equal(calls, 1);
});

test("locked shots cannot be replanned, reassigned or rendered", async () => {
  mutateProject((p) => {
    p.shots[1].locked = true;
  });
  let calls = 0;
  const provider: typeof fetch = async () => {
    calls++;
    return Response.json({ task_id: "bad" });
  };
  await assert.rejects(
    submitShot("shot_leap", "locked-operation", "768P", provider),
    /locked/,
  );
  const response = await post({
    action: "shot",
    shot: {
      ...getProject().shots[1],
      prompt: "Try to overwrite accepted footage",
    },
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.notEqual(
    getProject().shots[1].prompt,
    "Try to overwrite accepted footage",
  );
});

test("successful H3 output creates a candidate and preserves accepted footage and other shots", async () => {
  const uploaded = await registerUpload(
    new File([new Uint8Array(fixture)], "source.mp4", { type: "video/mp4" }),
  );
  mutateProject((p) => {
    p.shots[1].takes.push({
      id: "previous-take",
      assetId: uploaded.id,
      prompt: "old prompt",
      createdAt: new Date().toISOString(),
    });
    p.shots[1].acceptedTakeId = "previous-take";
  });
  const unchanged = getProject().shots.filter((s) => s.id !== "shot_leap");
  const provider: typeof fetch = async (url) => {
    if (String(url).includes("/query/"))
      return Response.json({
        task: {
          id: "task_success",
          status: "succeeded",
          content: { url: "https://media.example.test/generated.mp4" },
        },
      });
    if (String(url).includes("media.example.test"))
      return new Response(new Uint8Array(fixture), {
        headers: { "Content-Type": "video/mp4" },
      });
    return Response.json({ task_id: "task_success" });
  };
  const job = await submitShot(
    "shot_leap",
    "successful-operation",
    "768P",
    provider,
  );
  const ready = await refreshJob(job.id, provider);
  assert.equal(ready.status, "succeeded");
  assert.ok(ready.assetId);
  const p = getProject();
  assert.equal(p.shots[1].takes.length, 2);
  assert.equal(p.shots[1].acceptedTakeId, "previous-take");
  assert.deepEqual(
    p.shots.filter((s) => s.id !== "shot_leap"),
    unchanged,
  );
  assert.ok((await readFile(mediaPath(ready.assetId!))).equals(fixture));
  await refreshJob(job.id, provider);
  assert.equal(getProject().shots[1].takes.length, 2);
});

test("uploaded media is validated and visual review returns four real frames", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "source.mp4", { type: "video/mp4" }),
  );
  assert.equal(asset.width, 640);
  assert.equal(asset.height, 360);
  assert.ok(Math.abs(asset.duration! - 4) < 0.2);
  const sampled = await sampleAsset(asset.id);
  assert.equal(sampled.frames.length, 4);
  assert.ok(
    sampled.frames.every(
      (frame) => Buffer.from(frame.data, "base64").length > 1000,
    ),
  );
  await assert.rejects(
    registerUpload(new File(["not a movie"], "bad.mp4", { type: "video/mp4" })),
  );
  assert.equal(getProject().assets.length, 1);
});

test("Figma artwork is a real H3 image reference without changing campaign evidence or takes", async () => {
  const before = getProject();
  const kit = await loadBrandAssets();
  const afterLoad = getProject();
  assert.deepEqual(afterLoad.campaign, before.campaign);
  assert.deepEqual(afterLoad.shots, before.shots);
  assert.deepEqual(afterLoad.jobs, before.jobs);
  assert.equal(afterLoad.assets.filter((a) => a.origin === "brand").length, 1);
  const bytes = await readFile(brandPath("background"));
  assert.deepEqual(await readFile(mediaPath(kit.reference.assetId)), bytes);
  const references = await referenceContent([kit.reference.assetId]);
  assert.match(JSON.stringify(references), /image_url/);
  assert.ok(JSON.stringify(references).includes(bytes.toString("base64")));
  assert.ok(Buffer.from(kit.preview.data, "base64").length < 3 * 1024 * 1024);
  await loadBrandAssets();
  assert.deepEqual(getProject(), afterLoad, "Reloading the kit is idempotent");
});

test("ten references pass the prompt API and campaign save; an eleventh cannot replace the campaign", async () => {
  const assets: Awaited<ReturnType<typeof registerUpload>>[] = [];
  for (let i = 0; i <= MAX_CAMPAIGN_REFERENCES; i++) {
    assets.push(
      await registerUpload(
        new File([new Uint8Array(fixture)], `reference-${i}.mp4`, {
          type: "video/mp4",
        }),
      ),
    );
  }
  const assetIds = assets.slice(0, MAX_CAMPAIGN_REFERENCES).map((a) => a.id);
  const request = {
    action: "prompt",
    id: "12345678-1234-4123-8123-123456789abc",
    text: "Create a launch film using these references.",
    assetIds,
  };
  assert.equal((await post(request)).status, 200);
  assert.deepEqual(getProject().requests!.at(-1)!.assetIds, assetIds);
  assert.equal(
    (await post({ ...request, assetIds: assets.map((a) => a.id) })).status,
    400,
  );

  const saved = saveCampaignBrief({
    ...dancingDogsExample(),
    urls: assetIds.map((_, i) => `https://x.com/creator/status/${i + 1}`),
    assetIds,
  });
  assert.deepEqual(saved.assetIds, assetIds);
  assert.equal(saved.urls.length, MAX_CAMPAIGN_REFERENCES);
  assert.doesNotThrow(() =>
    sourceBasisInput.parse({
      analysisId: "current-analysis",
      assetIds,
      adaptation:
        "Use the observed lighting and staging across the source set.",
    }),
  );
  assert.throws(
    () => saveCampaignBrief({ ...saved, assetIds: assets.map((a) => a.id) }),
    /at most 10/,
  );
  assert.deepEqual(getProject().campaign, saved);
  // Research capacity does not change the provider's per-shot media limits.
  await assert.rejects(
    () => referenceContent(assetIds.slice(0, 4)),
    /H3 allows/,
  );
});

test("a social import can fill the tenth campaign source slot", async () => {
  const assetIds: string[] = [];
  for (let i = 0; i < MAX_CAMPAIGN_REFERENCES - 1; i++) {
    const asset = await registerUpload(
      new File([new Uint8Array(fixture)], `reference-${i}.mp4`, {
        type: "video/mp4",
      }),
    );
    assetIds.push(asset.id);
  }
  saveCampaignBrief({ ...dancingDogsExample(), urls: [], assetIds });
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const imported = await importCampaignVideo(
    "https://x.com/creator/status/123",
    async (url) =>
      String(url).includes("api.twitterapi.io")
        ? Response.json({ tweets: [socialTweet("123", 200_000)] })
        : new Response(new Uint8Array(fixture), {
            headers: { "content-type": "video/mp4" },
          }),
  );
  assert.equal(imported.error, undefined);
  assert.equal(getProject().campaign!.assetIds.length, MAX_CAMPAIGN_REFERENCES);
  assert.ok(
    assetIds.every((id) => getProject().campaign!.assetIds.includes(id)),
  );
  const source = getProject().socialPosts!.find((p) => p.id === "x:123")!;
  const inspection = await inspectCampaignReference(source.assetId!);
  assert.ok(inspection.frames.length > 0);
});

test("three uploaded brand assets do not prevent importing and inspecting a chosen scout video", async () => {
  const brands: string[] = [];
  for (const [index, role] of ["wordmark", "lockup", "background"].entries()) {
    const bytes = await readFile(
      brandPath(role as "wordmark" | "lockup" | "background"),
    );
    const asset = await registerUpload(
      new File([new Uint8Array(bytes)], `renamed-${index}.png`, {
        type: "image/png",
      }),
    );
    assert.equal(
      asset.origin,
      "brand",
      "Recognition must use content, not the filename",
    );
    brands.push(asset.id);
  }
  // Reproduce a campaign created before brand upload classification existed.
  mutateProject((p) => {
    for (const asset of p.assets) asset.origin = "upload";
    p.campaign = {
      ...dancingDogsExample(),
      urls: [],
      assetIds: brands,
      revision: 1,
    };
  });
  const beforeShots = getProject().shots;
  process.env.TWITTERAPI_IO_API_KEY = "test-only-not-a-real-key";
  const imported = await importCampaignVideo(
    "https://x.com/creator/status/123",
    async (url) =>
      String(url).includes("api.twitterapi.io")
        ? Response.json({ tweets: [socialTweet("123", 200_000)] })
        : new Response(new Uint8Array(fixture), {
            headers: { "content-type": "video/mp4" },
          }),
  );
  assert.equal(imported.error, undefined);
  const chosen = getProject().socialPosts!.find((p) => p.id === "x:123")!;
  assert.deepEqual(getProject().campaign!.assetIds, [chosen.assetId]);
  assert.equal(
    getProject().assets.filter((a) => a.origin === "brand").length,
    3,
  );
  const inspected = await inspectCampaignReference(chosen.assetId!);
  assert.ok(
    inspected.frames.length > 0,
    "The chosen source must actually reach analysis",
  );
  const campaign = getProject().campaign!;
  const saved = saveCampaignBrief({
    ...campaign,
    assetIds: [...brands, chosen.assetId!],
  });
  assert.deepEqual(saved.assetIds, [chosen.assetId]);
  assert.deepEqual(
    getProject().shots,
    beforeShots,
    "Selection must preserve shot plans and takes",
  );
  await importCampaignVideo(chosen.url, async () =>
    assert.fail("Reuse the cached video"),
  );
  assert.equal(getProject().campaign!.revision, saved.revision);
});

test("briefs persist, an actual MP4 exports, and range requests support playback", async () => {
  const saved = await post({
    action: "brief",
    brief: "A verified launch brief.",
  });
  assert.equal(saved.status, 200);
  assert.equal(getProject().brief, "A verified launch brief.");
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "source.mp4", { type: "video/mp4" }),
  );
  for (const shot of getProject().shots) {
    assert.equal(
      (await post({ action: "shot", shot: { ...shot, duration: 4 } })).status,
      200,
    );
    if (shot.kind !== "title")
      assert.equal(
        (await post({ action: "assign", shotId: shot.id, assetId: asset.id }))
          .status,
        200,
      );
  }
  const exported = await post({ action: "export" });
  assert.equal(
    exported.status,
    200,
    JSON.stringify(await exported.clone().json()),
  );
  const { cut } = await exported.json();
  assert.equal(cut.branding.signature, await brandSignature());
  assert.equal(cut.branding.name, "MiniMax M3.1 Flash");
  assert.equal(cut.audioCheck.sourceClipAudioIncluded, false);
  assert.equal(cut.audioCheck.method, "synthesized-instruments");
  const { probe } = await import("../lib/media");
  const metadata = await probe(mediaPath(cut.assetId));
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.equal(metadata.hasAudio, true);
  assert.ok(Math.abs(metadata.duration! - 16) < 0.2);
  const duplicate = await post({ action: "export" });
  assert.equal((await duplicate.json()).cut.id, cut.id);
  await setSoundtrack({ mode: "silent", mood: "cinematic", tempo: 112 });
  const silentCut = (await (await post({ action: "export" })).json()).cut;
  assert.notEqual(
    silentCut.id,
    cut.id,
    "Audio policy must invalidate a cached export",
  );
  assert.equal((await probe(mediaPath(silentCut.assetId))).hasAudio, false);
  const videoHash = async (file: string) =>
    (
      await exec(binary("ffmpeg"), [
        "-v",
        "error",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-f",
        "hash",
        "-hash",
        "sha256",
        "-",
      ])
    ).stdout;
  assert.equal(
    await videoHash(mediaPath(silentCut.assetId)),
    await videoHash(mediaPath(cut.assetId)),
    "An audio-only repair must preserve every encoded video packet",
  );
  await setSoundtrack({ mode: "instrumental", mood: "cinematic", tempo: 112 });
  await post({ action: "campaign", campaign: dancingDogsExample() });
  const portrait = await post({ action: "export" });
  assert.equal(portrait.status, 200);
  const portraitCut = (await portrait.json()).cut;
  assert.notEqual(portraitCut.id, cut.id);
  const portraitMetadata = await probe(mediaPath(portraitCut.assetId));
  assert.equal(portraitMetadata.width, 1080);
  assert.equal(portraitMetadata.height, 1920);
  assert.equal(getProject().cuts.length, 3);
  const range = await getMedia(
    new Request(`http://127.0.0.1:3000/api/media/${cut.assetId}`, {
      headers: { range: "bytes=0-99" },
    }),
    { params: Promise.resolve({ id: cut.assetId }) },
  );
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
});

test("source soundtrack uses the original recording once unless looping is explicitly selected", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "original.mp4", { type: "video/mp4" }),
  );
  mutateProject((p) => {
    p.shots = [p.shots[0], p.shots[3]].map((s) => ({ ...s, duration: 4 }));
  });
  await post({ action: "assign", shotId: "shot_brief", assetId: asset.id });
  const sourceSettings = {
    mode: "source" as const,
    sourceAssetId: asset.id,
    mood: "cinematic" as const,
    tempo: 112,
  };
  await setSoundtrack(sourceSettings);
  assert.equal(getProject().soundtrack?.playback, "once");
  const onceResponse = await post({ action: "export" });
  assert.equal(
    onceResponse.status,
    200,
    JSON.stringify(await onceResponse.clone().json()),
  );
  const once = (await onceResponse.json()).cut;
  assert.equal(once.audioCheck.method, "source-audio");
  assert.equal(once.audioCheck.sourceClipAudioIncluded, true);
  assert.equal(once.audioCheck.generatedClipAudioIncluded, false);
  assert.equal(once.audioCheck.sourceAssetId, asset.id);
  assert.equal(once.audioCheck.playback, "once");
  const rms = async (id: string, at: number) => {
    const { stdout } = await exec(
      binary("ffmpeg"),
      [
        "-v",
        "error",
        "-i",
        mediaPath(id),
        "-ss",
        String(at),
        "-t",
        "0.3",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "-",
      ],
      { encoding: "buffer" },
    );
    let sum = 0;
    for (let i = 0; i < stdout.length; i += 2)
      sum += stdout.readInt16LE(i) ** 2;
    return Math.sqrt(sum / (stdout.length / 2));
  };
  const originalLevel = await rms(asset.id, 1);
  const onceLevel = await rms(once.assetId, 1);
  assert.ok(
    onceLevel / originalLevel > 0.9 && onceLevel / originalLevel < 1.1,
    `The source recording should retain its level, not become synthesized music (${onceLevel} vs ${originalLevel})`,
  );
  assert.ok(
    (await rms(once.assetId, 5)) < 1,
    "Once mode must not repeat the original recording",
  );
  await setSoundtrack({ ...sourceSettings, playback: "loop" });
  const loopResponse = await post({ action: "export" });
  assert.equal(loopResponse.status, 200);
  const loop = (await loopResponse.json()).cut;
  assert.notEqual(loop.id, once.id);
  assert.equal(loop.audioCheck.playback, "loop");
  assert.ok(
    (await rms(loop.assetId, 5)) > 1000,
    "Explicit loop should continue the original audio",
  );
  assert.equal(loop.visualSignature, once.visualSignature);
  await setSoundtrack({ ...sourceSettings, fit: "match-source" });
  const shortResponse = await post({ action: "export" });
  assert.equal(
    shortResponse.status,
    200,
    JSON.stringify(await shortResponse.clone().json()),
  );
  const short = (await shortResponse.json()).cut;
  assert.equal(short.audioCheck.fit, "match-source");
  assert.equal(short.audioCheck.playback, "once");
  assert.equal(
    short.edit.length,
    2,
    "Keep both the footage scene and title card",
  );
  assert.ok(
    Math.abs((await probe(mediaPath(short.assetId))).duration! - 4) < 0.1,
  );
  assert.equal(
    getProject().shots.reduce((n, s) => n + s.duration, 0),
    8,
    "Source-length exports preserve accepted shot plans",
  );
  await assert.rejects(
    setSoundtrack({ ...sourceSettings, fit: "match-source", playback: "loop" }),
    /plays the original audio once/,
  );
  assert.deepEqual(
    await readFile(mediaPath(asset.id)),
    fixture,
    "Original source must remain intact",
  );

  const silentBytes = await visualReferenceBytes(mediaPath(asset.id));
  const silentAsset = await registerUpload(
    new File([new Uint8Array(silentBytes)], "no-audio.mp4", {
      type: "video/mp4",
    }),
  );
  await assert.rejects(
    setSoundtrack({ ...sourceSettings, sourceAssetId: silentAsset.id }),
    /no usable audio/,
  );
  await assert.rejects(
    setSoundtrack({ ...sourceSettings, sourceAssetId: loop.assetId }),
    /imported original/,
  );
  assert.equal(
    getProject().soundtrack?.sourceAssetId,
    asset.id,
    "Invalid source must not replace the selected soundtrack",
  );
});

test("private API rejects cross-origin reads", async () => {
  const response = await GET(
    new Request("http://127.0.0.1:3000/api/project", {
      headers: { origin: "https://unrelated.example" },
    }),
  );
  assert.equal(response.status, 403);
});

test("browser saves accept Next.js loopback hostname normalization", () => {
  assert.doesNotThrow(() =>
    assertLocalRequest(
      new Request("http://localhost:3000/api/project", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  );
  assert.throws(
    () =>
      assertLocalRequest(
        new Request("http://localhost:3000/api/project", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:4000" },
        }),
      ),
    /Cross-origin/,
  );
});

test("starting from blank archives the old campaign and media, and rejects stale or unresolved resets", async () => {
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "kept.mp4", { type: "video/mp4" }),
  );
  mutateProject((p) => {
    p.sessionId = "previous-session";
    p.requests = [
      {
        id: "previous-request",
        text: "Old campaign",
        assetIds: [asset.id],
        createdAt: new Date().toISOString(),
      },
    ];
    p.shots[0].takes = [
      {
        id: "accepted",
        assetId: asset.id,
        prompt: "Old take",
        createdAt: new Date().toISOString(),
      },
    ];
    p.shots[0].acceptedTakeId = "accepted";
    p.shots[0].locked = true;
  });
  const old = getProject();
  assert.equal(
    (await post({ action: "new-campaign", expectedUpdatedAt: "stale" })).status,
    400,
  );
  const response = await post({
    action: "new-campaign",
    expectedUpdatedAt: old.updatedAt,
  });
  assert.equal(response.status, 200);
  const fresh = getProject();
  assert.equal(fresh.brief, "");
  assert.equal(fresh.sessionId, undefined);
  assert.deepEqual(fresh.requests, []);
  assert.deepEqual(fresh.assets, []);
  assert.ok(
    fresh.shots.every((s) => s.takes.length === 0 && !s.locked && !s.prompt),
  );
  const archivedDb = new DatabaseSync(path.join(directory, "studio.sqlite"), {
    readOnly: true,
  });
  const archived = archivedDb
    .prepare(
      "SELECT document FROM campaign_archives ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { document: string };
  assert.deepEqual(JSON.parse(archived.document), old);
  archivedDb.close();
  assert.ok((await readFile(mediaPath(asset.id))).equals(fixture));
  mutateProject((p) =>
    p.jobs.push({
      id: "uncertain",
      requestKey: "uncertain",
      shotId: "shot_brief",
      shotRevision: 0,
      prompt: "Pending",
      referenceIds: [],
      duration: 5,
      resolution: "768P",
      status: "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  assert.equal(
    (
      await post({
        action: "new-campaign",
        expectedUpdatedAt: getProject().updatedAt,
      })
    ).status,
    400,
  );
  assert.equal(getProject().jobs[0].id, "uncertain");
});

async function prepareAutomaticProduction() {
  const source = await registerUpload(
    new File([new Uint8Array(fixture)], "chosen-source.mp4", {
      type: "video/mp4",
    }),
  );
  const chosen = await post({
    action: "prompt",
    id: crypto.randomUUID(),
    text: "Create the entire launch film from this video.",
    assetIds: [source.id],
  });
  assert.equal(chosen.status, 200);
  const campaign = saveCampaignBrief({
    ...dancingDogsExample(),
    assetIds: [source.id],
  });
  const inspection = await inspectCampaignReference(source.id);
  const analysis = saveCampaignAnalysis({
    ...analysisInput(campaign.revision),
    observations: [
      {
        assetId: source.id,
        seconds: inspection.frames[0].seconds,
        detail: "Colorful shapes fill the real source frame.",
      },
    ],
  });
  for (const shot of getProject().shots) {
    saveShotPlan({
      ...shot,
      duration: 4,
      kind: shot.kind === "title" ? "title" : "generated",
      prompt:
        shot.kind === "title"
          ? ""
          : "A space bunny walks through a colorful scene. No text or logos.",
      sourceBasis:
        shot.kind === "title"
          ? undefined
          : {
              analysisId: analysis.id,
              assetIds: [source.id],
              adaptation:
                "Adapt the source's colorful foreground into the bunny's space station.",
            },
    });
  }
  return source;
}

function successfulVideoProvider() {
  let submissions = 0;
  const fetcher: typeof fetch = async (url) => {
    if (String(url).includes("/query/"))
      return Response.json({
        task: {
          id: new URL(String(url)).pathname.split("/").at(-1),
          status: "succeeded",
          content: { url: "https://media.example.test/generated.mp4" },
        },
      });
    if (String(url).includes("media.example.test"))
      return new Response(new Uint8Array(fixture), {
        headers: { "Content-Type": "video/mp4" },
      });
    submissions++;
    return Response.json({ task_id: `automatic_${submissions}` });
  };
  return { fetcher, submissions: () => submissions };
}

async function reviewCompletedTake(
  jobId: string,
  verdict: "use" | "revise" | "unusable" = "use",
) {
  const job = getProject().jobs.find((j) => j.id === jobId)!;
  const inspection = await inspectTakeAsset(job.assetId!);
  return recordTakeReview({
    jobId,
    inspectionId: inspection.inspectionId!,
    verdict,
    summary:
      "Visible framing and colors suit the planned scene; audio has not been reviewed.",
    observations: inspection.frames.slice(0, 2).map((f) => ({
      seconds: f.seconds,
      note: "The actual sampled frame contains a colorful pattern.",
    })),
  });
}

test("automatic production waits for the human reference choice, not a scout import", async () => {
  assert.equal(initialProject().production?.mode, "automatic");
  mutateProject((p) => {
    p.production = { mode: "automatic" };
  });
  const source = await registerUpload(
    new File([new Uint8Array(fixture)], "scouted.mp4", { type: "video/mp4" }),
  );
  saveCampaignBrief({ ...dancingDogsExample(), assetIds: [source.id] });
  assert.throws(
    () => assertProductionReference(getProject()),
    /user to choose/,
  );
  await assert.rejects(
    submitShot("shot_leap", "before-choice", "768P", async () =>
      assert.fail("Must not call H3 before choice"),
    ),
    /user to choose/,
  );
  const url = "https://x.com/creator/status/123";
  assert.equal(
    (
      await post({
        action: "prompt",
        id: crypto.randomUUID(),
        text: `Use this reference: ${url}`,
        assetIds: [],
        referenceUrl: url,
      })
    ).status,
    200,
  );
  assert.equal(getProject().production?.reference?.url, url);
  assert.throws(
    () => assertProductionReference(getProject()),
    /Import the user's selected/,
  );
  mutateProject((p) => {
    p.assets.find((a) => a.id === source.id)!.sourceUrl = url;
  });
  assert.doesNotThrow(() => assertProductionReference(getProject()));
  const productionId = getProject().production?.id;
  assert.equal(
    (
      await post({
        action: "prompt",
        id: crypto.randomUUID(),
        text: `Continue with ${url}`,
        assetIds: [],
      })
    ).status,
    200,
  );
  assert.equal(
    getProject().production?.id,
    productionId,
    "The same choice must not reset the retry allowance",
  );
});

test("one reference choice runs all reviewed takes through an automatic branded MP4 export without acceptance calls", async () => {
  await prepareAutomaticProduction();
  const provider = successfulVideoProvider();
  const scenes = getProject().shots.filter((s) => s.kind === "generated");
  let exported;
  for (const [index, scene] of scenes.entries()) {
    const submitted = await submitShot(
      scene.id,
      `automatic-${scene.id}`,
      "768P",
      provider.fetcher,
    );
    const ready = await refreshJob(submitted.id, provider.fetcher);
    assert.equal(ready.status, "succeeded");
    assert.throws(() => selectReviewedTake(ready.id), /reviewer must inspect/);
    assert.throws(
      () =>
        recordTakeReview({
          jobId: ready.id,
          inspectionId: "fabricated",
          verdict: "use",
          summary: "A fabricated review must not pass.",
          observations: [
            { seconds: 0, note: "Not inspected" },
            { seconds: 1, note: "Not inspected" },
          ],
        }),
      /Inspect this completed/,
    );
    await reviewCompletedTake(ready.id);
    const result = await finishTakeSelection(ready.id);
    assert.equal(result.remainingShots.length, scenes.length - index - 1);
    assert.equal(result.shot.locked, true);
    if (result.cut) exported = result.cut;
  }
  assert.equal(provider.submissions(), 3);
  assert.ok(exported, "The final selection must export automatically");
  assert.equal(exported.branding!.name, "MiniMax M3.1 Flash");
  assert.equal(exported.audioCheck!.generatedClipAudioIncluded, false);
  const metadata = await probe(mediaPath(exported.assetId));
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.ok(
    metadata.duration && metadata.duration > 15 && metadata.duration < 17,
  );
  assert.equal(metadata.hasAudio, true);
  const replay = await finishTakeSelection(getProject().jobs.at(-1)!.id);
  assert.equal(replay.cut?.assetId, exported.assetId);
  assert.equal(getProject().cuts.length, 1, "Retries reuse the saved export");
  const response = await getMedia(
    new Request(`http://127.0.0.1:3000/api/media/${exported.assetId}`, {
      headers: { Range: "bytes=0-1023" },
    }),
    { params: Promise.resolve({ id: exported.assetId }) },
  );
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 1024);
});

test("automatic revisions are bounded and cannot select unusable or stale-source footage", async () => {
  await prepareAutomaticProduction();
  const provider = successfulVideoProvider();
  const scene = getProject().shots[0];
  const first = await submitShot(
    scene.id,
    "first-auto",
    "768P",
    provider.fetcher,
  );
  await refreshJob(first.id, provider.fetcher);
  await reviewCompletedTake(first.id, "revise");
  assert.throws(() => selectReviewedTake(first.id), /one allowed revision/);
  saveShotPlan({
    ...scene,
    prompt: "A revised bunny scene with exactly two large shapes.",
  });
  const retry = await submitShot(
    scene.id,
    "second-auto",
    "768P",
    provider.fetcher,
  );
  await refreshJob(retry.id, provider.fetcher);
  await reviewCompletedTake(retry.id, "unusable");
  assert.throws(
    () => selectReviewedTake(retry.id),
    /reviewer must inspect and record a usable/,
  );
  await assert.rejects(
    submitShot(scene.id, "third-auto", "768P", provider.fetcher),
    /one automatic revision/,
  );
  assert.equal(provider.submissions(), 2);
  const selected = selectReviewedTake(first.id);
  assert.equal(
    selected.acceptedTakeId,
    first.id,
    "The better earlier reviewed take can win",
  );
  assert.throws(() => selectReviewedTake(retry.id), /already has a selected/);
  const another = await submitShot(
    "shot_leap",
    "other-scene",
    "768P",
    provider.fetcher,
  );
  await refreshJob(another.id, provider.fetcher);
  await reviewCompletedTake(another.id);
  mutateProject((p) => {
    chooseProductionReference(p, { url: "https://x.com/creator/status/999" });
    p.assets.find((a) => a.id === p.campaign!.assetIds[0])!.sourceUrl =
      "https://x.com/creator/status/999";
  });
  assert.throws(() => selectReviewedTake(another.id), /earlier reference/);
});
