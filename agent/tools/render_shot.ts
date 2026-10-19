import { defineWorkflowTool } from "eve/tools";
import { sleep } from "workflow";
import { z } from "zod";
import { refreshJob, submitShot } from "../../lib/renders";
import type { RenderJob } from "../../lib/domain";

export default defineWorkflowTool({
  description:
    "Render one unlocked shot with MiniMax H3 after the user chooses the initial reference. Records its task ID, waits durably, and saves a candidate for take_reviewer and automatic selection. At most one corrective render per scene. Continue until create_cut returns the final film. Never resubmits uncertain jobs.",
  inputSchema: z.object({
    shotId: z.string(),
    resolution: z.enum(["768P", "2K"]).default("768P"),
  }),
  label: { start: ({ shotId }) => `Render ${shotId} with H3` },
  async *execute({ shotId, resolution }, ctx) {
    "use workflow";
    const start = await beginRender(
      shotId,
      `${ctx.session.id}:${ctx.callId}`,
      resolution,
    );
    if ("error" in start) return start;
    let job = start.job;
    yield { shotId, status: job.status, taskId: job.taskId };
    for (let i = 0; i < 90; i++) {
      if (["succeeded", "failed", "unknown"].includes(job.status))
        return { job };
      await sleep("30s");
      const checked = await checkRender(job.id);
      if ("job" in checked) job = checked.job;
      yield {
        shotId,
        status: job.status,
        taskId: job.taskId,
        ...("error" in checked ? { note: checked.error } : {}),
      };
    }
    return {
      job,
      note: "The provider job is still pending. Its task ID is saved. Check it from Activity; do not submit another render.",
    };
  },
});

async function beginRender(
  shotId: string,
  requestKey: string,
  resolution: "768P" | "2K",
): Promise<{ job: RenderJob } | { error: string }> {
  "use step";
  console.info("studio.render.start", { shotId });
  try {
    return { job: await submitShot(shotId, requestKey, resolution) };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not start this render.",
    };
  }
}
async function checkRender(
  jobId: string,
): Promise<{ job: RenderJob } | { error: string }> {
  "use step";
  console.info("studio.render.check", { jobId });
  try {
    return { job: await refreshJob(jobId) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not check this render. Its task ID is preserved.",
    };
  }
}
