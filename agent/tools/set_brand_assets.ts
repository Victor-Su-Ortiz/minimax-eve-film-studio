import { defineTool } from "eve/tools";
import { brandKitInput, setBrandAssets } from "../../lib/brand";
export default defineTool({
  description:
    "Register the user's uploaded logos, product art and brand images as this campaign's brand kit. Use only files the user supplied as branding. These images are kept separate from social reference evidence and may be used as real H3 image references. Replaces the current kit; never loads default assets. Existing takes and exports are preserved.",
  inputSchema: brandKitInput,
  label: { start: () => "Use your brand assets" },
  execute: setBrandAssets,
});
