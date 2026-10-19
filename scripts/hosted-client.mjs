import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "eve/client";

// Reuse the project-scoped automation credential created by `vercel curl`.
// Keep it in memory and attach it only to this exact deployment origin.
export function hostedClient(base) {
  const project=JSON.parse(readFileSync(".vercel/project.json","utf8"));
  let metadata;
  try { metadata=JSON.parse(execFileSync("vercel",["api",`/v9/projects/${project.projectId}`,"--scope",project.orgId,"--raw"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]})); }
  catch { throw new Error("Could not read the linked deployment's authenticated configuration."); }
  const token=Object.keys(metadata.protectionBypass||{}).find(key=>metadata.protectionBypass[key].scope==="automation-bypass");
  if(!token) throw new Error("Run vercel curl against this deployment first to initialize authorized test access.");
  const origin=new URL(base).origin;
  const headers={"x-vercel-protection-bypass":token};
  return {
    origin,headers,
    agent:new Client({host:origin,headers,redirect:"manual"}),
    async fetch(path,init={}) {
      const url=new URL(path,origin); if(url.origin!==origin) throw new Error("Verification requests must stay on the deployment origin.");
      return fetch(url,{...init,headers:{...headers,...init.headers},redirect:"manual"});
    },
  };
}
