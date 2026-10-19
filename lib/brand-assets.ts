import type { Asset } from "./domain";

export function isBrandAsset(asset: Pick<Asset, "origin">) {
  return asset.origin === "brand";
}
