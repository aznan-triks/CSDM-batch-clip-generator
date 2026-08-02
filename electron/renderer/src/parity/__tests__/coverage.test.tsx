import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "../../App";
import { SettingsProvider } from "../../settings/store";
import CaptureTab from "../../tabs/CaptureTab";
import SettingsTab from "../../tabs/SettingsTab";
import TagsTab from "../../tabs/TagsTab";
import VideoTab from "../../tabs/VideoTab";
import { NOT_YET_PORTED, NO_PORT_BY_DESIGN } from "../action-ledger";
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

describe("every Tkinter action is answered for", () => {
  const inventory = readActionInventory().filter((entry) => !entry.removed);
  const mounted = mountedActions();

  it("accounts for each one: mounted, or in the ledger with a reason", () => {
    const unaccounted = inventory
      .filter(
        (entry) =>
          !mounted.has(entry.id) &&
          !(entry.id in NO_PORT_BY_DESIGN) &&
          !(entry.id in NOT_YET_PORTED),
      )
      .map((entry) => `${entry.id} (${entry.label})`);
    expect(unaccounted, "these Tkinter actions have no answer in this shell").toEqual([]);
  });

  it("holds no stale ledger entry", () => {
    const known = new Set(inventory.map((entry) => entry.id));
    const stale = [...Object.keys(NO_PORT_BY_DESIGN), ...Object.keys(NOT_YET_PORTED)].filter(
      (id) => !known.has(id),
    );
    expect(stale, "these ids are in the ledger but not in the inventory").toEqual([]);
  });

  it("mounts no action the inventory does not know", () => {
    const known = new Set(readActionInventory().map((entry) => entry.id));
    const invented = [...mounted].filter((id) => !known.has(id));
    expect(invented, "these data-action markers name nothing real").toEqual([]);
  });

  it("never claims an id is both undoable and merely pending", () => {
    const both = Object.keys(NO_PORT_BY_DESIGN).filter((id) => id in NOT_YET_PORTED);
    expect(both).toEqual([]);
  });
});
