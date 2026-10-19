import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import sharp from "sharp";
import { del } from "@vercel/blob";
import { registerUpload } from "../lib/media";
import { mediaPath, postgresPool } from "../lib/store";
import { readMedia } from "../lib/media-storage";
if(!process.env.DATABASE_URL) throw new Error("Use an isolated Neon test branch and private Blob credentials.");
process.env.STUDIO_STORAGE="cloud";
process.env.STUDIO_PROJECT_ID=`storage-check-${randomUUID()}`;
let assetId:string|undefined;
try {
  const bytes=await sharp({create:{width:320,height:320,channels:3,background:"#c070ef"}}).png().toBuffer();
  const asset=await registerUpload(new File([new Uint8Array(bytes)],"storage-test.png",{type:"image/png"}));assetId=asset.id;
  await rm(mediaPath(asset.id));
  assert.deepEqual(await readMedia(asset.id),bytes,"A fresh instance must recover the exact uploaded bytes.");
  console.log("Private Blob media recovery verified after clearing the local cache.");
} finally {
  if(assetId) {await del(`media/${assetId}`);await rm(mediaPath(assetId),{force:true});}
  await postgresPool().query("DELETE FROM studio_projects WHERE id=$1",[process.env.STUDIO_PROJECT_ID]);
  await postgresPool().end();
}
