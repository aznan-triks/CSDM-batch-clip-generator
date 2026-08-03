/**
 * One filter row carries three boxes, and dropping one of them is a silent
 * data bug: a row built by hand once lost its Exclude box (v207, FERRARI
 * PEEK) and nobody noticed until clips went missing.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FilterRow from "../FilterRow";
import { SettingsProvider } from "../store";

const DEF = {
  key: "kill_mod_wall_bang",
  label: "WALLBANG:",
  tip: "Kill through a wall.",
  category: "mods" as const,
  hidden: false,
};

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: {} }),
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderRow() {
  const rendered = render(
    <SettingsProvider>
      <FilterRow def={DEF} />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("FilterRow", () => {
  it("carries Enable, Must and Exclude", async () => {
    await renderRow();
    expect(screen.getByRole("button", { name: /^Enable$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Must/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Exclude/ })).toBeTruthy();
  });

  it("marks all three keys for the coverage guard", async () => {
    const { container } = await renderRow();
    for (const suffix of ["", "_req", "_exclude"]) {
      expect(
        container.querySelector(`[data-config-key="kill_mod_wall_bang${suffix}"]`),
      ).not.toBeNull();
    }
  });

  it("drops Must when Enable is switched off", async () => {
    await renderRow();
    const enable = screen.getByRole("button", { name: /^Enable$/ });
    const must = screen.getByRole("button", { name: /Must/ });

    act(() => enable.click());
    act(() => must.click());
    expect(must.getAttribute("aria-pressed")).toBe("true");

    act(() => enable.click());
    expect(must.getAttribute("aria-pressed")).toBe("false");
  });

  it("arms Must on its own and auto-enables the filter", async () => {
    // `_wire_enable_must`: Enable is not a prerequisite for ★ Must — clicking
    // Must arms it and switches Enable on by itself.
    await renderRow();
    const enable = screen.getByRole("button", { name: /^Enable$/ });
    const must = screen.getByRole("button", { name: /Must/ });

    act(() => must.click());
    expect(must.getAttribute("aria-pressed")).toBe("true");
    expect(enable.getAttribute("aria-pressed")).toBe("true");
  });

  it("omits a box whose key does not exist", async () => {
    // `kill_mod_trois_tap_exclude` is not a real DEFAULT_CONFIG key.
    const { container } = render(
      <SettingsProvider>
        <FilterRow def={{ ...DEF, key: "kill_mod_trois_tap" }} hasExclude={false} />
      </SettingsProvider>,
    );
    await act(async () => {});
    expect(container.querySelector('[data-config-key$="_exclude"]')).toBeNull();
  });

  it("omits a box the ledger marks as never shown", async () => {
    // `kill_mod_high_velocity_exclude` exists in DEFAULT_CONFIG but the
    // window never built a box for it. Showing it here would make a
    // coverage-ledger.ts entry stale.
    const { container } = render(
      <SettingsProvider>
        <FilterRow def={{ ...DEF, key: "kill_mod_high_velocity" }} hasExclude={false} />
      </SettingsProvider>,
    );
    await act(async () => {});
    expect(
      container.querySelector('[data-config-key="kill_mod_high_velocity_exclude"]'),
    ).toBeNull();
  });
});
