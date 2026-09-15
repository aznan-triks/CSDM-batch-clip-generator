/**
 * Parity coverage: no Tkinter action may go unanswered — each one is mounted
 * or ledgered with a reason; no stale ledger entry, no unknown mount.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "../../App";
import { SettingsProvider } from "../../settings/store";
import ActionBar from "../../shell/ActionBar";
import CaptureTab from "../../tabs/CaptureTab";
import SettingsTab from "../../tabs/SettingsTab";
import TagsTab from "../../tabs/TagsTab";
import VideoTab from "../../tabs/VideoTab";
import { NOT_YET_PORTED, NO_PORT_BY_DESIGN, PORTED_BEHIND_STATE } from "../action-ledger";
import { readActionInventory } from "../inventory";

vi.mock("../../bridge", () => {
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
    sendCommand: () => "1",
  };
});

/** Scan a rendered container for every `data-action` marker. */
function collectActions(container: HTMLElement, into: Set<string>) {
  for (const element of container.querySelectorAll("[data-action]")) {
    const id = element.getAttribute("data-action");
    if (id) into.add(id);
  }
}

/**
 * Every `data-action` mounted anywhere in the interface.
 *
 * The top-level shell (`<App />`) only mounts the *active* tab; the three
 * inactive tabs are conditionally absent from the DOM tree.  This helper
 * renders the always-visible frame once, then mounts each of the four tabs
 * individually so their markers are all collected.
 */
function mountedActions(): Set<string> {
  const found = new Set<string>();

  // Always-visible frame: HudNav, ActionBar, LogConsole, WeaponBand.
  const { container: appContainer } = render(<App />);
  collectActions(appContainer, found);

  // The editing tab swaps in GENERATE/SAVE/CANCEL (Q1/Q2/Q3). It is a real,
  // clickable tab (HudNav's fifth entry, `tabs.ts`) but `<App />` above only
  // mounts whichever tab is active by default -- never "editing" on its own.
  // Render it standalone, same pattern as shell/__tests__/ActionBar.test.tsx.
  const { container: editingContainer } = render(
    <SettingsProvider>
      <ActionBar active="editing" onSetTab={() => {}} />
    </SettingsProvider>,
  );
  collectActions(editingContainer, found);

  // Each tab, wrapped in the same provider that App uses.
  const tabs = [
    { Component: CaptureTab, label: "capture" },
    { Component: TagsTab, label: "tags" },
    { Component: VideoTab, label: "video" },
    { Component: SettingsTab, label: "settings" },
  ];

  for (const { Component } of tabs) {
    const { container } = render(<SettingsProvider><Component /></SettingsProvider>);
    collectActions(container, found);
  }

  return found;
}

const SRC = path.resolve(__dirname, "../..");
const MARKER_LINE = /(data-action|dataAction|optionActions)\s*=/;

/** id → the non-test source files that mark it. Reads the code, not the DOM. */
function markerHomes(): Map<string, Set<string>> {
  const homes = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      const lines = readFileSync(full, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        // A marker's ids may sit on the attribute line or in the object literal just below it.
        if (!MARKER_LINE.test(line)) return;
        const window = lines.slice(i, i + 4).join(" ");
        for (const match of window.matchAll(/"([A-Q]\d+)"/g)) {
          const set = homes.get(match[1]) ?? new Set<string>();
          set.add(path.relative(SRC, full));
          homes.set(match[1], set);
        }
      });
    }
  };
  walk(SRC);
  return homes;
}

describe("every Tkinter action is answered for", () => {
  const inventory = readActionInventory().filter((entry) => !entry.removed);
  const mounted = mountedActions();

  it("accounts for each one: mounted, or in the ledger with a reason", () => {
    const unaccounted = inventory
      .filter(
        (entry) =>
          !mounted.has(entry.id) &&
          !(entry.id in NO_PORT_BY_DESIGN) &&
          !(entry.id in NOT_YET_PORTED) &&
          !(entry.id in PORTED_BEHIND_STATE),
      )
      .map((entry) => `${entry.id} (${entry.label})`);
    expect(unaccounted, "these Tkinter actions have no answer in this shell").toEqual([]);
  });

  it("holds no stale ledger entry", () => {
    const known = new Set(inventory.map((entry) => entry.id));
    const stale = [
      ...Object.keys(NO_PORT_BY_DESIGN),
      ...Object.keys(NOT_YET_PORTED),
      ...Object.keys(PORTED_BEHIND_STATE),
    ].filter((id) => !known.has(id));
    expect(stale, "these ids are in the ledger but not in the inventory").toEqual([]);
  });

  it("mounts no action the inventory does not know", () => {
    const known = new Set(readActionInventory().map((entry) => entry.id));
    const invented = [...mounted].filter((id) => !known.has(id));
    expect(invented, "these data-action markers name nothing real").toEqual([]);
  });

  it("never files one id in two lists", () => {
    const lists = [NO_PORT_BY_DESIGN, NOT_YET_PORTED, PORTED_BEHIND_STATE].map((l) => Object.keys(l));
    const seen = new Map<string, number>();
    for (const ids of lists) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it("lists nothing as pending that is already on screen", () => {
    const stale = Object.keys(NOT_YET_PORTED).filter((id) => mounted.has(id));
    expect(stale, "mounted, so no longer 'not yet ported'").toEqual([]);
  });

  it("gives every action id a single home in the source", () => {
    const shared = [...markerHomes()].filter(([, files]) => files.size > 1)
      .map(([id, files]) => `${id}: ${[...files].join(", ")}`);
    expect(shared, "one id marks one action, in one component").toEqual([]);
  });

  it("finds the marker of every action said to wait behind a state", () => {
    const homes = markerHomes();
    const noMarker = Object.keys(PORTED_BEHIND_STATE).filter((id) => !homes.has(id));
    const mountedAnyway = Object.keys(PORTED_BEHIND_STATE).filter((id) => mounted.has(id));
    expect(noMarker, "said to be ported, but no component marks it").toEqual([]);
    expect(mountedAnyway, "mounted in the test, so not behind a state").toEqual([]);
  });
});
