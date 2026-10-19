import { z } from "zod";
import { MAX_CAMPAIGN_REFERENCES } from "./reference-limits";

const text = z.string().trim().min(1).max(1800);
const sourceUrl = z
  .string()
  .url()
  .max(1500)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS source link without credentials.");

export const campaignBriefInput = z.object({
  title: z.string().trim().min(1).max(120),
  urls: z.array(sourceUrl).max(MAX_CAMPAIGN_REFERENCES),
  notes: z.string().max(6000),
  brand: z.string().trim().min(1).max(100),
  goal: z.string().trim().min(1).max(2500),
  assetIds: z
    .array(z.string())
    .max(MAX_CAMPAIGN_REFERENCES + 9)
    .describe(
      `Campaign source references. Up to ${MAX_CAMPAIGN_REFERENCES} non-brand assets; official MiniMax artwork is kept separately in the brand kit.`,
    ),
  ratio: z.enum(["9:16", "16:9"]),
});
export type CampaignBriefInput = z.infer<typeof campaignBriefInput>;
export type CampaignBrief = CampaignBriefInput & { revision: number };

export const campaignAnalysisInput = z.object({
  sourceRevision: z.number().int().nonnegative(),
  hook: text,
  visualPattern: text,
  pacing: text,
  payoff: text,
  loop: text,
  audioPlan: text,
  launchAngle: text,
  observations: z
    .array(
      z.object({
        assetId: z.string(),
        seconds: z.number().nonnegative(),
        detail: text,
      }),
    )
    .max(24),
  hypotheses: z.array(text).min(1).max(8),
  keep: z.array(text).min(1).max(6),
  change: z.array(text).min(1).max(6),
  beats: z
    .array(
      z.object({
        start: z.number().nonnegative().max(120),
        end: z.number().positive().max(120),
        label: z.string().min(1).max(80),
        adaptation: text,
      }),
    )
    .min(3)
    .max(8),
});
export type CampaignAnalysisInput = z.infer<typeof campaignAnalysisInput>;
export type CampaignAnalysis = CampaignAnalysisInput & {
  id: string;
  createdAt: string;
  basis: "sampled_frames" | "notes_only";
};
export type CampaignInspection = {
  assetId: string;
  sha256: string;
  sourceRevision: number;
  seconds: number[];
};

export function emptyCampaign(): CampaignBrief {
  return {
    title: "A campaign worth decoding",
    urls: [],
    notes: "",
    brand: "MiniMax M3.1",
    goal: "Create a 30-second MiniMax M3.1 launch film from the creative structure of a social campaign. M3.1 develops the concept and directs; H3 generates the footage. Use only approved launch facts.",
    assetIds: [],
    ratio: "9:16",
    revision: 0,
  };
}

// A human-authored starting brief, never presented as inspected or model-generated.
export function dancingDogsExample(): CampaignBriefInput {
  const { revision: _, ...base } = emptyCampaign();
  return {
    ...base,
    title: "Dancing dogs → a MiniMax launch",
    urls: ["https://www.tiktok.com/@king_odiee/video/7692606728323583246"],
    notes:
      "This source link is a lead to retrieve and inspect. Import its actual video before asserting choreography, cuts or timing. Search recent related videos to establish context. Treat proposed reasons for engagement as hypotheses.",
    goal: "Retrieve and study the actual dancing-dog video, then create an original MiniMax M3.1 launch film from its visual mechanism. Show related real videos with dated engagement counts. Let the user choose the initial reference video, then choose the creative direction and complete all scenes, reviews, take selection and final export automatically. Use original audio and an authored MiniMax M3.1 title. Preserve accepted footage.",
  };
}
