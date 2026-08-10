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
  console.log("Run with `measure-search` first (Task 1); `prove` is wired in Task 2.");
  await close();
  process.exitCode = 1;
}
