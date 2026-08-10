/**
 * The default window geometry is written ONCE, in Python's DEFAULT_CONFIG.
 * Two mirrors exist because they cannot import it: Electron's main process
 * (it sizes the window before the engine ever answers) and the renderer
 * (SettingsTab's "reset layout" must know the defaults synchronously).
 *
 * A mirror that drifts is exactly HC.1's failure mode -- ui_window_w said
 * 1600 in three files while the window everyone actually ran was 1100. So
 * the mirrors are not trusted: they are read back and compared to Python at
 * test time, the same way settings/__tests__/coverage.test.tsx reads the key
 * list instead of copying it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WINDOW_DEFAULTS } from "../windowDefaults";

const repoRoot = path.resolve(__dirname, "../../../../..");

function pythonDefaults(): { w: number; h: number; splitPct: number } {
  const raw = execFileSync(
    "python",
    [
      "-c",
      "import json; from csdm.config import DEFAULT_CONFIG as d; print(json.dumps({'w': d['ui_window_w'], 'h': d['ui_window_h'], 'splitPct': d['ui_split_pct']}))",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return JSON.parse(raw);
}

function mainJsConstant(name: string): number {
  const source = fs.readFileSync(path.join(repoRoot, "electron", "main.js"), "utf8");
  const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
  if (!match) throw new Error(`${name} not found in electron/main.js`);
  return Number(match[1]);
}

describe("default window geometry", () => {
  it("the renderer mirror matches Python", () => {
    expect(WINDOW_DEFAULTS).toEqual(pythonDefaults());
  });

  it("the main-process mirror matches Python", () => {
    const python = pythonDefaults();
    expect(mainJsConstant("WINDOW_DEFAULT_W")).toBe(python.w);
    expect(mainJsConstant("WINDOW_DEFAULT_H")).toBe(python.h);
  });

  it("is the size the user actually gets", () => {
    expect(pythonDefaults()).toMatchObject({ w: 1100, h: 900 });
  });
});
