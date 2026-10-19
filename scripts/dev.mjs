import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "eve/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  NODE_ENV: "development",
  STUDIO_PROJECT_DIR: root,
  STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR || path.join(root, ".studio"),
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => process.exit(code), 3000);
  timer.unref();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function start(file, args, childEnv = env) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
  return child;
}
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const host = `http://127.0.0.1:${port}`;
const evePackage = JSON.parse(
  readFileSync(path.join(root, "node_modules/eve/package.json"), "utf8"),
);
start(path.join(root, "node_modules/eve", evePackage.bin.eve), [
  "dev",
  "--no-ui",
  "--resume",
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
]);
const client = new Client({ host });
let ready = false;
for (let i = 0; i < 120 && !stopping; i++) {
  try {
    ready = (await client.health()).status === "ready";
  } catch {
    /* Starting. */
  }
  if (ready) break;
  await delay(500);
}
if (!ready) {
  console.error("eve did not become ready. Check the startup errors above.");
  stop(1);
} else if (!stopping) {
  console.log("Studio agent ready; saved conversations resumed.");
  start(
    path.join(root, "node_modules/next/dist/bin/next"),
    ["dev", "--hostname", "127.0.0.1"],
    { ...env, EVE_BASE_URL: host },
  );
}
