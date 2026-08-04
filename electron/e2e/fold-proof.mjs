/**
 * Ad-hoc animation proof for the card fold fix (2026-08-04).
 *
 * Launches the real Electron window (hermetic harness, no engine), folds a
 * card, and samples the card's rendered height mid-transition. If the fold
 * is animated, the samples are strictly between the open and closed heights;
 * if it still snapped, every sample equals one of the two endpoints.
 *
 * Not part of the e2e suite -- a one-shot evidence script, run on demand.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { launchApp } from "./harness.mjs";

const OUT = path.join("e2e", "output");

async function heightOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  }, sel);
}

const session = await launchApp();
const { page } = session;
try {
  // Wait for the shell and pick a card that actually has a body.
  await page.waitForSelector(".sec", { timeout: 15000 });
  const cardSel = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".sec")];
    const tall = cards.find((c) => c.getBoundingClientRect().height > 120);
    if (!tall) return null;
    tall.setAttribute("data-probe", "1");
    return ".sec[data-probe='1']";
  });
  if (!cardSel) {
    console.log(JSON.stringify({ error: "no card with a body found" }));
    process.exit(1);
  }

  const hOpen = await heightOf(page, cardSel);
  await page.screenshot({ path: path.join(OUT, "fold-proof-open.png") });

  // Fold it.
  await page.click(`${cardSel} .sh`);
  const samples = [];
  let acc = 0;
  for (const delay of [50, 100, 150, 200, 250, 300, 500]) {
    await page.waitForTimeout(delay);
    acc += delay;
    const h = await heightOf(page, cardSel);
    samples.push({ t: acc, h });
  }
  const hClosed = samples[samples.length - 1].h;
  await page.screenshot({ path: path.join(OUT, "fold-proof-closed.png") });

  // Unfold it and sample again.
  await page.click(`${cardSel} .sh`);
  const openSamples = [];
  let openAcc = 0;
  for (const delay of [50, 100, 150, 200, 250, 300, 500]) {
    await page.waitForTimeout(delay);
    openAcc += delay;
    const h = await heightOf(page, cardSel);
    openSamples.push({ t: openAcc, h });
  }
  const hOpenAgain = openSamples[openSamples.length - 1].h;
  await page.screenshot({ path: path.join(OUT, "fold-proof-reopened.png") });

  const monotonicFold = samples.every((s, i) => i === 0 || s.h <= samples[i - 1].h);
  const strictlyBetween =
    samples.filter((s) => s.h > hClosed && s.h < hOpen).length >= 2;
  const monotonicOpen = openSamples.every((s, i) => i === 0 || s.h >= openSamples[i - 1].h);

  console.log(
    JSON.stringify(
      {
        cardSel,
        hOpen,
        hClosed,
        hOpenAgain,
        foldSamples: samples,
        openSamples,
        verdict: {
          foldAnimated: strictlyBetween && monotonicFold,
          openAnimated: openSamples.some((s) => s.h > hClosed && s.h < hOpenAgain) && monotonicOpen,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(OUT, "fold-proof.json"),
    JSON.stringify({ hOpen, hClosed, hOpenAgain, foldSamples: samples, openSamples }, null, 2),
  );
} finally {
  await session.close();
}
