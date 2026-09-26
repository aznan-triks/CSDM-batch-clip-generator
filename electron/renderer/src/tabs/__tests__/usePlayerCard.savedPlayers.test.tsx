/**
 * Favourites (`saved_players`) written from a stale render must not erase
 * each other: every write goes through the real store as an updater.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import { usePlayerCard } from "../player/usePlayerCard";

const disk = vi.hoisted(() => ({ saved: null as Record<string, unknown> | null }));

vi.mock("../../bridge", () => ({
  runCommand: (name: string, payload?: { cfg: Record<string, unknown> }) => {
    if (name === "save_config") disk.saved = payload?.cfg ?? null;
    return Promise.resolve({
      type: "result",
      id: "1",
      ok: true,
      data: { saved_players: [{ steam_id: "1", name: "Alpha" }, { steam_id: "2", name: "Beta" }] },
    });
  },
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({ database: { weapons: [], maps: [], players: [], tags: [] }, error: null }),
}));

const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;

async function mount() {
  const hook = renderHook(() => usePlayerCard(), { wrapper });
  await act(async () => {});
  return hook;
}

describe("usePlayerCard favourites", () => {
  it("two stars from the same render both stick", async () => {
    const { result } = await mount();
    const model = result.current; // one render's closures, used twice
    act(() => {
      model.toggleRegister("3", "Gamma");
      model.toggleRegister("4", "Delta");
    });
    expect(result.current.saved.map((p) => p.steam_id)).toEqual(["1", "2", "3", "4"]);
  });

  it("a star and a removal from the same render both stick", async () => {
    const { result } = await mount();
    const model = result.current;
    act(() => {
      model.toggleRegister("3", "Gamma");
      model.removeSaved("1");
    });
    expect(result.current.saved.map((p) => p.steam_id)).toEqual(["2", "3"]);
  });

  it("a drag reorders the latest list, not the one it started from", async () => {
    const { result } = await mount();
    act(() => result.current.drag.down(0));
    act(() => result.current.drag.over(1));
    const model = result.current;
    act(() => {
      model.toggleRegister("3", "Gamma");
      model.drag.up();
    });
    expect(result.current.saved.map((p) => p.steam_id)).toEqual(["2", "1", "3"]);
  });

  it("the saved file carries the favourites", async () => {
    vi.useFakeTimers();
    try {
      const { result } = await mount();
      act(() => result.current.toggleRegister("3", "Gamma"));
      await act(async () => {
        vi.runAllTimers();
      });
      expect((disk.saved?.saved_players as { steam_id: string }[]).map((p) => p.steam_id)).toEqual(["1", "2", "3"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
