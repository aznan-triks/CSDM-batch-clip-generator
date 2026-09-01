/**
 * One-off probe: WHICH element refuses to get narrower.
 *
 * `surface-audit.mjs` says a Kill Filters row is 238 px wider than its card.
 * It does not say which box inside it is holding the width open, and guessing
 * that from the stylesheet is exactly the move CONTEXT_GUIDE section 10 keeps
 * recording as wrong. This walks the offending card and reports, per element,
 * the width it insists on (`min-content`, measured by asking the browser) next
 * to the width it has been given.
 *
 * Usage: node electron/e2e/overflow-culprit-probe.mjs
 */
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const PROBE = { width: 1180, height: 900, split: 0.38, settleMs: 600, engineTimeoutMs: 30_000 };

const { page, close } = await launchWithEngine();
try {
  await waitForEngine(page, PROBE.engineTimeoutMs);
  await page.setViewportSize({ width: PROBE.width, height: PROBE.height });
  const handle = page.locator(".split-handle").first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(Math.round(PROBE.width * PROBE.split), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(PROBE.settleMs);

  const rows = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".sec")]
      .find((c) => (c.querySelector(".t")?.textContent ?? "").includes("Kill Filters"));
    if (!card) return [{ note: "no Kill Filters card on screen" }];
    const out = [];
    const cardWidth = card.getBoundingClientRect().width;
    for (const el of card.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Ask the browser what this box refuses to go below, rather than adding
      // up what the stylesheet says it should be.
      const previous = el.style.width;
      el.style.width = "min-content";
      const minContent = el.getBoundingClientRect().width;
      el.style.width = previous;
      if (minContent <= cardWidth) continue;
      const style = getComputedStyle(el);
      out.push({
        element: `${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").split(" ").filter(Boolean).join(".")}`,
        text: (el.textContent ?? "").trim().slice(0, 34),
        given: Math.round(rect.width),
        insistsOn: Math.round(minContent),
        minWidth: style.minWidth,
        flexWrap: style.flexWrap,
        whiteSpace: style.whiteSpace,
        display: style.display,
        depth: (() => { let d = 0, n = el; while (n && n !== card) { d += 1; n = n.parentElement; } return d; })(),
      });
    }
    out.sort((a, b) => b.depth - a.depth || b.insistsOn - a.insistsOn);
    return [{ cardWidth: Math.round(cardWidth) }, ...out];
  });

  for (const row of rows) console.log(JSON.stringify(row));
} finally {
  await close();
}
