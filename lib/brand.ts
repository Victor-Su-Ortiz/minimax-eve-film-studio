import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Project } from "./domain";
import { event, getProject, mutateProject } from "./store";
import { ensureMedia, readMedia } from "./media-storage";

export const brandKitInput = z.object({
  name: z.string().trim().min(1).max(100),
  assetIds: z.array(z.string().min(1)).min(1).max(10),
});

export async function setBrandAssets(input: z.infer<typeof brandKitInput>) {
  const kit = brandKitInput.parse(input);
  kit.assetIds = [...new Set(kit.assetIds)];
  return mutateProject((p) => {
    for (const id of kit.assetIds) {
      const asset = p.assets.find((a) => a.id === id);
      if (
        !asset ||
        !["upload", "brand"].includes(asset.origin) ||
        !asset.mime.startsWith("image/")
      )
        throw new Error("Choose user-uploaded images as brand assets.");
    }
    for (const asset of p.assets) {
      if (kit.assetIds.includes(asset.id)) asset.origin = "brand";
      else if (p.brandKit?.assetIds.includes(asset.id)) asset.origin = "upload";
    }
    p.brandKit = kit;
    if (p.campaign?.assetIds.some((id) => kit.assetIds.includes(id))) {
      p.campaign.assetIds = p.campaign.assetIds.filter(
        (id) => !kit.assetIds.includes(id),
      );
      p.campaign.revision++;
      for (const inspection of p.campaignInspections || [])
        if (p.campaign.assetIds.includes(inspection.assetId))
          inspection.sourceRevision = p.campaign.revision;
    }
    event(p, "brand.saved", `Using ${kit.name} artwork supplied by you`);
    return kit;
  });
}

export async function getBrandAssets() {
  const project = await getProject();
  const assets = (project.brandKit?.assetIds || []).map((id) =>
    project.assets.find((a) => a.id === id)!,
  );
  return {
    name: project.brandKit?.name || null,
    assets,
    previews: await Promise.all(
      assets.map(async (asset) => ({
        assetId: asset.id,
        data: (
          await sharp(await ensureMedia(asset.id))
            .resize({
              width: 768,
              height: 768,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 80 })
            .toBuffer()
        ).toString("base64"),
      })),
    ),
    note: assets.length
      ? "Only user-supplied artwork. Use actual IDs as H3 references when relevant. Exact logos can be added with create_cut finish=brand-overlay and logoAssetId."
      : "No brand assets supplied. No default brand kit or logos will be loaded or added to the film.",
  };
}

export async function customBranding(project: Project, assetId: string) {
  const asset = project.assets.find((a) => a.id === assetId);
  if (
    !asset ||
    !project.brandKit?.assetIds.includes(assetId) ||
    asset.origin !== "brand" ||
    !asset.mime.startsWith("image/")
  )
    throw new Error("Choose a logo from the user-supplied brand kit first.");
  const bytes = await readMedia(assetId);
  return {
    name: project.brandKit.name,
    sourceUrl: asset.sourceUrl,
    signature: createHash("sha256")
      .update("user-logo-overlay-v1")
      .update(bytes)
      .digest("hex"),
    cornerWatermark: false,
  };
}

export async function prepareLogoLayer(
  directory: string,
  assetId: string,
  width: number,
  height: number,
) {
  const logo = await sharp(await ensureMedia(assetId))
    .resize({
      width: Math.round(width * 0.42),
      height: Math.round(height * 0.2),
      fit: "inside",
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const output = path.join(directory, "brand-overlay.png");
  await sharp({
    create: { width, height, channels: 4, background: "#00000000" },
  })
    .composite([
      {
        input: logo.data,
        left: Math.round((width - logo.info.width) / 2),
        top: Math.round(height * 0.08),
      },
    ])
    .png()
    .toFile(output);
  return output;
}
