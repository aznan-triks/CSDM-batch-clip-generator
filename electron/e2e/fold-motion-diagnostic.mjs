/**
 * Ad-hoc diagnostic: what actually moves when a mid-grid card folds
 * (2026-08-04, user report: "the nav pane moves to reposition itself, it's
 * epileptic because everything moves").
 *
 * Launches the real Electron window, scrolls Kill Filters into view, folds
 * it, and samples scrollTop + the screen positions of the card above, the
 * folded card, and the card below, every ~50ms.
 *
 * Not part of the e2e suite -- one-shot diagnostic, run on demand.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { launchApp } from "./harness.mjs";

const OUT = path.join("e2e", "output");

const session = await launchApp();
const { page } = session;
try {
  await page.waitForSelector(".sec", { timeout: 15000 });

  // Bring Kill Filters into view deterministically: scroll so the card's
  // top sits ~200px below the pane top (mid-screen, fully visible).
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".sec")];
    const kf = cards.find((c) => c.querySelector(".t")?.textContent?.includes("Kill Filters"));
    const scroll = document.querySelector(".scrollwrap");
    if (kf && scroll) scroll.scrollTop = kf.offsetTop - 200;
  });
  await page.waitForTimeout(400);

  // Hermetic start: the persisted layout may have left Kill Filters folded
  // from an earlier run -- force it open and let the layout settle.
  await page.evaluate(() => {
    const kf = [...document.querySelectorAll(".sec")].find((s) =>
      s.querySelector(".t")?.textContent?.includes("Kill Filters"),
    );
    if (kf?.classList.contains("closed")) kf.querySelector(".sh")?.click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".sec")];
    const kf = cards.find((c) => c.querySelector(".t")?.textContent?.includes("Kill Filters"));
    const scroll = document.querySelector(".scrollwrap");
    if (kf && scroll) scroll.scrollTop = kf.offsetTop - 200;
  });
  await page.waitForTimeout(400);

  const probe = () =>
    page.evaluate(() => {
      const scroll = document.querySelector(".scrollwrap");
      const byTitle = (t) => {
        const c = [...document.querySelectorAll(".sec")].find((s) =>
          s.querySelector(".t")?.textContent?.includes(t),
        );
        return c ? Math.round(c.getBoundingClientRect().top) : null;
      };
      return {
        scrollTop: scroll ? Math.round(scroll.scrollTop) : null,
        overflowAnchor: scroll ? getComputedStyle(scroll).overflowAnchor : null,
        timing: byTitle("Timing"),
        killFilters: byTitle("Kill Filters"),
        matchTypes: byTitle("Match Types"),
        mapFilter: byTitle("Map Filter"),
      };
    });

  const before = await probe();
  // Fold Kill Filters.
  await page.evaluate(() => {
    const kf = [...document.querySelectorAll(".sec")].find((s) =>
      s.querySelector(".t")?.textContent?.includes("Kill Filters"),
    );
    kf?.querySelector(".sh")?.click();
  });

  const samples = [];
  let acc = 0;
  for (const delay of [30, 50, 70, 90, 120, 160, 220, 300, 500]) {
    await page.waitForTimeout(delay);
    acc += delay;
    samples.push({ t: acc, ...(await probe()) });
  }

  const out = { before, samples };
  console.log(JSON.stringify(out, null, 2));
  writeFileSync(path.join(OUT, "fold-motion-diagnostic.json"), JSON.stringify(out, null, 2));
} finally {
  await session.close();
}
