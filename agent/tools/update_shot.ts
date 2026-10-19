import { defineTool } from "eve/tools";
import { shotInput } from "../../lib/domain";
import { saveShotPlan } from "../../lib/shot-plan";

export default defineTool({
  description:
    "Update an unlocked shot's actual H3 prompt. For a campaign reference, sourceBasis must cite the latest analysisId and inspected assetIds, explaining the concrete observed detail used in this shot. referenceIds are actual media inputs sent to H3; sourceBasis records creative influence. Preserve takes and locks, but revise unaccepted plans when the user changes references.",
  inputSchema: shotInput,
  label: { start: ({ title }) => `Plan “${title}”` },
  execute: saveShotPlan,
});
