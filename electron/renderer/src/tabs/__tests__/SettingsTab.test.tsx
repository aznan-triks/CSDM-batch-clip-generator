/**
 * The Settings tab: PATHS, UI THEME, UI LAYOUT, POSTGRESQL CONNECTION,
 * PERFORMANCE and INJECTION PREVIEW.
 *
 * Ported from `_tab_outils` in csdm_batch_clips_generator.py. Same pattern as
 * `VideoTab.test.tsx`: render through `SettingsProvider`, flush the pipe
 * once, then read the tree.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../../settings/store";
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
  ui_window_w: 1600,
  ui_window_h: 900,
  ui_split_pct: 60,
  ui_remember_layout: true,
  dp2_threads: 4,
  pg_host: "localhost",
  pg_port: "5432",
  pg_user: "csdm",
  pg_pass: "secret",
  pg_db: "csdm",
};

vi.mock("../../bridge", () => ({
  runCommand: (command: string) => {
    if (command === "load_config") {
      return Promise.resolve({ type: "result", id: "1", ok: true, data: CONFIG_FIXTURE });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
}));

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
});
