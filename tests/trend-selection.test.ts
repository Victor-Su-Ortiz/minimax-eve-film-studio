import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentTrendCandidates,
  earlierTrendSelections,
  qualifiesAsTrend,
  selectTrendPosts,
} from "../lib/trend-selection";
import type { SocialPost, TrendSearch } from "../lib/social-types";

const post = (id: string, views: number | null = 200_000): SocialPost => ({
  id,
  platform: "x",
  url: `https://x.com/example/status/${id}`,
  author: "example",
  text: "Candidate",
  checkedAt: "2026-10-19T00:00:00Z",
  metrics: { views, likes: 1, reposts: 0, comments: 0 },
  assetId: `asset-${id}`,
  importStatus: "discovered",
});

test("viral recommendations require strictly over 100K reported views", () => {
  for (const views of [null, 0, 1_964, 99_999, 100_000, NaN, Infinity])
    assert.equal(qualifiesAsTrend(post("1", views)), false);
  assert.equal(qualifiesAsTrend(post("1", 100_001)), true);
});

test("legacy selections cannot bypass the threshold in curation or either gallery", () => {
  const posts = [
    post("low", 1_964),
    post("unknown", null),
    post("edge", 100_000),
    post("high"),
  ];
  const legacy = search(
    posts.map((p) => p.id),
    posts.map((p) => p.id),
  );
  legacy.visualChecks = undefined;
  for (const id of ["low", "unknown", "edge"])
    assert.throws(
      () => selectTrendPosts(legacy, posts, [id]),
      /100,000 reported views/,
    );
  assert.throws(
    () => selectTrendPosts(legacy, posts, ["high"]),
    /record a visual match/,
  );
  assert.deepEqual(currentTrendCandidates(legacy, posts, []), []);
  assert.deepEqual(
    earlierTrendSelections([legacy, search([], [])], posts, []),
    [],
  );
  legacy.visualChecks = search(["high"], ["high"]).visualChecks;
  assert.deepEqual(selectTrendPosts(legacy, posts, ["high", "high"]), ["high"]);
  assert.deepEqual(
    currentTrendCandidates(legacy, posts, []).map((p) => p.id),
    ["high"],
  );
  assert.deepEqual(currentTrendCandidates(legacy, posts, ["high"]), []);
  assert.deepEqual(
    earlierTrendSelections([legacy, search([], [])], posts, []).map(
      (p) => p.id,
    ),
    ["high"],
  );
});
const search = (postIds: string[], selectedPostIds: string[]): TrendSearch => ({
  id: postIds.join("-"),
  query: "dogs",
  days: 14,
  since: "2026-10-05T00:00:00Z",
  checkedAt: "2026-10-19T00:00:00Z",
  status: "complete",
  postIds,
  selectedPostIds,
  visualChecks: selectedPostIds.map((postId) => ({
    postId,
    inspectionId: `inspection-${postId}`,
    assetId: `asset-${postId}`,
    sha256: `hash-${postId}`,
    status: "matched",
    checkedAt: "2026-10-19T00:00:00Z",
    seconds: [0, 1],
    reason: "Subject and action are visible in both frames.",
  })),
});

test("unreviewed, uncertain and stale visual candidates never appear as recommendations", () => {
  const posts = [post("1")];
  const result = search(["1"], ["1"]);
  for (const status of [
    "inspected",
    "uncertain",
    "rejected",
    "failed",
  ] as const) {
    result.visualChecks![0].status = status;
    assert.deepEqual(currentTrendCandidates(result, posts, []), []);
    assert.throws(
      () => selectTrendPosts(result, posts, ["1"]),
      /record a visual match/,
    );
  }
  result.visualChecks![0].status = "matched";
  posts[0].assetId = "different-video";
  assert.deepEqual(currentTrendCandidates(result, posts, []), []);
  const uncurated = search(["1"], []);
  uncurated.selectedPostIds = undefined;
  assert.deepEqual(currentTrendCandidates(uncurated, posts, []), []);
});

test("empty broadening search retains earlier curated examples, without reviving rejected or duplicate posts", () => {
  const posts = ["1", "2", "3", "4"].map((id) => post(id));
  assert.deepEqual(
    earlierTrendSelections(
      [search(["1", "2", "3"], ["1", "2"]), search(["4"], [])],
      posts,
      ["1"],
    ).map((p) => p.id),
    ["2"],
  );
  assert.deepEqual(
    earlierTrendSelections(
      [search(["1", "2"], ["1", "2"]), search(["2"], [])],
      posts,
      [],
    ).map((p) => p.id),
    ["1"],
  );
  assert.deepEqual(
    earlierTrendSelections(
      [search(["1", "2"], ["1", "2"]), search(["1"], ["1"]), search(["4"], [])],
      posts,
      [],
    ).map((p) => p.id),
    ["1", "2"],
  );
});
