"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Film, LoaderCircle, Radar } from "lucide-react";
import type { Project } from "@/lib/domain";
import type { SocialPost, TrendVisualCheck } from "@/lib/social-types";
import {
  currentTrendCandidates,
  earlierTrendSelections,
  qualifiesAsTrend,
  visualMatch,
} from "@/lib/trend-selection";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const date = (value: string) =>
  new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function TrendGallery({
  project,
  disabled,
  selectionHint,
  onChoose,
}: {
  project: Project;
  disabled: boolean;
  selectionHint?: string;
  onChoose: (post: SocialPost) => void;
}) {
  const search = project.trendSearches?.at(-1);
  const posts = project.socialPosts || [];
  const references = posts.filter(
    (p) =>
      !p.discoveryOnly &&
      p.importStatus !== "discovered" &&
      (!p.assetId || project.campaign?.assetIds.includes(p.assetId)),
  );
  const ids = new Set(references.map((p) => p.id));
  const candidates = currentTrendCandidates(search, posts, [...ids]);
  const qualifyingReferences = references.filter(qualifiesAsTrend);
  const otherReferences = references.filter((post) => !qualifiesAsTrend(post));
  const hasCurrentMatches =
    currentTrendCandidates(search, posts, []).length > 0;
  const reviewed = search?.visualChecks?.length || 0;
  const awaitingSelection =
    search?.status === "complete" &&
    search.postIds.length > 0 &&
    !search.selectedPostIds;
  const matchFor = (post: SocialPost) =>
    [...(project.trendSearches || [])]
      .reverse()
      .map((s) => visualMatch(s, post))
      .find(Boolean);
  const earlier = earlierTrendSelections(
    project.trendSearches || [],
    posts,
    [...references, ...candidates].map((post) => post.id),
  );
  if (!search && !references.length) return null;
  return (
    <section
      className="nl-section nl-trend-section"
      aria-label="Real source videos and trend research"
    >
      <div className="nl-section-heading">
        <Radar size={15} />
        <h2>Out in the world</h2>
        <span>Over 100K views. Matched visually.</span>
      </div>
      {selectionHint && (candidates.length > 0 || earlier.length > 0) && (
        <p className="nl-trend-footnote" role="status">
          {selectionHint}
        </p>
      )}
      {search && (
        <div className="nl-trend-search" role="status">
          {search.status === "searching" ? (
            <LoaderCircle size={14} className="nl-trend-spinner" />
          ) : (
            <Radar size={14} />
          )}
          <div>
            <strong>
              {search.status === "searching"
                ? "Searching X"
                : search.status === "failed"
                  ? "Search needs attention"
                  : `Over 100K views on X · last ${search.days} days`}
            </strong>
            <span>
              {search.visualTarget || search.query} · checked{" "}
              {date(search.checkedAt)} UTC
            </span>
            {search.visualTarget && (
              <p>
                Discovery:{" "}
                {search.query || "Popular videos · no caption keywords"}
              </p>
            )}
            {search.postIds.length > 0 && (
              <p>
                M3.1 visual review · {reviewed} of {search.postIds.length}{" "}
                candidates checked
              </p>
            )}
            {awaitingSelection && (
              <p>Checking actual video frames for a match.</p>
            )}
            {search.error && <p>{search.error}</p>}
            {search.warning && <p>{search.warning}</p>}
            {search.selectionNote && (
              <details>
                <summary>Discovery notes</summary>
                <p>{search.selectionNote}</p>
              </details>
            )}
            {search.status === "complete" &&
              !hasCurrentMatches &&
              !awaitingSelection && (
                <p>
                  No matching videos with more than 100,000 reported views were
                  selected.
                  {earlier.length
                    ? " Earlier qualifying selections are shown below."
                    : " Try a broader topic in the prompt."}
                </p>
              )}
          </div>
        </div>
      )}
      <div className="nl-trend-grid">
        {[...qualifyingReferences, ...candidates].map((post) => (
          <SourceCard
            key={post.id}
            post={post}
            visualCheck={matchFor(post)}
            selected={Boolean(
              post.assetId && project.campaign?.assetIds.includes(post.assetId),
            )}
            inspected={Boolean(
              post.assetId &&
              project.campaignInspections?.some(
                (i) =>
                  i.assetId === post.assetId &&
                  i.sourceRevision === project.campaign?.revision,
              ),
            )}
            disabled={disabled}
            onChoose={() => onChoose(post)}
          />
        ))}
      </div>
      {earlier.length > 0 && (
        <>
          <p className="nl-trend-footnote">
            Earlier examples with over 100K views · matched from video frames
          </p>
          <div className="nl-trend-grid">
            {earlier.map((post) => (
              <SourceCard
                key={post.id}
                post={post}
                visualCheck={matchFor(post)}
                selected={false}
                inspected={false}
                disabled={disabled}
                onChoose={() => onChoose(post)}
              />
            ))}
          </div>
        </>
      )}
      {otherReferences.length > 0 && (
        <details className="nl-trend-footnote">
          <summary>
            Saved campaign references · below the 100K-view requirement or count
            unavailable
          </summary>
          <p>
            Preserved for your campaign. These do not qualify as viral
            recommendations.
          </p>
          <div className="nl-trend-grid">
            {otherReferences.map((post) => (
              <SourceCard
                key={post.id}
                post={post}
                selected={Boolean(
                  post.assetId &&
                  project.campaign?.assetIds.includes(post.assetId),
                )}
                inspected={Boolean(
                  post.assetId &&
                  project.campaignInspections?.some(
                    (i) =>
                      i.assetId === post.assetId &&
                      i.sourceRevision === project.campaign?.revision,
                  ),
                )}
                disabled={disabled}
                onChoose={() => onChoose(post)}
              />
            ))}
          </div>
        </details>
      )}
      <p className="nl-trend-footnote">
        Recommendations require more than 100,000 reported views; unknown counts
        are excluded. Counts are reported by each platform at retrieval time.
        Related results come from bounded search pages; they may include reposts
        of the same footage.
      </p>
    </section>
  );
}

function SourceCard({
  post,
  selected,
  inspected,
  disabled,
  onChoose,
  visualCheck,
}: {
  post: SocialPost;
  selected: boolean;
  inspected: boolean;
  disabled: boolean;
  onChoose: () => void;
  visualCheck?: TrendVisualCheck;
}) {
  const [failedSource, setFailedSource] = useState("");
  const video = post.assetId
    ? `/api/media/${encodeURIComponent(post.assetId)}`
    : post.videoUrl;
  const playable = video && failedSource !== video;
  return (
    <article className={`nl-trend-card ${selected ? "selected" : ""}`}>
      <div className="nl-trend-media">
        {playable ? (
          <video
            key={video}
            controls
            playsInline
            preload={post.assetId ? "metadata" : "none"}
            poster={post.thumbnailUrl}
            src={video}
            aria-label={`Source video by ${post.author}`}
            onError={() => setFailedSource(video)}
          />
        ) : (
          <div className="nl-trend-placeholder">
            {post.importStatus === "fetching" ? (
              <LoaderCircle size={24} className="nl-trend-spinner" />
            ) : (
              <Film size={24} />
            )}
            <span>
              {post.importStatus === "fetching"
                ? "Retrieving original footage…"
                : "Preview unavailable"}
            </span>
            <a href={post.url} target="_blank" rel="noreferrer">
              Open the source <ArrowUpRight size={12} />
            </a>
          </div>
        )}
        <span className="nl-trend-platform">
          {post.platform === "tiktok" ? "TikTok" : "X"}
          {post.duration ? ` · ${Math.round(post.duration)}s` : ""}
        </span>
      </div>
      <div className="nl-trend-body">
        <a
          className="nl-trend-author"
          href={post.url}
          target="_blank"
          rel="noreferrer"
        >
          @{post.author} <ArrowUpRight size={13} />
        </a>
        <p className="nl-trend-caption">{post.text}</p>
        {visualCheck && (
          <div className="nl-trend-visual-match">
            <strong>
              <Check size={13} /> Visual match · M3.1
            </strong>
            <p>{visualCheck.reason}</p>
            <details>
              <summary>Frame evidence</summary>
              {visualCheck.evidence?.map((item, index) => (
                <p key={index}>
                  {item.seconds.toFixed(2)}s — {item.observation}
                </p>
              ))}
              <p>
                Based on {visualCheck.seconds.length} sampled frames. Audio and
                motion between frames are unverified.
              </p>
            </details>
          </div>
        )}
        <div className="nl-trend-metrics">
          {(
            [
              ["views", post.metrics.views],
              ["likes", post.metrics.likes],
              ["reposts", post.metrics.reposts],
            ] as const
          ).map(([label, value]) => (
            <span key={label}>
              <strong
                title={
                  value === null ? "Not reported" : value.toLocaleString("en")
                }
              >
                {value === null ? "—" : compact.format(value)}
              </strong>
              {label}
            </span>
          ))}
        </div>
        <small>
          Posted{" "}
          {post.publishedAt ? date(post.publishedAt) : "date unavailable"} ·
          counts checked {date(post.checkedAt)} UTC
        </small>
        {post.error && <p className="nl-trend-error">{post.error}</p>}
        {selected ? (
          <span className="nl-trend-selected">
            <Check size={13} />
            {inspected
              ? "Reference · frames inspected"
              : "Reference imported · ready to inspect"}
          </span>
        ) : (
          <button
            disabled={disabled || post.importStatus === "fetching"}
            onClick={onChoose}
          >
            Use this reference <ArrowUpRight size={13} />
          </button>
        )}
      </div>
    </article>
  );
}
