import { z } from "zod";
import { MAX_CAMPAIGN_REFERENCES } from "./reference-limits";
import type { SocialPost, TrendSearch } from "./social-types";
import type { WebResearchSearch } from "./web-search-types";
import type {
  CampaignAnalysis,
  CampaignBrief,
  CampaignInspection,
} from "./campaign";

export const sourceBasisInput = z.object({
  analysisId: z.string().min(1),
  assetIds: z.array(z.string()).min(1).max(MAX_CAMPAIGN_REFERENCES),
  adaptation: z.string().trim().min(20).max(1200),
});
export type SourceBasis = z.infer<typeof sourceBasisInput>;

export const shotInput = z.object({
  id: z.string().regex(/^shot_[a-z0-9_]{1,24}$/),
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(1200),
  prompt: z.string().max(6000),
  duration: z.number().int().min(4).max(15),
  kind: z.enum(["source", "generated", "title"]),
  referenceIds: z.array(z.string()).max(9),
  sourceBasis: sourceBasisInput.optional(),
});
export type ShotInput = z.infer<typeof shotInput>;
export type JobStatus =
  "submitting" | "queued" | "running" | "succeeded" | "failed" | "unknown";
export type Asset = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  duration?: number;
  width?: number;
  height?: number;
  origin: "upload" | "social" | "h3" | "export" | "brand" | "derived";
  derivedFrom?: { assetId: string; start: number; duration: number };
  sourceUrl?: string;
  createdAt: string;
};
export type Take = {
  id: string;
  assetId: string;
  jobId?: string;
  prompt: string;
  createdAt: string;
};
export type Shot = ShotInput & {
  locked: boolean;
  revision: number;
  takes: Take[];
  acceptedTakeId?: string;
  revisionRequestedAt?: string;
};
export type RenderJob = {
  id: string;
  requestKey: string;
  shotId: string;
  shotRevision: number;
  productionId?: string;
  prompt: string;
  referenceIds: string[];
  sourceBasis?: SourceBasis;
  shotTitle?: string;
  duration: number;
  resolution: "768P" | "2K";
  ratio?: "9:16" | "16:9";
  status: JobStatus;
  taskId?: string;
  error?: string;
  assetId?: string;
  createdAt: string;
  updatedAt: string;
};
export type Treatment = {
  id: string;
  title: string;
  logline: string;
  visualDirection: string;
};
export type StudioEvent = {
  id: string;
  at: string;
  type: string;
  message: string;
};
export type Cut = {
  id: string;
  assetId: string;
  signature: string;
  createdAt: string;
  visualSignature?: string;
  branding?: {
    name: string;
    sourceUrl?: string;
    signature: string;
    cornerWatermark?: boolean;
  };
  edit?: { shotId: string; start: number; duration: number }[];
  soundtrack?: Soundtrack;
  audioCheck?: {
    sourceClipAudioIncluded: boolean;
    generatedClipAudioIncluded?: false;
    method: "synthesized-instruments" | "silent" | "source-audio";
    hasAudio: boolean;
    duration: number;
    sourceAssetId?: string;
    sourceAudioDuration?: number;
    playback?: "once" | "loop";
    fit?: "keep-film" | "match-source";
  };
};
export const soundtrackInput = z
  .object({
    mode: z.enum(["instrumental", "silent", "source"]).default("instrumental"),
    mood: z.enum(["cinematic", "playful"]).default("cinematic"),
    tempo: z.number().int().min(70).max(150).default(112),
    sourceAssetId: z.string().min(1).optional(),
    playback: z.enum(["once", "loop"]).optional(),
    fit: z.enum(["keep-film", "match-source"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "source" && !value.sourceAssetId)
      context.addIssue({
        code: "custom",
        path: ["sourceAssetId"],
        message: "Choose the original audio/video asset for this soundtrack.",
      });
    if (
      value.mode !== "source" &&
      (value.sourceAssetId || value.playback || value.fit)
    )
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "Source selection and playback apply only to source audio.",
      });
    if (value.fit === "match-source" && value.playback === "loop")
      context.addIssue({
        code: "custom",
        path: ["playback"],
        message: "A source-length edit plays the original audio once.",
      });
  });
export type Soundtrack = z.infer<typeof soundtrackInput>;
export function projectSoundtrack(
  project: Pick<Project, "soundtrack">,
): Soundtrack {
  return (
    project.soundtrack || {
      mode: "instrumental",
      mood: "cinematic",
      tempo: 112,
    }
  );
}
export type Project = {
  id: string;
  name: string;
  brief: string;
  treatments: Treatment[];
  selectedTreatmentId?: string;
  shots: Shot[];
  assets: Asset[];
  jobs: RenderJob[];
  events: StudioEvent[];
  cuts: Cut[];
  shotEdits?: {
    shotId: string;
    takeId: string;
    start: number;
    holdEnd: boolean;
  }[];
  production?: {
    mode: "automatic" | "manual";
    id?: string;
    reference?: { url?: string; assetId?: string; selectedAt: string };
  };
  takeInspections?: {
    id: string;
    assetId: string;
    sha256: string;
    seconds: number[];
  }[];
  takeReviews?: {
    id: string;
    jobId: string;
    inspectionId: string;
    verdict: "use" | "revise" | "unusable";
    summary: string;
    observations: { seconds: number; note: string }[];
    createdAt: string;
  }[];
  soundtrack?: Soundtrack;
  sessionId?: string;
  previousSessionIds?: string[];
  brandKit?: { name: string; assetIds: string[] };
  campaign?: CampaignBrief;
  campaignAnalyses?: CampaignAnalysis[];
  campaignInspections?: CampaignInspection[];
  webResearch?: WebResearchSearch[];
  socialPosts?: SocialPost[];
  trendSearches?: TrendSearch[];
  requests?: {
    id: string;
    text: string;
    assetIds: string[];
    createdAt: string;
  }[];
  updatedAt: string;
};
export type ConnectionStatus = {
  text: boolean;
  video: boolean;
  ffmpeg: boolean;
  model: string;
  storage: "local" | "cloud";
};

export function initialProject(): Project {
  const shots: ShotInput[] = [
    { id: "shot_brief", title: "Opening", duration: 5 },
    { id: "shot_leap", title: "Build", duration: 10 },
    { id: "shot_world", title: "Payoff", duration: 10 },
    { id: "shot_reveal", title: "Closing", duration: 5 },
  ].map((shot) => ({
    ...shot,
    description: "To be planned from your brief.",
    prompt: "",
    kind: "generated" as const,
    referenceIds: [],
  }));
  return {
    id: "m31-launch",
    name: "New campaign",
    brief: "",
    treatments: [],
    shots: shots.map((s) => ({ ...s, locked: false, revision: 0, takes: [] })),
    assets: [],
    jobs: [],
    events: [],
    cuts: [],
    production: { mode: "automatic" },
    takeInspections: [],
    takeReviews: [],
    soundtrack: { mode: "instrumental", mood: "cinematic", tempo: 112 },
    campaign: undefined,
    campaignAnalyses: [],
    campaignInspections: [],
    socialPosts: [],
    trendSearches: [],
    requests: [],
    updatedAt: new Date().toISOString(),
  };
}

export function acceptedAsset(shot: Shot) {
  return shot.takes.find((t) => t.id === shot.acceptedTakeId)?.assetId;
}

export function planUsesCurrentSources(
  project: Project,
  shot: Pick<Shot, "sourceBasis">,
) {
  if (!project.campaign?.assetIds.length) return true;
  const analysis = project.campaignAnalyses?.at(-1);
  const basis = shot.sourceBasis;
  return Boolean(
    analysis &&
    basis &&
    analysis.sourceRevision === project.campaign.revision &&
    analysis.id === basis.analysisId &&
    basis.assetIds.length &&
    basis.assetIds.every(
      (id) =>
        project.campaign!.assetIds.includes(id) &&
        analysis.observations.some((observation) => observation.assetId === id),
    ),
  );
}

export function projectRatio(project: Project) {
  return project.campaign?.ratio || "16:9";
}

export function requireEditableShot(project: Project, id: string) {
  const shot = project.shots.find((s) => s.id === id);
  if (!shot) throw new Error("Shot not found.");
  if (shot.locked)
    throw new Error(
      "This shot is locked. The director must unlock it in the workspace before it can change.",
    );
  return shot;
}

export function isActiveJob(job: RenderJob) {
  return ["submitting", "queued", "running", "unknown"].includes(job.status);
}
