import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareBrandLayers, renderBrandTitle } from "../lib/brand";
import { probe } from "../lib/media";

const directory = await mkdtemp(path.join(tmpdir(), "minimax-brand-preview-"));
try {
  await mkdir("artifacts", { recursive: true });
  const layers = await prepareBrandLayers(directory, 1080, 1920);
  const output = path.resolve("artifacts/minimax-m31-figma-end-card.mp4");
  await renderBrandTitle(layers, output, 4, 1080, 1920);
  console.log(JSON.stringify({ output, ...(await probe(output)) }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
