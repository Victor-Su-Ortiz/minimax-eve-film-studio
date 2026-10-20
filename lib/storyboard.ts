import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { imageKey, runtimeEnv } from "./config";
import {
  planUsesCurrentSources,
  projectRatio,
  requireEditableShot,
  type Asset,
  type StoryboardFrame,
} from "./domain";
import { readMedia, writeMedia } from "./media-storage";
import { event, getProject, mutateProject } from "./store";

export const storyboardInput = z.object({
  shotId: z.string().min(1),
  prompt: z.string().trim().min(20).max(1500),
  subjectAssetId: z.string().min(1).optional(),
});

/** One paid request per distinct shot revision/prompt. Ambiguous requests are never replayed. */
export async function generateStoryboard(
  value: z.input<typeof storyboardInput>,
  providerFetch: typeof fetch = fetch,
) {
  const input = storyboardInput.parse(value);
  const key = imageKey();
  if (!key)
    throw new Error(
      "Storyboard images need a MiniMax image or video API key in the server environment.",
    );
  const snapshot = await getProject();
  const shot = requireEditableShot(snapshot, input.shotId);
  if (
    shot.kind !== "generated" ||
    !shot.prompt.trim() ||
    !planUsesCurrentSources(snapshot, shot)
  )
    throw new Error(
      "Plan this generated shot from the current reference analysis before creating its storyboard.",
    );
  const ratio = projectRatio(snapshot);
  const model = runtimeEnv("MINIMAX_IMAGE_MODEL") || "image-01";
  let subject: { type: "character"; image_file: string } | undefined;
  if (input.subjectAssetId) {
    const asset = snapshot.assets.find((a) => a.id === input.subjectAssetId);
    if (!asset?.mime.startsWith("image/"))
      throw new Error(
        "Choose an existing character image as the subject reference.",
      );
    const bytes = await sharp(await readMedia(asset.id))
      .resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
    subject = {
      type: "character",
      image_file: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    };
  }
  const signature = createHash("sha256")
    .update(
      JSON.stringify([
        "storyboard-v1",
        shot.id,
        shot.revision,
        ratio,
        model,
        input.prompt,
        input.subjectAssetId,
        snapshot.assets.find((a) => a.id === input.subjectAssetId)?.sha256,
      ]),
    )
    .digest("hex");
  const reservation = await mutateProject((p) => {
    const previous = p.storyboards?.find((b) => b.signature === signature);
    if (previous) return { frame: previous, fresh: false };
    const current = requireEditableShot(p, shot.id);
    if (
      current.revision !== shot.revision ||
      projectRatio(p) !== ratio ||
      !planUsesCurrentSources(p, current)
    )
      throw new Error(
        "The shot plan changed while preparing the storyboard. Read the workspace again.",
      );
    if (
      p.storyboards?.some(
        (b) =>
          b.shotId === shot.id && ["generating", "unknown"].includes(b.status),
      )
    )
      throw new Error(
        "This shot has a pending or uncertain image request. Do not submit another paid request.",
      );
    const frame: StoryboardFrame = {
      id: randomUUID(),
      signature,
      shotId: shot.id,
      shotRevision: shot.revision,
      ratio,
      model,
      prompt: input.prompt,
      subjectAssetId: input.subjectAssetId,
      status: "generating",
      createdAt: new Date().toISOString(),
    };
    (p.storyboards ??= []).push(frame);
    event(
      p,
      "storyboard.generating",
      `Drawing ${shot.title} with MiniMax ${model}`,
    );
    return { frame, fresh: true };
  });
  if (!reservation.fresh) return reservation.frame;
  const frame = reservation.frame;
  async function settle(status: StoryboardFrame["status"], error: string) {
    return mutateProject((p) => {
      const saved = p.storyboards?.find((b) => b.id === frame.id);
      if (!saved)
        throw new Error(
          "The campaign changed while generating the storyboard.",
        );
      Object.assign(saved, { status, error });
      event(p, `storyboard.${status}`, error);
      return saved;
    });
  }
  let response: Response;
  try {
    response = await providerFetch(
      "https://api.minimax.io/v1/image_generation",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          aspect_ratio: ratio,
          n: 1,
          response_format: "base64",
          prompt_optimizer: false,
          ...(subject ? { subject_reference: [subject] } : {}),
        }),
        signal: AbortSignal.timeout(150_000),
      },
    );
  } catch {
    return settle(
      "unknown",
      "The image response was interrupted. Check MiniMax before retrying; no automatic resubmission was made.",
    );
  }
  if (!response.ok)
    return settle(
      response.status >= 500 || response.status === 408 ? "unknown" : "failed",
      `MiniMax image generation returned HTTP ${response.status}. Check image access and balance; no video was generated.`,
    );
  try {
    const body = (await response.json()) as {
      base_resp?: { status_code?: number };
      data?: { image_base64?: string[] };
    };
    if (body.base_resp?.status_code !== 0)
      return settle(
        "failed",
        `MiniMax image generation failed (code ${typeof body.base_resp?.status_code === "number" ? body.base_resp.status_code : "unavailable"}). Check image access, balance and prompt requirements.`,
      );
    const encoded = body.data?.image_base64?.[0];
    if (!encoded || encoded.length > 24 * 1024 * 1024)
      throw new Error("Invalid image response");
    const { data: bytes, info } = await sharp(
      Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/, ""), "base64"),
      { limitInputPixels: 16_777_216 },
    )
      .png()
      .toBuffer({ resolveWithObject: true });
    const asset: Asset = {
      id: `board_${frame.id}`,
      name: `${shot.title} — storyboard.png`,
      mime: "image/png",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: info.width,
      height: info.height,
      origin: "storyboard",
      createdAt: new Date().toISOString(),
    };
    await writeMedia(asset.id, bytes);
    return await mutateProject((p) => {
      const saved = p.storyboards?.find((b) => b.id === frame.id);
      if (!saved) throw new Error("Campaign changed");
      p.assets.push(asset);
      Object.assign(saved, { status: "ready", assetId: asset.id });
      event(p, "storyboard.ready", `Storyboard ready: ${shot.title}`);
      return saved;
    });
  } catch {
    return settle(
      "unknown",
      "MiniMax returned an image response that could not be saved. Check the provider before retrying; no automatic resubmission was made.",
    );
  }
}
