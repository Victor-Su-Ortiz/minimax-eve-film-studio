import { defineTool } from "eve/tools";
import { soundtrackInput } from "../../lib/domain";
import { setSoundtrack } from "../../lib/soundtrack";

export default defineTool({
  description:
    "Choose the final soundtrack: source uses actual audio from an imported original clip or uploaded audio file via sourceAssetId; instrumental uses local note synthesis; silent removes audio. For source audio, fit match-source makes a shorter edit retaining every accepted scene and a brief title card, at native speed, to match the source audio length; fit keep-film preserves the existing edit. Playback once is the default; on a longer film it fades to silence after the source ends. Loop only when the user requests repetition. Match-source must use once. Replaces all H3 take audio. Preserves accepted takes; no H3 render or paid music API. Then call create_cut. Source audio is the real recording, not an imitation.",
  inputSchema: soundtrackInput,
  label: {
    start: ({ mode }) =>
      mode === "source"
        ? "Use the original reference audio"
        : "Set the film soundtrack",
  },
  execute: setSoundtrack,
});
