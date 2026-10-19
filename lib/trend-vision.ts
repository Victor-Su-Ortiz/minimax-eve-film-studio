import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProject, mutateProject, event } from "./store";
import { retrieveTrendVideo } from "./social";
import { sampleAsset } from "./media";
import { reviewSheet } from "./review-sheet";
import { qualifiesAsTrend } from "./trend-selection";
import type { TrendVisualCheck } from "./social-types";

export const inspectTrendInput = z.object({
  searchId: z.string(),
  postId: z.string(),
});

export async function inspectTrendCandidate(
  input: z.infer<typeof inspectTrendInput>,
  providerFetch: typeof fetch = fetch,
) {
  const { searchId, postId } = inspectTrendInput.parse(input);
  const project = await getProject();
  const search = project.trendSearches?.find((s) => s.id === searchId);
  const post = project.socialPosts?.find((p) => p.id === postId);
  if (
    !search ||
    search.status !== "complete" ||
    !search.postIds.includes(postId) ||
    !post
  )
    throw new Error("Inspect a candidate returned by a completed search.");
  if (!qualifiesAsTrend(post))
    throw new Error("Candidate must have more than 100,000 reported views.");
  const check: TrendVisualCheck = {
    postId,
    inspectionId: randomUUID(),
    status: "inspected",
    checkedAt: new Date().toISOString(),
    seconds: [],
  };
  try {
    const loaded = await retrieveTrendVideo(post.url, providerFetch);
    if (loaded.error || !loaded.post.assetId)
      throw new Error(loaded.error || "Video unavailable.");
    if (!qualifiesAsTrend(loaded.post))
      throw new Error("Refreshed view count no longer qualifies.");
    const asset = (await getProject()).assets.find(
      (a) => a.id === loaded.post.assetId,
    )!;
    const sampled = await sampleAsset(asset.id, "trend");
    const sheet = await reviewSheet(sampled.frames);
    Object.assign(check, {
      assetId: asset.id,
      sha256: asset.sha256,
      seconds: sampled.frames.map((f) => f.seconds),
    });
    await saveInspection(searchId, check);
    return {
      searchId,
      postId,
      inspectionId: check.inspectionId,
      visualTarget: search.visualTarget || search.query,
      url: post.url,
      assetId: asset.id,
      seconds: check.seconds,
      duration: sampled.duration,
      sheet,
      note: "Judge the requested subject and action from these actual video frames, not the caption. The sheet is evidence from eight timestamps, not continuous playback or audio. Record matched, rejected or uncertain with timestamped observations. Do not claim exact choreography or beat synchronization.",
    };
  } catch (error) {
    check.status = "failed";
    check.reason =
      error instanceof Error ? error.message : "Visual inspection failed.";
    await saveInspection(searchId, check);
    return {
      searchId,
      postId,
      inspectionId: check.inspectionId,
      error: check.reason,
    };
  }
}

async function saveInspection(searchId: string, check: TrendVisualCheck) {
  await mutateProject((p) => {
    const search = p.trendSearches?.find((s) => s.id === searchId);
    if (!search) throw new Error("Search changed while loading the video.");
    search.visualChecks = [
      ...(search.visualChecks || []).filter((c) => c.postId !== check.postId),
      check,
    ];
    if (search.selectedPostIds)
      search.selectedPostIds = search.selectedPostIds.filter(
        (id) => id !== check.postId,
      );
    event(
      p,
      "trends.inspected",
      check.status === "failed"
        ? "Could not inspect a trend candidate"
        : "Inspected eight frames from a trend candidate",
    );
  });
}

export const trendVisualMatchInput = z.object({
  searchId: z.string(),
  postId: z.string(),
  inspectionId: z.string(),
  verdict: z.enum(["matched", "rejected", "uncertain"]),
  reason: z.string().min(10).max(500),
  evidence: z
    .array(
      z.object({
        seconds: z.number().nonnegative(),
        observation: z.string().min(10).max(350),
      }),
    )
    .min(1)
    .max(4),
});

export async function recordTrendVisualMatch(
  input: z.input<typeof trendVisualMatchInput>,
) {
  const { searchId, postId, inspectionId, verdict, reason, evidence } =
    trendVisualMatchInput.parse(input);
  return await mutateProject((p) => {
    const search = p.trendSearches?.find((s) => s.id === searchId);
    const check = search?.visualChecks?.find(
      (c) => c.postId === postId && c.inspectionId === inspectionId,
    );
    const post = p.socialPosts?.find((item) => item.id === postId);
    const asset = p.assets.find((a) => a.id === check?.assetId);
    if (
      !search ||
      !check ||
      check.status === "failed" ||
      !asset ||
      asset.sha256 !== check.sha256 ||
      post?.assetId !== asset.id
    )
      throw new Error(
        "Inspect this exact candidate first; stale or failed inspections cannot establish a visual match.",
      );
    if (
      evidence.some(
        (e) => !check.seconds.some((s) => Math.abs(s - e.seconds) < 0.005),
      )
    )
      throw new Error(
        "Visual evidence must cite timestamps from this inspection.",
      );
    if (
      verdict === "matched" &&
      (new Set(
        evidence.map((e) =>
          check.seconds.find((s) => Math.abs(s - e.seconds) < 0.005),
        ),
      ).size < 2 ||
        !qualifiesAsTrend(post))
    )
      throw new Error(
        "A match needs observations at two distinct sampled timestamps and more than 100,000 reported views.",
      );
    Object.assign(check, {
      status: verdict,
      reason,
      evidence,
      checkedAt: new Date().toISOString(),
    });
    if (verdict !== "matched" && search.selectedPostIds)
      search.selectedPostIds = search.selectedPostIds.filter(
        (id) => id !== postId,
      );
    event(
      p,
      "trends.visual_match",
      `Visual review: ${verdict} · @${post.author}`,
    );
    return check;
  });
}
