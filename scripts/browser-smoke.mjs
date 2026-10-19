import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:3000";
await mkdir("artifacts", { recursive: true });
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "See a campaign. Make your next one." })
    .waitFor();
  assert.equal(await page.getByRole("textbox").count(), 1);
  await page
    .getByRole("button", { name: "Launch something new", exact: true })
    .click();
  assert.match(
    await page
      .getByRole("textbox", { name: "Describe your campaign", exact: true })
      .inputValue(),
    /sparkling tea/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Create campaign", exact: true })
      .isEnabled(),
    true,
  );
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Director’s room", exact: true })
    .waitFor();
  const original = await (await page.request.get(`${base}/api/project`)).json();
  await page
    .getByRole("heading", { name: "Find the pattern. Make it your launch." })
    .waitFor();
  if (original.campaign)
    assert.equal(
      await page.getByLabel("CAMPAIGN OR TREND", { exact: true }).inputValue(),
      original.campaign.title,
    );

  await page.getByRole("button", { name: "The brief", exact: true }).click();
  await page
    .getByLabel("LAUNCH BRIEF")
    .fill(`${original.brief}\nBrowser verification.`);
  await page.getByRole("button", { name: "Save brief", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "The brief", exact: true }).click();
  assert.equal(
    await page.getByLabel("LAUNCH BRIEF").inputValue(),
    `${original.brief}\nBrowser verification.`,
  );
  await page.getByLabel("LAUNCH BRIEF").fill(original.brief);
  await page.getByRole("button", { name: "Save brief", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });

  const connections = await (
    await page.request.get(`${base}/api/status`)
  ).json();
  if (!connections.text) {
    await page
      .getByRole("button", {
        name: "Pitch three creative directions",
        exact: true,
      })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.match(
      await page.getByRole("dialog").innerText(),
      /MINIMAX_TEXT_API_KEY/,
    );
    await page
      .getByRole("button", { name: "Back to the film", exact: true })
      .click();
  }

  await page
    .locator(".editor-tabs")
    .getByRole("button", { name: "Storyboard", exact: true })
    .click();
  await page.getByRole("button", { name: /A world, reimagined\. 03/ }).click();
  await page
    .locator(".director-tabs")
    .getByRole("button", { name: "Shot details", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("SHOT NAME", { exact: true }).inputValue(),
    "Another world",
  );
  assert.ok(
    (await page.getByLabel("H3 PRODUCTION PROMPT").inputValue()).includes(
      "night train",
    ),
  );
  await page
    .locator(".director-tabs")
    .getByRole("button", { name: "Director", exact: true })
    .click();
  await page.getByRole("button", { name: /Opening\. 01/ }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Export film", exact: true })
      .isEnabled(),
    false,
  );

  await page
    .locator(".editor-area")
    .evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({
    path: "artifacts/directors-room.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page must not overflow horizontally",
  );
  await page.screenshot({
    path: "artifacts/directors-room-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, [], "Browser must have no uncaught errors");
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "brief save/reload/restore",
        "single-prompt landing and natural-language example",
        "campaign workspace and saved reference",
        "missing-key connection flow",
        "shot selection and prompt inspector",
        "export readiness",
        "desktop screenshot",
        "mobile overflow",
        "no uncaught browser errors",
      ],
      screenshots: [
        "artifacts/directors-room.png",
        "artifacts/directors-room-mobile.png",
      ],
    }),
  );
} finally {
  await browser.close();
}
