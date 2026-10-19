import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalRequest } from "../lib/http";
test("hosted studio fails closed without the explicit protected-deployment policy and rejects foreign origins",()=>{
  const keys=["VERCEL","STUDIO_STORAGE","STUDIO_DEPLOYMENT_PROTECTED","VERCEL_URL","VERCEL_PROJECT_PRODUCTION_URL","STUDIO_HOST"] as const;
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    process.env.VERCEL="1";process.env.STUDIO_STORAGE="cloud";process.env.VERCEL_URL="studio-example.vercel.app";
    delete process.env.STUDIO_DEPLOYMENT_PROTECTED;
    const request=new Request("https://studio-example.vercel.app/api/project");
    assert.throws(()=>assertLocalRequest(request),/deployment protection/);
    process.env.STUDIO_DEPLOYMENT_PROTECTED="true";
    assert.doesNotThrow(()=>assertLocalRequest(request));
    assert.throws(()=>assertLocalRequest(new Request(request,{headers:{origin:"https://other.example"}})),/Cross-origin/);
    assert.throws(()=>assertLocalRequest(new Request("https://unknown.example/api/project")),/Unrecognized studio host/);
  } finally {for(const k of keys) {if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});
