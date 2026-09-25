/**
 * Timing & Retries in its three styles: every key reachable and written in
 * each, numbers stored as numbers, the style read live.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CARD_STYLES } from "../../../components/cardstyle/cardStyle";
import { openPopovers, operate, renderCard, store } from "../../../components/cardstyle/__tests__/smallCardHarness";
import TimingRetriesCard from "../TimingRetriesCard";

const initial = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));

vi.mock("../../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: initial.config }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

const CARD_KEYS = ["retry_count", "retry_delay", "recording_timeout", "delay_between_demos", "clip_order"] as const;

const DEFAULTS = {
  retry_count: 2,
  retry_delay: 15,
  recording_timeout: 0,
  delay_between_demos: 3,
  clip_order: "chrono",
};

async function render(config: Record<string, unknown>) {
  initial.config = config;
  return renderCard(<TimingRetriesCard />);
}

describe.each(CARD_STYLES)("Timing & Retries, %s style", (style) => {
  it.each(CARD_KEYS)("reaches %s and writes that key", async (key) => {
    const { container } = await render({ ...DEFAULTS, ui_card_style: style });
    expect(container.querySelector(`.tr-${style}`)).not.toBeNull();
    openPopovers(container);
    const wrapper = container.querySelector(`[data-config-key="${key}"]`);
    expect(wrapper, `${key} has no control in the ${style} style`).not.toBeNull();
    const before = JSON.stringify(store.current[key]);
    operate(wrapper!);
    expect(JSON.stringify(store.current[key]), `${key} was not written`).not.toBe(before);
  });

  it("keeps the wait reachable with no retry", async () => {
    const { container } = await render({ ...DEFAULTS, retry_count: 0, ui_card_style: style });
    openPopovers(container);
    expect(container.querySelector('[data-config-key="retry_delay"]')).not.toBeNull();
  });

  it("keeps every tooltip", async () => {
    const { container } = await render({ ...DEFAULTS, ui_card_style: style });
    openPopovers(container);
    const tips = [...container.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join("\n");
    for (const phrase of ["Extra attempts", "before each retry", "stopped and retried", "between two demos", "Order in which demos"]) {
      expect(tips, `${phrase} tooltip missing in ${style}`).toContain(phrase);
    }
  });
});

describe("Timing & Retries numbers", () => {
  it("stores a typed count as a number, never negative, and says so", async () => {
    // The batch loop did `1 + retry_count`: a typed "4" crashed the run.
    const { container } = await render({ ...DEFAULTS, retry_count: "3", ui_card_style: "timeline" });
    openPopovers(container);
    const box = document.getElementById("tr-retry_count") as HTMLInputElement;
    expect(box.value).toBe("3");
    fireEvent.change(box, { target: { value: "4" } });
    expect(store.current.retry_count).toBe(4);
    expect(screen.getByTestId("pacing-summary").textContent).toContain("tried again up to 4 times, 15s apart");
    fireEvent.change(box, { target: { value: "-2" } });
    expect(store.current.retry_count).toBe(0);
    expect(screen.getByTestId("pacing-summary").textContent).toContain("is not tried again");
  });

  it("lets a stored value past the drag range stay as it is", async () => {
    await render({ ...DEFAULTS, retry_delay: 300, ui_card_style: "tiles" });
    const slider = screen.getByRole("slider", { name: "Wait between" });
    expect(slider.getAttribute("aria-valuemax")).toBe("300");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(store.current.retry_delay).toBe(299);
  });

  it("redraws live when its own style changes, without touching a key", async () => {
    const { container } = await render({ ...DEFAULTS, ui_card_style_overrides: { "timing-retries": "sentence" } });
    expect(container.querySelector(".tr-sentence")).not.toBeNull();
    const keys = JSON.stringify(CARD_KEYS.map((k) => store.current[k]));
    act(() => screen.getByTestId("style-tiles").click());
    // Its own override wins over the global switch.
    expect(container.querySelector(".tr-sentence")).not.toBeNull();
    expect(JSON.stringify(CARD_KEYS.map((k) => store.current[k]))).toBe(keys);
  });
});
