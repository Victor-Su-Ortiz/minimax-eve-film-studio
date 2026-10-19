import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, none } from "eve/channels/auth";

// Browser requests are authenticated at Vercel's project boundary. Enable this
// mode only after configuring Vercel Authentication for ALL environments.
// Internal workflow/subagent calls continue to use project OIDC.
export default eveChannel({
  auth: [
    vercelOidc(),
    ...(process.env.VERCEL && process.env.STUDIO_DEPLOYMENT_PROTECTED === "true" ? [none()] : []),
    localDev(),
  ],
});
