/**
 * The ★ Registered Accounts section (Section D): chips of saved players at the
 * top of the Player card, persisted under the `saved_players` config key.
 *
 * The store is mocked as a live object so that both the read side
 * (`useSetting`) and the write side (`setSavedPlayers` / `setMany`) round-trip
 * through the same state -- the same contract the real store provides, without
 * its debounce or the bridge.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlayerSection from "../PlayerSection";

const PLAYERS = [
  ["Alpha  (7656119abc)", "7656119abc", "Alpha", 1],
  ["Beta  (7656119def)", "7656119def", "Beta", 2],
] as const;

const store = vi.hoisted(() => ({
  state: { saved: [] as { steam_id: string; name: string }[], active: [] as string[] },
  listeners: new Set<() => void>(),
  emit: () => store.listeners.forEach((fn) => fn()),
}));

vi.mock("../../settings/store", () => {
  // Real `useState`/`useEffect`: the mocked setters must trigger a React
  // re-render, or the tree would stay stale after a register/remove/drag.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useEffect, useState } = require("react");
  return {
    useSetting: (key: string) => {
      const read = () =>
        key === "saved_players" ? store.state.saved : key === "steam_ids" ? store.state.active : undefined;
      const [value, setValue] = useState(read());
      useEffect(() => {
        const handler = () => setValue(read());
        store.listeners.add(handler);
        return () => store.listeners.delete(handler);
      }, [key]);
      const setter = (next: unknown) => {
        if (key === "saved_players") store.state.saved = next as { steam_id: string; name: string }[];
        if (key === "steam_ids") store.state.active = next as string[];
        setValue(next);
        store.emit();
      };
      return [value, setter];
    },
    useSettingsBatch: () => (changes: Record<string, unknown>) => {
      if (Array.isArray(changes.steam_ids)) {
        store.state.active = changes.steam_ids as string[];
        store.emit();
      }
    },
  };
});

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({
    database: { weapons: [], maps: [], players: PLAYERS, tags: [] },
    error: null,
  }),
}));

/**
 * The player chips, WITHOUT the remove button that now sits beside each one.
 *
 * Since 2026-09-01 a registered account is a `.chip-pair`: the name chip and a
 * separate `.close-btn`, rather than a `role="button"` span positioned on top
 * of the chip (a control inside a control). Both carry `.chip`, so a bare
 * `.chip` query counts two per player.
 */
function chips(): HTMLElement[] {
  return [
    ...document.querySelectorAll(".ps-registered .chip:not(.close-btn)"),
  ] as HTMLElement[];
}

describe("the ★ Registered Accounts section", () => {
  beforeEach(() => {
    store.state.saved = [];
    store.state.active = [];
  });

  it("starts empty and says so", () => {
    render(<PlayerSection />);
    expect(screen.getByText(/None\. Select a player below/)).toBeTruthy();
    expect(screen.getByText(/0 registered/)).toBeTruthy();
    expect(chips().length).toBe(0);
  });

  it("registers a player from the ★ on their row", () => {
    render(<PlayerSection />);
    // Both rows start unregistered, so "Add to accounts" is ambiguous -- pick
    // the ★ that sits in the Alpha row.
    const alphaRow = [...document.querySelectorAll<HTMLElement>(".ps-row")].find((r) =>
      r.textContent.includes("Alpha"),
    )!;
    fireEvent.click(alphaRow.querySelector<HTMLElement>(".ps-star")!);
    expect(chips().length).toBe(1);
    expect(chips()[0].textContent).toContain("Alpha");
    expect(screen.getByText(/1 registered/)).toBeTruthy();
    expect(store.state.saved).toEqual([{ steam_id: "7656119abc", name: "Alpha" }]);
  });

  it("clicking a registered chip toggles that account active (steam_ids)", () => {
    store.state.saved = [{ steam_id: "7656119abc", name: "Alpha" }];
    render(<PlayerSection />);
    let chip = chips()[0];
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    chip = chips()[0];
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(store.state.active).toContain("7656119abc");
    fireEvent.click(chip);
    expect(store.state.active).not.toContain("7656119abc");
  });

  it("the × on a registered chip removes it from the saved accounts", () => {
    store.state.saved = [
      { steam_id: "7656119abc", name: "Alpha" },
      { steam_id: "7656119def", name: "Beta" },
    ];
    render(<PlayerSection />);
    expect(chips().length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /unregister alpha/i }));
    expect(chips().length).toBe(1);
    expect(chips()[0].textContent).toContain("Beta");
    expect(store.state.saved).toEqual([{ steam_id: "7656119def", name: "Beta" }]);
  });

  it("the ★ on a registered player is filled, and clicking it unregisters", () => {
    store.state.saved = [{ steam_id: "7656119abc", name: "Alpha" }];
    render(<PlayerSection />);
    const star = screen.getByRole("button", { name: /remove from accounts/i });
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.textContent).toContain("★");
    fireEvent.click(star);
    expect(chips().length).toBe(0);
    expect(store.state.saved).toEqual([]);
  });

  it("drag reorders the registered accounts and persists the new order", () => {
    store.state.saved = [
      { steam_id: "7656119abc", name: "Alpha" },
      { steam_id: "7656119def", name: "Beta" },
    ];
    render(<PlayerSection />);
    expect(chips()[0].textContent).toContain("Alpha");

    // Grab Alpha (index 0), hover it over Beta (index 1), release.
    fireEvent.mouseDown(chips()[0]);
    fireEvent.mouseMove(chips()[1]);
    fireEvent.mouseUp(chips()[1]);

    expect(chips()[0].textContent).toContain("Beta");
    expect(chips()[1].textContent).toContain("Alpha");
    expect(store.state.saved.map((p) => p.name)).toEqual(["Beta", "Alpha"]);
  });
});
