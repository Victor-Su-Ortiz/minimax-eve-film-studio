import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { inspectTakeAsset } from "../../lib/production";
import { reviewSheet } from "../../lib/review-sheet";

export default defineTool({
  description:
    "Inspect an image or four sampled video frames in one timestamped contact sheet. Compare the visible panels for continuity; this does not verify audio or all motion.",
  inputSchema: z.object({ assetId: z.string() }),
  label: { start: () => "Review visual references and continuity" },
  execute: async ({ assetId }) => {
    const sampled = await inspectTakeAsset(assetId);
    const sheet = await reviewSheet(sampled.frames);
    return {
      assetId: sampled.assetId,
      inspectionId: sampled.inspectionId,
      name: sampled.name,
      duration: sampled.duration,
      timestamps: sampled.frames.map((frame) => frame.seconds),
      note: sampled.note,
      sheet,
    };
  },
  toModelOutput(output) {
    return toolOutput.content([
      toolOutputPart.text(
        `${output.name}. Asset: ${output.assetId}. Inspection: ${output.inspectionId || "source only"}. Exact timestamps: ${JSON.stringify(output.timestamps)}. ${output.note} ${output.sheet.note}`,
      ),
      toolOutputPart.file(output.sheet.data, { mediaType: "image/jpeg" }),
    ]);
  },
});
