import { defineAgent } from "eve";
import { minimaxAgentModel } from "../../../lib/agent-model";

export default defineAgent({
  ...minimaxAgentModel(),
  description:
    "Trend scout: retrieve popular public videos, visually match actual sampled footage with M3.1, and curate relevant clips above 100K views. Captions are retrieval hints, not match evidence. Does not change the campaign, shot plans, or footage.",
  defaultTools: false,
});
