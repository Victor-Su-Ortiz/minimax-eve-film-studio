import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  event,
  getProject,
  mutateProject,
  startNewCampaign,
} from "@/lib/store";
import { assertLocalRequest, apiError } from "@/lib/http";
import { requireEditableShot, shotInput } from "@/lib/domain";
import { assembleCut } from "@/lib/assembly";
import { recoverJob, refreshJob } from "@/lib/renders";
import { campaignBriefInput } from "@/lib/campaign";
import { saveCampaignBrief } from "@/lib/campaign-store";
import { saveShotPlan } from "@/lib/shot-plan";
import { MAX_CAMPAIGN_REFERENCES } from "@/lib/reference-limits";
import {
  chooseProductionReference,
  referenceFromPrompt,
} from "@/lib/production";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const mutation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("new-campaign"),
    expectedUpdatedAt: z.string(),
  }),
  z.object({
    action: z.literal("prompt"),
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(6000),
    assetIds: z.array(z.string()).max(MAX_CAMPAIGN_REFERENCES),
    referenceUrl: z.string().url().optional(),
  }),
  z.object({ action: z.literal("campaign"), campaign: campaignBriefInput }),
  z.object({ action: z.literal("brief"), brief: z.string().min(1).max(12000) }),
  z.object({ action: z.literal("shot"), shot: shotInput }),
  z.object({
    action: z.literal("lock"),
    shotId: z.string(),
    locked: z.boolean(),
  }),
  z.object({
    action: z.literal("accept"),
    shotId: z.string(),
    takeId: z.string(),
  }),
  z.object({
    action: z.literal("assign"),
    shotId: z.string(),
    assetId: z.string(),
  }),
  z.object({ action: z.literal("treatment"), treatmentId: z.string() }),
  z.object({
    action: z.literal("session"),
    sessionId: z.string().min(1).max(200),
  }),
  z.object({ action: z.literal("check-job"), jobId: z.string() }),
  z.object({
    action: z.literal("recover-job"),
    jobId: z.string(),
    taskId: z.string(),
  }),
  z.object({ action: z.literal("export") }),
]);
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return Response.json(await getProject());
  } catch (error) {
    return apiError(error, 403);
  }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const input = mutation.parse(await request.json());
    if (input.action === "new-campaign")
      return Response.json(await startNewCampaign(input.expectedUpdatedAt));
    if (input.action === "campaign") {
      await saveCampaignBrief(input.campaign);
      return Response.json(await getProject());
    }
    if (input.action === "shot") {
      await saveShotPlan(input.shot);
      return Response.json(await getProject());
    }
    if (input.action === "export")
      return Response.json({ cut: await assembleCut() });
    if (input.action === "check-job")
      return Response.json({ job: await refreshJob(input.jobId) });
    if (input.action === "recover-job")
      return Response.json({
        job: await recoverJob(input.jobId, input.taskId),
      });
    await mutateProject((p) => {
      if (input.action === "prompt") {
        if (!p.requests?.some((r) => r.id === input.id)) {
          for (const id of input.assetIds) {
            const asset = p.assets.find((a) => a.id === id);
            if (!asset || !/^(image|video)\//.test(asset.mime))
              throw new Error(
                "Choose an image or video reference from this workspace.",
              );
          }
          const referenceUrl =
            input.referenceUrl || referenceFromPrompt(input.text);
          const videos = input.assetIds.filter((id) =>
            p.assets.some((a) => a.id === id && a.mime.startsWith("video/")),
          );
          if (referenceUrl) chooseProductionReference(p, { url: referenceUrl });
          else if (!p.production?.reference && videos.length === 1)
            chooseProductionReference(p, { assetId: videos[0] });
          p.requests ||= [];
          if (p.requests.length === 0) p.brief = input.text;
          p.requests.push({
            id: input.id,
            text: input.text,
            assetIds: input.assetIds,
            createdAt: new Date().toISOString(),
          });
          event(p, "prompt.saved", "Saved your direction");
        }
      }
      if (input.action === "brief") {
        p.brief = input.brief;
        event(p, "brief.saved", "Updated the launch brief");
      }
      if (input.action === "session") {
        if (p.sessionId && p.sessionId !== input.sessionId) {
          p.previousSessionIds ||= [];
          if (!p.previousSessionIds.includes(p.sessionId))
            p.previousSessionIds.push(p.sessionId);
        }
        p.sessionId = input.sessionId;
      }
      if (input.action === "treatment") {
        if (!p.treatments.some((t) => t.id === input.treatmentId))
          throw new Error("Treatment not found.");
        p.selectedTreatmentId = input.treatmentId;
        event(p, "treatment.selected", "Selected a creative direction");
      }
      if (input.action === "lock") {
        const shot = p.shots.find((s) => s.id === input.shotId);
        if (!shot) throw new Error("Shot not found.");
        shot.locked = input.locked;
        if (!input.locked) shot.revisionRequestedAt = new Date().toISOString();
        event(
          p,
          "shot.locked",
          `${input.locked ? "Locked" : "Unlocked"} ${shot.title}`,
        );
      }
      if (input.action === "accept") {
        const shot = requireEditableShot(p, input.shotId);
        if (!shot.takes.some((t) => t.id === input.takeId))
          throw new Error("Take not found.");
        shot.acceptedTakeId = input.takeId;
        shot.locked = true;
        event(p, "take.accepted", `Accepted and locked ${shot.title}`);
      }
      if (input.action === "assign") {
        const shot = requireEditableShot(p, input.shotId);
        const asset = p.assets.find((a) => a.id === input.assetId);
        if (!asset || !asset.mime.startsWith("video/"))
          throw new Error("Choose a video asset.");
        const take = {
          id: randomUUID(),
          assetId: asset.id,
          prompt: "Source footage selected by the director",
          createdAt: new Date().toISOString(),
        };
        shot.takes.push(take);
        shot.acceptedTakeId = take.id;
        shot.locked = true;
        event(p, "take.accepted", `Assigned ${asset.name} to ${shot.title}`);
      }
    });
    return Response.json(await getProject());
  } catch (error) {
    return apiError(error);
  }
}
