import { pathToFileURL } from "node:url";

import { chromium, test } from "@playwright/test";

import { CONFIG, SHOT_DIR } from "./config.mjs";
import { writeContactSheet } from "./contact-sheet.mjs";

test("photographs the approved mock at the app's own geometry", async () => {
  // A plain Chromium, not the Electron window: the mock is a standalone HTML
  // page and has no engine, no preload and no business being loaded into the app.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: CONFIG.viewport });
  await page.goto(pathToFileURL(CONFIG.mockPath).href);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try { a.finish(); } catch (_) { /* infinite target effect end */ }
    }
  });
  await page.screenshot({ path: `${SHOT_DIR}/mock-v12.png` });
  await browser.close();

  // The sheet is the deliverable of this phase: the §1 P8 gesture, prepared.
  writeContactSheet([{ app: "capture-tab", mock: "mock-v12", title: "Capture tab" }]);
});
