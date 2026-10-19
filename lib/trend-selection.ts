import type { SocialPost, TrendSearch } from "./social-types";

export const TREND_VIEW_THRESHOLD = 100_000;

export function qualifiesAsTrend(post: SocialPost) {
  return (
    typeof post.metrics.views === "number" &&
    Number.isFinite(post.metrics.views) &&
    post.metrics.views > TREND_VIEW_THRESHOLD
  );
}

export function visualMatch(search: TrendSearch | undefined, post: SocialPost) {
  return search?.visualChecks?.find(
    (check) =>
      check.postId === post.id &&
      check.status === "matched" &&
      Boolean(check.assetId) &&
      check.assetId === post.assetId,
  );
}

export function selectTrendPosts(
  search: TrendSearch,
  posts: SocialPost[],
  postIds: string[],
) {
  if (search.status !== "complete")
    throw new Error("Complete a trend search first.");
  if (postIds.some((id) => !search.postIds.includes(id)))
    throw new Error("Select only posts returned by the latest search.");
  if (
    postIds.some((id) => {
      const post = posts.find((p) => p.id === id);
      return !post || !qualifiesAsTrend(post);
    })
  )
    throw new Error(
      "Trend recommendations require more than 100,000 reported views. Missing counts and lower-view posts cannot be selected.",
    );
  if (
    postIds.some(
      (id) =>
        !visualMatch(
          search,
          posts.find((p) => p.id === id)!,
        ),
    )
  )
    throw new Error(
      "Inspect each candidate's video and record a visual match before selecting it. Captions alone cannot establish relevance.",
    );
  return [...new Set(postIds)];
}

export function currentTrendCandidates(
  search: TrendSearch | undefined,
  posts: SocialPost[],
  visibleIds: string[],
) {
  const ids = new Set(visibleIds);
  return (search?.selectedPostIds ?? [])
    .flatMap((id) => {
      const post = posts.find((p) => p.id === id);
      return post &&
        !ids.has(id) &&
        qualifiesAsTrend(post) &&
        visualMatch(search, post)
        ? [post]
        : [];
    })
    .sort((a, b) => b.metrics.views! - a.metrics.views!);
}

export function earlierTrendSelections(
  searches: TrendSearch[],
  posts: SocialPost[],
  visibleIds: string[],
) {
  const seen = new Set([...visibleIds, ...(searches.at(-1)?.postIds || [])]);
  const selected: SocialPost[] = [];
  for (const search of searches.slice(0, -1).reverse()) {
    for (const id of search.selectedPostIds || []) {
      const post = posts.find((item) => item.id === id);
      if (
        post &&
        !seen.has(id) &&
        qualifiesAsTrend(post) &&
        visualMatch(search, post)
      )
        selected.push(post);
    }
    for (const id of search.postIds) seen.add(id);
  }
  return selected;
}
