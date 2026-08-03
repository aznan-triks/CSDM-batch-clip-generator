/**
 * The Capture tab's conditional rows, which are the window's own rules.
 *
 * These are the rules no coverage count can check: a control can be mounted
 * and still appear in the wrong state. Each test names the rule it guards.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import CaptureTab from "../CaptureTab";

// `vi.hoisted` because `vi.mock` factories run before this file's own
// top-level code, so a plain module-scope object declared below would not
// exist yet when the factory closes over it.
const callCounts = vi.hoisted(() => ({ describe_filters: 0, connect_db: 0 }));

vi.mock("../../bridge", () => ({
  // A configuration with the window's defaults, so the tab opens on `killer`
  // exactly as the application does. `describe_filters` also goes through
  // `runCommand`, now that the tab mounts KillFiltersSection: an empty table
  // set is enough here, since this file tests the tab's own conditional
  // rows, not the filter rows themselves.
  runCommand: (command: string) => {
    if (command === "describe_filters" || command === "connect_db") {
      callCounts[command] += 1;
    }
    if (command === "describe_filters") {
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: {
          filters: [],
          match_types: [],
          weapon_categories: {},
          resolutions: [],
          framerates: [],
          video_codecs: [],
          audio_codecs: [],
        },
      });
    }
    return Promise.resolve({
      type: "result",
      id: "1",
      ok: true,
      data: { perspective: "killer", events: ["Kills"], before: 3, after: 5, victim_pre_s: 2 },
    });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

/**
 * Render, then let the configuration actually arrive.
 *
 * The store loads over the pipe, so a plain `render` returns while `settings`
 * is still the empty object. Reading the tree at that moment measures the
 * loading state, not the tab -- which is how the two value-reading tests
 * below first failed.
 */
async function renderTab() {
  const rendered = render(
    <SettingsProvider>
      <CaptureTab />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

function choosePerspective(value: string) {
  act(() => {
    screen.getByRole("radio", { name: value }).click();
  });
}

function keyOnScreen(container: HTMLElement, key: string): boolean {
  return container.querySelector(`[data-config-key="${key}"]`) !== null;
}

describe("CaptureTab bridge traffic", () => {
  it("fetches the static tables and the database exactly once for the whole tab", async () => {
    // `KillFiltersSection`, `MatchTypesSection`, `WeaponFilterSection` all
    // call `useTables()`, and `MatchTypesSection`, `WeaponFilterSection`,
    // `MapFilterSection`, `PlayerSection` all call `useDatabase()`. Before
    // `TablesProvider`/`DatabaseProvider` existed, mounting the tab fired one
    // `describe_filters` and one `connect_db` PER consumer -- each spawning
    // its own Python thread against shared, unlocked host state. This is the
    // count that must stay at exactly one no matter how many sections read
    // the hooks.
    callCounts.describe_filters = 0;
    callCounts.connect_db = 0;
    await renderTab();
    expect(callCounts.describe_filters).toBe(1);
    expect(callCounts.connect_db).toBe(1);
  });
});

describe("CaptureTab conditional rows", () => {
  it("hides the switch delay outside `both` perspective", async () => {
    // Only `both` switches camera mid-clip, so only `both` has a delay to set.
    const { container } = await renderTab();
    expect(keyOnScreen(container, "victim_pre_s")).toBe(false);

    choosePerspective("victim");
    expect(keyOnScreen(container, "victim_pre_s")).toBe(false);

    choosePerspective("both");
    expect(keyOnScreen(container, "victim_pre_s")).toBe(true);
  });

  it("shows Mate POV in victim and both, never on the killer", async () => {
    const { container } = await renderTab();
    expect(keyOnScreen(container, "kill_mod_mate_pov")).toBe(false);

    choosePerspective("victim");
    expect(keyOnScreen(container, "kill_mod_mate_pov")).toBe(true);

    choosePerspective("both");
    expect(keyOnScreen(container, "kill_mod_mate_pov")).toBe(true);

    choosePerspective("killer");
    expect(keyOnScreen(container, "kill_mod_mate_pov")).toBe(false);
  });

  it("drops the Must box when Mate POV is switched off", async () => {
    // `_wire_enable_must`: a Must left armed under a disabled filter would
    // silently skip clips nobody asked to skip.
    await renderTab();
    choosePerspective("victim");

    const enable = screen.getByRole("button", { name: /^Enable$/ });
    const must = screen.getByRole("button", { name: /Must/ });

    act(() => enable.click());
    act(() => must.click());
    expect(must.getAttribute("aria-pressed")).toBe("true");

    act(() => enable.click());
    expect(must.getAttribute("aria-pressed")).toBe("false");
  });

  it("arms Must on its own and auto-enables Mate POV", async () => {
    // `_wire_enable_must`: Enable is not a prerequisite for ★ Must — clicking
    // Must arms it and switches Mate POV Enable on by itself.
    await renderTab();
    choosePerspective("victim");
    const enable = screen.getByRole("button", { name: /^Enable$/ });
    const must = screen.getByRole("button", { name: /Must/ });

    act(() => must.click());
    expect(must.getAttribute("aria-pressed")).toBe("true");
    expect(enable.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles an event kind without dropping the others", async () => {
    await renderTab();
    const deaths = screen.getByRole("button", { name: /DEATHS BY/ });
    const kills = screen.getByRole("button", { name: /^KILLS$/ });

    expect(kills.getAttribute("aria-pressed")).toBe("true");
    act(() => deaths.click());
    expect(deaths.getAttribute("aria-pressed")).toBe("true");
    expect(kills.getAttribute("aria-pressed")).toBe("true");
  });

  it("adds the switch delay to the before seconds in its readout", async () => {
    // The window shows "total before: BEFORE + switch delay"; the two are
    // added, never the larger of the two.
    await renderTab();
    choosePerspective("both");
    expect(screen.getByText(/total before: 5s/)).toBeTruthy();
  });

  it("keeps every field inside a row, never as a full-width block", async () => {
    // jsdom lays nothing out, so this asserts the STRUCTURE that produces the
    // width: the mock shares a row out with `.fld { flex: 1; min-width: 90px }`
    // and a field with no row to sit in stretches to the card instead -- one
    // reached 1246px, which is what made this tab read as a stack of banners.
    // The rendered widths are checked by the task's on-screen probe.
    const { container } = await renderTab();
    const orphans = [...container.querySelectorAll(".fld")].filter(
      (field) => field.closest(".row") === null,
    );
    expect(
      orphans.map((f) => f.id || f.className),
      "these fields sit outside a row and will stretch to the card's width",
    ).toEqual([]);
  });
});
