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
import { render, screen } from "@testing-library/react";
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

/** Every key that has a control mounted somewhere in the four tabs. */
function renderedKeys(): Set<string> {
  const found = new Set<string>();
  for (const tab of TABS) {
    const { container, unmount } = render(
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>,
    );
    screen.getByRole("button", { name: new RegExp(tab.label, "i") }).click();
    for (const node of container.querySelectorAll("[data-config-key]")) {
      found.add(node.getAttribute("data-config-key")!);
    }
    unmount();
  }
  return found;
}

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
