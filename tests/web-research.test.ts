import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "campaign-web-research-"));
process.env.STUDIO_DATA_DIR = directory;
const { searchWebReferences, normalizeWebResults } =
  await import("../lib/web-search");
const { getProject, mutateProject } = await import("../lib/store");
const key = "test-exa-credential-never-sent-to-network";
beforeEach(async () => {
  process.env.EXA_API_KEY = key;
  await mutateProject((p) => {
    delete p.webResearch;
  });
});
after(() => rm(directory, { recursive: true, force: true }));

test("Exa requires a server key and never sends or persists it as research content", async () => {
  delete process.env.EXA_API_KEY;
  const before = await getProject();
  await assert.rejects(
    searchWebReferences({ query: "public product launch videos" }, async () =>
      assert.fail("No key, no provider request"),
    ),
    /EXA_API_KEY/,
  );
  assert.deepEqual(await getProject(), before);
});

test("cross-platform research stays separate from verified video recommendations and campaign sources", async () => {
  const before = await getProject();
  const result = await searchWebReferences(
    { query: "playful product launch videos", days: 14 },
    async (url, init) => {
      assert.equal(url, "https://api.exa.ai/search");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), key);
      const body = JSON.parse(String(init?.body));
      assert.ok(body.includeDomains.includes("instagram.com"));
      assert.ok(body.includeDomains.includes("youtube.com"));
      assert.ok(
        Math.abs(
          Date.parse(body.startPublishedDate) - (Date.now() - 14 * 86400000),
        ) < 2000,
      );
      assert.ok(!String(init?.body).includes(key));
      return Response.json({
        results: [
          {
            url: "https://www.instagram.com/reel/example/",
            title: "Launch",
            text: "A public search snippet mentioning 2M views is not verified video evidence.",
          },
          { url: "https://www.youtube.com/shorts/example", title: "Short" },
          { url: "https://www.tiktok.com/@brand/video/123", title: "TikTok" },
          { url: "https://x.com/brand/status/123", title: "Post" },
          { url: "https://agency.example/case-study", title: "Wrong scope" },
        ],
      });
    },
  );
  assert.deepEqual(
    result.results.map((r) => r.platform),
    ["instagram", "youtube", "tiktok", "x"],
  );
  assert.ok(
    result.results.every((r) => !("metrics" in r) && !("assetId" in r)),
  );
  const after = await getProject();
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(after.campaign, before.campaign);
  assert.deepEqual(after.socialPosts, before.socialPosts);
  assert.deepEqual(after.trendSearches, before.trendSearches);
  assert.equal(after.webResearch?.at(-1)?.status, "complete");
  assert.ok(!JSON.stringify(after).includes(key));
});

test("web research filters unsafe links, duplicates, wrong domains and dates without fabricating missing dates", async () => {
  const now = Date.now();
  const rows = [
    { url: "javascript:alert(1)" },
    { url: "https://user:pass@example.com" },
    { url: "https://127.0.0.1/private" },
    { url: "https://localhost./" },
    { url: "https://host.internal/private" },
    {
      url: "https://example.com/campaign?utm_source=search",
      title: "Case study",
      text: "a".repeat(2000),
    },
    { url: "https://example.com/campaign", title: "Duplicate" },
    {
      url: "https://example.com/future",
      publishedDate: new Date(now + 86400000 * 10).toISOString(),
    },
    { url: "https://example.com/old", publishedDate: "2020-01-01" },
    { url: "https://instagram.com.evil.example/fake" },
  ];
  const results = normalizeWebResults(rows, "web", now, now - 86400000 * 30);
  assert.equal(results.length, 2);
  assert.equal(results[0].publishedAt, undefined);
  assert.equal(results[0].excerpt.length, 1200);
  assert.deepEqual(normalizeWebResults(rows, "social", now), []);
  const result = await searchWebReferences(
    { query: "official brand campaign case studies", scope: "web" },
    async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).includeDomains, undefined);
      return Response.json({
        results: [{ url: "https://brand.example/campaign" }],
      });
    },
  );
  assert.equal(result.results[0].platform, "web");
});

test("provider errors preserve prior results without returning raw provider bodies or credentials", async () => {
  const good = await searchWebReferences(
    { query: "public launch campaign" },
    async () =>
      Response.json({ results: [{ url: "https://x.com/brand/status/123" }] }),
  );
  await assert.rejects(
    searchWebReferences(
      { query: "another public campaign" },
      async () =>
        new Response(`Private provider error ${key}`, { status: 401 }),
    ),
    /Exa returned HTTP 401/,
  );
  await assert.rejects(
    searchWebReferences({ query: "another public campaign" }, async () => {
      throw new Error(key);
    }),
    /could not be reached/,
  );
  const p = await getProject();
  assert.equal(p.webResearch?.find((s) => s.id === good.id)?.results.length, 1);
  assert.equal(p.webResearch?.at(-1)?.status, "failed");
  assert.ok(!JSON.stringify(p).includes(key));
});
