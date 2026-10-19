import { defineTool } from "eve/tools";
import { exportStyleInput } from "../../lib/export-style";
import { assembleCut } from "../../lib/assembly";

export default defineTool({
  description:
    "Finish production automatically as a downloadable 1080p MP4. For MiniMax × Vercel with continuing action, use finish=moving-cobrand: every shot must be real selected footage, including the finale; no title-kind shots. Exact official logos fade over the final four seconds, with no freeze-frame or separate card. Set cornerWatermark=false when asked to remove the corner MiniMax wordmark; this preserves the closing co-brand lockup. Default brand-card retains the MiniMax-only title behavior. Uses the saved original audio, instrumental score, or silence; H3 audio is excluded. Preserves previous exports. No public posting.",
  inputSchema: exportStyleInput,
  label: { start: () => "Assemble the launch film" },
  execute: (input) => assembleCut(input),
});
