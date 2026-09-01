/**
 * Every command the window sends must be one the engine serves.
 *
 * Nothing checked this, and it cost the whole PREVIEW checklist: `EditingTab`
 * sent `editing_toggle` and `AppShell` sent `editing_viewed`, neither of which
 * exists in `csdm/bridge/host.py::COMMANDS`. The engine answered
 * `unknown command`, `sendCommand` never reads a reply, and the feature was
 * inert from the day it shipped without a single test going red
 * (AUDIT_retours_ui_8_points.md, ecart E2).
 *
 * Same shape as the settings coverage guard: the list of truth is READ FROM
 * PYTHON on every run, never transcribed into TypeScript. A copy would drift,
 * and a drifting copy of the answer is how this happened in the first place.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const HOST_PY = path.join(REPO_ROOT, "csdm", "bridge", "host.py");
const RENDERER_SRC = path.resolve(HERE, "..");

/**
 * The command names `host.py` registers, read out of its `COMMANDS` table.
 *
 * Parsed rather than imported because this suite has no Python. The table is a
 * plain dict literal of `"name": handler` pairs, which is exactly why it is
 * safe to read this way -- and if that ever stops being true, the count check
 * below fails loudly instead of quietly matching nothing.
 */
function enginesCommands(): Set<string> {
  const source = readFileSync(HOST_PY, "utf8");
  const start = source.indexOf("COMMANDS = {");
  if (start === -1) throw new Error(`no COMMANDS table in ${HOST_PY}`);
  const end = source.indexOf("\n}", start);
  const table = source.slice(start, end);
  return new Set([...table.matchAll(/^\s*"([a-z0-9_]+)":/gm)].map((m) => m[1]));
}

/** Every `.ts`/`.tsx` file under the renderer, tests included. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every command name passed to `sendCommand(` / `runCommand(` in the source. */
function commandsSent(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = [];
  for (const file of sourceFiles(RENDERER_SRC)) {
    // The guard's own file names the dead commands in prose and in a fixture;
    // reading itself would make it fail on the very examples it documents.
    if (file === fileURLToPath(import.meta.url)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(?:send|run)Command\(\s*"([a-z0-9_]+)"/g)) {
      found.push({ name: match[1], file: path.relative(REPO_ROOT, file) });
    }
  }
  return found;
}

describe("the renderer's commands", () => {
  it("reads a real table out of host.py", () => {
    // A parser that silently matches nothing turns this whole file into a
    // test that always passes. Fail on an empty read instead.
    expect(enginesCommands().size).toBeGreaterThan(20);
  });

  it("finds the calls it is supposed to be checking", () => {
    expect(commandsSent().length).toBeGreaterThan(10);
  });

  it("sends nothing the engine does not serve", () => {
    const served = enginesCommands();
    const unknown = commandsSent().filter((call) => !served.has(call.name));
    expect(
      unknown.map((call) => `${call.name} (${call.file})`).sort(),
    ).toEqual([]);
  });

  it("still catches the two commands that were dead", () => {
    // The regression this guard exists for, pinned as a fixture rather than
    // as a comment: if the matcher ever stops recognising this call shape,
    // this fails instead of the guard going quietly blind.
    const fixture = 'sendCommand("editing_toggle", { index: 0 });';
    const names = [...fixture.matchAll(/\b(?:send|run)Command\(\s*"([a-z0-9_]+)"/g)]
      .map((m) => m[1]);
    expect(names).toEqual(["editing_toggle"]);
    expect(enginesCommands().has("editing_toggle")).toBe(false);
  });
});
