/**
 * Settings > UI Theme > Per-card style: every styled card listed, each row
 * writing only its own entry of `ui_card_style_overrides`, live for the card.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider, useAllSettings } from "../../../settings/store";
import CardStyleOverrides from "../CardStyleOverrides";
import { STYLED_CARDS } from "../styledCards";
import { useCardStyle } from "../useCardStyle";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));

vi.mock("../../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: initial.config }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

let store: Record<string, unknown> = {};
function Probe() {
  store = useAllSettings();
  return null;
}

function StyleOf({ id }: { id: string }) {
  return <span data-testid={`style-of-${id}`}>{useCardStyle(id)}</span>;
}

async function renderList(config: Record<string, unknown>) {
  initial.config = config;
  const rendered = render(
    <SettingsProvider>
      <CardStyleOverrides globalStyle="timeline" />
      <StyleOf id="map-filter" />
      <Probe />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("Per-card style", () => {
  it("lists every styled card, including the ten CAPTURE cards", async () => {
    await renderList({ ui_card_style: "timeline", ui_card_style_overrides: {} });
    for (const card of STYLED_CARDS) expect(screen.getByLabelText(card.title)).toBeTruthy();
    expect(STYLED_CARDS.map((c) => c.id)).toEqual([
      "player",
      "demo-selection",
      "weapon-filter",
      "capture-timing",
      "timing-retries",
      "kill-filters",
      "damage-filters",
      "shot-filters",
      "match-types",
      "map-filter",
    ]);
  });

  it("pins one card, live, and Default removes the pin", async () => {
    await renderList({ ui_card_style: "timeline", ui_card_style_overrides: { player: "tiles" } });
    expect(screen.getByTestId("style-of-map-filter").textContent).toBe("timeline");

    fireEvent.change(screen.getByLabelText("Map Filter"), { target: { value: "sentence" } });
    expect(store.ui_card_style_overrides).toEqual({ player: "tiles", "map-filter": "sentence" });
    expect(screen.getByTestId("style-of-map-filter").textContent).toBe("sentence");

    fireEvent.change(screen.getByLabelText("Map Filter"), { target: { value: "default" } });
    expect(store.ui_card_style_overrides).toEqual({ player: "tiles" });
    expect(screen.getByTestId("style-of-map-filter").textContent).toBe("timeline");
  });

  it("ignores an unknown stored style", async () => {
    await renderList({ ui_card_style: "sentence", ui_card_style_overrides: { "map-filter": "bogus" } });
    expect(screen.getByTestId("style-of-map-filter").textContent).toBe("sentence");
    expect((screen.getByLabelText("Map Filter") as HTMLSelectElement).value).toBe("default");
  });
});
