/**
 * Test helpers for a card drawn in the three card styles: find each key's
 * `data-config-key` wrapper, operate it the way a user would, read the store.
 * The test file mocks the bridge itself (`vi.mock` is hoisted per file).
 */
import { act, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { SettingsProvider, useAllSettings, useSetting } from "../../../settings/store";
import { CARD_STYLES } from "../cardStyle";

export const store: { current: Record<string, unknown> } = { current: {} };

function Probe() {
  store.current = useAllSettings();
  return null;
}

function StyleSwitch() {
  const [, set] = useSetting<string>("ui_card_style");
  return (
    <>
      {CARD_STYLES.map((s) => (
        <button key={s} type="button" data-testid={`style-${s}`} onClick={() => set(s)} />
      ))}
    </>
  );
}

/** Render `card` once the (mocked) bridge has answered with the config. */
export async function renderCard(card: ReactNode) {
  const rendered = render(
    <SettingsProvider>
      {card}
      <StyleSwitch />
      <Probe />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

/** Open every word popover, so the controls behind a word are on screen too. */
export function openPopovers(container: HTMLElement) {
  for (const token of container.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="false"]')) {
    act(() => token.click());
  }
}

/** Operate the first control inside a key's wrapper the way a user would. */
export function operate(wrapper: Element) {
  const radio = wrapper.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]');
  if (radio) return act(() => radio.click());
  const slider = wrapper.querySelector<HTMLElement>('[role="slider"]');
  if (slider) return fireEvent.keyDown(slider, { key: "ArrowUp" });
  const button = wrapper.querySelector<HTMLElement>("button:not([aria-disabled='true']):not(:disabled)");
  if (button) return act(() => button.click());
  throw new Error(`no operable control under ${wrapper.getAttribute("data-config-key")}`);
}
