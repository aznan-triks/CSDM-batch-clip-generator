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

vi.mock("../../bridge", () => ({
  // A configuration with the window's defaults, so the tab opens on `killer`
  // exactly as the application does. `describe_filters` also goes through
  // `runCommand`, now that the tab mounts KillFiltersSection: an empty table
  // set is enough here, since this file tests the tab's own conditional
  // rows, not the filter rows themselves.
  runCommand: (command: string) => {
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

  it("refuses to arm Must while Mate POV is off", async () => {
    await renderTab();
    choosePerspective("victim");
    const must = screen.getByRole("button", { name: /Must/ });

    act(() => must.click());
    expect(must.getAttribute("aria-pressed")).toBe("false");
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
});
