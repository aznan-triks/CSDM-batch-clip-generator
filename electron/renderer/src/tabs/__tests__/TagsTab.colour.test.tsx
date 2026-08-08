/**
 * A tag carries its own colour, whether or not it is picked.
 *
 * The engine returns one per tag (`[id, name, "#001eff"]`, 27 of them on the
 * real database) and none of it reached the screen: the style was applied only
 * when the tag was already active, which is never the case when the tab opens.
 * And once picked, `.chip.on` kept its lime fill on top, so a blue tag read as
 * green either way.
 *
 * Same harness as TagsTab.test.tsx: the settings store and the bridge are
 * mocked so the component renders without its providers.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TagsTab from "../TagsTab";

const DISCOVERY_FIXTURE = {
  weapons: [],
  maps: [],
  players: [],
  tags: [
    [1, "Mammouth", "#001eff"],
    [2, "Chevre", "#1eff00"],
  ],
};

// Stateful store stand-in, so picking a chip actually flips `aria-pressed`/
// `.on` (see TagsTab.test.tsx for the reasoning).
const tagStore = vi.hoisted(() => ({ map: {} as Record<string, unknown> }));
const lastSet = vi.hoisted(() => ({ key: null as string | null, value: null as unknown }));

vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const set = (value: unknown) => {
      tagStore.map[key] = value;
      lastSet.key = key;
      lastSet.value = value;
    };
    return [tagStore.map[key], set];
  },
}));

beforeEach(() => {
  tagStore.map = {};
  lastSet.key = null;
  lastSet.value = null;
});

vi.mock("../../bridge", () => ({
  runCommand: (command: string) => {
    if (command === "connect_db") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: DISCOVERY_FIXTURE });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
  pickSavePath: () => Promise.resolve(null),
}));

async function renderTab() {
  const rendered = render(<TagsTab />);
  await act(async () => {});
  return rendered;
}

function dotOf(name: string): HTMLElement {
  const chip = screen.getByRole("button", { name: `tag-${name}` });
  return chip.querySelector(".d") as HTMLElement;
}

describe("a tag shows its colour before anyone clicks it", () => {
  it("paints the mock's own dot with the tag's colour at rest", async () => {
    await renderTab();
    const dot = dotOf("Mammouth");
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe("rgb(0, 30, 255)");
  });

  it("gives every tag its own dot, not one shared colour", async () => {
    await renderTab();
    expect(dotOf("Mammouth").style.background).toBe("rgb(0, 30, 255)");
    expect(dotOf("Chevre").style.background).toBe("rgb(30, 255, 0)");
  });

  it("keeps the dot coloured once the tag is picked", async () => {
    await renderTab();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "tag-Mammouth" }));
    });
    // Toggle called the useSetting setter for ui_active_tags.
    expect(lastSet.key).toBe("ui_active_tags");
    expect(Array.isArray(lastSet.value)).toBe(true);
    // The dot colour is preserved — inline style outranks any stylesheet.
    const chip = screen.getByRole("button", { name: "tag-Mammouth" });
    expect((chip.querySelector(".d") as HTMLElement).style.background).toBe("rgb(0, 30, 255)");
  });
});
