import { defineTool } from "eve/tools";
import {
  prepareVideoReference,
  videoReferenceInput,
} from "../../lib/video-reference";

export default defineTool({
  availableInSubagents: false,
  description:
    "Prepare a chosen 2–15 second excerpt from an existing video for H3 visual reference. Use after inspecting the original when it exceeds H3's 15-second limit, or to select a relevant beat from a previous take for continuity. start and duration are seconds in that asset. Returns a real silent MP4 asset with provenance. Does not replace the original, change campaign analysis, select footage or shorten the full original soundtrack. Use the returned asset ID in update_shot.referenceIds; never drop a requested video reference just because it is too long.",
  inputSchema: videoReferenceInput,
  label: { start: () => "Prepare source footage for H3" },
  execute: prepareVideoReference,
});
