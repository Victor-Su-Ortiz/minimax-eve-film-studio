import { defineTool } from "eve/tools";
import { campaignAnalysisInput } from "../../lib/campaign";
import { saveCampaignAnalysis } from "../../lib/campaign-store";

export default defineTool({
  description:
    "Save a campaign creative breakdown and an original launch-film adaptation. Visual observations must cite inspected asset timestamps. Mark explanations of engagement, unsampled timing and source-link descriptions as hypotheses. Beats describe the proposed new film, not a verified source timeline. audioPlan is a proposal, never a claim that you heard the source.",
  inputSchema: campaignAnalysisInput,
  label: { start: () => "Map campaign structure to the launch film" },
  execute: async (input) => await saveCampaignAnalysis(input),
});
