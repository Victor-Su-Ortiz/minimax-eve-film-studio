import { defineTool } from "eve/tools";
import { exportStyleInput } from "../../lib/export-style";
import { assembleCut } from "../../lib/assembly";

export default defineTool({
  description:
    "Export a downloadable 1080p MP4 from selected real footage. Default finish=clean adds NO brand assets, watermark, logos or title card. For a supplied logo, register it with set_brand_assets then use finish=brand-overlay and logoAssetId: the exact image fades over the final four seconds while footage continues moving. Every shot must be footage, not title kind. Never add MiniMax or Vercel marks unless the user supplies and requests them. Uses the saved soundtrack, excludes H3 audio, and preserves earlier exports. No public posting.",
  inputSchema: exportStyleInput,
  label: { start: () => "Assemble the launch film" },
  execute: (input) => assembleCut(input),
});
