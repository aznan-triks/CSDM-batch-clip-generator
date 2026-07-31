/**
 * The parity guard of D20 / R1: no setting may vanish in the port.
 *
 * The key list is read from Python at test time, never copied into
 * TypeScript. A copy would drift the day someone adds a key to
 * DEFAULT_CONFIG, and the guard would then certify a parity it no longer
 * measures.
 *
 * Coverage is measured on the RENDERED tree, not by scanning source: a control
 * that is written but never mounted is not a ported setting.
 *
 * This test PASSES from birth and stays passing. It is the ledger that is
 * enforced, not the count: a key that is neither covered nor listed fails, and
 * so does a listed key that turns out to be covered. A guard left red for three
 * chantiers is a guard nobody reads.
 */
import { act, render, screen } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../shell/AppShell";
import { TABS } from "../../shell/tabs";
import { NOT_YET_PORTED, NO_CONTROL_BY_DESIGN } from "../coverage-ledger";
import { SettingsProvider } from "../store";

vi.mock("../../bridge", () => {
  // `describe_filters` is what KillFiltersSection (tâche 3) needs before it
  // renders a single control. The 19-filter list is read from Python here
  // too, for the same reason `defaultConfigKeys()` below is: a copy typed by
  // hand would drift the day a filter is added, and this guard would then
  // certify a coverage it no longer measures (D20 / R1). `require`, not the
  // module's own `execFileSync` import: `vi.mock` factories run before this
  // file's imports are guaranteed initialised, so nothing outside the
  // factory itself can be relied on.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync: run } = require("node:child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodePath = require("node:path");
  const repoRoot = nodePath.resolve(__dirname, "../../../../..");
  const tablesJson = run(
    "python",
    [
      "-c",
      "import json; from csdm.bridge.tables import describe_filters; print(json.dumps(describe_filters()))",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const tables = JSON.parse(tablesJson);

  return {
    runCommand: (command: string) =>
      command === "describe_filters"
        ? Promise.resolve({ type: "result", id: "1", ok: true, data: tables })
        : Promise.resolve({ type: "result", id: "1", ok: true, data: {} }),
    onMessage: () => () => {},
    send: () => {},
    // The shell greets the engine on mount; this test only cares about which
    // controls got rendered, so the greeting goes nowhere.
    sendCommand: () => "1",
  };
});

/** Every key, straight from the one place they are defined. */
function defaultConfigKeys(): string[] {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const out = execFileSync(
    "python",
    ["-c", "import json, csdm.config as c; print(json.dumps(list(c.DEFAULT_CONFIG)))"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return JSON.parse(out);
}

/**
 * Every key that has a control mounted somewhere in the four tabs.
 *
 * A tab is not one screen but several: the window hides whole rows behind a
 * choice (the switch delay exists only in `both` perspective, Mate POV only
 * in `victim` and `both`). Rendering the default state alone would report
 * those settings as unported forever, so every segmented choice on the tab is
 * selected in turn and the tree measured again after each.
 *
 * Still measured on the RENDERED tree: a branch is credited only once a
 * control actually appears in it, never because someone said it would.
 */
function collectInto(found: Set<string>, container: HTMLElement): void {
  for (const node of container.querySelectorAll("[data-config-key]")) {
    found.add(node.getAttribute("data-config-key")!);
  }
}

/**
 * Keys whose own Chip gates a sub-panel of OTHER settings, not reachable by
 * the `role="radio"` sweep below.
 *
 * `KillFiltersSection.test.tsx` already demonstrates exactly these two
 * panels: clicking the FERRARI PEEK row's own Enable chip
 * (`kill_mod_high_velocity`) reveals `kill_mod_hv_one_shot` /
 * `kill_mod_high_vel_thr`, and clicking the CLUTCH block's own chip
 * (`clutch_enabled`) reveals `clutch_wins_only`, `clutch_mode`, and
 * `clutch_1v1`..`clutch_1v5`.
 *
 * This list is deliberately NOT "every Chip on the page": every filter row
 * has an Enable/Must/Exclude chip of its own, and blindly clicking all of
 * them would toggle sibling rows' state along with it -- corrupting exactly
 * the filter state that `KillFiltersSection.test.tsx`'s own assertions (and
 * any future coverage test reading the same tree) depend on. Scoping to the
 * two known gate keys opens their sub-panels without touching anything else.
 */
const CHIP_GATE_KEYS = ["kill_mod_high_velocity", "clutch_enabled"];

/**
 * Click each gate's own Chip, once, if it is not already open.
 *
 * `data-config-key` wraps the Chip directly for both gates (`FilterRow.tsx`,
 * `KillFiltersSection.tsx`'s `ClutchBlock`), so scoping the query to that
 * wrapper reaches the right button without depending on its visible label.
 */
function openChipGates(container: HTMLElement): void {
  for (const key of CHIP_GATE_KEYS) {
    const wrapper = container.querySelector(`[data-config-key="${key}"]`);
    if (!wrapper) continue;
    const chip = wrapper.querySelector<HTMLButtonElement>(
      'button[aria-pressed="false"]:not([aria-disabled="true"])',
    );
    if (!chip) continue;
    act(() => {
      chip.click();
    });
  }
}

async function renderedKeys(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const tab of TABS) {
    const { container, unmount } = render(
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>,
    );
    // Some tabs read a table fetched over the pipe (`useTables`, tâche 2/3)
    // before they render a single control -- KillFiltersSection shows
    // "Loading filters…" until `describe_filters` resolves. Without this
    // flush, the guard would measure the loading state forever and report
    // every setting behind it as unported, which is not what "not yet
    // ported" means.
    await act(async () => {});
    // Every click goes through `act`: React batches state updates, and a
    // raw .click() would let the guard read the tree BEFORE the branch it
    // just opened has rendered -- reporting a ported setting as missing.
    act(() => {
      screen.getByRole("tab", { name: new RegExp(tab.label, "i") }).click();
    });
    collectInto(found, container);

    // Open the Chip-gated panels before the radio sweep: `clutch_mode` is a
    // `role="radio"` control that does not exist in the tree until the
    // CLUTCH chip itself has been clicked, so this must run first.
    openChipGates(container);
    collectInto(found, container);

    // Walk every choice of every segmented control. Re-reading the list each
    // time matters: selecting a value can add controls that carry choices of
    // their own, and a list captured once would miss them.
    const visited = new Set<string>();
    for (let pass = 0; pass < MAX_REVEAL_PASSES; pass += 1) {
      const next = [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(
        (radio) => !visited.has(radio.textContent ?? ""),
      );
      if (!next) break;
      visited.add(next.textContent ?? "");
      act(() => {
        next.click();
      });
      collectInto(found, container);
    }
    unmount();
  }
  return found;
}

/**
 * How many choices the sweep will open on one tab before giving up.
 *
 * A guard that could loop forever on a control that re-renders its own
 * options is worse than one that stops; this is the stop, set well above the
 * handful of segmented controls any tab actually has.
 */
const MAX_REVEAL_PASSES = 40;

describe("settings coverage", () => {
  it("accounts for every key: ported, or explicitly listed", async () => {
    const keys = defaultConfigKeys();
    const covered = await renderedKeys();
    const excused = new Set([...NOT_YET_PORTED, ...Object.keys(NO_CONTROL_BY_DESIGN)]);

    const unaccounted = keys.filter((k) => !covered.has(k) && !excused.has(k));
    expect(
      unaccounted,
      `${unaccounted.length} setting(s) have no control and no ledger entry. ` +
        `Port them, or list them in coverage-ledger.ts with a reason.`,
    ).toEqual([]);
  });

  it("has no stale ledger entry", async () => {
    const covered = await renderedKeys();
    const stale = [...NOT_YET_PORTED, ...Object.keys(NO_CONTROL_BY_DESIGN)]
      .filter((k) => covered.has(k));
    expect(stale, "these keys are ported -- remove them from the ledger").toEqual([]);
  });

  it("lists no key that DEFAULT_CONFIG does not have", () => {
    const keys = new Set(defaultConfigKeys());
    const ghosts = [...NOT_YET_PORTED, ...Object.keys(NO_CONTROL_BY_DESIGN)]
      .filter((k) => !keys.has(k));
    expect(ghosts, "these ledger entries name no real setting").toEqual([]);
  });

  it("reports how many settings are still to port", () => {
    const remaining = NOT_YET_PORTED.length;
    // Not an assertion on the number -- a printed ledger line, so a chantier
    // that moves nothing is visible in the test output.
    console.log(`[coverage] ${remaining} setting(s) left to port`);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });
});
