import { createAnthropic } from "@ai-sdk/anthropic";
import { textKey, modelId } from "./config";

export function minimaxAgentModel() {
  const minimax = createAnthropic({
    baseURL:
      process.env.MINIMAX_TEXT_BASE_URL ||
      "https://api.minimax.io/anthropic/v1",
    authToken: textKey() || "not-configured",
  });
  return {
    model: minimax(modelId()),
    modelContextWindowTokens: 1_000_000,
    modelOptions: {
      providerOptions: {
        anthropic: { thinking: { type: "adaptive" }, effort: "high" },
      },
    },
  };
}
