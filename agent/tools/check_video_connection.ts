import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { videoKey } from "../../lib/config";
import { providerBase } from "../../lib/renders";

export default defineWorkflowTool({
  description:
    "Check H3 authentication from the actual video workflow worker using a read-only list request. Returns configuration and HTTP status only; never returns task history or credentials and never submits a video. Use to resolve a reported missing video key or connection mismatch. A successful check verifies authentication, not generation entitlement or available credits.",
  inputSchema: z.object({}),
  label: { start: () => "Check H3 connection from the render worker" },
  async execute() {
    "use workflow";
    return await checkConnection();
  },
});

async function checkConnection() {
  "use step";
  const key = videoKey();
  if (!key)
    return { configured: false, authenticated: false, renderStarted: false };
  try {
    const response = await fetch(
      `${providerBase()}/v2/query/video_generation?page_num=1&page_size=1&model=MiniMax-H3`,
      {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await response.json().catch(() => null);
    return {
      configured: true,
      authenticated: response.ok && Array.isArray(data?.items),
      httpStatus: response.status,
      checkedAt: new Date().toISOString(),
      renderStarted: false,
      note: "This is the current workflow worker's result. Older missing-key errors in the conversation are historical. Generation entitlement and credits require an actual render.",
    };
  } catch {
    return {
      configured: true,
      authenticated: false,
      renderStarted: false,
      error:
        "The render worker could not reach H3. No video request was submitted.",
    };
  }
}
