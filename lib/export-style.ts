import { z } from "zod";

export const exportStyleInput = z
  .object({
    finish: z.enum(["clean", "brand-overlay"]).default("clean"),
    logoAssetId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.finish === "brand-overlay" && !value.logoAssetId)
      ctx.addIssue({
        code: "custom",
        path: ["logoAssetId"],
        message: "Choose an uploaded brand logo for the overlay.",
      });
    if (value.finish === "clean" && value.logoAssetId)
      ctx.addIssue({
        code: "custom",
        path: ["finish"],
        message: "Use brand-overlay to apply the supplied logo.",
      });
  });
export type ExportStyle = z.input<typeof exportStyleInput>;
