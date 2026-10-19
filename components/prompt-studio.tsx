"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openConversationInputs, useEveAgent } from "eve/react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  ExternalLink,
  Film,
  KeyRound,
  LoaderCircle,
  Paperclip,
  PawPrint,
  Play,
  ScanLine,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { Asset, ConnectionStatus, Project } from "@/lib/domain";
import {
  acceptedAsset,
  isActiveJob,
  projectRatio,
  planUsesCurrentSources,
} from "@/lib/domain";
import { TrendGallery } from "./trend-gallery";
import { DirectorText } from "./director-text";
import { FilmCrew } from "./film-crew";
import { sendWithSessionRecovery } from "@/lib/session-recovery";
import { MAX_CAMPAIGN_REFERENCES } from "@/lib/reference-limits";

const examples = [
  {
    label: "The dancing dogs launch",
    prompt:
      "Find the real dancing dogs videos, show me the trend, and study the footage. Then make an original 30-second MiniMax M3.1 launch film inspired by it. Let me choose the reference video, then handle the direction, generation, reviews and final export automatically.",
  },
  {
    label: "Remix a campaign",
    prompt:
      "Break down the hook, pacing and payoff of this campaign, then reimagine its creative structure as an original MiniMax M3.1 launch film: ",
  },
  {
    label: "Make the unexpected",
    prompt:
      "Make an unexpected 30-second MiniMax M3.1 launch film. An ordinary idea becomes an impossible production. Find strong video references for me to choose from. After my choice, handle everything through the finished branded MP4.",
  },
];
const mediaUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not complete that action.");
  return body as T;
}
async function mutate(input: Record<string, unknown>) {
  return api<Project>("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
function MiniMark() {
  return (
    <img
      className="nl-mark"
      src="/brand/minimax-symbol.ico"
      width={32}
      height={32}
      alt=""
    />
  );
}

export function PromptStudio() {
  const [project, setProject] = useState<Project>();
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<Project>("/api/project"),
      api<ConnectionStatus>("/api/status"),
    ]);
    setProject(p);
    setStatus(s);
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [p, s] = await Promise.all([
          api<Project>("/api/project"),
          api<ConnectionStatus>("/api/status"),
        ]);
        if (active) {
          setProject(p);
          setStatus(s);
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not open the studio.",
          );
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (!project || !status)
    return (
      <main className="nl-loading">
        <MiniMark />
        <p>{error || "Opening your studio…"}</p>
      </main>
    );
  return (
    <PromptWorkspace
      project={project}
      status={status}
      refresh={refresh}
      setProject={setProject}
    />
  );
}

function PromptWorkspace({
  project,
  status,
  refresh,
  setProject,
}: {
  project: Project;
  status: ConnectionStatus;
  refresh: () => Promise<void>;
  setProject: (project: Project) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState("");
  const [starting, setStarting] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const savedSession = useRef(project.sessionId);
  const lastAgentError = useRef<unknown>(undefined);
  const agent = useEveAgent({
    followSubagents: true,
    initialSession: project.sessionId
      ? { sessionId: project.sessionId, streamIndex: 0 }
      : undefined,
    resume: Boolean(project.sessionId),
    onError(error) {
      lastAgentError.current = error;
    },
    onSessionChange(session) {
      if (session && session.sessionId !== savedSession.current) {
        savedSession.current = session.sessionId;
        void mutate({ action: "session", sessionId: session.sessionId }).catch(
          (e) => setError(e.message),
        );
      }
    },
    onFinish() {
      void refresh().catch((e) => setError(e.message));
    },
  });
  const working = agent.status === "streaming" || agent.status === "submitted";
  const resuming = agent.status === "resuming";
  const requests = project.requests || [];
  const hasOutput = requests.length > 0 || agent.data.messages.length > 0;
  const analysis = project.campaignAnalyses?.at(-1);
  const freshAnalysis =
    analysis?.sourceRevision === project.campaign?.revision
      ? analysis
      : undefined;
  const cut = project.cuts.at(-1);
  const exportAsset = project.assets.find((a) => a.id === cut?.assetId);
  const exportStale = Boolean(
    cut &&
    project.events.some(
      (e) =>
        e.at > cut.createdAt &&
        [
          "shot.planned",
          "shot.updated",
          "take.accepted",
          "campaign.saved",
          "soundtrack.changed",
          "edit.changed",
        ].includes(e.type),
    ),
  );
  const hasPlans =
    project.events.some((e) => e.type === "shot.planned") &&
    project.shots
      .filter((shot) => shot.kind === "generated" && !shot.locked)
      .every((shot) => planUsesCurrentSources(project, shot));
  const activeEdit = !exportStale ? cut?.edit : undefined;
  const editShots = project.shots.map((shot) => {
    const excerpt = activeEdit?.find((s) => s.shotId === shot.id);
    return excerpt
      ? {
          ...shot,
          duration: excerpt.duration,
          description: shot.description.replace(/^\d+[–-]\d+s\.\s*/, ""),
        }
      : shot;
  });
  const sequence = editShots.map((shot, index) => {
    const start = editShots
      .slice(0, index)
      .reduce((sum, previous) => sum + previous.duration, 0);
    return { shot, start, end: start + shot.duration };
  });
  const canExport = project.shots.every(
    (s) => s.kind === "title" || acceptedAsset(s),
  );
  const activeJobs = project.jobs.filter(isActiveJob);
  const automatic = project.production?.mode === "automatic";
  const referenceChosen = Boolean(project.production?.reference);
  const latestAssistant = agent.data.messages
    .filter((m) => m.role === "assistant")
    .at(-1);
  const tools = agent.data.messages.flatMap((m) =>
    m.parts.flatMap((part, index) =>
      part.type === "dynamic-tool" ? [{ part, key: `${m.id}:${index}` }] : [],
    ),
  );
  const currentTool = tools
    .filter(
      ({ part }) => !["output-available", "output-error"].includes(part.state),
    )
    .at(-1);
  const phases = [
    {
      label: "Understand",
      done: Boolean(freshAnalysis),
      active: working && !freshAnalysis,
      detail: freshAnalysis ? "Creative pattern mapped" : "Reference & brief",
    },
    {
      label: "Direct",
      done: hasPlans,
      active: working && Boolean(freshAnalysis) && !hasPlans,
      detail: hasPlans ? "Sequence planned" : "Story & shot plan",
    },
    {
      label: "Create",
      done: automatic
        ? canExport
        : project.jobs.some(
            (j) =>
              j.status === "succeeded" &&
              planUsesCurrentSources(project, j) &&
              project.shots.some(
                (shot) =>
                  shot.id === j.shotId && shot.revision === j.shotRevision,
              ),
          ),
      active: activeJobs.length > 0,
      detail: activeJobs.length
        ? `${activeJobs.length} shot${activeJobs.length > 1 ? "s" : ""} in progress`
        : hasPlans &&
            project.jobs.some((job) => !planUsesCurrentSources(project, job))
          ? "Preparing the new scenes"
          : "MiniMax H3 footage",
    },
    {
      label: "Deliver",
      done: Boolean(exportAsset) && !exportStale,
      active:
        busy === "export" ||
        (working && canExport && (!exportAsset || exportStale)),
      detail:
        exportAsset && !exportStale
          ? "Film ready to watch"
          : "Your launch film",
    },
  ];

  async function send(
    text: string,
    assets: Asset[] = [],
    referenceUrl?: string,
  ) {
    const value = text.trim();
    if (!value || starting || resuming) return;
    setError("");
    setStarting(true);
    try {
      const p = await mutate({
        action: "prompt",
        id: crypto.randomUUID(),
        text: value,
        assetIds: assets.map((a) => a.id),
        referenceUrl,
      });
      setProject(p);
      setPrompt("");
      setAttachments([]);
      if (!status.text) {
        setSetup(true);
        return;
      }
      setStarting(false);
      await sendWithSessionRecovery(
        async () => {
          lastAgentError.current = undefined;
          await agent.send(value, {
            ...(working ? { turnPolicy: "steer" as const } : {}),
            clientContext: {
              attachedReferences: assets.map((a) => ({
                assetId: a.id,
                name: a.name,
              })),
              interface: "single-prompt",
            },
          });
        },
        () => agent.reset(),
        () => lastAgentError.current,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach M3.1.");
    } finally {
      setStarting(false);
    }
  }
  async function action(body: Record<string, unknown>, label: string) {
    setError("");
    setBusy(label);
    try {
      // Export and job actions return a cut/job receipt, not a Project.
      // Reload the saved workspace for every action before rendering it.
      await mutate(body);
      await refresh();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete that action.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  async function attach(files: FileList | null) {
    if (!files?.length) return;
    if (attachments.length + files.length > MAX_CAMPAIGN_REFERENCES) {
      setError(
        `Attach up to ${MAX_CAMPAIGN_REFERENCES} reference clips or images.`,
      );
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const added: Asset[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const { asset } = await api<{ asset: Asset }>("/api/assets", {
          method: "POST",
          body: form,
        });
        added.push(asset);
      }
      setAttachments((current) => [...current, ...added]);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not attach the reference.",
      );
    } finally {
      setBusy("");
      if (upload.current) upload.current.value = "";
    }
  }
  function fillExample(value: string) {
    setPrompt(value);
    input.current?.focus();
  }

  return (
    <div className={`nl-app ${hasOutput ? "has-output" : ""}`}>
      {!hasOutput && <div className="nl-atmosphere" aria-hidden="true" />}
      <header className="nl-header">
        <a href="/" className="nl-brand" aria-label="MiniMax studio home">
          <img
            className="nl-brand-logo"
            src="/brand/minimax-white.webp"
            width={349}
            height={128}
            alt="MiniMax"
          />
          <span className="nl-brand-divider" aria-hidden="true" />
          <span className="nl-brand-name">Studio</span>
        </a>
        <div className="nl-header-right">
          {hasOutput && (
            <button
              className="nl-new-campaign"
              disabled={
                working ||
                starting ||
                resuming ||
                Boolean(busy) ||
                activeJobs.length > 0
              }
              title="Save this campaign and start with an empty prompt"
              onClick={async () => {
                if (
                  await action(
                    {
                      action: "new-campaign",
                      expectedUpdatedAt: project.updatedAt,
                    },
                    "new-campaign",
                  )
                )
                  window.location.reload();
              }}
            >
              New campaign
            </button>
          )}
          <span className="nl-model">
            M3.1 <span>×</span> H3
          </span>
          <button
            className="nl-connection"
            onClick={() => setSetup(!setup)}
            aria-label="Connection settings"
          >
            <span className={status.text ? "online" : ""} />
            <KeyRound size={14} />
          </button>
        </div>
      </header>

      <main className="nl-main">
        {!hasOutput && (
          <section className="nl-welcome">
            <span className="nl-eyebrow">
              <span /> MINIMAX M3.1 / CAMPAIGN STUDIO
            </span>
            <h1>
              See a campaign.
              <br />
              <span>Make your next one.</span>
            </h1>
            <p>
              Tell M3.1 what you have in mind.
              <br className="nl-mobile-break" /> Watch it turn the idea into a
              launch film.
            </p>
          </section>
        )}

        {hasOutput && (
          <section className="nl-output" aria-label="Campaign output">
            <div className="nl-output-heading">
              <div>
                <span className="nl-eyebrow">YOUR CAMPAIGN, TAKING SHAPE</span>
                <h1>
                  {freshAnalysis
                    ? project.campaign?.title
                    : "From your words to the screen."}
                </h1>
              </div>
              <span className={`nl-run-status ${working ? "working" : ""}`}>
                {working ? (
                  <>
                    <LoaderCircle size={12} />
                    Creating
                  </>
                ) : !status.text ? (
                  "Ready to connect"
                ) : exportAsset && !exportStale ? (
                  "Film ready"
                ) : automatic && !referenceChosen ? (
                  "Choose your reference"
                ) : (
                  "Your studio"
                )}
              </span>
            </div>
            <div className="nl-request">
              <span>YOU</span>
              <p>{requests.at(-1)?.text || "Continue the launch film."}</p>
            </div>
            {setup && (
              <ConnectionNote
                onClose={() => setSetup(false)}
                connected={status.text}
              />
            )}
            {status.text && (
              <div className="nl-process" aria-label="Production progress">
                {phases.map((phase, i) => (
                  <div
                    key={phase.label}
                    className={`${phase.done ? "done" : ""} ${phase.active ? "active" : ""}`}
                  >
                    <span className="nl-phase-icon">
                      {phase.done ? (
                        <Check size={13} />
                      ) : phase.active ? (
                        <LoaderCircle size={13} />
                      ) : (
                        `0${i + 1}`
                      )}
                    </span>
                    <div>
                      <strong>{phase.label}</strong>
                      <small>{phase.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <FilmCrew conversation={agent.data} />

            {project.assets.some((asset) => asset.origin === "brand") && (
              <section className="nl-section">
                <div className="nl-section-heading">
                  <Sparkles size={14} />
                  <h2>The MiniMax look</h2>
                  <span>Official launch artwork</span>
                </div>
                <figure className="nl-brand-direction">
                  <img
                    src="/brand/m31-flash/hero.png"
                    width={1920}
                    height={1080}
                    alt="Official MiniMax M3.1 Flash lockup over the pink, orange and purple flower artwork"
                  />
                  <figcaption>
                    <p>
                      Flower, color and light for the scenes. The official logo
                      and animated end card in your final film.
                    </p>
                    <a
                      href="https://www.figma.com/design/OBZtbEFlEn8ilGAdqKpk5q?node-id=1311-7298"
                      target="_blank"
                      rel="noreferrer"
                    >
                      MiniMax brand kit <ExternalLink size={12} />
                    </a>
                  </figcaption>
                </figure>
              </section>
            )}

            <TrendGallery
              project={project}
              disabled={starting || resuming || activeJobs.length > 0}
              selectionHint={
                resuming
                  ? "Reconnecting to your saved run…"
                  : activeJobs.length > 0
                    ? "A take is rendering. You can choose another reference once it finishes."
                    : referenceChosen
                      ? "Reference selected. Your crew handles the scenes, reviews and final export."
                      : "Choose your reference once. The crew will create and export the complete film automatically."
              }
              onChoose={(post) =>
                void send(
                  `Use this reference for my film: ${post.url}. Import and inspect the actual video, adapt it creatively to my brief and MiniMax assets, then create the complete film. Handle the direction, all H3 scenes, take reviews, take selection, soundtrack and final branded MP4 automatically. Do not pause for approvals. Preserve my soundtrack choice, existing selected footage and previous takes.`,
                  [],
                  post.url,
                )
              }
            />

            {project.campaign?.assetIds.some(
              (id) => !project.socialPosts?.some((post) => post.assetId === id),
            ) ? (
              <div className="nl-section">
                <div className="nl-section-heading">
                  <ScanLine size={14} />
                  <h2>The reference</h2>
                  <span>{project.campaign.ratio}</span>
                </div>
                <div className="nl-references">
                  {project.campaign.assetIds
                    .filter(
                      (id) =>
                        !project.socialPosts?.some(
                          (post) => post.assetId === id,
                        ),
                    )
                    .map((id) => {
                      const asset = project.assets.find((a) => a.id === id);
                      return asset ? (
                        <div className="nl-reference" key={id}>
                          {asset.mime.startsWith("video/") ? (
                            <video
                              controls
                              preload="metadata"
                              src={mediaUrl(id)}
                            />
                          ) : (
                            <img alt={asset.name} src={mediaUrl(id)} />
                          )}
                          <span>{asset.name}</span>
                        </div>
                      ) : null;
                    })}
                </div>
              </div>
            ) : null}

            {freshAnalysis && (
              <section className="nl-section">
                <div className="nl-section-heading">
                  <ScanLine size={14} />
                  <h2>The creative pattern</h2>
                  <span>
                    {freshAnalysis.basis === "sampled_frames"
                      ? "From sampled frames"
                      : "From your description"}
                  </span>
                </div>
                <div className="nl-pattern">
                  {[
                    ["The hook", freshAnalysis.hook],
                    ["The payoff", freshAnalysis.payoff],
                    ["The loop", freshAnalysis.loop],
                  ].map(([label, text], i) => (
                    <article key={label}>
                      <span>0{i + 1}</span>
                      <h3>{label}</h3>
                      <p>{text}</p>
                    </article>
                  ))}
                </div>
                <div className="nl-angle">
                  <Sparkles size={17} />
                  <p>{freshAnalysis.launchAngle}</p>
                </div>
              </section>
            )}

            {project.treatments.length > 0 && (
              <section className="nl-section">
                <div className="nl-section-heading">
                  <Sparkles size={14} />
                  <h2>A direction for the film</h2>
                  <span>Or tell M3.1 what to change</span>
                </div>
                <div className="nl-directions">
                  {project.treatments.map((t, i) => (
                    <button
                      key={t.id}
                      className={
                        project.selectedTreatmentId === t.id ? "selected" : ""
                      }
                      disabled={starting || resuming}
                      onClick={() =>
                        void send(
                          `Use direction ${i + 1}, “${t.title}” (${t.id}). Choose it, develop the unlocked shots, then render, review, select and export the complete film automatically after my initial reference choice.`,
                        )
                      }
                    >
                      <span>
                        0{i + 1}
                        {project.selectedTreatmentId === t.id && (
                          <Check size={13} />
                        )}
                      </span>
                      <h3>{t.title}</h3>
                      <p>{t.logline}</p>
                      <small>
                        {project.selectedTreatmentId === t.id
                          ? "Selected direction"
                          : "Explore this direction"}
                        <ArrowRight size={12} />
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {freshAnalysis && (
              <section className="nl-section">
                <div className="nl-section-heading">
                  <Clapperboard size={14} />
                  <h2>{activeEdit ? "The final edit" : "The sequence"}</h2>
                  <span>
                    {Number(sequence.at(-1)?.end.toFixed(2))}s ·{" "}
                    {projectRatio(project)}
                  </span>
                </div>
                <div className="nl-sequence">
                  {sequence.map(({ shot, start, end }) => (
                    <article key={shot.id}>
                      <div>
                        <span>
                          {Number(start.toFixed(2))}–{Number(end.toFixed(2))}s
                        </span>
                        <i />
                      </div>
                      <h3>{shot.title}</h3>
                      <p>{shot.description}</p>
                      {shot.kind === "generated" &&
                      project.campaign?.assetIds.length ? (
                        planUsesCurrentSources(project, shot) ? (
                          <div className="nl-source-influence">
                            <strong>From the reference</strong>
                            {shot.sourceBasis!.assetIds.map((id) => {
                              const source = project.socialPosts?.find(
                                (post) => post.assetId === id,
                              );
                              return (
                                <a
                                  key={id}
                                  href={source?.url || mediaUrl(id)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source
                                    ? `@${source.author}`
                                    : "View reference"}{" "}
                                  ·{" "}
                                  {shot.referenceIds.includes(id)
                                    ? "Video input to H3"
                                    : "Creative inspiration"}
                                </a>
                              );
                            })}
                            <p>{shot.sourceBasis!.adaptation}</p>
                          </div>
                        ) : (
                          <p className="nl-source-stale">
                            {shot.locked
                              ? "Accepted footage preserved from an earlier plan."
                              : "Needs updating for the selected reference."}
                          </p>
                        )
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {project.jobs.length > 0 && (
              <section className="nl-section">
                <div className="nl-section-heading">
                  <Film size={14} />
                  <h2>The footage</h2>
                  <span>Real H3 renders</span>
                </div>
                <div className="nl-takes">
                  {project.shots
                    .filter(
                      (s) =>
                        s.kind !== "title" &&
                        (s.takes.length ||
                          project.jobs.some((j) => j.shotId === s.id)),
                    )
                    .map((shot) => {
                      const job = project.jobs
                        .filter((j) => j.shotId === shot.id)
                        .at(-1);
                      const take =
                        (automatic &&
                          shot.takes.find(
                            (t) => t.id === shot.acceptedTakeId,
                          )) ||
                        shot.takes.at(-1);
                      const takeReview = project.takeReviews?.findLast(
                        (r) => r.jobId === take?.jobId,
                      );
                      const takeJob = take
                        ? project.jobs.find((entry) => entry.id === take.jobId)
                        : job;
                      const earlierTake = Boolean(
                        take &&
                        project.campaign?.assetIds.length &&
                        (!takeJob ||
                          !planUsesCurrentSources(project, takeJob) ||
                          (takeJob.shotRevision !== shot.revision &&
                            shot.acceptedTakeId !== take.id)),
                      );
                      return (
                        <article key={shot.id}>
                          {take ? (
                            <video
                              controls
                              preload="metadata"
                              src={mediaUrl(take.assetId)}
                            />
                          ) : (
                            <div className="nl-render-wait">
                              {job &&
                              isActiveJob(job) &&
                              job.status !== "unknown" ? (
                                <LoaderCircle size={23} />
                              ) : (
                                <Film size={23} />
                              )}
                              <strong>
                                {job?.status === "unknown"
                                  ? "Render needs attention"
                                  : job?.status === "failed"
                                    ? "Render failed"
                                    : "Creating this scene"}
                              </strong>
                              <span>
                                {job?.status === "queued"
                                  ? "Queued with MiniMax H3"
                                  : job?.status === "running"
                                    ? "Generating footage"
                                    : job?.error || "Preparing your shot"}
                              </span>
                            </div>
                          )}
                          <div className="nl-take-caption">
                            <div>
                              <h3>
                                {takeJob?.shotTitle ||
                                  (takeJob ? "Earlier test shot" : shot.title)}
                              </h3>
                              <span>
                                {takeJob?.duration || shot.duration}s ·{" "}
                                {takeJob?.ratio || projectRatio(project)}
                              </span>
                            </div>
                            {automatic && take && (
                              <span role="status">
                                {shot.acceptedTakeId === take.id
                                  ? "Selected for the film"
                                  : job && isActiveJob(job)
                                    ? job.status === "unknown"
                                      ? "Render needs attention"
                                      : "Creating the revised scene"
                                    : takeReview?.verdict === "unusable"
                                      ? "Scene needs attention"
                                      : takeReview?.verdict === "revise"
                                        ? "Refining the scene"
                                        : "Crew reviewing"}
                              </span>
                            )}
                            {!automatic &&
                              take &&
                              shot.acceptedTakeId !== take.id && (
                                <button
                                  disabled={Boolean(busy)}
                                  onClick={() =>
                                    void action(
                                      {
                                        action: "accept",
                                        shotId: shot.id,
                                        takeId: take.id,
                                      },
                                      shot.id,
                                    )
                                  }
                                >
                                  Use this take
                                  <Check size={12} />
                                </button>
                              )}
                            {take &&
                              shot.acceptedTakeId === take.id &&
                              (!automatic ||
                                (!working && activeJobs.length === 0)) && (
                                <button
                                  disabled={Boolean(busy)}
                                  onClick={async () => {
                                    if (
                                      await action(
                                        {
                                          action: "lock",
                                          shotId: shot.id,
                                          locked: false,
                                        },
                                        shot.id,
                                      )
                                    )
                                      fillExample(
                                        `Revise “${shot.title}” (${shot.id}): `,
                                      );
                                  }}
                                >
                                  Revise
                                </button>
                              )}
                          </div>
                          {take &&
                            job?.error &&
                            ["failed", "unknown"].includes(job.status) && (
                              <p className="nl-source-stale" role="alert">
                                {job.error}
                              </p>
                            )}
                          {earlierTake && (
                            <p className="nl-source-stale">
                              Earlier take · made before the current reference
                              plan.
                            </p>
                          )}
                          {job && isActiveJob(job) && job.taskId && (
                            <button
                              className="nl-check-job"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void action(
                                  { action: "check-job", jobId: job.id },
                                  job.id,
                                )
                              }
                            >
                              Check render status
                            </button>
                          )}
                        </article>
                      );
                    })}
                </div>
              </section>
            )}

            {exportAsset && (
              <section className="nl-section nl-final">
                <div className="nl-section-heading">
                  <Play size={14} />
                  <h2>
                    {exportStale ? "Last exported film" : "Your launch film"}
                  </h2>
                  <a
                    href={mediaUrl(exportAsset.id)}
                    download={exportAsset.name}
                  >
                    <Download size={13} />
                    Download MP4
                  </a>
                </div>
                <video
                  controls
                  preload="metadata"
                  src={mediaUrl(exportAsset.id)}
                />
                <p>
                  {exportAsset.duration == null
                    ? "—"
                    : Number(exportAsset.duration.toFixed(2))}
                  s · {exportAsset.width} × {exportAsset.height}
                  {cut?.audioCheck && (
                    <>
                      {" "}
                      ·{" "}
                      {cut.soundtrack?.mode === "silent"
                        ? "Silent cut"
                        : cut.soundtrack?.mode === "source"
                          ? `Original reference audio · ${cut.audioCheck.playback === "loop" ? "Looped" : "Plays once"}`
                          : "Instrumental score"}{" "}
                      · H3 audio removed
                    </>
                  )}
                </p>
              </section>
            )}
            {!automatic && canExport && (!exportAsset || exportStale) && (
              <button
                className="nl-export"
                disabled={Boolean(busy)}
                onClick={() => void action({ action: "export" }, "export")}
              >
                {busy === "export" ? (
                  <LoaderCircle size={15} />
                ) : (
                  <Film size={15} />
                )}
                Assemble the launch film
                <ArrowRight size={15} />
              </button>
            )}

            {tools.length > 0 && (
              <details className="nl-activity" open={working || undefined}>
                <summary>
                  {currentTool && working ? (
                    <LoaderCircle size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                  {currentTool && working
                    ? currentTool.part.toolMetadata?.eve?.label ||
                      "M3.1 is working"
                    : "What M3.1 did"}
                  <ChevronDown size={13} />
                </summary>
                <div>
                  {tools.slice(-12).map(({ part, key }) => (
                    <p key={key}>
                      {part.state === "output-available" ? (
                        <Check size={11} />
                      ) : part.state === "output-error" ? (
                        <X size={11} />
                      ) : working ? (
                        <LoaderCircle size={11} />
                      ) : (
                        <Square size={10} />
                      )}
                      <span>
                        {part.toolMetadata?.eve?.label ||
                          part.toolName.replace(/_/g, " ")}
                      </span>
                    </p>
                  ))}
                </div>
              </details>
            )}
            {latestAssistant && (
              <div className="nl-director-note">
                <MiniMark />
                <div>
                  {latestAssistant.parts.map((part, i) =>
                    part.type === "text" ? (
                      <p key={part.id || i}>
                        <DirectorText text={part.text} />
                      </p>
                    ) : null,
                  )}
                </div>
              </div>
            )}
            {openConversationInputs(agent.data).map((entry) => (
              <div className="nl-checkpoint" key={entry.request.requestId}>
                <p>{entry.request.prompt}</p>
                {entry.request.options?.map((option) => (
                  <button
                    key={option.id}
                    disabled={resuming}
                    onClick={() =>
                      void agent
                        .respond([
                          {
                            requestId: entry.request.requestId,
                            optionId: option.id,
                          },
                        ])
                        .catch((e) => setError(e.message))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ))}
            {agent.error && (
              <p className="nl-error" role="alert">
                M3.1 could not complete this turn. Your brief and footage are
                saved. Check the connection, then try again.
              </p>
            )}
            {working && (
              <div className="nl-working">
                <LoaderCircle size={13} />
                <span>
                  {currentTool?.part.toolMetadata?.eve?.label ||
                    "M3.1 is developing your film"}
                </span>
                <button
                  onClick={() =>
                    void agent.cancel().catch((e) => setError(e.message))
                  }
                  aria-label="Stop creating"
                >
                  <Square size={11} />
                </button>
              </div>
            )}
          </section>
        )}

        <section
          className={`nl-input-area ${hasOutput ? "follow-up" : ""}`}
          aria-label="Your direction"
        >
          {!hasOutput && setup && (
            <ConnectionNote
              onClose={() => setSetup(false)}
              connected={status.text}
            />
          )}
          <form
            className="nl-prompt-box"
            onSubmit={(e) => {
              e.preventDefault();
              void send(prompt, attachments);
            }}
          >
            <textarea
              ref={input}
              aria-label="Describe your campaign"
              placeholder={
                hasOutput
                  ? "Make it stranger. Change the ending. Try another direction…"
                  : "Turn the dancing dogs trend into a launch film for MiniMax M3.1…"
              }
              rows={hasOutput ? 2 : 3}
              maxLength={6000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={resuming}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {attachments.length > 0 && (
              <div className="nl-attachments">
                {attachments.map((a) => (
                  <span key={a.id}>
                    <Film size={11} />
                    {a.name}
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((asset) => asset.id !== a.id),
                        )
                      }
                      aria-label={`Remove ${a.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="nl-composer-bottom">
              <div>
                <button
                  type="button"
                  onClick={() => upload.current?.click()}
                  disabled={Boolean(busy)}
                  aria-label="Attach a reference"
                >
                  {busy === "upload" ? (
                    <LoaderCircle size={16} />
                  ) : (
                    <Paperclip size={17} />
                  )}
                </button>
                <span>
                  {working
                    ? "Your words steer the film"
                    : "M3.1 directs · H3 creates"}
                </span>
              </div>
              <button
                className="nl-send"
                type="submit"
                aria-label={working ? "Send direction" : "Create campaign"}
                disabled={
                  !prompt.trim() || starting || resuming || busy === "upload"
                }
              >
                {starting ? <LoaderCircle size={18} /> : <ArrowUp size={20} />}
              </button>
            </div>
          </form>
          <input
            ref={upload}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
            hidden
            onChange={(e) => void attach(e.target.files)}
          />
          {error && (
            <p className="nl-error" role="alert">
              {error}
            </p>
          )}
          {!hasOutput && (
            <div className="nl-examples">
              {examples.map((example, i) => (
                <button
                  key={example.label}
                  onClick={() => fillExample(example.prompt)}
                >
                  {i === 0 ? (
                    <PawPrint size={13} />
                  ) : i === 1 ? (
                    <ScanLine size={13} />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {example.label}
                  <ArrowRight size={11} />
                </button>
              ))}
            </div>
          )}
          <p className="nl-input-hint">
            {hasOutput
              ? "Keep directing in your own words."
              : "Describe a trend, paste a campaign link, or drop in a reference clip."}
          </p>
        </section>
        {!hasOutput && (
          <div className="nl-empty-output">
            <div className="nl-empty-line" />
            <span>
              <ScanLine size={14} />
              The pattern
            </span>
            <ArrowRight size={12} />
            <span>
              <Clapperboard size={14} />
              The idea
            </span>
            <ArrowRight size={12} />
            <span>
              <Film size={14} />
              The film
            </span>
            <div className="nl-empty-line" />
          </div>
        )}
        {hasOutput && project.campaign?.urls.length ? (
          <div className="nl-source-links">
            {project.campaign.urls.map((url, i) => (
              <a href={url} target="_blank" rel="noreferrer" key={url}>
                Reference {i + 1}
                <ExternalLink size={10} />
              </a>
            ))}
          </div>
        ) : null}
      </main>
      <footer className="nl-footer">
        <div className="nl-footer-main">
          <span className="nl-footer-note">An idea. A sentence. A film.</span>
          <div className="nl-built-with">
            <span>Built with</span>
            <a
              href="https://eve.dev"
              target="_blank"
              rel="noreferrer"
              aria-label="eve agent framework"
            >
              <img
                src="/brand/eve-white.svg"
                width={328}
                height={120}
                alt="eve"
              />
            </a>
            <span>by</span>
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Vercel"
            >
              <img
                src="/brand/vercel-white.svg"
                width={2048}
                height={407}
                alt="Vercel"
              />
            </a>
          </div>
        </div>
        <details className="nl-brand-credits">
          <summary>Brand credits</summary>
          <p>
            MiniMax logos and artwork from{" "}
            <a href="https://www.minimax.io" target="_blank" rel="noreferrer">
              minimax.io
            </a>
            . eve and Vercel logos from the{" "}
            <a
              href="https://vercel.com/geist/brands"
              target="_blank"
              rel="noreferrer"
            >
              official brand library
            </a>
            . Vercel, the Vercel design, Next.js and related marks, designs and
            logos are trademarks or registered trademarks of Vercel, Inc. or its
            affiliates in the US and other countries.
          </p>
        </details>
      </footer>
    </div>
  );
}

function ConnectionNote({
  onClose,
  connected,
}: {
  onClose: () => void;
  connected: boolean;
}) {
  return (
    <aside className="nl-setup" aria-label="MiniMax connection">
      <button onClick={onClose} aria-label="Close connection details">
        <X size={14} />
      </button>
      <KeyRound size={17} />
      <div>
        <h2>
          {connected
            ? "Your director is connected."
            : "Connect MiniMax to create your film."}
        </h2>
        <p>
          Add <code>MINIMAX_TEXT_API_KEY</code> and{" "}
          <code>MINIMAX_VIDEO_API_KEY</code> to <code>.env.local</code>, then
          restart the app.
        </p>
        <p>
          References are optional. Attach the exact clip when you want M3.1 to
          inspect it; social links alone are not imported.
        </p>
      </div>
    </aside>
  );
}
