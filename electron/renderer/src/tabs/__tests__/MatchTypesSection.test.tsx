/**
 * The MATCH TYPES section.
 *
 * `connect_db` never resolves in `renderTab()`: the section must grey its
 * boxes out rather than hide them while waiting, so the tests never need it
 * to answer.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import MatchTypesSection from "../MatchTypesSection";

const FILTERS_FIXTURE = {
  filters: [],
  match_types: [
    { key: "match_type_premier", label: "Premier" },
    { key: "match_type_competitive", label: "Competitive" },
    { key: "match_type_casual", label: "Casual" },
    { key: "match_type_wingman", label: "Wingman" },
  ],
  weapon_categories: {},
  resolutions: [],
  framerates: [],
  video_codecs: [],
  audio_codecs: [],
};

vi.mock("../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "describe_filters") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: FILTERS_FIXTURE });
    }
    if (name === "connect_db") {
      // Never resolves: exercises the "still waiting for the database" state.
      return new Promise(() => {});
    }
    return Promise.reject(new Error(`unexpected command: ${name}`));
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

async function renderTab() {
  const rendered = render(
    <SettingsProvider>
      <MatchTypesSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("MatchTypesSection", () => {
  it("builds one box per match type, in the table's order", async () => {
    const { container } = await renderTab();
    // Scoped to the grid: the section's own master switch
    // (`match_type_filter_enabled`) also carries a `data-config-key` and
    // would otherwise pollute this list.
    const grid = container.querySelector(".mt-grid") as HTMLElement;
    const keys = [...grid.querySelectorAll("[data-config-key]")].map((n) =>
      n.getAttribute("data-config-key"),
    );
    expect(keys).toEqual(FILTERS_FIXTURE.match_types.map((m) => m.key));
  });

  it("greys the boxes out until the database answers", async () => {
    // The window shows them disabled rather than hiding them: a hidden filter
    // reads as a filter that does not exist.
    await renderTab();
    expect(screen.getByRole("button", { name: /Premier/ }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});
