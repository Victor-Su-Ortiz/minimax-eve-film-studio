import { defineTool } from "eve/tools";
import { z } from "zod";
import { event, mutateProject } from "../../lib/store";
import { selectTrendPosts } from "../../lib/trend-selection";

export default defineTool({
  description:
    "Curate a completed X search using recorded VLM frame matches. Each selected post must have more than 100,000 reported views and a matched verdict from inspect_trend_candidate then record_trend_visual_match. Captions alone cannot qualify a post. An empty list is valid after inspecting candidates or when retrieval is empty. Imported campaign references stay separate.",
  inputSchema: z.object({
    postIds: z.array(z.string()).max(6),
    searchId: z.string().optional(),
    note: z.string().min(1).max(400),
  }),
  label: { start: () => "Select relevant trend examples" },
  execute({ postIds, note, searchId }) {
    return mutateProject((p) => {
      const search = searchId
        ? p.trendSearches?.find((s) => s.id === searchId)
        : p.trendSearches?.at(-1);
      if (!search || search.status !== "complete")
        throw new Error("Complete a trend search first.");
      search.selectedPostIds = selectTrendPosts(
        search,
        p.socialPosts || [],
        postIds,
      );
      search.selectionNote = note;
      event(
        p,
        "trends.selected",
        `Selected ${search.selectedPostIds.length} relevant video examples`,
      );
      return search;
    });
  },
});
