import { ExternalLink, Globe, LoaderCircle } from "lucide-react";
import type { WebResearchSearch } from "@/lib/web-search-types";
const labels = {
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  web: "Web",
};
export function WebResearch({ searches }: { searches?: WebResearchSearch[] }) {
  if (!searches?.length) return null;
  return (
    <section className="nl-section" aria-label="Web research">
      <div className="nl-section-heading">
        <Globe size={14} />
        <h2>Across the web</h2>
        <span>Exa · Research leads</span>
      </div>
      {searches.slice(-2).map((search) => (
        <div key={search.id} className="nl-web-search">
          <p>
            {search.status === "searching" && <LoaderCircle size={12} />}{" "}
            {search.query}
          </p>
          {search.error && <p role="status">{search.error}</p>}
          {search.status === "complete" && !search.results.length && (
            <p>No public research links found in this search.</p>
          )}
          <div className="nl-web-results">
            {search.results.map((result) => (
              <article key={result.url}>
                <small>
                  {labels[result.platform]} · {new URL(result.url).hostname} ·{" "}
                  {result.publishedAt
                    ? new Date(result.publishedAt).toISOString().slice(0, 10)
                    : "Date unavailable"}
                </small>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  {result.title} <ExternalLink size={12} />
                </a>
                {result.excerpt && <p>{result.excerpt.slice(0, 260)}</p>}
                <small>Footage and views unverified</small>
              </article>
            ))}
          </div>
        </div>
      ))}
      <p className="nl-caption">
        Research links, not verified viral videos. Video import and view checks
        happen separately.
      </p>
    </section>
  );
}
