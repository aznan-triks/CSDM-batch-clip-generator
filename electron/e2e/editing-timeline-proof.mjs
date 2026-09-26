/**
 * EDITING timeline visual proof (§1 principle 8): a realistic preview --
 * 24 demos, 340 clips, kills / deaths / damage / shots, camera switches --
 * shown as the timeline (fit, zoomed, a clip open and edited in the
 * inspector) and as the list, with the tab's DOM node count for each view.
 *
 * Hermetic harness (no engine): the `preview_ready` the engine would send is
 * dispatched into the renderer's own store, in the engine's payload shape
 * (`_preview_sequences`: event_keys, camera_segments).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SHOT_DIR } from "./config.mjs";
import { launchApp } from "./harness.mjs";

const OUT = path.join(SHOT_DIR, "editing-timeline");
mkdirSync(OUT, { recursive: true });

const { page, close } = await launchApp();
try {
  await page.waitForSelector('[data-config-key="date_from"]', { timeout: 30000 });
  const counts = await page.evaluate(async () => {
    const TR = 64;
    const MAPS = ["mirage", "inferno", "ancient", "nuke", "anubis", "dust2", "vertigo", "overpass"];
    const TYPES = ["kill", "kill", "kill", "death", "damage_actor", "damage_target", "shot"];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const sequences = {};
    let total = 0;
    for (let d = 0; d < 24; d++) {
      const dp = `D:/CS2/demos/2026-09-${String(1 + (d % 28)).padStart(2, "0")}_${MAPS[d % MAPS.length]}_${1000 + d}.dem`;
      const n = 8 + Math.floor(rnd() * 14);
      const seqs = [];
      let t = Math.floor((30 + rnd() * 90) * TR);
      for (let i = 0; i < n; i++) {
        const events = [];
        const k = 1 + Math.floor(rnd() * (rnd() < 0.3 ? 4 : 2));
        let et = t;
        for (let j = 0; j < k; j++) {
          const type = TYPES[Math.floor(rnd() * TYPES.length)];
          events.push({ tick: et, type, victim_sid: `v${j}`, killer_sid: "me", attacker_sid: "me" });
          et += Math.floor((0.6 + rnd() * 2.5) * TR);
        }
        const start = events[0].tick - 3 * TR;
        const end = events[events.length - 1].tick + 2 * TR;
        const cams = [{ from_tick: start, to_tick: end, steam_id: "me", name: "zebi" }];
        if (k > 1) {
          const sw = events[1].tick - TR;
          cams[0].to_tick = sw;
          cams.push({ from_tick: sw, to_tick: end, steam_id: "v1", name: "ropz" });
        }
        seqs.push({
          start_tick: start,
          end_tick: end,
          event_type: events[0].type,
          events,
          event_keys: events.map((e) => `${e.tick}:${e.type}:${e.victim_sid}`),
          camera_segments: cams,
        });
        t = end + Math.floor((20 + rnd() * 110) * TR);
      }
      total += n;
      sequences[dp] = seqs;
    }
    const store = await import("/src/motion/engineStore.ts");
    store.dispatchEngineMessage("preview_ready", { sequences, cfg: { tickrate: TR, player_name: "zebi" } });
    return { demos: 24, clips: total };
  });
  console.log("preview:", JSON.stringify(counts));

  await page.getByRole("tab", { name: /editing/i }).click();
  await page.waitForSelector(".edtl-lane", { timeout: 10000 });
  await page.waitForTimeout(1200);
  const nodes = () => page.evaluate(() => ({
    tab: document.querySelector(".editing-tab").querySelectorAll("*").length,
    page: document.querySelectorAll("*").length,
  }));
  const timelineFit = await nodes();
  await page.screenshot({ path: path.join(OUT, "01-timeline-fit.png") });

  for (let i = 0; i < 5; i++) await page.getByLabel("Zoom in").click();
  await page.waitForTimeout(400);
  const timelineZoomed = await nodes();
  await page.screenshot({ path: path.join(OUT, "02-timeline-zoomed.png") });

  await page.locator(".edtl-lane").nth(1).locator(".edtl-clip").first().click();
  await page.waitForSelector(".edtl-inspector");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "03-inspector.png") });
  // Virtualisation check: the first mounted tick must sit at or left of the view.
  console.log("window vs mounted:", JSON.stringify(await page.evaluate(() => {
    const sc = document.querySelector(".edtl-scroll");
    const ticks = [...document.querySelectorAll(".edtl-tick")].map((t) => parseFloat(t.style.left));
    return { scrollLeft: sc.scrollLeft, clientWidth: sc.clientWidth, firstTick: Math.min(...ticks), lastTick: Math.max(...ticks) };
  })));

  // Edit it: one second earlier, two seconds longer, first event out.
  const inspector = page.locator(".edtl-inspector");
  await inspector.getByRole("slider", { name: /before/ }).press("ArrowLeft");
  await inspector.getByRole("slider", { name: /after/ }).press("ArrowRight");
  await inspector.getByRole("slider", { name: /after/ }).press("ArrowRight");
  await inspector.locator(".edtl-insp-event").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "04-inspector-edited.png") });
  await inspector.screenshot({ path: path.join(OUT, "05-inspector-closeup.png") });
  const payload = await page.evaluate(async () => {
    const store = await import("/src/motion/engineStore.ts");
    const { clipPayload } = await import("/src/tabs/editing/clipEdits.ts");
    return store.getEngineState().previewClips.filter((c) => c.edit).map(clipPayload);
  });
  console.log("edited payload:", JSON.stringify(payload));

  await page.getByRole("radio", { name: "List" }).click();
  await page.waitForSelector(".editing-list");
  await page.waitForTimeout(600);
  const list = await nodes();
  await page.screenshot({ path: path.join(OUT, "06-list.png") });

  console.log("DOM nodes (editing tab / whole page):", JSON.stringify({ timelineFit, timelineZoomed, list }));
  console.log(`shots in ${OUT}`);
} finally {
  await close();
}
