import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { loadBrandAssets } from "../../lib/brand";

export default defineTool({
  description:
    "Load and visually inspect the real MiniMax M3.1 Flash Figma brand kit. Returns the launch artwork and a text-free flower asset ID eligible for H3 referenceIds. The exporter applies the exact official logos separately. Does not change campaign evidence, shot plans or accepted footage.",
  inputSchema: z.object({}),
  label: { start: () => "Bring in the MiniMax launch artwork" },
  execute: () => loadBrandAssets(),
  toModelOutput(output) {
    const { preview, ...metadata } = output;
    return toolOutput.content([
      toolOutputPart.text(JSON.stringify(metadata)),
      toolOutputPart.file(preview.data, { mediaType: preview.mediaType }),
    ]);
  },
});
