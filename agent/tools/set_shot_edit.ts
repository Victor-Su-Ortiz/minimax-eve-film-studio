import { defineTool } from "eve/tools";
import { setShotEdit, shotEditInput } from "../../lib/shot-edit";

export default defineTool({
  availableInSubagents: false,
  description:
    "Set the in-point of a selected, reviewed take without regenerating or modifying its file. Use to remove repeated action at a scene boundary. start is seconds into that take, snapped to 24fps. holdEnd permits at most two seconds of holding its last frame to preserve the planned scene and soundtrack length. Keep at least two seconds of moving footage. Changes are tied to this exact selected take and require create_cut to export. Use only when the footage and intended cut support this editorial decision.",
  inputSchema: shotEditInput,
  label: { start: () => "Refine the cut between scenes" },
  execute: setShotEdit,
});
