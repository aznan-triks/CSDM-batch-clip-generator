/**
 * Ad-hoc proof: the reticle frames the longest real button at full size
 * (2026-08-04, user feedback: "it has a max size, that's bad ... loosen it").
 *
 * Hovers the mouse over the widest .btn/.chip/.seg button in the real
 * window, reads the reticle's --cw/--ch custom properties, and screenshots
 * the result. Not part of the e2e suite -- one-shot evidence.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { launchApp } from "./harness.mjs";

const OUT = path.join("e2e", "output");

const session = await launchApp();
const { page } = session;
try {
  await page.waitForSelector(".btn", { timeout: 15000 });
  await page.waitForTimeout(500);

  // Hermetic start: the persisted layout may have left cards folded from an
  // earlier run -- unfold everything so chips are actually visible.
  await page.evaluate(() => {
    for (const sec of document.querySelectorAll(".sec.closed")) {
      sec.querySelector(".sh")?.click();
    }
  });
  await page.waitForTimeout(600);

  const target = await page.evaluate(() => {
    const snap = [...document.querySelectorAll(".btn, .chip, .seg button")].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    snap.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const widest = snap[0];
    if (!widest) return null;
    // Bring it on screen first and tag it so we can re-find it (a bare
    // class selector would match the FIRST element of that class, not this one).
    widest.setAttribute("data-reticle-probe", "1");
    widest.scrollIntoView({ block: "center" });
    return { cls: widest.className, text: (widest.textContent || "").trim().slice(0, 40) };
  });
  if (!target) {
    console.log(JSON.stringify({ error: "no snap target found" }));
    process.exit(1);
  }
  await page.waitForTimeout(500);
  const rect = await page.evaluate(() => {
    const el = document.querySelector("[data-reticle-probe='1']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!rect) {
    console.log(JSON.stringify({ error: "target lost after scroll" }));
    process.exit(1);
  }

  await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
  await page.waitForTimeout(400);

  const underPointer = await page.evaluate((pt) => {
    const el = document.elementFromPoint(pt.x, pt.y);
    if (!el) return null;
    return { tag: el.tagName, cls: el.className, text: (el.textContent || "").trim().slice(0, 30) };
  }, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

  const reticle = await page.evaluate(() => {
    const el = document.querySelector(".cursor-reticle");
    if (!el) return null;
    return {
      cw: el.style.getPropertyValue("--cw"),
      ch: el.style.getPropertyValue("--ch"),
      snap: el.classList.contains("snap"),
    };
  });
  await page.screenshot({ path: path.join(OUT, "reticle-long-button.png") });

  const out = {
    target: { ...target, rect },
    underPointer,
    reticle,
    followsButton: reticle && Math.abs(parseFloat(reticle.cw) - (rect.w + 10)) < 1 && Math.abs(parseFloat(reticle.ch) - (rect.h + 10)) < 1,
  };
  console.log(JSON.stringify(out, null, 2));
  writeFileSync(path.join(OUT, "reticle-long-button.json"), JSON.stringify(out, null, 2));
} finally {
  await session.close();
}
