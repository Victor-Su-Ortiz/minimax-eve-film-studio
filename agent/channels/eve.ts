import { eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";

// This first build is a private, loopback-only studio. Production fails closed.
export default eveChannel({ auth: [localDev()] });
