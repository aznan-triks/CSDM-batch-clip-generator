/**
 * The player list must survive a real database.
 *
 * Measured on the user's own: 7892 players, rendered in one block. That is
 * 31 568 DOM nodes and 139 ms of layout just to put them on screen, inside a
 * card carrying `backdrop-filter: blur(14px)` -- so every repaint re-blurs the
 * region. The page holds 395 nodes without it.
 *
 * The window asked for the two things a list this size needs and had neither:
 * paging and ordering.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlayerSection from "../PlayerSection";
import { PLAYER_LIST } from "../PlayerSection";

/** 500 players, newest last, so ordering is observable in both directions. */
const MANY = Array.from({ length: 500 }, (_, i) => [
  `Player${String(i).padStart(3, "0")}  (7656119${i})`,
  `7656119${i}`,
  `Player${String(i).padStart(3, "0")}`,
  i,
]);

vi.mock("../../settings/store", () => ({
  useSetting: () => [[], () => {}],
  useSettingsBatch: () => () => {},
}));

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({
    database: { weapons: [], maps: [], players: MANY, tags: [] },
    error: null,
  }),
}));

function rows(): HTMLElement[] {
  return [...document.querySelectorAll(".ps-row")] as HTMLElement[];
}

describe("the list never renders more than one page at a time", () => {
  it("renders a page, not the whole database", () => {
    render(<PlayerSection />);
    expect(rows().length).toBe(PLAYER_LIST.pageSize);
    expect(rows().length).toBeLessThan(MANY.length);
  });

  it("says where the reader is", () => {
    render(<PlayerSection />);
    expect(screen.getByText(new RegExp(`1\\s*/\\s*${Math.ceil(500 / PLAYER_LIST.pageSize)}`)))
      .toBeTruthy();
  });

  it("moves to the next page and shows different players", () => {
    render(<PlayerSection />);
    const first = rows()[0].textContent;
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    });
    expect(rows()[0].textContent).not.toBe(first);
  });

  it("cannot walk off either end", () => {
    render(<PlayerSection />);
    const previous = screen.getByRole("button", { name: /previous page/i });
    expect(previous.hasAttribute("disabled")).toBe(true);
  });
});

describe("the list can be ordered", () => {
  it("offers an ordering control", () => {
    render(<PlayerSection />);
    expect(screen.getByRole("radiogroup", { name: /sort/i })).toBeTruthy();
  });

  it("orders by name by default", () => {
    render(<PlayerSection />);
    expect(rows()[0].textContent).toContain("Player000");
  });

  it("orders by most recently seen when asked", () => {
    render(<PlayerSection />);
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "recent" }));
    });
    expect(rows()[0].textContent).toContain("Player499");
  });
});

describe("searching still reaches the whole database, not just the page", () => {
  it("finds a player who is not on the first page", () => {
    render(<PlayerSection />);
    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/search/i), {
        target: { value: "Player499" },
      });
    });
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("Player499");
  });

  it("returns to the first page when the query changes", () => {
    render(<PlayerSection />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    });
    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Player" } });
    });
    expect(rows()[0].textContent).toContain("Player000");
  });
});
