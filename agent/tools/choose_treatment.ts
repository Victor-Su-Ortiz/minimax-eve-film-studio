import { defineTool } from "eve/tools";
import { z } from "zod";
import { event, mutateProject } from "../../lib/store";

export default defineTool({
  description:
    "Select an existing creative direction from the user's natural-language choice, or select the strongest direction when the user asks you to make the film and leaves the choice to you. Does not generate footage, accept takes or change locked shots.",
  inputSchema: z.object({ treatmentId: z.string() }),
  label: { start: () => "Choose the film’s direction" },
  async execute({ treatmentId }) {
    return await mutateProject((p) => {
      const treatment = p.treatments.find((t) => t.id === treatmentId);
      if (!treatment)
        throw new Error(
          "Treatment not found. Read the current directions first.",
        );
      p.selectedTreatmentId = treatmentId;
      event(p, "treatment.selected", `Selected ${treatment.title}`);
      return treatment;
    });
  },
});
