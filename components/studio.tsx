"use client";
import { uploadStudioFile } from "@/lib/upload-client";

import { DirectorText } from "./director-text";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  ImageIcon,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MoreHorizontal,
  ScanLine,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { openConversationInputs, useEveAgent } from "eve/react";
import type { Asset, ConnectionStatus, Project, Shot } from "@/lib/domain";
import { acceptedAsset, isActiveJob, projectRatio } from "@/lib/domain";
import { CampaignLab } from "./campaign-lab";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "The operation could not be completed.");
  return body as T;
}
async function mutate(input: Record<string, unknown>) {
  return request("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
const mediaUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
const timecode = (seconds: number) =>
  `00:${String(Math.floor(seconds)).padStart(2, "0")}`;

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function Studio() {
  const [project, setProject] = useState<Project>();
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setProject(await request<Project>("/api/project"));
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<Project>("/api/project"),
      request<ConnectionStatus>("/api/status"),
    ])
      .then(([p, s]) => {
        if (active) {
          setProject(p);
          setStatus(s);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const interval = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refresh]);
  if (!project || !status)
    return (
      <main className="loading-screen">
        <Mark />
        <p>{error || "Opening the director’s room"}</p>
        {!error && <LoaderCircle className="spin" size={18} />}
      </main>
    );
  return <Workspace project={project} status={status} refresh={refresh} />;
}

function Workspace({
  project,
  status,
  refresh,
}: {
  project: Project;
  status: ConnectionStatus;
  refresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(project.shots[0].id);
  const [tab, setTab] = useState<
    "campaign" | "storyboard" | "assets" | "activity"
  >("campaign");
  const [rightTab, setRightTab] = useState<"director" | "details">("director");
  const [setup, setSetup] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState(project.brief);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [takeId, setTakeId] = useState<string>();
  const [compare, setCompare] = useState(false);
  const [viewExport, setViewExport] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shot =
    project.shots.find((s) => s.id === selectedId) || project.shots[0];
  const take = shot.takes.find((t) => t.id === takeId) || shot.takes.at(-1);
  const selectedAssetId = take?.assetId || acceptedAsset(shot);
  const asset = project.assets.find((a) => a.id === selectedAssetId);
  const accepted = shot.takes.find((t) => t.id === shot.acceptedTakeId);
  const total = project.shots.reduce((sum, s) => sum + s.duration, 0);
  const activeJobs = project.jobs.filter(isActiveJob);
  const exportCut = project.cuts.at(-1);
  const exportAsset = project.assets.find((a) => a.id === exportCut?.assetId);
  const canExport = project.shots.every(
    (s) => s.kind === "title" || acceptedAsset(s),
  );
  const chatSend = useRef<(text: string) => Promise<void>>(async () => {});

  async function perform(input: Record<string, unknown>, label = "") {
    setBusy(label);
    try {
      await mutate(input);
      await refresh();
      return true;
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not complete that action.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  function selectShot(id: string) {
    setSelectedId(id);
    setTakeId(undefined);
    setCompare(false);
    setViewExport(false);
  }
  async function send(text: string) {
    setRightTab("director");
    if (!status.text) {
      setSetup(true);
      return;
    }
    await chatSend.current(text);
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    try {
      for (const file of Array.from(files)) {
        await uploadStudioFile(file);
      }
      await refresh();
      setTab(tab === "campaign" ? "campaign" : "assets");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy("");
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  function exportManifest() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "campaign-production-log.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="studio-shell">
      <nav className="icon-rail" aria-label="Workspace navigation">
        <a className="rail-logo" href="/" aria-label="Director’s Room home">
          <Mark small />
        </a>
        <button
          className={tab === "campaign" ? "rail-button active" : "rail-button"}
          onClick={() => setTab("campaign")}
          title="Campaign lab"
        >
          <ScanLine size={19} />
        </button>
        <button
          className={
            tab === "storyboard" ? "rail-button active" : "rail-button"
          }
          onClick={() => setTab("storyboard")}
          title="Storyboard"
        >
          <Clapperboard size={19} />
        </button>
        <button
          className={tab === "assets" ? "rail-button active" : "rail-button"}
          onClick={() => setTab("assets")}
          title="Media library"
        >
          <FolderOpen size={19} />
        </button>
        <button
          className={tab === "activity" ? "rail-button active" : "rail-button"}
          onClick={() => setTab("activity")}
          title="Production activity"
        >
          <Layers3 size={19} />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-button"
          onClick={() => setSetup(true)}
          title="Connection settings"
        >
          <Settings2 size={19} />
        </button>
        <button
          className="avatar"
          onClick={() => setSetup(true)}
          title="Private local workspace"
        >
          M
        </button>
      </nav>

      <div className="studio-app">
        <header className="topbar">
          <div className="wordmark">
            Campaign <span>studio</span>
            <span className="beta">LAB</span>
          </div>
          <div className="topbar-divider" />
          <div className="breadcrumb">
            Launch films <ChevronRight size={13} />
            <strong>M3.1 — Campaign to launch</strong>
            <ChevronDown size={13} />
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <LockKeyhole size={12} /> Private workspace
            </span>
            <button
              className="icon-button"
              title="Connection settings"
              onClick={() => setSetup(true)}
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
        </header>

        <div className="project-bar">
          <div>
            <div className="eyebrow">MINIMAX M3.1 LAUNCH FILM</div>
            <h1>
              Director’s room
              <span className="project-dot" />
            </h1>
          </div>
          <div className="project-actions">
            <button
              className="button secondary"
              onClick={() => {
                setBrief(project.brief);
                setBriefOpen(true);
              }}
            >
              <Film size={14} />
              The brief
            </button>
            <button
              className="button primary"
              disabled={Boolean(busy) || !canExport || !status.ffmpeg}
              title={
                !canExport
                  ? "Accept footage for each shot to export the film"
                  : "Assemble accepted shots as an MP4"
              }
              onClick={() => void perform({ action: "export" }, "export")}
            >
              {busy === "export" ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <ArrowUp className="export-arrow" size={14} />
              )}
              Export film
            </button>
          </div>
        </div>

        <div className="workspace-grid">
          <aside className="project-sidebar">
            <div className="project-cover">
              <span className="cover-tag">A FILM DIRECTED WITH</span>
              <strong>
                MiniMax
                <br />
                M3.1<span>↗</span>
              </strong>
              <div className="cover-bottom">
                INTRODUCE YOURSELF.<span>01 / 01</span>
              </div>
              <div className="cover-orbit" />
            </div>
            <div className="sidebar-section-label">PRODUCTION</div>
            <button
              className={`sidebar-nav ${tab === "campaign" ? "active" : ""}`}
              onClick={() => setTab("campaign")}
            >
              <ScanLine size={15} />
              Campaign lab<span>01</span>
            </button>
            <button
              className={`sidebar-nav ${tab === "storyboard" ? "active" : ""}`}
              onClick={() => setTab("storyboard")}
            >
              <Clapperboard size={15} />
              Storyboard
              <span>{project.shots.length.toString().padStart(2, "0")}</span>
            </button>
            <button
              className={`sidebar-nav ${tab === "assets" ? "active" : ""}`}
              onClick={() => setTab("assets")}
            >
              <FolderOpen size={15} />
              Media library
              <span>
                {project.assets
                  .filter((a) => a.origin !== "export")
                  .length.toString()
                  .padStart(2, "0")}
              </span>
            </button>
            <button
              className={`sidebar-nav ${tab === "activity" ? "active" : ""}`}
              onClick={() => setTab("activity")}
            >
              <Layers3 size={15} />
              Activity{activeJobs.length > 0 && <span className="live-dot" />}
            </button>
            <div className="sidebar-rule" />
            <div className="sidebar-section-label">
              THE IDEA{" "}
              <button
                className="text-icon"
                aria-label="Edit brief"
                onClick={() => {
                  setBrief(project.brief);
                  setBriefOpen(true);
                }}
              >
                <Settings2 size={12} />
              </button>
            </div>
            <p className="sidebar-brief">
              Decode the campaign you love.
              <br />
              <span>M3.1 directs what comes next.</span>
            </p>
            <div className="format-tags">
              <span>{total}s film</span>
              <span>{projectRatio(project)}</span>
              <span>H3</span>
            </div>
            <div className="sidebar-rule" />
            <div className="sidebar-section-label">REFERENCE MATERIAL</div>
            {project.assets
              .filter((a) => a.origin === "upload")
              .slice(0, 3)
              .map((a) => (
                <button
                  key={a.id}
                  className="small-asset"
                  onClick={() => setTab("assets")}
                >
                  {a.mime.startsWith("image") ? (
                    <ImageIcon size={13} />
                  ) : (
                    <Film size={13} />
                  )}
                  <span>{a.name}</span>
                  <Check size={11} />
                </button>
              ))}
            <button
              className="add-reference"
              onClick={() => uploadInput.current?.click()}
              disabled={Boolean(busy)}
            >
              <Plus size={14} />
              {busy === "upload" ? "Uploading…" : "Add footage & references"}
            </button>
            <div className="sidebar-spacer" />
            <button className="connection-card" onClick={() => setSetup(true)}>
              <span
                className={`status-dot ${status.text && status.video ? "connected" : ""}`}
              />
              <div>
                <strong>
                  {status.text && status.video
                    ? "MiniMax connected"
                    : "Connect MiniMax"}
                </strong>
                <span>
                  {status.text && status.video
                    ? "M3.1 + H3 · local studio"
                    : "Bring your director online"}
                </span>
              </div>
              <ChevronRight size={14} />
            </button>
            <div className="built-with">
              <span className="vercel-triangle" />
              Powered by <strong>eve</strong>
            </div>
          </aside>

          <main className="editor-area">
            <div className="editor-tabs">
              <div className="tab-list">
                {(
                  ["campaign", "storyboard", "assets", "activity"] as const
                ).map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t === "campaign"
                      ? "Campaign lab"
                      : t === "storyboard"
                        ? "Storyboard"
                        : t === "assets"
                          ? "Media library"
                          : "Activity"}
                  </button>
                ))}
              </div>
              <span className="saved-label">
                <Check size={11} />
                Saved locally
              </span>
            </div>
            {tab === "campaign" && (
              <CampaignLab
                key={project.campaign?.revision || 0}
                project={project}
                onSave={(campaign) =>
                  perform({ action: "campaign", campaign }, "campaign")
                }
                onUpload={() => uploadInput.current?.click()}
                onStoryboard={() => setTab("storyboard")}
                onAnalyze={() =>
                  send(
                    "Decode the latest saved campaign reference for the user’s campaign film. Read get_project, inspect attached campaign assets with inspect_campaign_reference, and save_campaign_analysis with the current sourceRevision. If only links and notes exist, label the result as a notes-only hypothesis; you cannot fetch or watch a linked post. Separate visible evidence from creative hypotheses. Then save exactly three distinctive launch-film treatments. Do not render or change locked shots.",
                  )
                }
              />
            )}
            {tab === "storyboard" && (
              <>
                {project.treatments.length > 0 && (
                  <div className="treatments">
                    <div className="section-kicker">
                      <Sparkles size={13} />
                      CREATIVE DIRECTIONS
                    </div>
                    <div className="treatment-grid">
                      {project.treatments.map((t, i) => (
                        <button
                          key={t.id}
                          className={`treatment ${project.selectedTreatmentId === t.id ? "selected" : ""}`}
                          title={t.visualDirection}
                          onClick={async () => {
                            const selected = await perform({
                              action: "treatment",
                              treatmentId: t.id,
                            });
                            if (!selected) return;
                            await send(
                              `I choose the treatment “${t.title}” (${t.id}). Develop the existing shot board for this direction. Do not render yet.`,
                            );
                          }}
                        >
                          <span>
                            0{i + 1}
                            {project.selectedTreatmentId === t.id && (
                              <Check size={12} />
                            )}
                          </span>
                          <strong>{t.title}</strong>
                          <p>{t.logline}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="preview-heading">
                  <span>
                    <span className="tiny-square" />
                    {viewExport ? "LAST EXPORTED CUT" : "PREVIEW"}
                  </span>
                  <div>
                    <button
                      className={compare ? "active" : ""}
                      disabled={
                        !accepted ||
                        !take ||
                        accepted.id === take.id ||
                        viewExport
                      }
                      onClick={() => setCompare(!compare)}
                    >
                      <Layers3 size={12} />
                      Compare takes
                    </button>
                    <span className="preview-ratio">
                      {projectRatio(project)}
                    </span>
                  </div>
                </div>
                <div
                  className={`preview-stage ${projectRatio(project) === "9:16" ? "portrait" : ""}`}
                  ref={stageRef}
                >
                  {compare && accepted && take ? (
                    <div className="comparison">
                      <div>
                        <span>ACCEPTED</span>
                        <video controls src={mediaUrl(accepted.assetId)} />
                      </div>
                      <div>
                        <span>NEW TAKE</span>
                        <video controls src={mediaUrl(take.assetId)} />
                      </div>
                    </div>
                  ) : viewExport && exportAsset ? (
                    <video
                      key={exportAsset.id}
                      controls
                      autoPlay
                      className="stage-video"
                      src={mediaUrl(exportAsset.id)}
                    />
                  ) : asset ? (
                    <video
                      key={asset.id}
                      className="stage-video"
                      controls
                      src={mediaUrl(asset.id)}
                    />
                  ) : (
                    <ConceptFrame shot={shot} />
                  )}
                  {!asset && !viewExport && (
                    <span className="board-label">
                      {shot.kind === "title"
                        ? "TITLE CARD"
                        : "CONCEPT BOARD · AWAITING FOOTAGE"}
                    </span>
                  )}
                  <button
                    className="fullscreen"
                    aria-label="Fullscreen preview"
                    onClick={() =>
                      void stageRef.current
                        ?.requestFullscreen()
                        .catch(() =>
                          setToast(
                            "Fullscreen is unavailable in this browser.",
                          ),
                        )
                    }
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
                <div className="preview-caption">
                  <div>
                    <span className="shot-number">
                      {String(project.shots.indexOf(shot) + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {viewExport ? "Launch film export" : shot.title}
                    </strong>
                    <span className="caption-divider">/</span>
                    <span>
                      {viewExport
                        ? `${exportAsset?.duration || total}s`
                        : `${shot.duration}s`}
                    </span>
                  </div>
                  <div>
                    {shot.takes.length > 0 && !viewExport && (
                      <select
                        aria-label="Preview take"
                        value={take?.id || ""}
                        onChange={(e) => setTakeId(e.target.value)}
                      >
                        {shot.takes.map((t, i) => (
                          <option key={t.id} value={t.id}>
                            Take {String(i + 1).padStart(2, "0")}
                            {t.id === shot.acceptedTakeId ? " · accepted" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {exportAsset && (
                      <button
                        className="text-button"
                        onClick={() => setViewExport(!viewExport)}
                      >
                        {viewExport ? "Back to shot" : "Play last export"}
                        <Play size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="shot-description">
                  <p>{shot.description}</p>
                  <div>
                    {take && take.id !== shot.acceptedTakeId && (
                      <button
                        className="button tiny primary"
                        disabled={shot.locked || Boolean(busy)}
                        onClick={() =>
                          void perform({
                            action: "accept",
                            shotId: shot.id,
                            takeId: take.id,
                          })
                        }
                      >
                        <Check size={12} />
                        Accept take
                      </button>
                    )}
                    <button
                      className={`button tiny ${shot.locked ? "locked-button" : "secondary"}`}
                      onClick={() =>
                        void perform({
                          action: "lock",
                          shotId: shot.id,
                          locked: !shot.locked,
                        })
                      }
                    >
                      <LockKeyhole size={12} />
                      {shot.locked ? "Locked" : "Lock shot"}
                    </button>
                    <button
                      className="button tiny secondary"
                      onClick={() => setRightTab("details")}
                    >
                      <SlidersHorizontal size={12} />
                      Shot details
                    </button>
                  </div>
                </div>

                <div className="timeline-heading">
                  <div>
                    <span className="section-kicker">THE SEQUENCE</span>
                    <span className="muted">
                      {project.shots.length} shots · {timecode(total)}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    onClick={exportManifest}
                    title="Download production manifest"
                  >
                    <Download size={14} />
                  </button>
                </div>
                <div className="timeline-ruler">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i}>{timecode((total * i) / 6)}</span>
                  ))}
                </div>
                <div className="shot-timeline">
                  {project.shots.map((s, i) => {
                    const latest = s.takes.at(-1);
                    const pending = project.jobs.find(
                      (j) => j.shotId === s.id && isActiveJob(j),
                    );
                    return (
                      <button
                        key={s.id}
                        className={`timeline-shot ${s.id === shot.id ? "selected" : ""}`}
                        onClick={() => selectShot(s.id)}
                        style={{ flex: Math.max(s.duration, 5) }}
                      >
                        <div className={`shot-art art-${i}`}>
                          <span className="art-grid" />
                          <span className="art-shape" />
                          <b>
                            {i === 0
                              ? "The brief."
                              : i === 1
                                ? "An idea, in motion."
                                : i === 2
                                  ? "A world, reimagined."
                                  : "MiniMax M3.1"}
                          </b>
                          <span className="thumb-number">0{i + 1}</span>
                          {s.locked && (
                            <LockKeyhole className="thumb-lock" size={10} />
                          )}
                          {pending && (
                            <LoaderCircle
                              className="thumb-lock spin"
                              size={12}
                            />
                          )}
                        </div>
                        <div className="timeline-shot-label">
                          <span>{s.title}</span>
                          <small>{s.duration}s</small>
                        </div>
                        <div
                          className={`shot-state ${s.acceptedTakeId || s.kind === "title" ? "ready" : ""}`}
                        >
                          <span />
                          {pending
                            ? pending.status === "unknown"
                              ? "Needs recovery"
                              : "Rendering"
                            : s.acceptedTakeId
                              ? "Accepted"
                              : latest
                                ? "Review take"
                                : s.kind === "source"
                                  ? "Add footage"
                                  : s.kind === "title"
                                    ? "Title card"
                                    : "Planned"}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="audio-track">
                  <AudioLines size={13} />
                  <span>Source audio is kept in your export</span>
                  <div className="waveform" aria-hidden="true">
                    {Array.from({ length: 65 }, (_, i) => (
                      <i key={i} style={{ height: 3 + ((i * 7 + 3) % 11) }} />
                    ))}
                  </div>
                  <span>NATIVE AUDIO</span>
                </div>
                <div className="editor-bottom-note">
                  <ShieldCheck size={12} />
                  Accepted shots stay locked. Every revision gets a new take.
                </div>
              </>
            )}

            {tab === "assets" && (
              <div className="library-view">
                <div className="view-heading">
                  <div>
                    <h2>Your source material</h2>
                    <p>Footage, visual references and generated takes.</p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => uploadInput.current?.click()}
                    disabled={Boolean(busy)}
                  >
                    <Upload size={13} />
                    Upload
                  </button>
                </div>
                <div
                  className="upload-zone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void upload(e.dataTransfer.files);
                  }}
                >
                  <FolderOpen size={24} />
                  <strong>Drop the first frame of your film.</strong>
                  <p>MP4, MOV, images or audio · up to 32 MB each</p>
                  <button
                    className="text-button"
                    onClick={() => uploadInput.current?.click()}
                  >
                    Choose files
                    <ArrowRight size={13} />
                  </button>
                </div>
                {project.assets.length > 0 && (
                  <div className="asset-grid">
                    {project.assets
                      .filter((a) => a.origin !== "export")
                      .map((a) => (
                        <AssetCard
                          key={a.id}
                          asset={a}
                          shot={shot}
                          onReference={() => {
                            void perform({
                              action: "shot",
                              shot: {
                                ...shot,
                                referenceIds: shot.referenceIds.includes(a.id)
                                  ? shot.referenceIds.filter(
                                      (id) => id !== a.id,
                                    )
                                  : [...shot.referenceIds, a.id],
                              },
                            });
                          }}
                          onAssign={() => {
                            void perform({
                              action: "assign",
                              shotId: shot.id,
                              assetId: a.id,
                            });
                          }}
                        />
                      ))}
                  </div>
                )}
                <p className="library-note">
                  References for H3: video and audio clips must be 2–15 seconds.
                  Use MP4 for video references. Select a shot in Storyboard
                  before assigning media.
                </p>
              </div>
            )}

            {tab === "activity" && (
              <div className="activity-view">
                <div className="view-heading">
                  <div>
                    <h2>Behind the film</h2>
                    <p>
                      The actual production record, from brief to final cut.
                    </p>
                  </div>
                  <button className="button secondary" onClick={exportManifest}>
                    <Download size={13} />
                    Save log
                  </button>
                </div>
                {project.jobs.map((job) => (
                  <div className="job-card" key={job.id}>
                    <div>
                      <span
                        className={`status-dot ${job.status === "succeeded" ? "connected" : ""}`}
                      />
                      <strong>
                        {project.shots.find((s) => s.id === job.shotId)?.title}
                      </strong>
                      <span className="job-status">{job.status}</span>
                    </div>
                    <p>
                      MiniMax H3 · {job.duration}s · {job.resolution}
                    </p>
                    {job.taskId && <code>Task {job.taskId}</code>}
                    {job.error && <p className="job-error">{job.error}</p>}
                    {job.taskId &&
                      job.status !== "succeeded" &&
                      job.status !== "failed" && (
                        <button
                          className="button tiny secondary"
                          onClick={() =>
                            void perform(
                              { action: "check-job", jobId: job.id },
                              job.id,
                            )
                          }
                          disabled={Boolean(busy)}
                        >
                          Check provider status
                        </button>
                      )}
                    {!job.taskId &&
                      ["unknown", "submitting"].includes(job.status) && (
                        <form
                          className="recover-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            void perform({
                              action: "recover-job",
                              jobId: job.id,
                              taskId: String(data.get("taskId")),
                            });
                          }}
                        >
                          <input
                            name="taskId"
                            required
                            placeholder="Task ID from MiniMax console"
                            aria-label="Recovered MiniMax task ID"
                          />
                          <button className="button tiny secondary">
                            Attach task
                          </button>
                        </form>
                      )}
                  </div>
                ))}
                {project.events.length ? (
                  <div className="event-list">
                    {project.events
                      .slice()
                      .reverse()
                      .map((e) => (
                        <div className="production-event" key={e.id}>
                          <span className="event-dot" />
                          <div>
                            <p>{e.message}</p>
                            <small>
                              {new Date(e.at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </small>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="empty-activity">
                    <Layers3 size={30} />
                    <h3>The making-of starts here.</h3>
                    <p>
                      Upload footage or give M3.1 the brief. Real production
                      events will appear as the work happens.
                    </p>
                  </div>
                )}
                {exportAsset && (
                  <a
                    className="button primary download-cut"
                    href={`${mediaUrl(exportAsset.id)}?download`}
                  >
                    <ArrowDownToLine size={14} />
                    Download last exported film
                  </a>
                )}
              </div>
            )}
          </main>

          <aside className="director-panel">
            <div className="director-tabs">
              <button
                className={rightTab === "director" ? "active" : ""}
                onClick={() => setRightTab("director")}
              >
                <Sparkles size={13} />
                Director
              </button>
              <button
                className={rightTab === "details" ? "active" : ""}
                onClick={() => setRightTab("details")}
              >
                <Settings2 size={13} />
                Shot details
              </button>
            </div>
            <div
              className="director-body"
              style={{ display: rightTab === "director" ? "flex" : "none" }}
            >
              <DirectorChat
                project={project}
                status={status}
                selectedShot={shot}
                refresh={refresh}
                onSetup={() => setSetup(true)}
                onError={setToast}
                sendRef={chatSend}
              />
            </div>
            {rightTab === "details" && (
              <ShotInspector
                key={`${shot.id}-${shot.revision}`}
                shot={shot}
                project={project}
                busy={Boolean(busy)}
                onSave={(s) => void perform({ action: "shot", shot: s })}
                onRender={() =>
                  void send(
                    `Render only selected shot ${shot.id} using MiniMax H3 at 768P. First read the project and ensure this shot’s prompt and references fit the selected treatment. Preserve all other shots. Inspect the returned take after generation.`,
                  )
                }
                onAssets={() => setTab("assets")}
                onUnlock={() =>
                  void perform({
                    action: "lock",
                    shotId: shot.id,
                    locked: false,
                  })
                }
              />
            )}
          </aside>
        </div>
        <footer className="statusbar">
          <div>
            <span className="status-dot connected" />
            Local studio<span>·</span>
            {activeJobs.length
              ? `${activeJobs.length} pending render${activeJobs.length > 1 ? "s" : ""}`
              : "Ready when you are"}
          </div>
          <div>
            <span>DIRECTED WITH M3.1</span>
            <span>GENERATED WITH H3</span>
            <span>ORCHESTRATED WITH EVE</span>
          </div>
        </footer>
      </div>
      <input
        type="file"
        multiple
        hidden
        ref={uploadInput}
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav"
        onChange={(e) => void upload(e.target.files)}
      />
      {toast && (
        <div className="toast" role="alert">
          <CircleHelp size={16} />
          <p>{toast}</p>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {setup && (
        <Modal
          title="Connect your production team"
          onClose={() => setSetup(false)}
        >
          <p className="modal-intro">
            M3.1 directs. H3 generates. eve keeps the production moving.
          </p>
          <div className="connection-row">
            <span className={`status-dot ${status.text ? "connected" : ""}`} />
            <div>
              <strong>MiniMax M3.1</strong>
              <p>{status.model}</p>
            </div>
            <span>{status.text ? "Configured" : "Needs key"}</span>
          </div>
          <div className="connection-row">
            <span className={`status-dot ${status.video ? "connected" : ""}`} />
            <div>
              <strong>MiniMax H3</strong>
              <p>Pay-as-you-go video generation</p>
            </div>
            <span>{status.video ? "Configured" : "Needs key"}</span>
          </div>
          <div className="connection-row">
            <span
              className={`status-dot ${status.ffmpeg ? "connected" : ""}`}
            />
            <div>
              <strong>Film assembly</strong>
              <p>FFmpeg · local MP4 exports</p>
            </div>
            <span>{status.ffmpeg ? "Available" : "Install FFmpeg"}</span>
          </div>
          <div className="setup-instructions">
            <strong>Keep your keys on the server</strong>
            <p>
              Add your credentials to <code>.env.local</code> in the project
              folder, then restart the app. A text subscription key and an H3
              API key may be different.
            </p>
            <pre>MINIMAX_TEXT_API_KEY=…{"\n"}MINIMAX_VIDEO_API_KEY=…</pre>
            <p>
              For internal launch access, also set{" "}
              <code>MINIMAX_TEXT_MODEL</code> and{" "}
              <code>MINIMAX_TEXT_BASE_URL</code>. No keys are sent to this
              browser.
            </p>
          </div>
          <button
            className="button primary modal-done"
            onClick={() => setSetup(false)}
          >
            Back to the film
            <ArrowRight size={14} />
          </button>
        </Modal>
      )}
      {briefOpen && (
        <Modal
          title="Give your model its big break."
          onClose={() => setBriefOpen(false)}
        >
          <p className="modal-intro">
            The brief that starts the launch film. Add approved facts, tone and
            the story you want to tell.
          </p>
          <label className="field-label" htmlFor="brief">
            LAUNCH BRIEF
          </label>
          <textarea
            className="brief-editor"
            id="brief"
            rows={11}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="modal-footer">
            <span>Target: {total} seconds · 16:9</span>
            <button
              className="button primary"
              disabled={!brief.trim() || Boolean(busy)}
              onClick={async () => {
                if (await perform({ action: "brief", brief }, "brief"))
                  setBriefOpen(false);
              }}
            >
              Save brief
              <Check size={14} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConceptFrame({ shot }: { shot: Shot }) {
  return (
    <div
      className={`concept-frame concept-${shot.kind} ${shot.id === "shot_world" ? "concept-world" : ""}`}
    >
      <div className="stage-grain" />
      <div className="stage-grid" />
      <div className="stage-orbit orbit-one" />
      <div className="stage-orbit orbit-two" />
      <div className="stage-orbit orbit-three" />
      <div className="light-beam" />
      <div className="floating-frame">
        <span>▶</span>
        <i />
      </div>
      <div className="stage-type">
        <span>
          {shot.kind === "title" ? "YOUR CLOSING SCENE" : "YOUR CAMPAIGN FILM"}
        </span>
        <h2>
          {shot.kind === "title" ? (
            <>
              Your
              <br />
              <em>brand.</em>
            </>
          ) : (
            <>
              Introduce
              <br />
              <em>yourself.</em>
            </>
          )}
        </h2>
        <p>
          {shot.kind === "title"
            ? "An idea. A world. A launch."
            : "A scene shaped around your brief."}
        </p>
      </div>
      <span className="stage-corner">CONCEPT</span>
      <span className="stage-cross cross-one">+</span>
      <span className="stage-cross cross-two">+</span>
    </div>
  );
}

function AssetCard({
  asset,
  shot,
  onReference,
  onAssign,
}: {
  asset: Asset;
  shot: Shot;
  onReference: () => void;
  onAssign: () => void;
}) {
  return (
    <article className="asset-card">
      <div className="asset-preview">
        {asset.mime.startsWith("image/") ? (
          <img src={mediaUrl(asset.id)} alt={asset.name} />
        ) : asset.mime.startsWith("video/") ? (
          <video src={mediaUrl(asset.id)} controls preload="metadata" />
        ) : (
          <audio src={mediaUrl(asset.id)} controls />
        )}
      </div>
      <div className="asset-info">
        <strong title={asset.name}>{asset.name}</strong>
        <p>
          {asset.origin === "h3"
            ? "H3 take"
            : asset.origin === "social"
              ? "Imported reference"
              : asset.origin === "brand"
                ? "User-supplied brand artwork"
                : "Uploaded"}{" "}
          · {(asset.size / 1024 / 1024).toFixed(1)} MB
          {asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ""}
        </p>
        <div>
          <button
            disabled={shot.locked}
            onClick={onReference}
            className={
              shot.referenceIds.includes(asset.id)
                ? "asset-reference selected"
                : "asset-reference"
            }
          >
            {shot.referenceIds.includes(asset.id) ? (
              <Check size={11} />
            ) : (
              <Link2 size={11} />
            )}
            {shot.referenceIds.includes(asset.id)
              ? "Referenced"
              : "Use as reference"}
          </button>
          {asset.mime.startsWith("video/") && (
            <button
              className="asset-reference"
              disabled={shot.locked}
              onClick={onAssign}
            >
              Use footage
              <ArrowRight size={11} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function DirectorChat({
  project,
  status,
  selectedShot,
  refresh,
  onSetup,
  onError,
  sendRef,
}: {
  project: Project;
  status: ConnectionStatus;
  selectedShot: Shot;
  refresh: () => Promise<void>;
  onSetup: () => void;
  onError: (message: string) => void;
  sendRef: React.RefObject<(text: string) => Promise<void>>;
}) {
  const [message, setMessage] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const savedId = useRef(project.sessionId);
  const agent = useEveAgent({
    initialSession: project.sessionId
      ? { sessionId: project.sessionId, streamIndex: 0 }
      : undefined,
    resume: Boolean(project.sessionId),
    onSessionChange(session) {
      if (session && session.sessionId !== savedId.current) {
        savedId.current = session.sessionId;
        void mutate({ action: "session", sessionId: session.sessionId }).catch(
          (e) => onError(e.message),
        );
      }
    },
    onFinish() {
      void refresh().catch(() => {});
    },
  });
  const working = agent.status === "streaming" || agent.status === "submitted";
  const resuming = agent.status === "resuming";
  async function send(text: string) {
    if (!status.text) {
      onSetup();
      return;
    }
    try {
      await agent.send(text, working ? { turnPolicy: "steer" } : undefined);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Could not reach the director.",
      );
    }
  }
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [agent.data.messages, agent.status]);
  const pending = openConversationInputs(agent.data);
  return (
    <>
      <div className="director-identity">
        <div className="director-avatar">
          <Mark small />
        </div>
        <div>
          <strong>
            M3.1<span>CREATIVE DIRECTOR</span>
          </strong>
          <p>
            <span className={`status-dot ${status.text ? "connected" : ""}`} />
            {working
              ? "On set · working"
              : resuming
                ? "Reconnecting to the session"
                : status.text
                  ? "Ready for your direction"
                  : "Waiting for API connection"}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Director connection settings"
          onClick={onSetup}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="chat-scroll" ref={scroll}>
        <div className="chat-intro">
          <span className="intro-symbol">✳</span>
          <h2>
            Decode the campaign.
            <br />
            Direct what’s next.
          </h2>
          <p>
            Turn a social reference into your next campaign. Study the creative
            pattern, choose your interpretation, then make it with H3.
          </p>
          <div className="chat-capabilities">
            <span>
              <ImageIcon size={12} />
              Campaign DNA
            </span>
            <span>
              <Clapperboard size={12} />
              Shot planning
            </span>
            <span>
              <WandSparkles size={12} />
              H3 generation
            </span>
          </div>
        </div>
        {!agent.data.messages.length && (
          <div className="starter-prompts">
            <span className="section-kicker">LET’S MAKE SOMETHING</span>
            <button
              disabled={resuming}
              onClick={() =>
                void send(
                  "Read the saved campaign in get_project. Inspect its attached clips with inspect_campaign_reference and save_campaign_analysis. If only links and notes are available, make a clearly labelled notes-only hypothesis and explain what clip we need. Then save three original treatments for the user’s brand. Do not generate footage yet.",
                )
              }
            >
              Decode our campaign reference
              <ArrowUp size={13} />
            </button>
            <button
              disabled={resuming}
              onClick={() =>
                void send(
                  "Read the project brief and inspect our available references. Propose three distinctive treatments for the user’s campaign film. Save them to the workspace. Do not generate footage yet.",
                )
              }
            >
              Pitch three creative directions
              <ArrowUp size={13} />
            </button>
            <button
              disabled={resuming}
              onClick={() =>
                void send(
                  `Read the project and develop the selected shot ${selectedShot.id}. Explain which footage or references we need to shoot first. Do not generate yet.`,
                )
              }
            >
              Plan our first test shot
              <ArrowUp size={13} />
            </button>
          </div>
        )}
        {agent.data.messages.map((m) => (
          <article className={`chat-message ${m.role}`} key={m.id}>
            <div className="message-byline">
              {m.role === "user" ? "YOU" : "MINIMAX M3.1"}
            </div>
            {m.parts.map((part, i) =>
              part.type === "text" ? (
                <p key={part.id || i}>
                  {m.role === "assistant" ? (
                    <DirectorText text={part.text} />
                  ) : (
                    part.text
                  )}
                </p>
              ) : part.type === "dynamic-tool" ? (
                <div className="tool-activity" key={i}>
                  <span className="tool-dot" />
                  <span>
                    {part.toolMetadata?.eve?.label ||
                      part.toolName.replace(/_/g, " ")}
                  </span>
                </div>
              ) : null,
            )}
          </article>
        ))}
        {pending.map((input) => (
          <fieldset
            className="agent-question"
            disabled={resuming}
            key={input.request.requestId}
          >
            <legend>DIRECTOR’S CHECKPOINT</legend>
            <p>{input.request.prompt}</p>
            {input.request.options?.map((option) => (
              <button
                className="button tiny secondary"
                key={option.id}
                onClick={() =>
                  void agent
                    .respond([
                      {
                        requestId: input.request.requestId,
                        optionId: option.id,
                      },
                    ])
                    .catch((e) => onError(e.message))
                }
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        ))}
        {agent.error && (
          <div className="chat-error" role="alert">
            The director session needs attention. Check your model, endpoint and
            API key in connection settings. Your shots and task IDs are saved.
          </div>
        )}
        {working && (
          <div className="working-label">
            <LoaderCircle size={12} className="spin" />
            M3.1 is working on the film
            <button
              onClick={() =>
                void agent.cancel().catch((e) => onError(e.message))
              }
              title="Stop director turn"
            >
              <Square size={10} />
            </button>
          </div>
        )}
      </div>
      <div className="composer-wrap">
        <div className="selected-context">
          <span className="tiny-square" />
          SHOT{" "}
          {String(
            project.shots.findIndex((s) => s.id === selectedShot.id) + 1,
          ).padStart(2, "0")}
          <span>{selectedShot.title}</span>
          {selectedShot.locked && <LockKeyhole size={10} />}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim() && !resuming) {
              void send(`Selected shot: ${selectedShot.id}. ${message.trim()}`);
              setMessage("");
            }
          }}
        >
          <textarea
            aria-label="Give M3.1 direction"
            placeholder="Give your director a note…"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={resuming}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              {working
                ? "Your note will steer the current turn"
                : "M3.1 + MiniMax H3"}
            </span>
            <button
              aria-label="Send director note"
              disabled={!message.trim() || resuming}
              type="submit"
            >
              <ArrowUp size={17} />
            </button>
          </div>
        </form>
        <p className="composer-hint">
          You direct the vision. M3.1 brings it to the screen.
        </p>
      </div>
    </>
  );
}

function ShotInspector({
  shot,
  project,
  busy,
  onSave,
  onRender,
  onAssets,
  onUnlock,
}: {
  shot: Shot;
  project: Project;
  busy: boolean;
  onSave: (shot: Shot) => void;
  onRender: () => void;
  onAssets: () => void;
  onUnlock: () => void;
}) {
  const [draft, setDraft] = useState(shot);
  return (
    <div className="shot-inspector">
      <div className="inspector-heading">
        <span className="section-kicker">
          SHOT{" "}
          {String(
            project.shots.findIndex((s) => s.id === shot.id) + 1,
          ).padStart(2, "0")}
        </span>
        <h2>{shot.title}</h2>
        <p>
          {shot.kind === "generated"
            ? "H3 generation"
            : shot.kind === "source"
              ? "Original footage"
              : "Authored title card"}
        </p>
      </div>
      {shot.locked && (
        <div className="lock-notice">
          <LockKeyhole size={15} />
          <p>This shot is protected. Unlock it to make a revision.</p>
          <button className="text-button" onClick={onUnlock}>
            Unlock
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <label className="field-label" htmlFor="shot-title">
          SHOT NAME
        </label>
        <input
          id="shot-title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          disabled={shot.locked}
          required
          maxLength={100}
        />
        <div className="inspector-fields">
          <div>
            <label className="field-label" htmlFor="shot-duration">
              DURATION
            </label>
            <select
              id="shot-duration"
              value={draft.duration}
              onChange={(e) =>
                setDraft({ ...draft, duration: Number(e.target.value) })
              }
              disabled={shot.locked}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 4}>
                  {i + 4} seconds
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="shot-kind">
              SOURCE
            </label>
            <select
              id="shot-kind"
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as Shot["kind"] })
              }
              disabled={shot.locked}
            >
              <option value="source">Real footage</option>
              <option value="generated">MiniMax H3</option>
              <option value="title">Title card</option>
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="shot-description">
          THE SCENE
        </label>
        <textarea
          id="shot-description"
          rows={4}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          disabled={shot.locked}
          required
          maxLength={1200}
        />
        {draft.kind === "generated" && (
          <>
            <label className="field-label" htmlFor="shot-prompt">
              H3 PRODUCTION PROMPT
            </label>
            <textarea
              id="shot-prompt"
              rows={8}
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              disabled={shot.locked}
              maxLength={6000}
            />
          </>
        )}
        <label className="field-label">REFERENCES</label>
        <div className="inspector-references">
          {shot.referenceIds.map((id) => (
            <span key={id}>
              <Link2 size={11} />
              {project.assets.find((a) => a.id === id)?.name}
            </span>
          ))}
          <button type="button" className="text-button" onClick={onAssets}>
            <Plus size={12} />
            Choose from media library
          </button>
        </div>
        <button
          className="button secondary inspector-save"
          disabled={shot.locked || busy}
          type="submit"
        >
          Save shot plan
          <Check size={13} />
        </button>
      </form>
      {shot.kind === "generated" && (
        <button
          className="button primary inspector-render"
          disabled={shot.locked || busy}
          onClick={onRender}
        >
          <WandSparkles size={14} />
          Ask M3.1 to render this shot
        </button>
      )}
      <p className="inspector-note">
        New takes are candidates until you accept them. The accepted take stays
        in your cut.
      </p>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
