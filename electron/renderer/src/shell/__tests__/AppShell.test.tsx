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
    // The narrow layout hides the console with CSS, never by unmounting it:
    // an unmounted console loses every line already written.
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
    let deliver: ((message: unknown) => void) | null = null;
    window.bridge = {
      send() {},
      onMessage(cb: (message: unknown) => void) {
        deliver = cb;
        return () => {};
      },
    } as unknown as typeof window.bridge;

    renderShell();
    act(() => {
      deliver?.({ type: "state", name: "progress", payload: { text: "demo 2/7" } });
      deliver?.({ type: "state", name: "summary", payload: { text: "12 clips" } });
    });

    expect(screen.getByText("demo 2/7")).toBeTruthy();
    expect(screen.getByText("12 clips")).toBeTruthy();
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
    };
    renderShell();
    expect(sent.some((c) => (c as { name?: string }).name === "hello")).toBe(true);
  });
});
