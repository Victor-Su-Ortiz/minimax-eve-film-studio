import { defineTool } from "eve/tools";
import { recordTakeReview, takeReviewInput } from "../../../../lib/production";

export default defineTool({
  description:
    "Record your review of a real completed H3 take after inspect_asset. Cite at least two exact sampled timestamps. Use 'use' for a usable take, 'revise' for a fixable visible issue, and 'unusable' only for footage that cannot serve the film. This records evidence; the director selects the take and continues automatically.",
  inputSchema: takeReviewInput,
  label: { start: () => "Record the take review" },
  execute: recordTakeReview,
});
