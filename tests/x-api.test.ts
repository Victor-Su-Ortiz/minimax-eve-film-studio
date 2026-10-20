import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoveryStatus, binary } from "../lib/config";
import { officialTweets, officialXRequest } from "../lib/x-api";
import {
  normalizeTweet,
  searchTrendVideos,
  importCampaignVideo,
} from "../lib/social";
import { getProject, mutateProject } from "../lib/store";
import { initialProject } from "../lib/domain";
import { registerUpload } from "../lib/media";
import {
  inspectCampaignReference,
  saveCampaignBrief,
} from "../lib/campaign-store";
import { emptyCampaign } from "../lib/campaign";

const secret = "official-test-token-not-sent-to-network";
const thirdPartySecret = "third-party-test-token-not-sent-to-network";
let directory: string;
let fixture: Buffer;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "studio-x-provider-"));
  process.env.STUDIO_DATA_DIR = directory;
  const filename = path.join(directory, "fixture.mp4");
  await promisify(execFile)(binary("ffmpeg"), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=128x128:r=24:d=2",
    "-an",
    filename,
  ]);
  fixture = await readFile(filename);
});
beforeEach(async () => {
  for (const key of [
    "X_API_BEARER_TOKEN",
    "TWITTERAPI_IO_API_KEY",
    "EXA_API_KEY",
    "X_SEARCH_PROVIDER",
  ])
    delete process.env[key];
  await mutateProject((p) => {
    for (const key of Object.keys(p))
      delete (p as unknown as Record<string, unknown>)[key];
    Object.assign(p, initialProject());
  });
});
after(() => rm(directory, { recursive: true, force: true }));

function payload(id = "123", views: number | null = 200_000) {
  return {
    data: [
      {
        id,
        author_id: "author-1",
        text: "Public launch clip",
        created_at: new Date(Date.now() - 86400000).toISOString(),
        attachments: { media_keys: ["media-1"] },
        public_metrics: {
          like_count: 20,
          retweet_count: 3,
          reply_count: 2,
          impression_count: 9_000_000,
        },
      },
    ],
    includes: {
      users: [{ id: "author-1", username: "launchbrand" }],
      media: [
        {
          media_key: "media-1",
          type: "video",
          duration_ms: 2000,
          preview_image_url: "https://pbs.twimg.com/media/test.jpg",
          public_metrics: views === null ? {} : { view_count: views },
          variants: [
            {
              content_type: "application/x-mpegURL",
              url: "https://video.twimg.com/video.m3u8",
            },
            {
              content_type: "video/mp4",
              bit_rate: 832000,
              url: "https://video.twimg.com/video-low.mp4",
            },
            {
              content_type: "video/mp4",
              bit_rate: 2176000,
              url: "https://video.twimg.com/video.mp4",
            },
            {
              content_type: "video/mp4",
              bit_rate: 8000000,
              url: "https://video.twimg.com/video-large.mp4",
            },
          ],
        },
      ],
    },
    meta: { result_count: 1 },
  };
}

test("optional providers select predictably; pinning never falls through and flags contain no secrets", () => {
  assert.equal(discoveryStatus().uploadOnly, true);
  process.env.EXA_API_KEY = "test-exa";
  assert.equal(discoveryStatus().uploadOnly, false);
  assert.equal(discoveryStatus().xConfigured, false);
  process.env.TWITTERAPI_IO_API_KEY = thirdPartySecret;
  assert.equal(discoveryStatus().xProvider, "twitterapi-io");
  process.env.X_API_BEARER_TOKEN = secret;
  assert.equal(discoveryStatus().xProvider, "official");
  process.env.X_SEARCH_PROVIDER = "twitterapi-io";
  assert.equal(discoveryStatus().xProvider, "twitterapi-io");
  delete process.env.TWITTERAPI_IO_API_KEY;
  assert.equal(discoveryStatus().xConfigured, false);
  assert.match(discoveryStatus().configurationError!, /no server credential/);
  process.env.X_SEARCH_PROVIDER = "none";
  assert.equal(discoveryStatus().xProvider, null);
  process.env.X_SEARCH_PROVIDER = "invalid";
  assert.equal(discoveryStatus().xConfigured, false);
  assert.match(discoveryStatus().configurationError!, /must be/);
  assert.ok(!JSON.stringify(discoveryStatus()).includes(secret));
});

test("without search keys discovery is a no-op and uploaded footage can be analyzed", async () => {
  const before = await getProject();
  const result = await searchTrendVideos({ query: "launch" }, async () =>
    assert.fail("No search key must mean no provider request"),
  );
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(await getProject(), before);
  const asset = await registerUpload(
    new File([new Uint8Array(fixture)], "my-reference.mp4", {
      type: "video/mp4",
    }),
  );
  await saveCampaignBrief({ ...emptyCampaign(), assetIds: [asset.id] });
  const inspection = await inspectCampaignReference(asset.id);
  assert.ok(inspection.frames.length > 0);
  assert.equal((await getProject()).trendSearches?.length, 0);
});

test("official media expansions preserve exact-post provenance and unknown views", () => {
  const p = payload();
  const normalized = normalizeTweet(
    officialTweets(p)[0],
    new Date().toISOString(),
  )!;
  assert.equal(normalized.url, "https://x.com/launchbrand/status/123");
  assert.equal(normalized.videoUrl, "https://video.twimg.com/video.mp4");
  assert.equal(normalized.metrics.views, 200_000);
  assert.equal(normalized.duration, 2);
  assert.equal(
    normalizeTweet(
      officialTweets(payload("123", null))[0],
      new Date().toISOString(),
    )!.metrics.views,
    null,
  );
  p.data[0].attachments.media_keys = ["not-expanded"];
  assert.equal(
    normalizeTweet(officialTweets(p)[0], new Date().toISOString()),
    undefined,
    "Never attach unrelated expanded media",
  );
  p.data[0].attachments.media_keys = ["media-1"];
  p.includes.users = [];
  assert.equal(
    normalizeTweet(officialTweets(p)[0], new Date().toISOString()),
    undefined,
    "Never guess the author",
  );
});

test("official search uses bearer auth, paginates, clamps dates and excludes low/unknown views", async () => {
  process.env.X_API_BEARER_TOKEN = secret;
  let calls = 0;
  let firstStart = "";
  const result = await searchTrendVideos(
    { query: "(bunny OR rabbit) from:launchbrand", days: 30 },
    async (input, init) => {
      const u = new URL(String(input));
      assert.equal(u.origin, "https://api.x.com");
      assert.equal(u.pathname, "/2/tweets/search/recent");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${secret}`,
      );
      assert.equal(new Headers(init?.headers).get("X-API-Key"), null);
      assert.equal(init?.redirect, "error");
      assert.equal(
        u.searchParams.get("query"),
        "((bunny OR rabbit) from:launchbrand) has:videos -is:retweet",
      );
      assert.equal(u.searchParams.get("sort_order"), "relevancy");
      assert.equal(u.searchParams.get("max_results"), "100");
      assert.ok(
        Date.parse(u.searchParams.get("start_time")!) >
          Date.now() - 7 * 86400000,
      );
      assert.ok(
        Date.parse(u.searchParams.get("end_time")!) < Date.now() - 20000,
      );
      if (!calls) firstStart = u.searchParams.get("start_time")!;
      assert.equal(u.searchParams.get("start_time"), firstStart);
      assert.equal(
        u.searchParams.get("next_token"),
        calls ? "next-page" : null,
      );
      calls++;
      const data = payload(String(calls), calls === 1 ? 100_000 : 200_001);
      return Response.json({
        ...data,
        meta: {
          result_count: 1,
          ...(calls === 1 ? { next_token: "next-page" } : {}),
        },
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.provider, "official");
  assert.equal(result.days, 7);
  assert.equal(result.requestedDays, 30);
  assert.match(result.warning!, /not searched in full/);
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ["x:2"],
  );
  const saved = await getProject();
  assert.equal(saved.trendSearches!.at(-1)!.days, 7);
  assert.equal(saved.socialPosts!.at(-1)!.provider, "official");
  assert.ok(!JSON.stringify(saved).includes(secret));
});

test("official errors are sanitized and never fall back to another paid provider", async () => {
  process.env.X_API_BEARER_TOKEN = secret;
  process.env.TWITTERAPI_IO_API_KEY = thirdPartySecret;
  let calls = 0;
  const result = await searchTrendVideos({ query: "launch" }, async (u) => {
    calls++;
    assert.equal(new URL(String(u)).host, "api.x.com");
    return new Response(secret, { status: 403 });
  });
  assert.equal(calls, 1);
  assert.match(result.error!, /Official X API returned HTTP 403/);
  assert.ok(!JSON.stringify(await getProject()).includes(secret));
  await assert.rejects(
    officialXRequest({ kind: "lookup", id: "123" }, async () =>
      Response.json({ errors: [{ detail: secret }] }),
    ),
    /no readable posts/,
  );
  await assert.rejects(
    officialXRequest({ kind: "lookup", id: "123" }, async () => {
      throw new Error(secret);
    }),
    /could not be reached/,
  );
  await assert.rejects(
    officialXRequest(
      {
        kind: "search",
        query: "bunny min_faves:20",
        since: "",
        until: "",
        cursor: "",
      },
      async () => assert.fail("Reject incompatible syntax before billing"),
    ),
    /TwitterAPI.io-only operators/,
  );
  const empty = await officialXRequest(
    { kind: "search", query: "bunny", since: "", until: "", cursor: "" },
    async () => Response.json({ meta: { result_count: 0 } }),
  );
  assert.deepEqual(empty.tweets, []);
});

test("official exact-video import and subsequent cached use work without third-party credentials", async () => {
  process.env.X_API_BEARER_TOKEN = secret;
  const before = await getProject();
  let calls = 0;
  const result = await importCampaignVideo(
    "https://x.com/launchbrand/status/123",
    async (input, init) => {
      const u = new URL(String(input));
      calls++;
      if (u.host === "api.x.com") {
        assert.equal(u.pathname, "/2/tweets");
        assert.equal(u.searchParams.get("ids"), "123");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${secret}`,
        );
        return Response.json(payload());
      }
      assert.equal(u.host, "video.twimg.com");
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return new Response(new Uint8Array(fixture), {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(fixture.length),
        },
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.post?.importStatus, "imported");
  assert.equal(result.post?.provider, "official");
  assert.deepEqual((await getProject()).shots, before.shots);
  delete process.env.X_API_BEARER_TOKEN;
  const cached = await importCampaignVideo(
    "https://x.com/launchbrand/status/123",
    async () => assert.fail("Cached footage should not require any provider"),
  );
  assert.equal(cached.post?.assetId, result.post?.assetId);
});

test("explicit TwitterAPI.io selection preserves its existing request despite an official token", async () => {
  process.env.X_API_BEARER_TOKEN = secret;
  process.env.TWITTERAPI_IO_API_KEY = thirdPartySecret;
  process.env.X_SEARCH_PROVIDER = "twitterapi-io";
  const result = await searchTrendVideos(
    { query: "bunny min_faves:20", days: 30 },
    async (input, init) => {
      const u = new URL(String(input));
      assert.equal(u.host, "api.twitterapi.io");
      assert.match(u.searchParams.get("query")!, /min_faves:20/);
      assert.equal(
        new Headers(init?.headers).get("X-API-Key"),
        thirdPartySecret,
      );
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return Response.json({ tweets: [], has_next_page: false });
    },
  );
  assert.equal(result.provider, "twitterapi-io");
  assert.equal(result.days, 30);
});
