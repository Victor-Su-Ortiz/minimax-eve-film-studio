import { officialXKey } from "./config";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Adapt only media attached to this post, never quoted/referenced posts.
// Keep unknown video views unknown; impressions/likes are not video views.
export function officialTweets(payload: Record<string, unknown>) {
  const includes = object(payload.includes);
  return list(payload.data).map((value) => {
    const post = object(value);
    const user = list(includes.users)
      .map(object)
      .find((u) => u.id === post.author_id);
    const keys = list(object(post.attachments).media_keys);
    const media = list(includes.media)
      .map(object)
      .filter((m) => keys.includes(m.media_key));
    const video = media.find(
      (m) => m.type === "video" || m.type === "animated_gif",
    );
    const metrics = object(post.public_metrics);
    return {
      id: post.id,
      text: post.text,
      createdAt: post.created_at,
      author: { userName: user?.username },
      viewCount: object(video?.public_metrics).view_count,
      likeCount: metrics.like_count,
      retweetCount: metrics.retweet_count,
      replyCount: metrics.reply_count,
      extendedEntities: {
        media: video
          ? [
              {
                type: video.type,
                media_url_https: video.preview_image_url,
                video_info: {
                  duration_millis: video.duration_ms,
                  variants: list(video.variants).map((v) => {
                    const variant = object(v);
                    return {
                      ...variant,
                      bitrate: variant.bit_rate ?? variant.bitrate,
                    };
                  }),
                },
              },
            ]
          : [],
      },
    };
  });
}

export type XRequest =
  | { kind: "lookup"; id: string }
  | {
      kind: "search";
      query: string;
      since: string;
      until: string;
      cursor: string;
    };

export async function officialXRequest(
  input: XRequest,
  providerFetch: typeof fetch = fetch,
) {
  const key = officialXKey();
  if (!key)
    throw new Error(
      "Official X lookup/search is optional. Configure X_API_BEARER_TOKEN or upload a reference video.",
    );
  const url = new URL(
    input.kind === "lookup"
      ? "https://api.x.com/2/tweets"
      : "https://api.x.com/2/tweets/search/recent",
  );
  url.searchParams.set(
    "tweet.fields",
    "created_at,author_id,attachments,public_metrics",
  );
  url.searchParams.set("expansions", "author_id,attachments.media_keys");
  url.searchParams.set("user.fields", "username");
  url.searchParams.set(
    "media.fields",
    "type,duration_ms,preview_image_url,variants,public_metrics",
  );
  if (input.kind === "lookup") {
    if (!/^\d+$/.test(input.id))
      throw new Error("Use an exact numeric X post ID.");
    url.searchParams.set("ids", input.id);
  } else {
    if (
      /\b(?:min_faves|min_retweets|min_replies|filter|since_time|until_time):/.test(
        input.query,
      )
    )
      throw new Error(
        "This query uses TwitterAPI.io-only operators. For official X use keywords, OR, quoted phrases or from:handle; video/date filters are applied automatically.",
      );
    url.searchParams.set(
      "query",
      `${input.query ? `(${input.query}) ` : ""}has:videos -is:retweet`,
    );
    url.searchParams.set("start_time", input.since);
    url.searchParams.set("end_time", input.until);
    url.searchParams.set("sort_order", "relevancy");
    url.searchParams.set("max_results", "100");
    if (input.cursor) url.searchParams.set("next_token", input.cursor);
  }
  let response: Response;
  try {
    response = await providerFetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(40000),
    });
  } catch {
    throw new Error(
      "The official X API could not be reached. Existing references were preserved.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Official X API returned HTTP ${response.status}. Check access and quota, or upload the reference clip.`,
    );
  let data: Record<string, unknown>;
  try {
    data = object(await response.json());
  } catch {
    throw new Error("Official X API returned an unreadable response.");
  }
  const meta = object(data.meta);
  if (
    !Array.isArray(data.data) &&
    !(
      input.kind === "search" &&
      meta.result_count === 0 &&
      !list(data.errors).length
    )
  )
    throw new Error(
      "Official X API returned no readable posts. Check access to the requested posts or upload a reference.",
    );
  if (list(data.errors).length && !list(data.data).length)
    throw new Error(
      "Official X could not return the requested posts. Upload the reference clip instead.",
    );
  const nextCursor = typeof meta.next_token === "string" ? meta.next_token : "";
  return {
    tweets: officialTweets(data),
    hasNextPage: Boolean(nextCursor),
    nextCursor,
  };
}
