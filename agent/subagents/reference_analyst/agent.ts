import { defineAgent } from "eve";
import { minimaxAgentModel } from "../../../lib/agent-model";

export default defineAgent({
  ...minimaxAgentModel(),
  description:
    "Reference analyst: inspect actual saved source frames and return timestamped observations, uncertainties, and concrete shot adaptations. Does not edit the brief, analysis, plans, or rendered takes.",
  defaultTools: false,
});
