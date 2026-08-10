/**
 * Active players render as removable chips instead of the old
 * "Active: {name} (+X more)" text, which truncated past the first player and
 * never showed who else was selected.
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

function activeChips(): HTMLElement[] {
  return [...document.querySelectorAll(".ps-active-chips .chip")] as HTMLElement[];
}

describe("active players render as chips", () => {
  beforeEach(() => {
    store.state.saved = [];
    store.state.active = [];
  });

  it("shows the empty-state text when nobody is active", () => {
    render(<PlayerSection />);
    expect(screen.getByText(/No active player -- pick one below/)).toBeTruthy();
    expect(activeChips().length).toBe(0);
  });

  it("renders one chip per active player, by name", () => {
    store.state.active = ["7656119abc", "7656119def"];
    render(<PlayerSection />);
    expect(activeChips().length).toBe(2);
    expect(activeChips()[0].textContent).toContain("Alpha");
    expect(activeChips()[1].textContent).toContain("Beta");
  });

  it("falls back to the raw Steam ID when the player is not in the current rows", () => {
    store.state.active = ["7656119999"];
    render(<PlayerSection />);
    expect(activeChips()[0].textContent).toContain("7656119999");
  });

  it("clicking an active chip deactivates that player", () => {
    store.state.active = ["7656119abc", "7656119def"];
    render(<PlayerSection />);
    fireEvent.click(activeChips()[0]);
    expect(store.state.active).toEqual(["7656119def"]);
  });
});
