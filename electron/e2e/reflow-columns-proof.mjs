/**
 * Two jobs, one launch.
 *
 * `measure`: reports the width a filter row occupies when nothing forces it
 * to wrap -- the number `--reflow-col-min` is set from, so the column width
 * is measured rather than picked. Rows carrying a `.kf-extra` sub-panel are
 * excluded on purpose: they are wider by nature, and `.filter-row` is
 * `flex-wrap: wrap`, so they fold cleanly inside a column sized for the
 * ordinary rows. Sizing on the widest row would mean the card never splits.
 *
 * `prove`: widens the KILL FILTERS card on the real window and checks the
 * rows really do spread over more columns, that the group heading still
 * spans the whole group, and that no row is broken across a column boundary.
 * A stylesheet containing `columns` is not proof that anything reflowed
 * (§1 principle 8).
 */
import { launchApp, shoot } from "./harness.mjs";

const MODE = process.argv[2] ?? "prove";

/** Index of the KILL FILTERS card among the visible tab's grid items. */
const FIND_CARD = () => {
  const items = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')];
  return items.findIndex((it) => (it.querySelector(".sh")?.textContent ?? "").toLowerCase().includes("kill filters"));
};

const { page, close } = await launchApp();
await page.waitForTimeout(2000);

const cardIndex = await page.evaluate(FIND_CARD);
if (cardIndex === -1) {
  await close();
  throw new Error("KILL FILTERS card not found -- did the Capture tab stop mounting it?");
}

if (MODE === "measure") {
  const measured = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".kf-group .filter-row")].filter(
      (r) => !r.querySelector(".kf-extra"),
    );
    if (rows.length === 0) return null;
    let widest = 0;
    for (const row of rows) {
      const probe = row.cloneNode(true);
      // `max-content` on a wrapping flex box reports the width it needs to
      // keep everything on one line -- exactly the natural row width.
      probe.style.width = "max-content";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      widest = Math.max(widest, Math.ceil(probe.getBoundingClientRect().width));
      probe.remove();
    }
    return { rowsMeasured: rows.length, naturalRowWidth: widest };
  });
  console.log(JSON.stringify(measured, null, 2));
  console.log(`MEASURED --reflow-col-min = ${measured?.naturalRowWidth}px`);
  await close();
  process.exitCode = measured?.naturalRowWidth > 0 ? 0 : 1;
} else {
  /** Card rectangle, scrolled into view first so the drag below can reach it. */
  const cardBox = () =>
    page.evaluate((i) => {
      const c = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
      c.scrollIntoView({ block: "center" });
      const b = c.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    }, cardIndex);

  const readGroups = () =>
    page.evaluate((i) => {
      const card = [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .react-grid-item')][i];
      return [...card.querySelectorAll(".kf-group")].map((g) => {
        const rows = [...g.querySelectorAll(".filter-row")];
        // Distinct left edges = distinct columns. Rounded, because a
        // fractional layout can differ by a hair between rows in a column.
        const columns = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left))).size;
        const heading = g.querySelector(".reflow-columns-header");
        const groupWidth = g.getBoundingClientRect().width;
        const headingWidth = heading ? heading.getBoundingClientRect().width : 0;
        // A block fragmented across a column boundary reports MORE THAN ONE
        // client rect -- that is the direct observation of a split, not a
        // proxy for it. `break-inside: avoid` is what keeps it at one.
        const split = rows.some((r) => r.getClientRects().length > 1);
        return {
          rows: rows.length,
          columns,
          headingSpans: heading ? headingWidth >= groupWidth - 2 : false,
          anyRowSplit: split,
        };
      });
    }, cardIndex);

  const before = { box: await cardBox(), groups: await readGroups() };
  await shoot(page, "reflow-columns-narrow");

  // Widen the card with its real resize corner -- the same gesture a user
  // makes. Anything else would prove a layout the app never actually enters.
  //
  // KILL FILTERS starts single-column (the bug this plan fixes) and taller
  // than the 900px viewport, so centering the CARD (`cardBox()` above) still
  // leaves its bottom-right handle off-screen -- the drag would land on
  // nothing. Scroll the handle itself into view instead.
  const handle = page
    .locator('[role="tabpanel"]:not([hidden]) .react-grid-item')
    .nth(cardIndex)
    .locator(".react-resizable-handle");
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("resize handle has no box -- is the card off-screen?");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // 520px landed one grid step short of the ~880px content width two 419px
  // columns + gap actually need (846px card, 816px content after the card's
  // 15px side padding) -- widen further to clear it with margin.
  await page.mouse.move(hb.x + 700, hb.y + 40, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const after = { box: await cardBox(), groups: await readGroups() };
  const wideShot = await shoot(page, "reflow-columns-wide");

  console.log(JSON.stringify({ before, after }, null, 2));
  const widened = after.box.w > before.box.w;
  const gainedColumns = after.groups.some((g, n) => g.columns > before.groups[n].columns);
  const headingsSpan = after.groups.every((g) => g.headingSpans);
  const noSplit = after.groups.every((g) => !g.anyRowSplit);
  console.log(
    `VERDICT: card widened = ${widened}; columns gained = ${gainedColumns}; ` +
      `headings span = ${headingsSpan}; no row split = ${noSplit}`,
  );
  console.log(`shot: ${wideShot}`);
  await close();
  process.exitCode = widened && gainedColumns && headingsSpan && noSplit ? 0 : 1;
}
