import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { JustBashSandbox } from "eve/sandbox/just-bash";
export const environment = process.env.VERCEL
  ? VercelSandbox.environment({
      prepare: async (sandbox) => {
        await sandbox.writeTextFile({ path: "studio-role.txt", content: "take-reviewer" });
      },
    })
  : JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
