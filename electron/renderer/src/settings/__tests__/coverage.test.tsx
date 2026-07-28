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

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: {} }),
  onMessage: () => () => {},
  send: () => {},
  // The shell greets the engine on mount; this test only cares about which
  // controls got rendered, so the greeting goes nowhere.
  sendCommand: () => "1",
}));

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

function renderedKeys(): Set<string> {
  const found = new Set<string>();
  for (const tab of TABS) {
    const { container, unmount } = render(
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>,
    );
    // Every click goes through `act`: React batches state updates, and a
    // raw .click() would let the guard read the tree BEFORE the branch it
    // just opened has rendered -- reporting a ported setting as missing.
    act(() => {
      screen.getByRole("button", { name: new RegExp(tab.label, "i") }).click();
    });
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
  it("accounts for every key: ported, or explicitly listed", () => {
    const keys = defaultConfigKeys();
    const covered = renderedKeys();
    const excused = new Set([...NOT_YET_PORTED, ...Object.keys(NO_CONTROL_BY_DESIGN)]);

    const unaccounted = keys.filter((k) => !covered.has(k) && !excused.has(k));
    expect(
      unaccounted,
      `${unaccounted.length} setting(s) have no control and no ledger entry. ` +
        `Port them, or list them in coverage-ledger.ts with a reason.`,
    ).toEqual([]);
  });

  it("has no stale ledger entry", () => {
    const covered = renderedKeys();
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
