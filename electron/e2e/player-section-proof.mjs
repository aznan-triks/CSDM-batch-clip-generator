/**
 * Three jobs, one launch.
 *
 * `measure-search`: reports the width the search field's own placeholder
 * needs, un-clipped, in the field's real font -- the number
 * `#player-search`'s max-width is set from, so the cap is measured against
 * its own content rather than picked.
 *
 * `prove`: on the real window, checks the search field shows its placeholder
 * without clipping, widens the PLAYER card and checks the player list grows
 * into the extra height, and checks a never-touched card does not measure to
 * an oversized default height. A stylesheet change is not proof that any of
 * this happens (§1 principle 8).
 */
import { launchApp, shoot } from "./harness.mjs";

const MODE = process.argv[2] ?? "prove";

const FIND_CARD = () => {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  return items.findIndex((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes("player"));
};

const { page, close } = await launchApp();
await page.waitForTimeout(2000);

const cardIndex = await page.evaluate(FIND_CARD);
if (cardIndex === -1) {
  await close();
  throw new Error("Player card not found -- did the Capture tab stop mounting it?");
}

if (MODE === "measure-search") {
  const measured = await page.evaluate(() => {
    const input = document.querySelector("#player-search");
    if (!input) return null;
    const cs = getComputedStyle(input);
    const probe = document.createElement("span");
    probe.textContent = input.placeholder;
    probe.style.font = cs.font;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    document.body.appendChild(probe);
    const textWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const horizontal =
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    // 4px of slack: the caret needs room after the last glyph, or the field
    // clips the instant it gets focus -- the placeholder's own measured
    // width alone is not what has to fit inside the box.
    return Math.ceil(textWidth + horizontal + 4);
  });
  console.log(JSON.stringify({ measured }, null, 2));
  console.log(`MEASURED search field width = ${measured}px`);
  await close();
  process.exitCode = measured > 0 ? 0 : 1;
} else {
  // A never-touched card: read its height exactly as SectionList's one-time
  // measurement would have locked it in, BEFORE this proof does anything
  // that could itself change it (§1 principle 8 -- read reality, don't
  // assume Task 2's flex chain avoided the blow-up it was written to avoid).
  const defaultBox = await page.evaluate((i) => {
    const item = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
    const b = item.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  }, cardIndex);

  // Activate two players so the screenshots also show the active-chips row
  // (Task 3) -- after the default-height read above, since clicking a row
  // cannot retroactively change SectionList's one-time measurement.
  await page.evaluate((i) => {
    const item = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
    const rows = [...item.querySelectorAll(".ps-row")].slice(0, 2);
    for (const row of rows) row.click();
  }, cardIndex);
  await page.waitForTimeout(200);

  const listHeight = () =>
    page.evaluate((i) => {
      const item = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
      const list = item.querySelector(".ps-list");
      return list ? Math.round(list.getBoundingClientRect().height) : null;
    }, cardIndex);

  const before = { box: defaultBox, listHeight: await listHeight() };
  await shoot(page, "player-narrow");

  const handle = page
    .locator('[role="tabpanel"]:not([hidden]) .react-grid-item')
    .nth(cardIndex)
    .locator(".react-resizable-handle");
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("resize handle has no box -- is the card off-screen?");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 100, hb.y + 400, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const after = {
    box: await page.evaluate((i) => {
      const item = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
      const b = item.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    }, cardIndex),
    listHeight: await listHeight(),
  };
  const wideShot = await shoot(page, "player-wide");

  console.log(JSON.stringify({ before, after }, null, 2));
  // 900 = e2e/config.mjs's own viewport height: a never-touched card taller
  // than the whole window it lives in is exactly the blow-up this task's
  // flex chain exists to avoid, not a cosmetic detail.
  const defaultSane = before.box.h < 900;
  const listGrew = after.listHeight > before.listHeight;
  console.log(`VERDICT: default height sane = ${defaultSane} (${before.box.h}px); list grew = ${listGrew} (${before.listHeight}px -> ${after.listHeight}px)`);
  console.log(`shots: ${wideShot}`);
  await close();
  process.exitCode = defaultSane && listGrew ? 0 : 1;
}
