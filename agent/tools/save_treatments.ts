import { defineTool } from "eve/tools";
import { z } from "zod";
import { event, mutateProject } from "../../lib/store";

export default defineTool({
  description:
    "Save exactly three creative treatments. For a film-creation request, after the initial user reference choice, select the strongest direction and complete all scenes and the final export automatically. Only wait for a choice if the user explicitly requested pitches or wants to choose.",
  inputSchema: z.object({
    treatments: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
          title: z.string().min(1).max(100),
          logline: z.string().min(1).max(600),
          visualDirection: z.string().min(1).max(1600),
        }),
      )
      .length(3),
  }),
  label: { start: () => "Develop three creative directions" },
  execute({ treatments }) {
    if (new Set(treatments.map((t) => t.id)).size !== 3)
      throw new Error("Each treatment needs a unique ID.");
    return mutateProject((p) => {
      p.treatments = treatments;
      p.selectedTreatmentId = undefined;
      event(
        p,
        "treatments.proposed",
        "M3.1 proposed three creative directions",
      );
      return {
        treatments,
        next: "After the user selects the initial reference, call choose_treatment, plan and render the unlocked shots, delegate each take review, select_take, and export the finished film without approvals. For an explicit pitches-only request, present these directions and wait.",
      };
    });
  },
});
