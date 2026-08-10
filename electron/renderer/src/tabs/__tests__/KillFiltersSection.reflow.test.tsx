/**
 * KILL FILTERS emits the shared reflow class names.
 *
 * A component that renders a class the stylesheets do not style fails in
 * total silence -- `Chip.tsx` wrote `chip-selected` where the mock styles
 * `.chip.on`, and the selected state was invisible on 27 places with every
 * test green (§10). So this asserts on the rendered DOM, never on the source
 * text, and names the exact strings reflowColumns.css defines.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import KillFiltersSection from "../KillFiltersSection";

vi.mock("../../settings/store", () => ({
  useSetting: () => [undefined, vi.fn()],
  useSettingsBatch: () => vi.fn(),
}));

vi.mock("../../settings/useTables", () => ({
  useTables: () => ({
    tables: {
      filters: [
        { key: "kill_mod_flick", label: "FLICK", category: "mods", tip: "", hidden: false },
        { key: "kill_mod_wallbang", label: "WALLBANG", category: "dp2", tip: "", hidden: false },
      ],
    },
  }),
}));

describe("KILL FILTERS adopts the shared reflow rule", () => {
  it("marks every filter group as a reflow container", () => {
    const { container } = render(<KillFiltersSection />);
    const groups = container.querySelectorAll(".kf-group");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.classList.contains("reflow-columns")).toBe(true);
    }
  });

  it("marks every group heading as a spanning header", () => {
    const { container } = render(<KillFiltersSection />);
    const groups = container.querySelectorAll(".kf-group");
    for (const group of groups) {
      const heading = group.querySelector(".reflow-columns-header");
      expect(heading).not.toBeNull();
      // The heading keeps the window's own label styling as well.
      expect(heading?.classList.contains("lab")).toBe(true);
    }
  });

  it("still renders every filter row inside its group", () => {
    render(<KillFiltersSection />);
    expect(screen.getByText("FLICK")).toBeTruthy();
    expect(screen.getByText("WALLBANG")).toBeTruthy();
  });
});
