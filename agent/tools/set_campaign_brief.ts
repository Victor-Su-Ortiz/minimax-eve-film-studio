import { defineTool } from "eve/tools";
import { campaignBriefInput } from "../../lib/campaign";
import { saveCampaignBrief } from "../../lib/campaign-store";

export default defineTool({
  description:
    "Turn the user's natural-language request into the saved campaign brief. Infer sensible title, brand, goal and aspect ratio; preserve supplied source links and references. Accept up to 10 campaign sources; user-supplied brand images stay in the media library and do not consume source slots. Use the returned assetIds and revision as authoritative; import_campaign_video attaches the actual chosen social video. Infer the requested brand; do not default to MiniMax or invent product facts. Default to a 30-second 9:16 film. Do not invent source links or claim to have watched a clip.",
  inputSchema: campaignBriefInput,
  label: { start: () => "Understand your campaign brief" },
  execute: async (input) => await saveCampaignBrief(input),
});
