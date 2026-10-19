import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { videoKey } from "./config";
import {
  isActiveJob,
  requireEditableShot,
  projectRatio,
  planUsesCurrentSources,
  type Asset,
  type RenderJob,
} from "./domain";
import { referenceContent, probe } from "./media";
import { event, getProject, mediaPath, mutateProject } from "./store";
import { assertRenderAllowance } from "./production";

export type ProviderFetch = typeof fetch;
export function providerBase() {
  return (
    process.env.MINIMAX_VIDEO_BASE_URL || "https://api.minimax.io"
  ).replace(/\/$/, "");
}
function updateJob(id: string, values: Partial<RenderJob>) {
  return mutateProject((p) => {
    const job = p.jobs.find((j) => j.id === id);
    if (!job) throw new Error("Render job not found.");
    Object.assign(job, values, { updatedAt: new Date().toISOString() });
    return structuredClone(job);
  });
}

/** Reserve before the provider write. A lost response stays unknown and is never resubmitted. */
export async function submitShot(
  shotId: string,
  requestKey: string,
  resolution: "768P" | "2K" = "768P",
  providerFetch: ProviderFetch = fetch,
) {
  const previous = getProject().jobs.find((j) => j.requestKey === requestKey);
  if (previous) return previous;
  if (!videoKey())
    throw new Error(
      "The H3 credential is unavailable to this render worker. Check the current connection with check_video_connection. No provider request was made.",
    );
  const snapshot = getProject();
  assertRenderAllowance(snapshot, shotId);
  const shot = requireEditableShot(snapshot, shotId);
  if (shot.kind !== "generated" || !shot.prompt.trim())
    throw new Error("This shot needs an H3 prompt before rendering.");
  if (!planUsesCurrentSources(snapshot, shot))
    throw new Error(
      "This shot predates the current reference analysis. Inspect the selected footage, save the analysis, and update this shot's prompt and sourceBasis before rendering. No H3 request was made.",
    );
  const references = await referenceContent(shot.referenceIds);
  const reservation = mutateProject((p) => {
    const duplicate = p.jobs.find((j) => j.requestKey === requestKey);
    if (duplicate) return { job: structuredClone(duplicate), fresh: false };
    assertRenderAllowance(p, shotId);
    const current = requireEditableShot(p, shotId);
    if (!planUsesCurrentSources(p, current))
      throw new Error(
        "Campaign analysis changed while preparing the render. Update the shot plan before rendering.",
      );
    if (current.revision !== shot.revision)
      throw new Error(
        "Shot changed while preparing references. Review it and render again.",
      );
    if (projectRatio(p) !== projectRatio(snapshot))
      throw new Error(
        "Output format changed while preparing the render. Review and try again.",
      );
    if (p.jobs.some((j) => j.shotId === shotId && isActiveJob(j)))
      throw new Error(
        "This shot already has a pending or uncertain job. Check that job before creating another.",
      );
    const now = new Date().toISOString();
    const job: RenderJob = {
      id: randomUUID(),
      requestKey,
      shotId,
      shotRevision: shot.revision,
      productionId: p.production?.id,
      prompt: shot.sourceBasis
        ? `${shot.prompt}\n\nCreative adaptation from inspected footage: ${shot.sourceBasis.adaptation}`
        : shot.prompt,
      referenceIds: [...shot.referenceIds],
      sourceBasis: shot.sourceBasis
        ? structuredClone(shot.sourceBasis)
        : undefined,
      shotTitle: shot.title,
      duration: shot.duration,
      resolution,
      ratio: projectRatio(snapshot),
      status: "submitting",
      createdAt: now,
      updatedAt: now,
    };
    p.jobs.push(job);
    event(p, "render.submitting", `Sending ${shot.title} to MiniMax H3`);
    return { job, fresh: true };
  });
  if (!reservation.fresh) return reservation.job;
  const job = reservation.job;
  let response: Response;
  try {
    response = await providerFetch(`${providerBase()}/v2/video_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${videoKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-H3",
        content: [{ type: "text", text: job.prompt }, ...references],
        resolution,
        duration: job.duration,
        ratio: job.ratio || "16:9",
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return updateJob(job.id, {
      status: "unknown",
      error:
        "The provider response was lost. Do not resubmit. Recover the task ID from the MiniMax console, then attach it to this job.",
    });
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 408;
    return updateJob(job.id, {
      status: uncertain ? "unknown" : "failed",
      error: `MiniMax returned HTTP ${response.status}.${uncertain ? " Check the console before resubmitting." : " Check API access, balance and input requirements."}`,
    });
  }
  let body: { task_id?: string };
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!body.task_id || !/^[a-zA-Z0-9_-]+$/.test(body.task_id))
    return updateJob(job.id, {
      status: "unknown",
      error:
        "MiniMax accepted the request but returned no readable task ID. Reconcile it in the provider console.",
    });
  const updated = updateJob(job.id, { taskId: body.task_id, status: "queued" });
  mutateProject((p) =>
    event(
      p,
      "render.queued",
      `H3 job ${body.task_id} queued for ${shot.title}`,
    ),
  );
  return updated;
}

export async function refreshJob(
  jobId: string,
  providerFetch: ProviderFetch = fetch,
) {
  const job = getProject().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Job not found.");
  if (!job.taskId || ["failed", "succeeded"].includes(job.status)) return job;
  if (!videoKey()) throw new Error("H3 API key is missing.");
  const response = await providerFetch(
    `${providerBase()}/v2/query/video_generation/${encodeURIComponent(job.taskId)}`,
    {
      headers: { Authorization: `Bearer ${videoKey()}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not check H3 job (HTTP ${response.status}). The existing task ID has been preserved.`,
    );
  const body = (await response.json()) as {
    task?: {
      id: string;
      status: string;
      content?: { url?: string };
      error?: unknown;
    };
  };
  const task = body.task;
  if (!task || task.id !== job.taskId)
    throw new Error(
      "H3 returned a mismatched task. The existing job has been preserved.",
    );
  if (["queued", "running"].includes(task.status))
    return updateJob(job.id, {
      status: task.status as "queued" | "running",
      error: undefined,
    });
  if (["failed", "cancelled"].includes(task.status))
    return updateJob(job.id, {
      status: "failed",
      error: `H3 marked this task ${task.status}.`,
    });
  if (task.status !== "succeeded" || !task.content?.url)
    throw new Error(
      "H3 returned an unrecognized task status or no output URL.",
    );
  const url = new URL(task.content.url);
  if (url.protocol !== "https:")
    throw new Error("H3 output URL must use HTTPS.");
  const video = await providerFetch(url, {
    signal: AbortSignal.timeout(90_000),
  });
  if (!video.ok || !video.body)
    throw new Error(
      "The shot is ready at H3, but its video could not be saved locally. Check this job again to retry the download.",
    );
  const reader = video.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 150 * 1024 * 1024)
        throw new Error("Rendered video exceeds the 150 MB local limit.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  const assetId = `render_${job.id}`;
  await writeFile(mediaPath(assetId), bytes);
  const metadata = await probe(mediaPath(assetId));
  const asset: Asset = {
    id: assetId,
    name: `${job.shotId}-${job.id.slice(0, 8)}.mp4`,
    mime: "video/mp4",
    size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    origin: "h3",
    createdAt: new Date().toISOString(),
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
  };
  return mutateProject((p) => {
    const existing = p.jobs.find((j) => j.id === job.id)!;
    if (existing.status === "succeeded") return existing;
    p.assets.push(asset);
    const shot = p.shots.find((s) => s.id === job.shotId)!;
    shot.takes.push({
      id: job.id,
      jobId: job.id,
      assetId,
      prompt: job.prompt,
      createdAt: asset.createdAt,
    });
    Object.assign(existing, {
      status: "succeeded",
      assetId,
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    event(
      p,
      "render.ready",
      `New take ready for ${shot.title}. ${p.production?.mode === "automatic" ? "The crew will review and continue." : "Awaiting your review."}`,
    );
    return structuredClone(existing);
  });
}

export function recoverJob(jobId: string, taskId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId))
    throw new Error("Enter the task ID from the MiniMax console.");
  return mutateProject((p) => {
    const job = p.jobs.find((j) => j.id === jobId);
    if (!job || !["unknown", "submitting"].includes(job.status) || job.taskId)
      throw new Error(
        "Only an uncertain submission without a task ID can be recovered.",
      );
    if (p.jobs.some((j) => j.taskId === taskId))
      throw new Error("That task ID is already registered.");
    Object.assign(job, {
      taskId,
      status: "queued",
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    event(p, "render.recovered", `Recovered H3 task ${taskId}`);
    return job;
  });
}
