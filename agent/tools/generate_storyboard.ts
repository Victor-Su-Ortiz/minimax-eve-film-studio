import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { generateStoryboard, storyboardInput } from "../../lib/storyboard";
import { readMedia } from "../../lib/media-storage";

export default defineTool({
  description:
    "Generate one real MiniMax Image-01 storyboard frame for a planned shot before H3. Describe a single cinematic keyframe (not a multi-panel sheet). Optional subjectAssetId uses an existing character image for continuity, not an exact logo. Frames appear in the app and the current frame is automatically sent to H3 as a visual reference. Generate all planned frames before video; stop after images if the user requested storyboards only. Repeated identical calls reuse the saved result; never retry unknown requests.",
  inputSchema: storyboardInput,
  label: { start: ({ shotId }) => `Draw storyboard for ${shotId}` },
  execute: (input) => generateStoryboard(input),
  async toModelOutput(frame) {
    return toolOutput.content([
      toolOutputPart.text(JSON.stringify(frame)),
      ...(frame.status === "ready" && frame.assetId
        ? [
            toolOutputPart.file(
              (await readMedia(frame.assetId)).toString("base64"),
              { mediaType: "image/png" },
            ),
          ]
        : []),
    ]);
  },
});
