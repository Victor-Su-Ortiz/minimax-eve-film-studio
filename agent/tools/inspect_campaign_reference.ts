import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { inspectCampaignReference } from "../../lib/campaign-store";

export default defineTool({
  description:
    "Inspect a saved campaign reference as up to twelve timestamped still frames, including a denser opening sample. This does not play video or hear audio. Use exact returned timestamps for visual observations.",
  inputSchema: z.object({ assetId: z.string() }),
  label: { start: () => "Inspect campaign reference frames" },
  execute: ({ assetId }) => inspectCampaignReference(assetId),
  toModelOutput(output) {
    return toolOutput.content([
      toolOutputPart.text(
        `Asset ${output.assetId}: ${output.name}. Duration ${output.duration || 0}s. ${output.note}`,
      ),
      ...output.frames.flatMap((frame) => [
        toolOutputPart.text(`Sample at ${frame.seconds.toFixed(3)}s`),
        toolOutputPart.file(frame.data, { mediaType: "image/jpeg" }),
      ]),
    ]);
  },
});
