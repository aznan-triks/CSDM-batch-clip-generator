/**
 * The DEMO SELECTION section.
 *
 * `renderTab()` never resolves `list_demos`: the date shortcuts and Clear all
 * must all work without ever calling Manual mode. `renderTabWithDemos()`
 * turns Manual mode on and lets a fixed `list_demos` fixture resolve -- one
 * ordinary demo, one dated 2024-01-01 so its compat status comes back "warn"
 * (any real breaking-update maths lives in Python, tested there; this fixture
 * is already the shape `list_demos` sends over the pipe).
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
import DemoSelectionSection from "../DemoSelectionSection";

const DEMOS_FIXTURE = [
  {
    path: "C:/demos/recent.dem",
    name: "recent.dem",
    date: "01-08-2025 10:30",
    map: "mirage",
    compat: { status: "ok", break: null, tip: null },
  },
  {
    path: "C:/demos/old.dem",
    name: "old.dem",
    date: "01-01-2024 08:00",
    map: "ancient",
    compat: {
      status: "warn",
      break: "AnimGraph2",
      tip: "Valve's AnimGraph2 engine update (Jul 28 2025) made all older demos incompatible.",
    },
  },
];

vi.mock("../../bridge", () => ({
  runCommand: (name: string) => {
    if (name === "list_demos") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: { demos: DEMOS_FIXTURE } });
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
      <DemoSelectionSection />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

async function renderTabWithDemos() {
  const rendered = await renderTab();
  act(() => {
    screen.getByRole("button", { name: /Manual mode/i }).click();
  });
  await act(async () => {});
  return rendered;
}

describe("DemoSelectionSection", () => {
  it("sets the end date to today when Today is pressed", async () => {
    const { container } = await renderTab();
    act(() => screen.getByRole("button", { name: /^Today$/ }).click());
    const field = container.querySelector<HTMLInputElement>('[data-config-key="date_to"] input');
    expect(field?.value).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it("clears both dates and the picker when Clear all is pressed", async () => {
    const { container } = await renderTab();
    act(() => screen.getByRole("button", { name: /Clear all/i }).click());
    for (const key of ["date_from", "date_to"]) {
      const field = container.querySelector<HTMLInputElement>(`[data-config-key="${key}"] input`);
      expect(field?.value).toBe("");
    }
  });

  it("empties both dates on the All shortcut", async () => {
    // "All" means no range at all -- not a very wide range.
    const { container } = await renderTab();
    act(() => screen.getByRole("button", { name: /^All$/ }).click());
    const from = container.querySelector<HTMLInputElement>('[data-config-key="date_from"] input');
    expect(from?.value).toBe("");
  });

  it("offers every shortcut the window had", async () => {
    await renderTab();
    for (const label of ["Yesterday", "7d", "30d", "This month", "3m", "6m", "Year", "All"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it("checks and unchecks every demo at once", async () => {
    // Exact strings on purpose: "Uncheck all" contains "Check all" as a
    // substring, so a non-anchored /Check all/i regex matches both buttons
    // and getByRole throws on ambiguity (same trap WeaponFilterSection's own
    // Select all / Deselect all test avoids).
    await renderTabWithDemos();
    act(() => screen.getByRole("button", { name: "✕ Uncheck all" }).click());
    expect(screen.getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") === "false")).toBe(
      true,
    );

    act(() => screen.getByRole("button", { name: "✓ Check all" }).click());
    expect(screen.getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") === "true")).toBe(
      true,
    );
  });

  it("warns on a demo recorded before a CS2 breaking update", async () => {
    await renderTabWithDemos(); // fixture holds one demo dated 2024-01-01
    expect(screen.getByTitle(/breaking update/i)).toBeTruthy();
  });

  it("checks only the highlighted row when Check selected is pressed", async () => {
    await renderTabWithDemos();
    // Both rows start checked (`_demo_picker_populate`'s default). Uncheck
    // both first so "Check selected" flipping only one is actually visible.
    act(() => screen.getByRole("button", { name: "✕ Uncheck all" }).click());

    // Highlight (native-select) just the "old.dem" row by clicking it --
    // a plain click, not the checkbox button inside it.
    act(() => screen.getByTitle(/breaking update/i).click());
    act(() => screen.getByRole("button", { name: "✓ Check selected" }).click());

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0].getAttribute("aria-checked")).toBe("false"); // recent.dem, untouched
    expect(boxes[1].getAttribute("aria-checked")).toBe("true"); // old.dem, was highlighted
  });

  it("unchecks only the highlighted row when Uncheck selected is pressed", async () => {
    await renderTabWithDemos(); // both rows start checked

    act(() => screen.getByTitle(/breaking update/i).click()); // highlight old.dem
    act(() => screen.getByRole("button", { name: "✕ Uncheck selected" }).click());

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0].getAttribute("aria-checked")).toBe("true"); // recent.dem, untouched
    expect(boxes[1].getAttribute("aria-checked")).toBe("false"); // old.dem, was highlighted
  });
});
