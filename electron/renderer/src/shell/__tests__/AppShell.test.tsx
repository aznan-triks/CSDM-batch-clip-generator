/**
 * The shell must mount, show its four tabs, and switch between them.
 *
 * It is rendered with no `window.bridge`: outside Electron the pipe is absent,
 * and the shell has to stay usable rather than blank the page -- the failure
 * mode `bridge.ts` already documents.
 *
 * The shell is always mounted inside `SettingsProvider`, as App.tsx does: the
 * Capture tab reads real configuration keys, and a shell rendered bare would
 * be testing a tree the application never builds.
 */
import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "../../settings/store";
import AppShell from "../AppShell";

/** Render the shell the way the application does. */
function renderShell(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
  return render(tree);
}

describe("AppShell", () => {
  beforeEach(() => {
    // @ts-expect-error -- deliberately absent, as in a plain browser tab.
    delete window.bridge;
  });

  it("shows the four tabs", () => {
    renderShell();
    for (const label of ["CAPTURE", "TAGS", "VIDEO", "SETTINGS"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  it("opens on Capture", () => {
    renderShell();
    const capture = screen.getByRole("tab", { name: /capture/i });
    expect(capture.getAttribute("aria-current")).toBe("true");
  });

  it("keeps the log console in the tree at every width", () => {
    // The narrow layout stacks the console below the workspace with CSS,
    // never by unmounting it: an unmounted console loses every line already
    // written.
    renderShell();
    expect(document.querySelector(".console")).not.toBeNull();
  });

  it("mounts without a bridge instead of blanking the page", () => {
    expect(() => renderShell()).not.toThrow();
  });

  // The progress and summary lines used to be rendered by ActionBar. They are
  // the weapon row's now (the mock's `.wband`), and the shell is what wires the
  // engine's own events into it -- so this is where that wiring is proved.
  it("feeds the engine's progress and summary lines into the weapon row", () => {
    // The real preload bridge (`electron/preload.js`) is `ipcRenderer.on`,
    // which keeps one listener per subscriber -- every independent
    // `useEngineState()` call (AppShell, StatStrip, ActionBar, EditingTab)
    // gets its own and all of them hear every message. A single `deliver`
    // slot here would silently drop every subscriber but the last one,
    // making the test's outcome depend on incidental effect-mount order
    // instead of on the wiring this test means to prove.
    const subscribers = new Set<(message: unknown) => void>();
    window.bridge = {
      send() {},
      onMessage(cb: (message: unknown) => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    } as unknown as typeof window.bridge;
    const deliver = (message: unknown) => subscribers.forEach((cb) => cb(message));

    const { container } = renderShell();
    act(() => {
      deliver({ type: "state", name: "progress", payload: { text: "demo 2/7" } });
      deliver({ type: "state", name: "summary", payload: { text: "12 clips" } });
    });

    // Scoped to the weapon row itself: with every subscriber correctly wired
    // (see above), LogConsole legitimately narrates the same progress line
    // into the console, so a document-wide query would be ambiguous even
    // though both readings are correct -- this test's own claim is about the
    // weapon row specifically.
    const band = container.querySelector(".wband");
    expect(band?.querySelector(".band-status")?.textContent).toBe("demo 2/7");
    expect(band?.querySelector(".band-counter")?.textContent).toBe("12 clips");
  });

  it("greets the engine on mount so the console is never blank", () => {
    // The engine volunteers nothing at start-up: without this the console
    // shows one bare `[result]` line and reads as broken. The greeting has to
    // leave AFTER the console has subscribed, which child-first effect order
    // guarantees -- LogConsole is mounted below this component.
    const sent: unknown[] = [];
    window.bridge = {
      send(command) {
        sent.push(command);
      },
      onMessage() {
        return () => {};
      },
      pickPath() {
        return Promise.resolve(null);
      },
      pickSavePath() {
        return Promise.resolve(null);
      },
      restartEngine() {
        return Promise.resolve();
      },
    };
    renderShell();
    expect(sent.some((c) => (c as { name?: string }).name === "hello")).toBe(true);
  });
});
