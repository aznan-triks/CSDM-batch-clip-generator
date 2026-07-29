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
import { render, screen } from "@testing-library/react";
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
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  it("opens on Capture", () => {
    renderShell();
    const capture = screen.getByRole("button", { name: /capture/i });
    expect(capture.getAttribute("aria-current")).toBe("true");
  });

  it("keeps the log console in the tree at every width", () => {
    // The narrow layout hides the console with CSS, never by unmounting it:
    // an unmounted console loses every line already written.
    renderShell();
    expect(document.querySelector(".shell-logs")).not.toBeNull();
  });

  it("mounts without a bridge instead of blanking the page", () => {
    expect(() => renderShell()).not.toThrow();
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
    };
    renderShell();
    expect(sent.some((c) => (c as { name?: string }).name === "hello")).toBe(true);
  });
});
