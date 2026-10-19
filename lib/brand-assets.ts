import manifest from "../public/brand/m31-flash/sources.json";
import type { Asset } from "./domain";

// Match the actual exported bytes, so renaming a file cannot change its role.
export function officialBrandSource(sha256: string) {
  return manifest.assets.find((entry) => entry.sha256 === sha256)?.sourceUrl;
}

export function isBrandAsset(asset: Pick<Asset, "origin" | "sha256">) {
  return asset.origin === "brand" || Boolean(officialBrandSource(asset.sha256));
}
