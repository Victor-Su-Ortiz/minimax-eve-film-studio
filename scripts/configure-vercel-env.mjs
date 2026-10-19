// Credentials travel over stdin to the authenticated CLI; never print values.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
const local = parseEnv(readFileSync(".env.local", "utf8"));
const hosted = parseEnv(readFileSync(".env.deploy.local", "utf8"));
const test = parseEnv(readFileSync(".env.neon-test.local", "utf8"));
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
const metadata=JSON.parse(execFileSync("vercel",["api",`/v9/projects/${project.projectId}`,"--scope",project.orgId,"--raw"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
if(metadata.ssoProtection?.deploymentType!=="all") throw new Error("Enable Vercel Authentication for all deployments before configuring hosted access.");
const names = [
  "MINIMAX_TEXT_API_KEY",
  "MINIMAX_TEXT_BASE_URL",
  "MINIMAX_TEXT_MODEL",
  "MINIMAX_VIDEO_API_KEY",
  "MINIMAX_VIDEO_BASE_URL",
  "MINIMAX_VIDEO_MODEL",
  "TWITTERAPI_IO_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
];
const common = {
  STUDIO_STORAGE: "cloud",
  STUDIO_DEPLOYMENT_PROTECTED: "true",
  STUDIO_HOST: `${project.projectName}.vercel.app`,
};
for (const key of names) if (local[key]) common[key] = local[key];
const envs = [];
for (const target of ["production", "preview"]) {
  const values = { ...common, ...(target === "production" ? hosted : test) };
  for (const [key, value] of Object.entries(values)) {
    if (!value) throw new Error(`Missing configured value for ${key}.`);
    envs.push({ key, value, type: "encrypted", target: [target] });
  }
}
for (const env of envs) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(env.key))
    continue;
  try {
    execFileSync(
      "vercel",
      [
        "env",
        "add",
        env.key,
        env.target[0],
        "--scope",
        project.orgId,
        "--project",
        project.projectId,
        "--force",
        "--yes",
        "--sensitive",
      ],
      { input: env.value, stdio: ["pipe", "pipe", "pipe"] },
    );
    console.log(`Configured ${env.key} (${env.target[0]}).`);
  } catch {
    throw new Error(
      `Could not configure ${env.key} (${env.target[0]}). No credentials were printed.`,
    );
  }
}
