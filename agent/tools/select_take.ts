import { defineTool } from "eve/tools";
import { z } from "zod";
import { finishTakeSelection } from "../../lib/production";

export default defineTool({
  availableInSubagents: false,
  description:
    "Select a completed take for the final film after take_reviewer records its visual review. No human approval is needed. A 'revise' review permits one corrective render, then select the best usable reviewed take from this production, including the earlier candidate if it is better. Preserves existing selected footage. After selection, immediately continue remaining scenes and create_cut; do not stop for approval.",
  inputSchema: z.object({ jobId: z.string() }),
  label: { start: () => "Choose the reviewed take for the film" },
  execute: ({ jobId }) => finishTakeSelection(jobId),
});
