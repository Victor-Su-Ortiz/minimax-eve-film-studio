import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { reviewSheet } from "../lib/review-sheet";

test("one review image contains all four distinct input frames in time order", async () => {
  const colors = [
    { r: 230, g: 20, b: 20 },
    { r: 20, g: 230, b: 20 },
    { r: 20, g: 20, b: 230 },
    { r: 230, g: 230, b: 20 },
  ];
  const frames = await Promise.all(
    colors.map(async (background, i) => ({
      seconds: i + 0.25,
      data: (
        await sharp({
          create: { width: 320, height: 180, channels: 3, background },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64"),
    })),
  );
  const sheet = await reviewSheet(frames);
  const bytes = Buffer.from(sheet.data, "base64");
  const { width, height } = await sharp(bytes).metadata();
  assert.ok(width && height);
  for (let i = 0; i < colors.length; i++) {
    const pixel = await sharp(bytes)
      .extract({
        left: Math.round(width * (i % 2 === 0 ? 0.25 : 0.75)),
        top: Math.round(height * (i < 2 ? 0.25 : 0.75)),
        width: 1,
        height: 1,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    const expected = Object.values(colors[i]);
    expected.forEach((channel, j) =>
      assert.ok(
        Math.abs(pixel[j] - channel) < 8,
        `Frame ${i + 1} must retain its own pixels`,
      ),
    );
  }
  assert.match(sheet.note, /4 actual sampled frames/);
  assert.ok(bytes.length < 3 * 1024 * 1024);
});

test("portrait and single-image reviews preserve their aspect ratio without cropping", async () => {
  const data = (
    await sharp({
      create: { width: 100, height: 200, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const result = await reviewSheet([{ seconds: 0, data }]);
  const bytes = Buffer.from(result.data, "base64");
  const center = await sharp(bytes)
    .extract({ left: 320, top: 10, width: 1, height: 1 })
    .raw()
    .toBuffer();
  const edge = await sharp(bytes)
    .extract({ left: 10, top: 10, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(center[0] > 240 && center[1] < 15);
  assert.ok(
    edge.every((channel) => channel < 30),
    "Portrait frame should be letterboxed, not stretched",
  );
  assert.match(result.note, /1 actual sampled frame,/);
});
