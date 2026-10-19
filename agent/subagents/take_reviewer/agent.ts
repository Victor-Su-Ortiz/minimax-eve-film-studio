import { defineAgent } from "eve";
import { minimaxAgentModel } from "../../../lib/agent-model";

export default defineAgent({
  ...minimaxAgentModel(),
  description:
    "Take reviewer: compare a real generated take with its saved render prompt and source reference using sampled frames. Return concrete matches and mismatches. Cannot render, edit, accept, or unlock footage.",
  defaultTools: false,
});
