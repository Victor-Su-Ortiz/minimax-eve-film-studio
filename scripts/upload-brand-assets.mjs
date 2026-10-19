import { readFile } from "node:fs/promises";
import { put } from "@vercel/blob";
const files = [
  "m31-flash/hero.png",
  "m31-flash/flower-background.png",
  "m31-flash/m31-flash-lockup.png",
  "m31-flash/minimax-wordmark.png",
  "vercel-white.svg",
];
for (const file of files) {
  await put(
    `brand/${file}`,
    await readFile(new URL(`../public/brand/${file}`, import.meta.url)),
    { access: "private", addRandomSuffix: false, allowOverwrite: true },
  );
  console.log(`Initialized brand/${file}.`);
}
