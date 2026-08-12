/**
 * Reproduces the reported bug: after enlarging then shrinking the Electron
 * window, a card that the user had already sized/placed does not go back to
 * that rectangle. Unlike the other SectionList tests, `useSectionLayout` is
 * NOT mocked here -- the bug lives in the interaction between the real
 * `migrateLayout` clamp (sectionLayout.ts) and how `SectionList` decides
 * when a layout change is worth persisting, so a stubbed hook would hide it.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Card from "../../components/Card";
import type { BridgeMessage } from "../../bridge";
import { SettingsProvider, useAllSettings } from "../../settings/store";
import SectionList, { type SectionSpec } from "../SectionList";

let currentWidth = 1200;
let resizeCallback: ((entries: [{ contentRect: { width: number } }]) => void) | null = null;

// Shadows the inert stub in test-setup.ts for this file only (each Vitest
// test file gets its own global scope): SectionList's own resize handling
// only matters if the observer callback can actually be fired on demand.
globalThis.ResizeObserver = class {
  constructor(cb: (entries: [{ contentRect: { width: number } }]) => void) {
    resizeCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => currentWidth,
});

function resizePane(width: number): void {
  currentWidth = width;
  act(() => {
    resizeCallback?.([{ contentRect: { width } }]);
  });
}

/**
 * A minimal fake of the preload bridge (bridge.ts) that answers
 * `load_config` with a layout the "user" already saved in a prior session --
 * `SettingsProvider` only reads real data through this round trip, and the
 * fix under test is specifically about NOT rewriting it on a pane resize.
 */
function installFakeBridge(initialConfig: Record<string, unknown>): void {
  const handlers = new Set<(message: BridgeMessage) => void>();
  window.bridge = {
    send(command) {
      if (command.type !== "command") return;
      const { id, name } = command;
      queueMicrotask(() => {
        const result: BridgeMessage =
          name === "load_config"
            ? { type: "result", id, ok: true, data: initialConfig }
            : { type: "result", id, ok: true };
        handlers.forEach((h) => h(result));
      });
    },
    onMessage(cb) {
      handlers.add(cb);
      return () => handlers.delete(cb);
    },
    pickPath: async () => null,
    pickSavePath: async () => null,
    restartEngine: async () => {},
    setWindowBounds: async () => {},
  };
}

let latestSettings: Record<string, unknown> = {};

function SettingsProbe() {
  latestSettings = useAllSettings();
  return null;
}

const SECTIONS: SectionSpec[] = [
  { id: "player", element: <Card title="Player">p</Card> },
  { id: "demo", element: <Card title="Demo">d</Card> },
];

// The user's own placement from an earlier session: side by side, wider than
// the default 3-column card.
const STORED_PLAYER = { x: 0, y: 0, w: 6, h: 24 };
const STORED_DEMO = { x: 6, y: 0, w: 5, h: 24 };

describe("SectionList surviving a pane resize", () => {
  it("keeps the user's stored rectangle after the pane widens then narrows back", async () => {
    currentWidth = 1200;
    installFakeBridge({
      ui_sections: {
        t: { v: 3, cards: { player: STORED_PLAYER, demo: STORED_DEMO }, collapsed: [] },
      },
    });

    render(
      <SettingsProvider>
        <SectionList tabId="t" sections={SECTIONS} />
        <SettingsProbe />
      </SettingsProvider>,
    );
    await act(async () => {});

    // Narrow the pane drastically (as if the window shrank enough to force a
    // reflow), then restore it to the exact original width.
    resizePane(200);
    await act(async () => {});
    resizePane(1200);
    await act(async () => {});

    const after = (
      latestSettings.ui_sections as Record<string, { cards: Record<string, { x: number; y: number; w: number; h: number }> }>
    )?.t?.cards;
    expect(after.player).toEqual(STORED_PLAYER);
    expect(after.demo).toEqual(STORED_DEMO);
  });
});
