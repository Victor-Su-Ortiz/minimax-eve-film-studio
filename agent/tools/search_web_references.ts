import { defineTool } from "eve/tools";
import { searchWebReferences, webResearchInput } from "../../lib/web-search";
export default defineTool({
  description:
    "Optional: call only when get_project.connections.webSearchConfigured is true. Find public-web campaign research through Exa. Without search keys, use uploaded references; the agent has no independent browser search. scope=social searches indexed X, TikTok, Instagram and YouTube pages; scope=web finds brand campaign pages, articles and case studies. Use natural-language descriptions, not X boolean syntax, and only public topics. Returns at most eight dated research leads, not downloaded videos, verified view counts, visual matches or viral recommendations. Unsupported platform videos require a user upload; search does not add an importer. Never select these leads into the verified viral gallery or claim the clips were watched. Use at most two Exa searches per task and preserve the user's chosen reference.",
  inputSchema: webResearchInput,
  label: { start: () => "Research across the web" },
  execute: (input) => searchWebReferences(input),
});
