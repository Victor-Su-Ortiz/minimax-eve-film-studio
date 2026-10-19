import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";
import { VercelSandbox } from "eve/sandbox/vercel";

// eve stages model-visible image attachments in the session workspace.
// Hosted sessions need a durable provider; the local just-bash template lives
// on disk and cannot be resumed across serverless function instances.
// FFmpeg remains in fixed authored tools; no arbitrary shell tool is exposed.
export const environment = process.env.VERCEL
  ? VercelSandbox.environment({
      prepare: async (sandbox) => {
        await sandbox.writeTextFile({ path: "studio-role.txt", content: "director" });
      },
    })
  : JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
