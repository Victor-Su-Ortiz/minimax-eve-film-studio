import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import {
  inspectTrendCandidate,
  inspectTrendInput,
} from "../../lib/trend-vision";

export default defineTool({
  description:
    "Retrieve a discovered candidate's actual video and inspect eight timestamped frames in one image. Does not attach it to or change the campaign. Use the visualTarget to assess relevance even when the caption omits it. Follow with record_trend_visual_match. Inspect before selecting; unavailable footage cannot be a visual match.",
  inputSchema: inspectTrendInput,
  label: { start: () => "M3.1 is checking the actual video" },
  execute: (input) => inspectTrendCandidate(input),
  toModelOutput(output) {
    if (!output.sheet) return toolOutput.text(JSON.stringify(output));
    const { sheet, ...metadata } = output;
    return toolOutput.content([
      toolOutputPart.text(JSON.stringify(metadata)),
      toolOutputPart.file(sheet.data, { mediaType: "image/jpeg" }),
    ]);
  },
});
