/**
 * The Settings tab: PATHS, UI THEME, UI LAYOUT, POSTGRESQL CONNECTION,
 * PERFORMANCE and INJECTION PREVIEW.
 *
 * Ported from `_tab_outils` in csdm_batch_clips_generator.py. Same pattern as
 * `VideoTab.test.tsx`: render through `SettingsProvider`, flush the pipe
 * once, then read the tree.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAVE_DEBOUNCE_MS, SettingsProvider } from "../../settings/store";
import SettingsTab from "../SettingsTab";

/** A configuration with the window's defaults for the 16 keys this tab ports. */
const CONFIG_FIXTURE = {
  csdm_exe: "",
  cs2_cfg_dir: "",
  output_dir_clips: "",
  output_dir_concat: "",
  output_dir_assembled: "",
  subfolder_per_demo: true,
  theme_accent: "#C8A24A",
  ui_window_w: 1100,
  ui_window_h: 900,
  ui_split_pct: 60,
  ui_remember_layout: true,
  dp2_threads: 4,
  pg_host: "localhost",
  pg_port: "5432",
  pg_user: "csdm",
  pg_pass: "secret",
  pg_db: "csdm",
  ui_card_block_size: 48,
  ui_font_family: "auto",
};

vi.mock("../../bridge", () => ({
  runCommand: (command: string, payload: Record<string, unknown> = {}) => {
    if (command === "load_config") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: CONFIG_FIXTURE });
    }
    if (command === "probe_config_dir") {
      const target = (payload.target as string) ?? "";
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: {
          current: "C:\\script\\CSDM Batch Clip Generator",
          target:
            target === "appdata"
              ? "C:\\AppData\\Local\\CSDM Batch Clip Generator"
              : "C:\\script\\CSDM Batch Clip Generator",
          conflicts: [],
          same: target === "",
          kind: "app",
        },
      });
    }
    if (command === "save_config") {
      saveCalls.push(payload);
      return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
    }
    if (command === "apply_config_dir") {
      applyCalls.push(payload);
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: {
          current: "C:\\AppData\\Local\\CSDM Batch Clip Generator",
          target: "C:\\AppData\\Local\\CSDM Batch Clip Generator",
          conflicts: [],
          same: true,
          kind: "appdata",
        },
      });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
  setWindowBounds: (width: number, height: number) => {
    windowBoundsCalls.push([width, height]);
    return Promise.resolve();
  },
}));

/** Captures every `apply_config_dir` payload sent during a test. */
let applyCalls: Array<Record<string, unknown>> = [];

/** Captures every `setWindowBounds` call during a test. */
let windowBoundsCalls: Array<[number, number]> = [];

/** Captures every `save_config` payload during a test. */
let saveCalls: Array<Record<string, unknown>> = [];

async function renderTab() {
  const rendered = render(
    <SettingsProvider>
      <SettingsTab />
    </SettingsProvider>,
  );
  await act(async () => {});
  return rendered;
}

describe("SettingsTab", () => {
  beforeEach(() => {
    applyCalls = [];
    windowBoundsCalls = [];
    saveCalls = [];
  });

  it("shows every path the window had", async () => {
    const { container } = await renderTab();
    for (const key of [
      "csdm_exe",
      "cs2_cfg_dir",
      "output_dir_clips",
      "output_dir_concat",
      "output_dir_assembled",
    ]) {
      expect(container.querySelector(`[data-config-key="${key}"]`)).not.toBeNull();
    }
  });

  it("shows the five PostgreSQL fields", async () => {
    const { container } = await renderTab();
    for (const key of ["pg_host", "pg_port", "pg_user", "pg_pass", "pg_db"]) {
      expect(container.querySelector(`[data-config-key="${key}"]`)).not.toBeNull();
    }
  });

  it("keeps the PostgreSQL help beside Test & Reload, not on a line of its own", async () => {
    // A help line under the button cost the card a row its reference height
    // does not have: it scrolled (round-2 UI, e2e/round2-ui-proof.mjs).
    const { container } = await renderTab();
    const row = container.querySelector(".settings-db-row");
    expect(row?.querySelector('[data-action="B1"]')).not.toBeNull();
    expect(row?.querySelector(".capture-hint")?.textContent).toMatch(/CS Demo Manager › Settings › Database/);
    expect(container.querySelector("p.capture-hint")).toBeNull();

    await act(async () => (row?.querySelector('[data-action="B1"]') as HTMLButtonElement).click());
    expect(row?.querySelector(".settings-db-status")?.textContent).toBe("Connected");
    expect(row?.querySelector(".capture-hint")).toBeNull();
  });

  it("never shows the password in clear", async () => {
    const { container } = await renderTab();
    const field = container.querySelector<HTMLInputElement>('[data-config-key="pg_pass"] input');
    expect(field?.type).toBe("password");
  });

  it("offers the layout buttons the window had", async () => {
    await renderTab();
    for (const label of ["Apply", "Auto", "Reset default"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it("resizes the live window when Apply is clicked", async () => {
    await renderTab();
    act(() => screen.getByRole("button", { name: /^Apply$/ }).click());
    // CONFIG_FIXTURE has ui_window_w: 1100, ui_window_h: 900 -- inside
    // clampLayout's 1000-3840 / 600-2160 bounds, so it passes through unchanged.
    expect(windowBoundsCalls).toEqual([[1100, 900]]);
  });

  it("resizes the live window when Reset default is clicked", async () => {
    await renderTab();
    act(() => screen.getByRole("button", { name: /^Reset default$/ }).click());
    expect(windowBoundsCalls).toEqual([[1600, 900]]);
  });

  it("resizes the live window when Auto is clicked", async () => {
    const widthSpy = vi.spyOn(window.screen, "width", "get").mockReturnValue(1920);
    const heightSpy = vi.spyOn(window.screen, "height", "get").mockReturnValue(1080);
    await renderTab();
    act(() => screen.getByRole("button", { name: /^Auto$/ }).click());
    // clampLayout(round(1920*0.86), round(1080*0.84), 60) = (1651, 907, 60).
    expect(windowBoundsCalls).toEqual([[1651, 907]]);
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it("shows the configuration folder control with its three locations", async () => {
    const { container } = await renderTab();
    expect(container.querySelector('[data-config-key="config_dir"]')).not.toBeNull();
    for (const label of ["App folder (portable)", "User Local AppData", "Choose…"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}$`) }),
      ).toBeTruthy();
    }
  });

  it("copies to Local AppData after the confirmation, never moving", async () => {
    await renderTab();
    await act(async () => {
      screen.getByRole("button", { name: /^User Local AppData$/ }).click();
    });
    // Probe resolved with no conflicts, so a single copy confirmation shows.
    expect(screen.getByRole("alertdialog", { name: "Copy config folder" })).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: /^Copy$/ }).click();
    });
    expect(applyCalls).toEqual([{ target: "appdata" }]);
  });

  it("stays put when the copy confirmation is cancelled", async () => {
    await renderTab();
    await act(async () => {
      screen.getByRole("button", { name: /^User Local AppData$/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /^Cancel$/ }).click();
    });
    expect(applyCalls).toEqual([]);
  });

  it("keeps the active location highlighted after a switch", async () => {
    await renderTab();
    // The probe reports the script subfolder as active (kind "app").
    expect(screen.getByRole("button", { name: /^App folder \(portable\)$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^User Local AppData$/ }).getAttribute("aria-pressed")).toBe("false");
    // Switch to AppData and confirm: the apply response reports kind "appdata",
    // so the highlight must move -- this is the "constantly selected" report.
    await act(async () => {
      screen.getByRole("button", { name: /^User Local AppData$/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /^Copy$/ }).click();
    });
    expect(screen.getByRole("button", { name: /^App folder \(portable\)$/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /^User Local AppData$/ }).getAttribute("aria-pressed")).toBe("true");
  });

  // E12: ui_card_block_size (grid size) and ui_font_family (font) used to be
  // editable only by hand-editing csdm_config.json. Both now have a control
  // here, wired through the same SettingControl/useSetting binding every
  // other field on this tab uses.
  describe("E12: grid size and font family", () => {
    it("mounts both with their config-key wrapper", async () => {
      const { container } = await renderTab();
      expect(container.querySelector('[data-config-key="ui_card_block_size"]')).not.toBeNull();
      expect(container.querySelector('[data-config-key="ui_font_family"]')).not.toBeNull();
    });

    it("writes ui_card_block_size when the grid-size slider changes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { container } = await renderTab();
        const slider = container.querySelector('#ui-card-block-size.slider-input') as HTMLInputElement;
        expect(slider).not.toBeNull();

        act(() => {
          fireEvent.change(slider, { target: { value: "64" } });
        });
        await act(async () => {
          vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        const saves = saveCalls.filter((c) => c.cfg !== undefined);
        const last = saves.at(-1)?.cfg as Record<string, unknown> | undefined;
        expect(last?.ui_card_block_size).toBe(64);
      } finally {
        vi.useRealTimers();
      }
    });

    it("writes ui_font_family when the font field changes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { container } = await renderTab();
        const field = container.querySelector("#ui-font-family") as HTMLInputElement;
        expect(field).not.toBeNull();

        act(() => {
          fireEvent.change(field, { target: { value: "JetBrains Mono" } });
        });
        await act(async () => {
          vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        const saves = saveCalls.filter((c) => c.cfg !== undefined);
        const last = saves.at(-1)?.cfg as Record<string, unknown> | undefined;
        expect(last?.ui_font_family).toBe("JetBrains Mono");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
