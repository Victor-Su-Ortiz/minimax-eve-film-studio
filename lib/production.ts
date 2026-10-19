import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  acceptedAsset,
  isActiveJob,
  planUsesCurrentSources,
  projectRatio,
  type Project,
} from "./domain";
import { event, getProject, mutateProject } from "./store";
import { sampleAsset } from "./media";
import { socialUrl } from "./social";
import { assembleCut } from "./assembly";

// Only the user-facing API calls this. Scout imports cannot authorize production.
export function chooseProductionReference(
  p: Project,
  input: { url?: string; assetId?: string },
) {
  const url = input.url ? socialUrl(input.url).url : undefined;
  const asset = input.assetId
    ? p.assets.find((a) => a.id === input.assetId)
    : undefined;
  if (!url && !asset?.mime.startsWith("video/"))
    throw new Error("Choose a source video before starting production.");
  const previous = p.production?.reference;
  if (
    p.production?.mode === "automatic" &&
    previous &&
    previous.url === url &&
    previous.assetId === asset?.id
  )
    return;
  if (p.jobs.some(isActiveJob))
    throw new Error(
      "The current render is still running. Choose a new reference when it finishes.",
    );
  p.production = {
    mode: "automatic",
    id: randomUUID(),
    reference: {
      url,
      assetId: asset?.id,
      selectedAt: new Date().toISOString(),
    },
  };
  event(
    p,
    "reference.chosen",
    "Reference chosen. The director will create the complete film.",
  );
}

export function referenceFromPrompt(text: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>\]\)]+/g)) {
    try {
      urls.add(socialUrl(match[0].replace(/[.,;!?]+$/, "")).url);
    } catch {
      /* Not a social post. */
    }
  }
  return urls.size === 1 ? [...urls][0] : undefined;
}

export function assertProductionReference(p: Project) {
  if (p.production?.mode !== "automatic") return;
  const selected = p.production.reference;
  if (!selected)
    throw new Error(
      "Show the checked source cards and wait for the user to choose a reference. No H3 request was made.",
    );
  const imported = p.campaign?.assetIds.some((id) => {
    const asset = p.assets.find((a) => a.id === id);
    return (
      asset?.mime.startsWith("video/") &&
      (id === selected.assetId ||
        Boolean(selected.url && asset.sourceUrl === selected.url))
    );
  });
  if (!imported)
    throw new Error(
      "Import the user's selected video and attach it as the campaign reference before production.",
    );
}

export function assertRenderAllowance(p: Project, shotId: string) {
  assertProductionReference(p);
  if (p.production?.mode !== "automatic") return;
  const attempts = p.jobs.filter(
    (j) =>
      j.shotId === shotId &&
      j.productionId === p.production!.id &&
      j.createdAt >=
        (p.shots.find((s) => s.id === shotId)?.revisionRequestedAt || ""),
  );
  if (attempts.length >= 2)
    throw new Error(
      "This scene has used its initial render and one automatic revision. Review and select the best usable take; do not start another render.",
    );
}

export async function inspectTakeAsset(assetId: string) {
  const sampled = await sampleAsset(assetId);
  const asset = getProject().assets.find((a) => a.id === assetId)!;
  if (asset.origin !== "h3") return { ...sampled, inspectionId: undefined };
  const inspection = {
    id: randomUUID(),
    assetId,
    sha256: asset.sha256,
    seconds: sampled.frames.map((f) => f.seconds),
  };
  mutateProject((p) => {
    p.takeInspections ||= [];
    p.takeInspections.push(inspection);
  });
  return { ...sampled, inspectionId: inspection.id };
}

export const takeReviewInput = z.object({
  jobId: z.string(),
  inspectionId: z.string(),
  verdict: z.enum(["use", "revise", "unusable"]),
  summary: z.string().trim().min(10).max(1200),
  observations: z
    .array(
      z.object({
        seconds: z.number().nonnegative(),
        note: z.string().trim().min(5).max(500),
      }),
    )
    .min(2)
    .max(4),
});

export function recordTakeReview(value: z.infer<typeof takeReviewInput>) {
  const input = takeReviewInput.parse(value);
  return mutateProject((p) => {
    const job = p.jobs.find(
      (j) => j.id === input.jobId && j.status === "succeeded",
    );
    const asset = p.assets.find((a) => a.id === job?.assetId);
    const inspection = p.takeInspections?.find(
      (i) =>
        i.id === input.inspectionId &&
        i.assetId === asset?.id &&
        i.sha256 === asset?.sha256,
    );
    if (!job || !asset || !inspection)
      throw new Error(
        "Inspect this completed H3 take before recording its review.",
      );
    if (
      new Set(input.observations.map((o) => o.seconds)).size < 2 ||
      input.observations.some((o) => !inspection.seconds.includes(o.seconds))
    )
      throw new Error(
        "Cite at least two distinct timestamps returned by this take's inspection.",
      );
    const existing = p.takeReviews?.find(
      (r) => r.jobId === input.jobId && r.inspectionId === input.inspectionId,
    );
    if (existing) return existing;
    const review = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    p.takeReviews ||= [];
    p.takeReviews.push(review);
    event(
      p,
      "take.reviewed",
      `Reviewed ${job.shotTitle || job.shotId}: ${input.verdict}`,
    );
    return review;
  });
}

export function selectReviewedTake(jobId: string) {
  return mutateProject((p) => {
    if (p.production?.mode !== "automatic")
      throw new Error(
        "Automatic take selection is not enabled for this campaign.",
      );
    assertProductionReference(p);
    const job = p.jobs.find((j) => j.id === jobId && j.status === "succeeded");
    const shot = p.shots.find((s) => s.id === job?.shotId);
    const take = shot?.takes.find(
      (t) => t.jobId === jobId && t.assetId === job?.assetId,
    );
    if (!job || !shot || !take)
      throw new Error("A completed take is required.");
    if (shot.acceptedTakeId === take.id) return shot;
    if (shot.locked)
      throw new Error(
        "This scene already has a selected take. Preserve it unless the user requests a revision.",
      );
    if (p.jobs.some((j) => j.shotId === shot.id && isActiveJob(j)))
      throw new Error(
        "Wait for this scene's existing render before selecting its take.",
      );
    if (
      job.productionId !== p.production.id ||
      !planUsesCurrentSources(p, job) ||
      job.duration !== shot.duration ||
      job.ratio !== projectRatio(p)
    )
      throw new Error(
        "This take belongs to an earlier reference, analysis, or output format. Review a take from the current production.",
      );
    const review = p.takeReviews?.findLast((r) => r.jobId === jobId);
    if (!review || review.verdict === "unusable")
      throw new Error(
        "The take reviewer must inspect and record a usable take before selection.",
      );
    const attempts = p.jobs.filter(
      (j) =>
        j.shotId === shot.id &&
        j.productionId === p.production!.id &&
        j.createdAt >= (shot.revisionRequestedAt || ""),
    );
    if (review.verdict === "revise" && attempts.length < 2)
      throw new Error(
        "Address the reviewer's concrete issue with the one allowed revision, then select the best usable reviewed take.",
      );
    shot.acceptedTakeId = take.id;
    shot.locked = true;
    event(p, "take.accepted", `Director selected ${shot.title} after review`);
    return shot;
  });
}

export async function finishTakeSelection(jobId: string) {
  const shot = selectReviewedTake(jobId);
  const remaining = getProject().shots.filter(
    (s) => s.kind !== "title" && !acceptedAsset(s),
  );
  return {
    shot,
    remainingShots: remaining.map((s) => ({ id: s.id, title: s.title })),
    next: remaining.length
      ? "Continue rendering and reviewing the remaining scenes now; no human approval is needed."
      : "The finished MP4 is ready.",
    cut: remaining.length ? undefined : await assembleCut(),
  };
}
