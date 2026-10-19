import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { getBrandAssets } from "../../lib/brand";
export default defineTool({
  description:
    "Inspect only brand images supplied by this user and registered with set_brand_assets. An empty kit returns no artwork. There is no preloaded brand kit.",
  inputSchema: z.object({}),
  label: { start: () => "Inspect your brand artwork" },
  execute: getBrandAssets,
  toModelOutput({ previews, ...metadata }) {
    return toolOutput.content([
      toolOutputPart.text(JSON.stringify(metadata)),
      ...previews.flatMap((preview) => [
        toolOutputPart.text(`Brand asset ${preview.assetId}`),
        toolOutputPart.file(preview.data, { mediaType: "image/jpeg" }),
      ]),
    ]);
  },
});
