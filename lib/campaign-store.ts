import { randomUUID } from "node:crypto";
import {
  campaignAnalysisInput,
  campaignBriefInput,
  emptyCampaign,
  type CampaignAnalysisInput,
  type CampaignBriefInput,
} from "./campaign";
import { event, getProject, mutateProject } from "./store";
import { sampleAsset } from "./media";
import { isBrandAsset, officialBrandSource } from "./brand-assets";
import { MAX_CAMPAIGN_REFERENCES } from "./reference-limits";

export function saveCampaignBrief(value: CampaignBriefInput) {
  const input = campaignBriefInput.parse(value);
  return mutateProject((p) => {
    for (const id of input.assetIds) {
      const asset = p.assets.find((a) => a.id === id);
      if (!asset || !/^(image|video)\//.test(asset.mime))
        throw new Error(
          "Choose an uploaded image or video as the campaign reference.",
        );
    }
    input.assetIds = [...new Set(input.assetIds)].filter(
      (id) => !isBrandAsset(p.assets.find((asset) => asset.id === id)!),
    );
    if (input.assetIds.length > MAX_CAMPAIGN_REFERENCES)
      throw new Error(
        `Choose at most ${MAX_CAMPAIGN_REFERENCES} campaign source references. Brand artwork is kept separately.`,
      );
    for (const asset of p.assets) {
      const sourceUrl = officialBrandSource(asset.sha256);
      if (sourceUrl) Object.assign(asset, { origin: "brand", sourceUrl });
    }
    const current = p.campaign || emptyCampaign();
    const { revision: _, ...previous } = current;
    if (p.campaign && JSON.stringify(previous) === JSON.stringify(input))
      return current;
    p.campaign = { ...input, revision: current.revision + 1 };
    // Retained, byte-identical footage does not need to be sampled again when
    // another reference or the written brief changes. The analysis still does.
    for (const inspection of p.campaignInspections || []) {
      if (
        input.assetIds.includes(inspection.assetId) &&
        p.assets.some(
          (asset) =>
            asset.id === inspection.assetId &&
            asset.sha256 === inspection.sha256,
        )
      )
        inspection.sourceRevision = p.campaign.revision;
    }
    event(p, "campaign.saved", `Saved campaign reference: ${input.title}`);
    return p.campaign;
  });
}

export async function inspectCampaignReference(assetId: string) {
  const before = getProject();
  const campaign = before.campaign;
  if (!campaign?.assetIds.includes(assetId))
    throw new Error("Save this asset as a campaign reference first.");
  const asset = before.assets.find((a) => a.id === assetId)!;
  const result = await sampleAsset(assetId, "campaign");
  mutateProject((p) => {
    if (p.campaign?.revision !== campaign.revision)
      throw new Error(
        "Campaign reference changed during inspection. Read it again.",
      );
    p.campaignInspections = [
      ...(p.campaignInspections || []).filter((i) => i.assetId !== assetId),
      {
        assetId,
        sha256: asset.sha256,
        sourceRevision: campaign.revision,
        seconds: result.frames.map((f) => f.seconds),
      },
    ];
    event(
      p,
      "campaign.inspected",
      `Sampled ${result.frames.length} frames from ${asset.name}`,
    );
  });
  return result;
}

export function saveCampaignAnalysis(value: CampaignAnalysisInput) {
  const input = campaignAnalysisInput.parse(value);
  return mutateProject((p) => {
    if (!p.campaign || input.sourceRevision !== p.campaign.revision)
      throw new Error(
        "Campaign reference changed. Analyze the latest saved revision.",
      );
    for (const observation of input.observations) {
      const asset = p.assets.find((a) => a.id === observation.assetId);
      const inspection = p.campaignInspections?.find(
        (i) =>
          i.assetId === observation.assetId &&
          i.sourceRevision === input.sourceRevision &&
          i.sha256 === asset?.sha256,
      );
      if (
        !p.campaign.assetIds.includes(observation.assetId) ||
        !inspection ||
        !inspection.seconds.some(
          (s) => Math.abs(s - observation.seconds) < 0.05,
        )
      )
        throw new Error(
          "Visual observations must cite a timestamp returned by inspect_campaign_reference for this revision.",
        );
    }
    for (let i = 0; i < input.beats.length; i++) {
      if (
        input.beats[i].end <= input.beats[i].start ||
        (i > 0 && input.beats[i].start < input.beats[i - 1].end)
      )
        throw new Error(
          "Proposed film beats must be ordered and must not overlap.",
        );
    }
    const analysis = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      basis: input.observations.length
        ? ("sampled_frames" as const)
        : ("notes_only" as const),
    };
    p.campaignAnalyses = [...(p.campaignAnalyses || []), analysis];
    event(
      p,
      "campaign.analyzed",
      `M3.1 saved a campaign breakdown (${analysis.basis === "notes_only" ? "notes only" : "sampled visual evidence"})`,
    );
    return analysis;
  });
}
