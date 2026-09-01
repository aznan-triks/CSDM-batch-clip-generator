/**
 * A finished preview must lead the user to its clips, and the clips must be
 * clickable.
 *
 * The two halves of the same report: "I ran a plain preview, it did not work".
 * The engine had in fact done everything -- `preview_ready` in 137 ms with a
 * full payload -- but the window stayed on CAPTURE, so nothing on screen said
 * so; and once on EDITING, clicking a clip did nothing because the toggle was
 * a command the engine never implemented
 * (AUDIT_retours_ui_8_points.md, ecarts E2 and E3).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEngineState } from "../../motion/engineStore";
import { SettingsProvider } from "../../settings/store";
import AppShell from "../AppShell";

/** The subscribers currently listening on the fake pipe. */
let subscribers: Set<(message: unknown) => void>;

function installPipe() {
  subscribers = new Set();
  window.bridge = {
    send() {},
    onMessage(cb: (message: unknown) => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  } as unknown as typeof window.bridge;
}

function deliver(message: unknown) {
  act(() => {
    for (const cb of [...subscribers]) cb(message);
  });
}

/** A `preview_ready` payload holding `count` clips. */
function previewReady(count: number) {
  return {
    type: "state",
    name: "preview_ready",
    payload: {
      sequences: {
        "C:/demos/a.dem": Array.from({ length: count }, (_, i) => ({
          start_tick: 1000 * (i + 1),
          end_tick: 1000 * (i + 1) + 640,
          event_type: "kill",
          events: [{ type: "kill", killer_sid: "76561198000000001" }],
        })),
      },
      cfg: { tickrate: 64 },
    },
  };
}

function renderShell(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
  return render(tree);
}

beforeEach(() => {
  resetEngineState();
  installPipe();
});

afterEach(() => {
  resetEngineState();
});

describe("after a preview", () => {
  it("opens the clip list without the user having to find it", () => {
    renderShell();
    expect(screen.getByRole("tab", { name: /capture/i }).getAttribute("aria-current")).toBe("true");

    deliver(previewReady(3));

    expect(screen.getByRole("tab", { name: /editing/i }).getAttribute("aria-current")).toBe("true");
  });

  it("stays put when the preview matched nothing", () => {
    // An empty checklist explains nothing. The filters that produced nothing
    // are what the user needs to see.
    renderShell();
    deliver(previewReady(0));
    expect(screen.getByRole("tab", { name: /capture/i }).getAttribute("aria-current")).toBe("true");
  });

  it("does not drag the user back after they have navigated away", () => {
    renderShell();
    deliver(previewReady(2));
    fireEvent.click(screen.getByRole("tab", { name: /video/i }));
    expect(screen.getByRole("tab", { name: /video/i }).getAttribute("aria-current")).toBe("true");

    // Any unrelated engine event re-renders the shell. `previewReady` is still
    // true, and switching on its VALUE rather than its rising edge would steal
    // the tab back here.
    deliver({ type: "state", name: "progress", payload: { text: "still here" } });

    expect(screen.getByRole("tab", { name: /video/i }).getAttribute("aria-current")).toBe("true");
  });

  it("opens the list again for the next preview", () => {
    renderShell();
    deliver(previewReady(2));
    fireEvent.click(screen.getByRole("tab", { name: /capture/i }));
    deliver(previewReady(5));
    expect(screen.getByRole("tab", { name: /editing/i }).getAttribute("aria-current")).toBe("true");
  });
});

describe("the clip checklist", () => {
  it("includes every clip to begin with", () => {
    renderShell();
    deliver(previewReady(3));
    expect(document.querySelectorAll(".editing-clip.selected")).toHaveLength(3);
    expect(document.querySelector(".editing-header")?.textContent).toContain("3");
  });

  it("excludes the clip that was clicked, and only that one", () => {
    renderShell();
    deliver(previewReady(3));
    const rows = document.querySelectorAll(".editing-clip");

    fireEvent.click(rows[1]);

    expect(rows[0].className).toContain("selected");
    expect(rows[1].className).not.toContain("selected");
    expect(rows[2].className).toContain("selected");
  });

  it("puts the clip back on a second click", () => {
    renderShell();
    deliver(previewReady(2));
    const row = document.querySelectorAll(".editing-clip")[0];
    fireEvent.click(row);
    fireEvent.click(row);
    expect(row.className).toContain("selected");
  });

  it("counts what is left included", () => {
    renderShell();
    deliver(previewReady(3));
    fireEvent.click(document.querySelectorAll(".editing-clip")[0]);
    expect(document.querySelector(".editing-header")?.textContent).toContain("2 of 3");
  });
});

describe("the editing badge", () => {
  it("goes out once the tab has been opened, with no engine round trip", () => {
    renderShell();
    deliver(previewReady(2));
    // Landing on the tab is what marks it seen; the switch above already did it.
    const editingTab = screen.getByRole("tab", { name: /editing/i });
    expect(editingTab.querySelector(".badge, .dot, [data-badge]")).toBeNull();
  });
});
