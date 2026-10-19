"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Film,
  Link2,
  LoaderCircle,
  PawPrint,
  ScanLine,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Project } from "@/lib/domain";
import {
  campaignBriefInput,
  dancingDogsExample,
  emptyCampaign,
  type CampaignBriefInput,
} from "@/lib/campaign";

export function CampaignLab({
  project,
  onSave,
  onAnalyze,
  onUpload,
  onStoryboard,
}: {
  project: Project;
  onSave: (campaign: CampaignBriefInput) => Promise<boolean>;
  onAnalyze: () => Promise<void>;
  onUpload: () => void;
  onStoryboard: () => void;
}) {
  const source = project.campaign || emptyCampaign();
  const [draft, setDraft] = useState<CampaignBriefInput>(source);
  const [links, setLinks] = useState(source.urls.join("\n"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [example, setExample] = useState(false);
  const analysis = project.campaignAnalyses?.at(-1);
  const stale = analysis && analysis.sourceRevision !== source.revision;
  const media = project.assets.filter(
    (a) =>
      (a.origin === "upload" || a.origin === "social") &&
      /^(image|video)\//.test(a.mime),
  );
  const selected = media.find((a) => draft.assetIds.includes(a.id));
  const parsed = campaignBriefInput.safeParse({
    ...draft,
    urls: links
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  const dirty =
    !project.campaign ||
    !parsed.success ||
    JSON.stringify(parsed.data) !==
      JSON.stringify(campaignBriefInput.parse(source));

  async function save(andAnalyze = false) {
    setError("");
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message || "Check your campaign reference.",
      );
      return;
    }
    if (
      andAnalyze &&
      !parsed.data.notes.trim() &&
      !parsed.data.assetIds.length
    ) {
      setError(
        "Add a reference clip or describe the campaign. A link alone cannot be inspected here.",
      );
      return;
    }
    setSaving(true);
    try {
      if (!(await onSave(parsed.data))) return;
      if (andAnalyze) await onAnalyze();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="campaign-lab" aria-label="Campaign reverse engineering">
      <div className="campaign-hero">
        <div className="section-kicker">
          <ScanLine size={13} /> CAMPAIGN LAB / 01
        </div>
        <h2>
          Find the pattern.
          <br />
          <span>Make it your launch.</span>
        </h2>
        <p>
          Bring a campaign you can’t stop watching. M3.1 breaks down its
          creative structure, then directs a new film for your brand.
        </p>
        <div className="campaign-flow">
          <span>Reference</span>
          <ArrowRight size={12} />
          <span>Creative DNA</span>
          <ArrowRight size={12} />
          <span>Launch film</span>
        </div>
      </div>

      <button
        className="campaign-example"
        onClick={() => {
          const preset = dancingDogsExample();
          setDraft(preset);
          setLinks(preset.urls.join("\n"));
          setExample(true);
          setError("");
        }}
      >
        <span className="campaign-paw">
          <PawPrint size={23} />
        </span>
        <span>
          <small>TRY A CREATIVE STARTING POINT</small>
          <strong>Dancing dogs. Your next campaign.</strong>
          <em>Unexpected lead → dance cue → bigger stage → loop</em>
        </span>
        <ArrowRight size={17} />
      </button>
      {example && (
        <p className="campaign-notice">
          Example brief loaded. Add the exact clip to inspect it; source timing
          and choreography are unverified.
        </p>
      )}

      <div className="campaign-card">
        <div className="campaign-card-heading">
          <span className="section-kicker">01 / THE REFERENCE</span>
          <span className="campaign-tag">
            {draft.assetIds.length ? "Clip attached" : "Link + notes"}
          </span>
        </div>
        <label className="field-label" htmlFor="campaign-title">
          CAMPAIGN OR TREND
        </label>
        <input
          id="campaign-title"
          value={draft.title}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <label className="field-label" htmlFor="campaign-links">
          SOURCE LINKS · ONE PER LINE
        </label>
        <div className="campaign-link-input">
          <Link2 size={14} />
          <textarea
            id="campaign-links"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="https://www.tiktok.com/@creator/video/…"
            rows={2}
          />
        </div>
        <p className="campaign-hint">
          Links preserve attribution. Upload the clip for visual inspection;
          posts are not imported automatically.
        </p>
        <div className="campaign-clip-picker">
          <label className="field-label" htmlFor="campaign-clip">
            REFERENCE CLIP OR IMAGE
          </label>
          <select
            id="campaign-clip"
            value={draft.assetIds[0] || ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                assetIds: e.target.value ? [e.target.value] : [],
              })
            }
          >
            <option value="">Choose from your media library</option>
            {media.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="text-button" onClick={onUpload}>
            <Upload size={12} /> Upload reference
          </button>
        </div>
        {selected && (
          <div className="campaign-source-preview">
            {selected.mime.startsWith("video/") ? (
              <video
                controls
                preload="metadata"
                src={`/api/media/${encodeURIComponent(selected.id)}`}
              />
            ) : (
              <img
                alt={selected.name}
                src={`/api/media/${encodeURIComponent(selected.id)}`}
              />
            )}
            <span>{selected.name} · original reference</span>
          </div>
        )}
        <label className="field-label" htmlFor="campaign-notes">
          WHAT HAPPENS IN THE CAMPAIGN?
        </label>
        <textarea
          id="campaign-notes"
          value={draft.notes}
          maxLength={6000}
          rows={3}
          placeholder="The opening, reveal, visual motif, recurring joke or details you want M3.1 to study…"
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      <div className="campaign-card">
        <div className="campaign-card-heading">
          <span className="section-kicker">02 / YOUR VERSION</span>
          <Film size={14} />
        </div>
        <div className="campaign-brand-row">
          <div>
            <label className="field-label" htmlFor="campaign-brand">
              BRAND / LAUNCH
            </label>
            <input
              id="campaign-brand"
              value={draft.brand}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="campaign-format">
              DELIVERY
            </label>
            <select
              id="campaign-format"
              value={draft.ratio}
              onChange={(e) =>
                setDraft({ ...draft, ratio: e.target.value as "9:16" | "16:9" })
              }
            >
              <option value="9:16">9:16 · social</option>
              <option value="16:9">16:9 · widescreen</option>
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="campaign-goal">
          WHAT SHOULD THE FILM DO?
        </label>
        <textarea
          id="campaign-goal"
          value={draft.goal}
          maxLength={2500}
          rows={4}
          onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
        />
        <p className="campaign-hint">
          M3.1 develops the story. MiniMax H3 makes the footage. eve keeps the
          production session moving.
        </p>
        {error && (
          <p className="campaign-error" role="alert">
            {error}
          </p>
        )}
        <div className="campaign-actions">
          <button
            className="button secondary"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {!dirty ? <Check size={13} /> : null}
            {dirty ? "Save reference" : "Reference saved"}
          </button>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save(true)}
          >
            {saving ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Decode & pitch the launch
          </button>
        </div>
      </div>

      {analysis ? (
        <div className="campaign-analysis">
          <div className="campaign-card-heading">
            <span className="section-kicker">03 / CREATIVE DNA</span>
            <span className={`campaign-tag ${stale ? "stale" : ""}`}>
              {stale
                ? "Reference changed · analyze again"
                : analysis.basis === "sampled_frames"
                  ? "M3.1 · sampled visual evidence"
                  : "M3.1 · notes-only hypothesis"}
            </span>
          </div>
          <div className="campaign-dna-grid">
            {(
              [
                ["The hook", analysis.hook],
                ["Visual signature", analysis.visualPattern],
                ["Pacing & escalation", analysis.pacing],
                ["The payoff", analysis.payoff],
                ["The loop", analysis.loop],
                ["New audio direction", analysis.audioPlan],
              ] as const
            ).map(([label, value], i) => (
              <article key={label}>
                <span>0{i + 1}</span>
                <h3>{label}</h3>
                <p>{value}</p>
              </article>
            ))}
          </div>
          {analysis.observations.length > 0 && (
            <div className="campaign-evidence">
              <h3>Visible in the sampled frames</h3>
              {analysis.observations.map((o, i) => (
                <p key={i}>
                  <b>{o.seconds.toFixed(2)}s</b>
                  {o.detail}
                  <small>
                    {project.assets.find((a) => a.id === o.assetId)?.name}
                  </small>
                </p>
              ))}
              <p className="campaign-hint">
                Still frames cannot verify all movement or the soundtrack.
              </p>
            </div>
          )}
          <div className="campaign-hypotheses">
            <h3>Creative hypotheses</h3>
            <p className="campaign-hint">
              Interpretations to test, not proven causes of engagement.
            </p>
            {analysis.hypotheses.map((h, i) => (
              <p key={i}>{h}</p>
            ))}
          </div>
          <div className="campaign-translation">
            <div>
              <span className="section-kicker">KEEP THE MECHANISM</span>
              {analysis.keep.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </div>
            <div>
              <span className="section-kicker">MAKE IT OURS</span>
              {analysis.change.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </div>
          </div>
          <div className="campaign-launch-angle">
            <Sparkles size={17} />
            <div>
              <span className="section-kicker">THE MINIMAX LAUNCH ANGLE</span>
              <p>{analysis.launchAngle}</p>
            </div>
          </div>
          <h3 className="campaign-timeline-title">
            Proposed launch-film beats
          </h3>
          <div className="campaign-beats">
            {analysis.beats.map((beat, i) => (
              <div key={i}>
                <span>
                  {beat.start}–{beat.end}s
                </span>
                <strong>{beat.label}</strong>
                <p>{beat.adaptation}</p>
              </div>
            ))}
          </div>
          <button className="button primary" onClick={onStoryboard}>
            Open the launch storyboard
            <ArrowRight size={14} />
          </button>
          <p className="campaign-hint">
            Choose a treatment in the storyboard before generating a test shot.
          </p>
        </div>
      ) : (
        <div className="campaign-empty-analysis">
          <ScanLine size={22} />
          <h3>A reference becomes a creative brief.</h3>
          <p>
            The breakdown will map the hook, visual pattern, pacing, payoff and
            loop into your launch film. Nothing has been analyzed or generated
            yet.
          </p>
        </div>
      )}
      {source.urls.length > 0 && (
        <div className="campaign-attribution">
          <span className="section-kicker">SAVED SOURCE ATTRIBUTION</span>
          {source.urls.map((url, i) => (
            <a href={url} target="_blank" rel="noreferrer" key={url}>
              Reference {i + 1} · {new URL(url).hostname}
              <ExternalLink size={11} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
