/**
 * Phase 2 of the 2026-09-01 audit: drive the three reportedly-broken journeys
 * in the real window, with the real engine and the real database, and record
 * what actually crosses the pipe.
 *
 * This is NOT the hermetic suite. `harness.mjs` deliberately points the engine
 * at a name that cannot resolve, because the visual tests are not about the
 * engine. Here the engine is the whole point: "PREVIEW does nothing" has at
 * least five possible meanings and only a real round trip can say which one it
 * is.
 *
 * CS2 is never launched. PREVIEW is a dry run -- it queries the database,
 * pre-parses demos and returns a checklist. Nothing in this file starts a
 * recording.
 *
 * Usage: node electron/e2e/trace-scenarios.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "./config.mjs";
import { launchWithEngine, waitForEngine } from "./engine-harness.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRACE_DIR = path.join(REPO_ROOT, "docs", "audits", "traces");

/**
 * HC.1 -- every delay this script waits on, named once, with why.
 *
 * `engineBanner` : the greeting is a command round trip; anything slower than
 *   this means the engine never started, which is itself the finding.
 * `settle`       : one animation frame plus slack, for a click whose effect is
 *   local (a tab switching, a chip toggling).
 * `dbCommand`    : `connect_db` introspects the schema and reads every player.
 * `preview`      : a dry run pre-parses demos with demoparser2. Generous on
 *   purpose: a timeout here must mean "it never answered", never "we were
 *   impatient".
 */
const WAIT = {
  engineBanner: 30_000,
  settle: 600,
  dbCommand: 60_000,
  preview: 240_000,
};

/** Everything the console currently shows, as plain text. */
function consoleText(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".console .body");
    return body ? body.innerText : "<no console body in the page>";
  });
}

async function traceText(page) {
  return page.evaluate(() =>
    (window.__csdmTrace ? window.__csdmTrace.text() : "<tracing was not on>"),
  );
}

async function note(page, text) {
  await page.evaluate((t) => window.__csdmTrace?.note(t), text);
}

async function clearTrace(page) {
  await page.evaluate(() => window.__csdmTrace?.clear());
}

function save(name, text) {
  const file = path.join(TRACE_DIR, `${name}.txt`);
  writeFileSync(file, text, "utf8");
  console.log(`  → ${path.relative(REPO_ROOT, file)}`);
  return file;
}

/**
 * Wait until the trace holds an entry matching `{kind, name}`, or time out.
 *
 * Matched by plain field comparison, NOT by a predicate string compiled in the
 * page: dynamic code evaluation is blocked by the window's content security
 * policy, so the first version of this helper answered "no such entry" for
 * every entry -- a harness that reports failure regardless of the truth, which
 * is worse than no harness. `names` accepts several so "reached any end state"
 * is one wait rather than a race.
 */
async function waitForTrace(page, timeoutMs, kind, names) {
  const wanted = Array.isArray(names) ? names : [names];
  try {
    await page.waitForFunction(
      ({ kind: k, wanted: w }) => {
        const entries = window.__csdmTrace ? window.__csdmTrace.entries() : [];
        return entries.some((entry) => entry.kind === k && w.includes(entry.name));
      },
      { kind, wanted },
      { timeout: timeoutMs, polling: 250 },
    );
    return true;
  } catch {
    return false;
  }
}

async function openTab(page, label) {
  await page.locator(`.tab:has-text("${label}")`).first().click();
  await page.waitForTimeout(WAIT.settle);
}

async function main() {
  mkdirSync(TRACE_DIR, { recursive: true });
  const summary = [];
  const { page, close } = await launchWithEngine();

  try {
    // 1. The engine must actually be alive, or every scenario below is noise.
    console.log("waiting for the engine banner…");
    const alive = await waitForEngine(page, WAIT.engineBanner);
    console.log(`  engine ready: ${alive}`);
    if (!alive) {
      save("00-engine-never-started", await consoleText(page));
      summary.push("engine: NEVER STARTED -- every scenario below is void");
    }

    // 2. Turn the recorder on the way a user would: the chip, not an internal.
    await page.locator('[data-action="J13"]').click();
    await page.waitForTimeout(WAIT.settle);
    const tracingOn = await page.evaluate(() => Boolean(window.__csdmTrace));
    console.log(`  tracing on: ${tracingOn}`);
    if (!tracingOn) throw new Error("the DEBUG chip did not turn the recorder on");

    // --- Scenario A: Settings -> Test & Reload ------------------------------
    console.log("scenario A: Settings / Test & Reload");
    await openTab(page, "SETTINGS");
    await clearTrace(page);
    await note(page, "scenario A: click Test & Reload (data-action M10)");
    await page.locator('[data-action="M10"]').click();
    const gotA = await waitForTrace(
      page, WAIT.dbCommand, "result", "connect_db",
    );
    await page.waitForTimeout(WAIT.settle);
    await note(page, `scenario A end (connect_db result seen: ${gotA})`);
    save("A-settings-test-and-reload", await traceText(page));
    summary.push(`A settings reload: connect_db answered = ${gotA}`);

    // --- Scenario B: Tags -> Reload ----------------------------------------
    console.log("scenario B: Tags / Reload");
    await openTab(page, "TAGS");
    await clearTrace(page);
    await note(page, "scenario B: click Reload (data-action I17)");
    const tagsBefore = await page.locator(".tags-list, .tag-row, [class*='tag']").count();
    await page.locator('[data-action="I17"]').click();
    const gotB = await waitForTrace(
      page, WAIT.dbCommand, "result", "connect_db",
    );
    await page.waitForTimeout(WAIT.settle);
    const tagsAfter = await page.locator(".tags-list, .tag-row, [class*='tag']").count();
    await note(page, `scenario B end (result seen: ${gotB}, tag nodes ${tagsBefore} -> ${tagsAfter})`);
    save("B-tags-reload", await traceText(page));
    summary.push(`B tags reload: connect_db answered = ${gotB}, tag nodes ${tagsBefore} -> ${tagsAfter}`);

    // --- Scenario C: PREVIEW ------------------------------------------------
    console.log("scenario C: PREVIEW (dry run, no CS2)");
    await openTab(page, "CAPTURE");
    await clearTrace(page);
    await note(page, "scenario C: click PREVIEW");
    await page.locator('.btn:has-text("PREVIEW")').first().click();
    const startedC = await waitForTrace(
      page, WAIT.dbCommand, "result", "start_preview",
    );
    const readyC = await waitForTrace(
      page, WAIT.preview, "state", ["preview_ready", "buttons_idle"],
    );
    await page.waitForTimeout(WAIT.settle);

    // The engine answering is only half of PREVIEW. The other half is the
    // checklist appearing, and "the engine produced clips" and "the user sees
    // clips" are exactly the two things the report could not distinguish.
    // Since the fix the window goes there by itself; record whether it did
    // BEFORE forcing the tab, or the measurement would hide the behaviour.
    const landedOnEditing = await page
      .locator('.tab[aria-current="true"]')
      .innerText()
      .catch(() => "?");
    await openTab(page, "EDITING");
    const editingRows = await page.locator(".editing-list > *").count();
    const editingText = await page
      .locator(".editing-tab")
      .innerText()
      .catch(() => "<no editing tab in the page>");
    await note(page, `scenario C end (start_preview answered: ${startedC}, finished: ${readyC}, editing rows: ${editingRows})`);
    save("C-preview", await traceText(page));
    save("C-preview-console", await consoleText(page));
    save("C-preview-editing-tab", `rows: ${editingRows}

${editingText}`);
    summary.push(
      `C preview: start_preview answered = ${startedC}, reached an end state = ${readyC}, ` +
      `clips shown on the editing tab = ${editingRows}, ` +
      `tab the window moved to on its own = ${landedOnEditing.replace(/\s+/g, " ").trim()}`,
    );
    // --- Scenario D: unchecking a clip on the editing checklist -------------
    // The editing tab is already open from scenario C.
    console.log("scenario D: uncheck one clip on the editing checklist");
    await clearTrace(page);
    await note(page, "scenario D: click the first clip row");
    const firstRow = page.locator(".editing-list > *").first();
    // Inclusion is carried by the row's own class (`.editing-clip.selected`),
    // not by an aria state or a nested input -- the first version of this probe
    // counted `[aria-checked]` and `input:checked`, found none of either, and
    // reported "0 -> 0" whatever happened.
    const included = () => page.locator(".editing-clip.selected").count();
    const beforeD = await included();
    const classBefore = await firstRow.getAttribute("class");
    await firstRow.click();
    await page.waitForTimeout(WAIT.settle);
    const afterD = await included();
    const classAfter = await firstRow.getAttribute("class");
    const header = await page.locator(".editing-header").innerText().catch(() => "");
    await note(page, `scenario D end (included ${beforeD} -> ${afterD}, row class "${classBefore}" -> "${classAfter}")`);
    save("D-editing-toggle", await traceText(page));
    summary.push(
      `D editing toggle: included clips ${beforeD} -> ${afterD}, ` +
      `row class changed = ${classBefore !== classAfter}, header = ${header.replace(/\s+/g, " ").trim()}`,
    );
  } finally {
    await close();
  }

  const report = summary.join("\n");
  save("00-summary", `${report}\n`);
  console.log(`\n${report}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
