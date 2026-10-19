import { defineAgent } from "eve";
import { minimaxAgentModel } from "../lib/agent-model";

export default defineAgent({
  ...minimaxAgentModel(),
  defaultTools: false,
  tool: false,
});
