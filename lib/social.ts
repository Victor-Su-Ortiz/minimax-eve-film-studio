import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyCampaign } from "./campaign";
import { trendKey, discoveryStatus } from "./config";
import { officialXRequest } from "./x-api";
import { saveCampaignBrief } from "./campaign-store";
import { MAX_UPLOAD, registerUpload } from "./media";
import { event, getProject, mutateProject } from "./store";
import type { SocialPost, TrendSearch } from "./social-types";
import { qualifiesAsTrend, TREND_VIEW_THRESHOLD } from "./trend-selection";
import { isBrandAsset } from "./brand-assets";
import { MAX_CAMPAIGN_REFERENCES } from "./reference-limits";

const exec = promisify(execFile);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const string = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown): number | null =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
const iso = (v: unknown) =>
  string(v) && Number.isFinite(Date.parse(string(v)))
    ? new Date(string(v)).toISOString()
    : undefined;

export function socialUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("Use a public HTTPS TikTok or X post link.");
  const host = u.hostname.toLowerCase();
  const match = /^(?:www\.)?tiktok\.com$/.test(host)
    ? u.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/)
    : /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(host)
      ? u.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/video\/\d+)?\/?$/)
      : null;
  if (!match)
    throw new Error(
      "Use the full TikTok /@creator/video/ID or X /creator/status/ID link.",
    );
  const platform = host.includes("tiktok")
    ? ("tiktok" as const)
    : ("x" as const);
  return {
    platform,
    postId: match[2],
    author: match[1],
    id: `${platform}:${match[2]}`,
    url:
      platform === "tiktok"
        ? `https://www.tiktok.com/@${match[1]}/video/${match[2]}`
        : `https://x.com/${match[1]}/status/${match[2]}`,
  };
}

// Only known public platform CDNs; never follow a redirect to an arbitrary host.
export function socialMediaUrl(
  value: unknown,
  image = false,
): string | undefined {
  try {
    const u = new URL(string(value));
    if (u.protocol !== "https:" || u.username || u.password || u.port) return;
    const host = u.hostname.toLowerCase();
    const domains = image
      ? [
          "pbs.twimg.com",
          "tiktokcdn.com",
          "tiktokcdn-us.com",
          "tiktokcdn-eu.com",
          "tiktok.com",
          "ibytedtos.com",
          "byteoversea.com",
        ]
      : [
          "video.twimg.com",
          "video-s.twimg.com",
          "tiktok.com",
          "tiktokcdn.com",
          "tiktokcdn-us.com",
          "tiktokcdn-eu.com",
          "byteoversea.com",
        ];
    if (domains.some((d) => host === d || host.endsWith(`.${d}`)))
      return u.href;
  } catch {
    /* Invalid provider URL. */
  }
}

async function upsertPost(post: SocialPost) {
  return await mutateProject((p) => {
    p.socialPosts ||= [];
    const existing = p.socialPosts.find((v) => v.id === post.id);
    if (existing) Object.assign(existing, post);
    else p.socialPosts.push(post);
    return post;
  });
}

export function normalizeTweet(
  value: unknown,
  checkedAt: string,
): SocialPost | undefined {
  const t = record(value);
  const author = string(record(t.author).userName);
  const id = string(t.id);
  if (!/^\d+$/.test(id) || !/^\w+$/.test(author)) return;
  const media = array(record(t.extendedEntities).media)
    .map(record)
    .find((m) => m.type === "video" || m.type === "animated_gif");
  if (!media) return;
  const info = record(media.video_info);
  const variants = array(info.variants)
    .map(record)
    .filter((v) => v.content_type === "video/mp4" && socialMediaUrl(v.url))
    .sort((a, b) => (count(a.bitrate) || 0) - (count(b.bitrate) || 0));
  const selected =
    variants.filter((v) => (count(v.bitrate) || 0) <= 2_500_000).at(-1) ||
    variants[0];
  if (!selected) return;
  return {
    id: `x:${id}`,
    platform: "x",
    url: `https://x.com/${author}/status/${id}`,
    author,
    text: string(t.text).slice(0, 2000),
    publishedAt: iso(t.createdAt),
    checkedAt,
    metrics: {
      views: count(t.viewCount),
      likes: count(t.likeCount),
      reposts: count(t.retweetCount),
      comments: count(t.replyCount),
    },
    thumbnailUrl: socialMediaUrl(media.media_url_https, true),
    videoUrl: socialMediaUrl(selected.url),
    duration:
      count(info.duration_millis) === null
        ? undefined
        : Number(info.duration_millis) / 1000,
    importStatus: "discovered",
  };
}

async function twitterRequest(
  endpoint: string,
  params: Record<string, string>,
  providerFetch: typeof fetch = fetch,
) {
  const key = trendKey();
  if (!key)
    throw new Error(
      "Live trend search needs TWITTERAPI_IO_API_KEY in the server environment.",
    );
  const u = new URL(`https://api.twitterapi.io/twitter/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const response = await providerFetch(u, {
    headers: { "X-API-Key": key },
    redirect: "error",
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok)
    throw new Error(`Trend provider returned HTTP ${response.status}.`);
  const data = record(await response.json());
  if (!Array.isArray(data.tweets))
    throw new Error("Trend provider did not return a readable post list.");
  return {
    tweets: data.tweets as unknown[],
    hasNextPage: data.has_next_page === true,
    nextCursor: string(data.next_cursor),
  };
}

export const trendSearchInput = z
  .object({
    query: z.string().trim().max(250).default(""),
    visualTarget: z.string().trim().min(2).max(250).optional(),
    days: z.number().int().min(1).max(30).default(14),
  })
  .refine(
    (input) => input.query.length >= 2 || Boolean(input.visualTarget),
    "Provide search words or a visual target for keyword-free discovery.",
  );
export async function searchTrendVideos(
  input: z.input<typeof trendSearchInput>,
  providerFetch: typeof fetch = fetch,
) {
  const {
    query,
    days: requestedDays,
    visualTarget,
  } = trendSearchInput.parse(input);
  const discovery = discoveryStatus();
  const checkedAt = new Date().toISOString();
  if (!discovery.xConfigured)
    return {
      query,
      checkedAt,
      posts: [],
      unavailable: true,
      error:
        discovery.configurationError ||
        "X discovery is optional and is not configured. Use an uploaded reference video, or Exa research if configured. Do not retry X search until configured.",
    };
  const provider = discovery.xProvider!;
  const days = Math.min(requestedDays, discovery.xMaxSearchDays);
  // Keep pagination safely inside X's rolling seven-day window.
  const since = new Date(
    Date.parse(checkedAt) -
      days * 86_400_000 +
      (provider === "official" && days === 7 ? 300_000 : 0),
  ).toISOString();
  const until = new Date(
    Date.parse(checkedAt) - (provider === "official" ? 30_000 : 0),
  ).toISOString();
  const windowWarning =
    days < requestedDays
      ? `Official X recent search covers only the last ${days} days; the requested ${requestedDays}-day window was not searched in full.`
      : undefined;
  const search: TrendSearch = {
    id: randomUUID(),
    query,
    visualTarget: visualTarget || query,
    days,
    requestedDays,
    provider,
    until,
    since,
    checkedAt,
    status: "searching",
    postIds: [],
  };
  await mutateProject((p) => {
    (p.trendSearches ||= []).push(search);
    event(
      p,
      "trends.searching",
      `Searching recent videos: ${query || "popular videos without caption keywords"}`,
    );
  });
  try {
    const unique = new Map<string, SocialPost>();
    const cursors = new Set<string>();
    let cursor = "";
    let pagesScanned = 0;
    let warning: string | undefined = windowWarning;
    // A sparse first page is not evidence that no popular clip exists.
    // Bound provider work and reject low/unknown views locally on every page.
    for (let page = 0; page < 3; page++) {
      let result;
      try {
        result =
          provider === "official"
            ? await officialXRequest(
                { kind: "search", query, since, until, cursor },
                providerFetch,
              )
            : await twitterRequest(
                "tweet/advanced_search",
                {
                  query: `${query ? `(${query}) ` : ""}filter:videos -filter:retweets since_time:${Math.floor(Date.parse(since) / 1000)} until_time:${Math.ceil(Date.parse(checkedAt) / 1000)}`,
                  queryType: "Top",
                  cursor,
                },
                providerFetch,
              );
      } catch (error) {
        if (!pagesScanned) throw error;
        warning = [
          windowWarning,
          `Search stopped after ${pagesScanned} page(s): ${error instanceof Error ? error.message : "Provider unavailable."}`,
        ]
          .filter(Boolean)
          .join(" ");
        break;
      }
      pagesScanned++;
      for (const tweet of result.tweets) {
        const post = normalizeTweet(tweet, checkedAt);
        if (
          post?.publishedAt &&
          post.publishedAt >= since &&
          post.publishedAt <= checkedAt &&
          qualifiesAsTrend(post)
        )
          unique.set(post.id, { ...post, provider });
      }
      if (
        unique.size >= 6 ||
        !result.hasNextPage ||
        !result.nextCursor ||
        cursors.has(result.nextCursor)
      )
        break;
      cursor = result.nextCursor;
      cursors.add(cursor);
    }
    const posts = [...unique.values()]
      .sort(
        (a, b) =>
          (b.metrics.views || 0) - (a.metrics.views || 0) ||
          (b.metrics.likes || 0) - (a.metrics.likes || 0),
      )
      .slice(0, 6);
    await mutateProject((p) => {
      p.socialPosts ||= [];
      for (const post of posts) {
        const existing = p.socialPosts.find((v) => v.id === post.id);
        if (existing)
          Object.assign(existing, post, {
            assetId: existing.assetId,
            importStatus: existing.importStatus,
            error: existing.error,
          });
        else p.socialPosts.push(post);
      }
      Object.assign(
        p.trendSearches!.find((s) => s.id === search.id)!,
        {
          status: "complete",
          postIds: posts.map((v) => v.id),
          pagesScanned,
          warning,
        },
      );
      event(
        p,
        "trends.found",
        `Found ${posts.length} video candidates with over 100K views on X`,
      );
    });
    return {
      searchId: search.id,
      provider,
      days,
      requestedDays,
      until,
      query,
      visualTarget: search.visualTarget,
      since,
      checkedAt,
      minimumViewsExclusive: TREND_VIEW_THRESHOLD,
      pagesScanned,
      warning,
      posts: posts.map(postSummary),
      note: "These are retrieval candidates, not recommendations. Use inspect_trend_candidate on each candidate, then record_trend_visual_match using observed frame evidence for the visualTarget. Do not reject a candidate just because its caption omits the subject/action. Only visually matched clips with more than 100,000 reported views can be selected. If discovery is sparse, search broader subjects, relevant creator feeds, or query:'' with visualTarget to search without caption keywords. This is bounded X retrieval, not a visual index of all social media.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Trend search failed.";
    await mutateProject((p) => {
      Object.assign(
        p.trendSearches!.find((s) => s.id === search.id)!,
        { status: "failed", error: message },
      );
      event(p, "trends.failed", message);
    });
    return { query, since, checkedAt, posts: [], error: message };
  }
}

// Candidate inspection caches the exact video without selecting it as a
// campaign reference or advancing the campaign revision.
export async function retrieveTrendVideo(
  url: string,
  providerFetch: typeof fetch = fetch,
) {
  return importVideo(socialUrl(url), providerFetch, false);
}

export function postSummary(post: SocialPost) {
  const { videoUrl: _, thumbnailUrl: __, ...summary } = post;
  return summary;
}

export function videoExtractorPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const root = process.env.STUDIO_PROJECT_DIR || process.cwd();
  for (const file of [
    path.join(root, ".tools/social-video/bin/yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
  ]) {
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      /* Try next location. */
    }
  }
  throw new Error(
    "The TikTok importer needs yt-dlp. Run npm run setup:video-import and restart the studio.",
  );
}

async function resolveTikTok(
  url: string,
  downloadPath: string,
): Promise<SocialPost> {
  const source = socialUrl(url);
  const executable = videoExtractorPath();
  let stdout: string;
  try {
    ({ stdout } = await exec(
      executable,
      [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--no-cache-dir",
        "--no-warnings",
        "--socket-timeout",
        "15",
        "--retries",
        "0",
        "--extractor-retries",
        "0",
        "--max-filesize",
        "32M",
        "--match-filters",
        "duration <= 120",
        "--format",
        "b[ext=mp4][vcodec^=avc]/b[ext=mp4]",
        "--output",
        downloadPath,
        "--no-simulate",
        "--dump-single-json",
        "--",
        source.url,
      ],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch {
    throw new Error(
      "TikTok did not make this public clip available. Open the original post or attach the exact video; no visual analysis was made.",
    );
  }
  const info = record(JSON.parse(stdout));
  if (string(info.id) !== source.postId)
    throw new Error(
      "The returned TikTok ID does not match the requested post.",
    );
  const formats = array(info.formats)
    .map(record)
    .filter(
      (f) =>
        f.ext === "mp4" &&
        f.vcodec !== "none" &&
        Number(f.width) > 0 &&
        socialMediaUrl(f.url),
    );
  const bySize = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    (count(b.filesize) || 0) - (count(a.filesize) || 0);
  const selected =
    formats
      .filter(
        (f) =>
          /h264|avc/.test(string(f.vcodec) + string(f.format_id)) &&
          Math.max(Number(f.width), Number(f.height)) <= 1920 &&
          (count(f.filesize) || 0) <= MAX_UPLOAD,
      )
      .sort(bySize)[0] ||
    formats
      .filter((f) => (count(f.filesize) || 0) <= MAX_UPLOAD)
      .sort(bySize)[0];
  if (!selected) throw new Error("This post has no accessible MP4 reference.");
  const timestamp = count(info.timestamp);
  return {
    id: source.id,
    platform: "tiktok",
    url: source.url,
    author: string(info.uploader) || source.author,
    text: (string(info.description) || string(info.title)).slice(0, 2000),
    publishedAt:
      timestamp === null ? undefined : new Date(timestamp * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    metrics: {
      views: count(info.view_count),
      likes: count(info.like_count),
      reposts: count(info.repost_count),
      comments: count(info.comment_count),
    },
    thumbnailUrl: socialMediaUrl(info.thumbnail, true),
    videoUrl: socialMediaUrl(selected.url),
    duration: count(info.duration) ?? undefined,
    importStatus: "fetching",
  };
}

export async function downloadSocialVideo(
  url: string,
  providerFetch: typeof fetch = fetch,
) {
  let target = socialMediaUrl(url);
  if (!target)
    throw new Error("The video URL is not on an allowed public platform CDN.");
  const signal = AbortSignal.timeout(60_000);
  for (let redirect = 0; redirect <= 4; redirect++) {
    const response: Response = await providerFetch(target, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: target.includes("tiktok")
          ? "https://www.tiktok.com/"
          : "https://x.com/",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location: string | null = response.headers.get("location");
      await response.body?.cancel();
      target = location
        ? socialMediaUrl(new URL(location, target).href)
        : undefined;
      if (!target)
        throw new Error(
          "The video redirected outside the allowed platform CDNs.",
        );
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(
        `The source video could not be retrieved (HTTP ${response.status}).`,
      );
    if (Number(response.headers.get("content-length") || 0) > MAX_UPLOAD) {
      await response.body.cancel();
      throw new Error("The reference exceeds the 32 MB import limit.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_UPLOAD)
          throw new Error("The reference exceeds the 32 MB import limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    if (!size) throw new Error("The source returned an empty video.");
    return Buffer.concat(chunks);
  }
  throw new Error("The video redirected too many times.");
}

async function attachReference(post: SocialPost) {
  const p = await getProject();
  const campaign = p.campaign || emptyCampaign();
  const sourceIds = campaign.assetIds.filter((id) => {
    const asset = p.assets.find((a) => a.id === id);
    return asset && !isBrandAsset(asset);
  });
  const assetIds = [...new Set([...sourceIds, post.assetId!])];
  const urls = [...new Set([...campaign.urls, post.url])];
  if (
    assetIds.length > MAX_CAMPAIGN_REFERENCES ||
    urls.length > MAX_CAMPAIGN_REFERENCES
  )
    throw new Error(
      `The reference is imported, but the campaign already has ${MAX_CAMPAIGN_REFERENCES} sources. Choose which sources to retain with set_campaign_brief.`,
    );
  const { revision: _, ...brief } = campaign;
  return await saveCampaignBrief({ ...brief, urls, assetIds });
}

const imports = new Map<string, ReturnType<typeof importVideo>>();
export async function importCampaignVideo(
  url: string,
  providerFetch: typeof fetch = fetch,
) {
  const source = socialUrl(url);
  const running = imports.get(source.id);
  if (running) return running;
  const operation = importVideo(source, providerFetch);
  imports.set(source.id, operation);
  try {
    return await operation;
  } finally {
    imports.delete(source.id);
  }
}

async function importVideo(
  source: ReturnType<typeof socialUrl>,
  providerFetch: typeof fetch,
  attachToCampaign = true,
) {
  const existing = (await getProject()).socialPosts?.find(
    (p) => p.id === source.id,
  );
  if (
    existing?.assetId &&
    (await getProject()).assets.some((a) => a.id === existing.assetId)
  ) {
    const campaign = attachToCampaign
      ? await attachReference(existing)
      : undefined;
    if (attachToCampaign) {
      existing.discoveryOnly = false;
      existing.error = undefined;
      await upsertPost(existing);
    }
    return {
      post: postSummary(existing),
      sourceRevision: campaign?.revision,
      next: "Call inspect_campaign_reference on the imported asset before making visual claims.",
    };
  }
  let post: SocialPost = {
    id: source.id,
    platform: source.platform,
    url: source.url,
    author: source.author,
    text: "Retrieving the original post…",
    checkedAt: new Date().toISOString(),
    metrics: { views: null, likes: null, reposts: null, comments: null },
    ...existing,
    discoveryOnly: !attachToCampaign,
    importStatus: "fetching",
    error: undefined,
  };
  await upsertPost(post);
  await mutateProject((p) =>
    event(
      p,
      "reference.fetching",
      `Retrieving ${source.platform === "tiktok" ? "TikTok" : "X"} video from @${source.author}`,
    ),
  );
  let temporary: string | undefined;
  try {
    let bytes: Buffer;
    if (source.platform === "tiktok") {
      temporary = await mkdtemp(path.join(tmpdir(), "minimax-reference-"));
      const filename = path.join(temporary, "source.mp4");
      post = await resolveTikTok(source.url, filename);
      const file = await stat(filename);
      if (!file.size || file.size > MAX_UPLOAD)
        throw new Error(
          "The reference exceeds the 32 MB import limit or has no video data.",
        );
      bytes = await readFile(filename);
    } else {
      const discovery = discoveryStatus();
      if (!discovery.xConfigured)
        throw new Error(
          discovery.configurationError ||
            "X URL import needs an optional X provider. Upload the reference video directly, or configure X_API_BEARER_TOKEN or TWITTERAPI_IO_API_KEY.",
        );
      const { tweets } =
        discovery.xProvider === "official"
          ? await officialXRequest(
              { kind: "lookup", id: source.postId },
              providerFetch,
            )
          : await twitterRequest(
              "tweets",
              { tweet_ids: source.postId },
              providerFetch,
            );
      const found = tweets.find((t) => string(record(t).id) === source.postId);
      const resolved = normalizeTweet(found, new Date().toISOString());
      if (!resolved)
        throw new Error(
          "The exact X post has no accessible video. Quoted or linked clips must be imported from their own source post.",
        );
      post = {
        ...resolved,
        provider: discovery.xProvider!,
        importStatus: "fetching",
        discoveryOnly: !attachToCampaign,
      };
      if (!post.duration || post.duration > 120)
        throw new Error(
          "Automatic references must be videos up to 2 minutes. Attach a shorter excerpt for longer posts.",
        );
      bytes = await downloadSocialVideo(post.videoUrl!, providerFetch);
    }
    await upsertPost(post);
    if (!post.duration || post.duration > 120)
      throw new Error(
        "Automatic references must be videos up to 2 minutes. Attach a shorter excerpt for longer posts.",
      );
    const asset = await registerUpload(
      new File(
        [new Uint8Array(bytes)],
        `${post.platform}-${source.postId}.mp4`,
        { type: "video/mp4" },
      ),
      post.url,
    );
    post = {
      ...post,
      assetId: asset.id,
      duration: asset.duration,
      importStatus: "imported",
      error: undefined,
    };
    await upsertPost(post);
    const campaign = attachToCampaign ? await attachReference(post) : undefined;
    await mutateProject((p) =>
      event(
        p,
        attachToCampaign ? "reference.imported" : "trends.video_loaded",
        `Retrieved ${Math.round(asset.duration || 0)}s of video from @${post.author}`,
      ),
    );
    return {
      post: postSummary(post),
      sourceRevision: campaign?.revision,
      next: "The exact video is now playable in the studio. Call inspect_campaign_reference on this asset; save analysis against this sourceRevision. Retrieval alone is not visual inspection.",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The reference could not be imported.";
    // If attachment fails, keep the successfully imported media available.
    post = {
      ...post,
      importStatus: post.assetId ? "imported" : "unavailable",
      error: message,
    };
    await upsertPost(post);
    await mutateProject((p) => event(p, "reference.unavailable", message));
    return {
      post: postSummary(post),
      error: message,
      next: "Show this failure honestly. Do not claim to have watched the clip or silently substitute a different post.",
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
