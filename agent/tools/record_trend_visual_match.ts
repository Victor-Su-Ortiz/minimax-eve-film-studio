import { defineTool } from "eve/tools";
import {
  recordTrendVisualMatch,
  trendVisualMatchInput,
} from "../../lib/trend-vision";

export default defineTool({
  description:
    "Record your VLM assessment AFTER inspect_trend_candidate returned actual frames. Match the visualTarget using visible subject/action; captions are not evidence. A match needs at least two distinct inspected timestamps. Use uncertain when sampled stills cannot establish the action. Selection requires a recorded visual match.",
  inputSchema: trendVisualMatchInput,
  label: { start: () => "Save visual match and frame evidence" },
  execute: async (input) => await recordTrendVisualMatch(input),
});
