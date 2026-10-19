import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";

// Media processing is implemented by fixed authored tools. The agent has no
// arbitrary shell tool and needs no native VM to keep its session workspace.
export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
