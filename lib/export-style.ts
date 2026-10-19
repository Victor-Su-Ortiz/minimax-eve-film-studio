import { z } from "zod";

export const exportStyleInput = z.object({
  finish: z.enum(["brand-card", "moving-cobrand"]).default("brand-card"),
  cornerWatermark: z.boolean().default(true),
});
export type ExportStyle = z.input<typeof exportStyleInput>;
