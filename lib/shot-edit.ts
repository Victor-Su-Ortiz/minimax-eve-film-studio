import { z } from "zod";
import { acceptedAsset, type Project } from "./domain";
import { event, mutateProject } from "./store";

export const shotEditInput = z.object({
  shotId: z.string(),
  start: z.number().finite().min(0),
  holdEnd: z.boolean().default(false),
});

export async function setShotEdit(input: z.input<typeof shotEditInput>) {
  const { shotId, start, holdEnd } = shotEditInput.parse(input);
  return await mutateProject((p) => {
    const shot = p.shots.find((s) => s.id === shotId);
    const asset = p.assets.find((a) => a.id === (shot && acceptedAsset(shot)));
    if (!shot?.acceptedTakeId || shot.kind === "title" || !asset?.duration)
      throw new Error(
        "Select a reviewed video take before editing its in-point.",
      );
    const snappedStart = Math.round(start * 24) / 24;
    if (asset.duration - snappedStart < 2)
      throw new Error("Keep at least two seconds of moving footage.");
    const edit = {
      shotId,
      takeId: shot.acceptedTakeId,
      start: snappedStart,
      holdEnd,
    };
    p.shotEdits = [
      ...(p.shotEdits || []).filter((e) => e.shotId !== shotId),
      edit,
    ];
    event(
      p,
      "edit.changed",
      `Trim ${shot.title} to start at ${snappedStart.toFixed(2)}s${holdEnd ? "; allow a short hold on the last frame" : ""}`,
    );
    return edit;
  });
}

export function applyShotEdits(
  project: Project,
  edit: { shotId: string; start: number; duration: number }[],
) {
  return edit.map((entry) => {
    const override = project.shotEdits?.find((e) => e.shotId === entry.shotId);
    if (!override) return entry;
    const shot = project.shots.find((s) => s.id === entry.shotId)!;
    if (shot.acceptedTakeId !== override.takeId)
      throw new Error(
        "The selected take changed. Review its edit in-point before exporting.",
      );
    const asset = project.assets.find((a) => a.id === acceptedAsset(shot));
    if (!asset?.duration || asset.duration - override.start < 2)
      throw new Error("The edit needs at least two seconds of moving footage.");
    const hold = Math.max(0, override.start + entry.duration - asset.duration);
    if (hold > (override.holdEnd ? 2 : 0) + 0.05)
      throw new Error(
        "This edit would need more than the allowed final-frame hold. Use an earlier in-point or a shorter scene.",
      );
    return { ...entry, start: override.start };
  });
}
