import {
  planUsesCurrentSources,
  requireEditableShot,
  shotInput,
  type ShotInput,
} from "./domain";
import { event, mutateProject } from "./store";

export async function saveShotPlan(value: ShotInput) {
  const input = shotInput.parse(value);
  return await mutateProject((p) => {
    const shot = requireEditableShot(p, input.id);
    for (const id of input.referenceIds)
      if (!p.assets.some((asset) => asset.id === id))
        throw new Error("Reference asset not found.");
    if (input.kind === "generated" && !planUsesCurrentSources(p, input))
      throw new Error(
        "This shot must use the latest campaign analysis. Set sourceBasis with its analysisId, inspected assetIds, and the concrete source detail adapted into this shot. Update the actual prompt; preserving old unaccepted plans is not required.",
      );
    Object.assign(shot, input, {
      sourceBasis: input.sourceBasis,
      revision: shot.revision + 1,
    });
    event(p, "shot.planned", `M3.1 updated ${shot.title}`);
    return shot;
  });
}
