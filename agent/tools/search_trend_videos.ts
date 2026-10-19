import { defineTool } from "eve/tools";
import { searchTrendVideos, trendSearchInput } from "../../lib/social";

export default defineTool({
  description:
    "Retrieve up to six public X video candidates with more than 100,000 reported views across up to three pages. query is passed to TwitterAPI.io advanced_search and supports X search operators: uppercase OR, parentheses, quoted phrases, from:handle, -term, min_faves:N. Preserve these operators; never flatten (cat OR kitten) into cat kitten. Spaces between words restrict the search, so use short subject alternatives rather than a sentence describing the desired scene. visualTarget is the subject/action to find IN THE VIDEO. Broaden to general subjects or relevant creator feeds before trying an empty query. Inspect candidate frames and record visual matches before selection. Do not reject vague or missing captions. Retrieval is bounded, not a visual index of all X videos. Keep private campaign information out of queries. The >100K reported-view requirement applies independently of any favorites filter.",
  inputSchema: trendSearchInput,
  label: {
    start: ({ query, visualTarget }) => `Find videos: ${query || visualTarget}`,
  },
  execute: (input) => searchTrendVideos(input),
});
