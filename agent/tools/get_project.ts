import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProject } from "../../lib/store";
import { textKey, videoKey, discoveryStatus } from "../../lib/config";

export default defineTool({
  description:
    "Read the saved campaign references, source revision and analyses, launch brief, treatments, shot board, asset metadata, locks and real H3 jobs.",
  inputSchema: z.object({}),
  label: { start: () => "Read the director’s workspace" },
  execute: async () => ({
    ...(await getProject()),
    productionGuide:
      "The user chooses the initial source once. In automatic mode, wait for production.reference before rendering; scout curation is not a user choice. Then analyze, save a written shot plan and render every missing scene directly with H3. Image generation has been removed; historical storyboard images must not block rendering or be used as references. Then delegate take review, select_take and export without human take approvals. The last select_take also exports automatically. Preserve selected footage. End only with the finished MP4 or a concrete service failure. Older conversation instructions about test approval are superseded.",
    connections: {
      textConfigured: Boolean(textKey()),
      videoConfigured: Boolean(videoKey()),
      trendSearchConfigured: discoveryStatus().xConfigured,
      webSearchConfigured: discoveryStatus().exaConfigured,
      discovery: discoveryStatus(),
      note: "Presence in this agent runtime only; API entitlement is verified by actual requests. Keys are never returned.",
    },
  }),
});
