import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyCampaign } from "./campaign";
import { trendKey } from "./config";
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

function upsertPost(post: SocialPost) {
  return mutateProject((p) => {
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
  const { query, days, visualTarget } = trendSearchInput.parse(input);
  const checkedAt = new Date().toISOString();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const search: TrendSearch = {
    id: randomUUID(),
    query,
    visualTarget: visualTarget || query,
    days,
    since,
    checkedAt,
    status: "searching",
    postIds: [],
  };
  mutateProject((p) => {
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
    let warning: string | undefined;
    // A sparse first page is not evidence that no popular clip exists.
    // Bound provider work and reject low/unknown views locally on every page.
    for (let page = 0; page < 3; page++) {
      let result;
      try {
        result = await twitterRequest(
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
        warning = `Search stopped after ${pagesScanned} page(s): ${error instanceof Error ? error.message : "Provider unavailable."}`;
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
          unique.set(post.id, post);
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
    mutateProject((p) => {
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
    mutateProject((p) => {
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

function attachReference(post: SocialPost) {
  const p = getProject();
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
  return saveCampaignBrief({ ...brief, urls, assetIds });
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
  const existing = getProject().socialPosts?.find((p) => p.id === source.id);
  if (
    existing?.assetId &&
    getProject().assets.some((a) => a.id === existing.assetId)
  ) {
    const campaign = attachToCampaign ? attachReference(existing) : undefined;
    if (attachToCampaign) {
      existing.discoveryOnly = false;
      existing.error = undefined;
      upsertPost(existing);
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
  upsertPost(post);
  mutateProject((p) =>
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
      const { tweets } = await twitterRequest(
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
        importStatus: "fetching",
        discoveryOnly: !attachToCampaign,
      };
      if (!post.duration || post.duration > 120)
        throw new Error(
          "Automatic references must be videos up to 2 minutes. Attach a shorter excerpt for longer posts.",
        );
      bytes = await downloadSocialVideo(post.videoUrl!, providerFetch);
    }
    upsertPost(post);
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
    upsertPost(post);
    const campaign = attachToCampaign ? attachReference(post) : undefined;
    mutateProject((p) =>
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
    upsertPost(post);
    mutateProject((p) => event(p, "reference.unavailable", message));
    return {
      post: postSummary(post),
      error: message,
      next: "Show this failure honestly. Do not claim to have watched the clip or silently substitute a different post.",
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
