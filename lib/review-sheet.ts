import sharp from "sharp";

// A single image keeps every review frame visible even when a provider or
// context compaction retains only one image from a tool response.
export async function reviewSheet(frames: { seconds: number; data: string }[]) {
  if (frames.length < 1 || frames.length > 12)
    throw new Error("A review sheet needs one to twelve frames.");
  const columns = frames.length > 4 ? 3 : frames.length === 1 ? 1 : 2;
  const cellWidth = 640;
  const imageHeight = 640;
  const labelHeight = 40;
  const cellHeight = imageHeight + labelHeight;
  const tiles = await Promise.all(
    frames.map(async (frame, index) => {
      const tile = await sharp(Buffer.from(frame.data, "base64"))
        .resize(cellWidth, imageHeight, {
          fit: "contain",
          background: "#111111",
        })
        .png()
        .toBuffer();
      const left = (index % columns) * cellWidth;
      const top = Math.floor(index / columns) * cellHeight;
      const label = Buffer.from(
        `<svg width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111111"/><text x="16" y="28" fill="white" font-family="sans-serif" font-size="23">Frame ${index + 1} · ${frame.seconds.toFixed(3)}s</text></svg>`,
      );
      return [
        { input: tile, left, top },
        { input: label, left, top: top + imageHeight },
      ];
    }),
  );
  const bytes = await sharp({
    create: {
      width: columns * cellWidth,
      height: Math.ceil(frames.length / columns) * cellHeight,
      channels: 3,
      background: "#111111",
    },
  })
    .composite(tiles.flat())
    .jpeg({ quality: 88 })
    .toBuffer();
  return {
    data: bytes.toString("base64"),
    note: `One contact sheet contains ${frames.length} actual sampled frame${frames.length === 1 ? "" : "s"}, in reading order (left to right, then top to bottom). Each panel has its own timestamp. Compare all visible panels; report any unreadable panel. This is not continuous video playback.`,
  };
}
