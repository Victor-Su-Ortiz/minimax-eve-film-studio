import { defineTool } from "eve/tools";
import { campaignBriefInput } from "../../lib/campaign";
import { saveCampaignBrief } from "../../lib/campaign-store";

export default defineTool({
  description:
    "Turn the user's natural-language request into the saved campaign brief. Infer sensible title, brand, goal and aspect ratio; preserve supplied source links and references. Accept up to 10 campaign sources; official MiniMax brand images stay in the media library and do not consume source slots. Use the returned assetIds and revision as authoritative; import_campaign_video attaches the actual chosen social video. Default to a 30-second 9:16 MiniMax M3.1 launch. Do not invent source links or claim to have watched a clip.",
  inputSchema: campaignBriefInput,
  label: { start: () => "Understand your campaign brief" },
  execute: (input) => saveCampaignBrief(input),
});
