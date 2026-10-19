import { defineTool } from "eve/tools";
import { z } from "zod";
import { importCampaignVideo } from "../../lib/social";

export default defineTool({
  description:
    "Retrieve the actual video from an exact public TikTok or X post URL. Verify its post ID, save a local playable MP4 with source attribution and observed counts, and attach it to the campaign for inspection. Supports full TikTok /@creator/video/ID and X /creator/status/ID links, up to 2 minutes and 32 MB. Import is not visual inspection; call inspect_campaign_reference next. A blocked or unavailable source is returned explicitly. Does not attach footage to H3 generation prompts.",
  inputSchema: z.object({ url: z.string().url().max(1500) }),
  label: { start: () => "Retrieve the original campaign video" },
  execute: ({ url }) => importCampaignVideo(url),
});
