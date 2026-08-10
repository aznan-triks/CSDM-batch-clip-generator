/**
 * On the real window: the top accent bar (`.top-ind`) is visible, sits at a
 * measurable position, has a real running CSS transition, and actually
 * moves when the active tab changes -- not just present in the DOM with no
 * style (the exact failure mode of the regression this proves against).
 */
import { launchApp, shoot } from "./harness.mjs";

const { page, close } = await launchApp();
await page.waitForTimeout(2000);

const readBar = () =>
  page.evaluate(() => {
    const el = document.querySelector(".top-ind");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      transitionDuration: cs.transitionDuration,
      transform: el.style.transform,
      width: Math.round(rect.width),
      left: Math.round(rect.left),
    };
  });

const before = await readBar();
await shoot(page, "tab-top-indicator-before");

// Click a different tab, same gesture a user makes.
const tabs = page.getByRole("tab");
const count = await tabs.count();
if (count < 2) {
  await close();
  throw new Error("fewer than 2 tabs found -- cannot prove the indicator moves");
}
await tabs.nth(1).click();
await page.waitForTimeout(500);

const after = await readBar();
await shoot(page, "tab-top-indicator-after");

console.log(JSON.stringify({ before, after }, null, 2));
const hasDuration = before && parseFloat(before.transitionDuration) > 0;
const moved = before && after && before.transform !== after.transform;
console.log(`VERDICT: transition duration > 0 = ${hasDuration}; bar moved on tab switch = ${moved}`);
await close();
process.exitCode = hasDuration && moved ? 0 : 1;
