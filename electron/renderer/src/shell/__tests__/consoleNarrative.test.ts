/**
 * What the console says, against what the pipe carries.
 *
 * Measured on the real engine before this existed: a plain start-up produced
 *
 *   [log:ok] CSDM Batch Clips Generator v215 -- engine ready
 *   [log:dim] python 3.14.3 | 181 settings loaded
 *   [result] id=1 ok=true
 *
 * against the approved mock's eight narrated, timestamped lines with no
 * protocol prefix anywhere.
 */
import { describe, expect, it } from "vitest";

import { PROMPT_COMMANDS, narrate, promptFor } from "../consoleNarrative";

const text = (message: Parameters<typeof narrate>[0]): string =>
  (narrate(message)?.runs ?? []).map(([t]) => t).join("");

describe("no protocol prefix survives to the screen", () => {
  it("shows a log line as itself, with no [log:level] in front", () => {
    const line = narrate({ type: "log", message: "engine ready", level: "ok" })!;
    expect(line.runs).toEqual([["engine ready", "ok"]]);
    expect(text({ type: "log", message: "engine ready", level: "ok" })).not.toContain("[");
  });

  it("says nothing at all for a successful result", () => {
    // `[result] id=1 ok=true` is a counter and a fact the window already shows.
    expect(narrate({ type: "result", id: "1", ok: true })).toBeNull();
  });

  it("still explains a FAILED result, which carries the only reason there is", () => {
    const line = narrate({ type: "result", id: "7", ok: false, error: "no player selected" })!;
    expect(text({ type: "result", id: "7", ok: false, error: "no player selected" })).toContain(
      "no player selected",
    );
    expect(line.level).toBe("err");
    expect(text({ type: "result", id: "7", ok: false, error: "x" })).not.toContain("id=");
  });
});

describe("a multicolour line stays multicolour", () => {
  it("keeps the engine's runs instead of flattening them", () => {
    // The engine really sends this shape (csdm/engine/core.py, the timeout line).
    const parts: [string, "dim" | "info" | "ok"][] = [
      ["  ⏱ Timeout: ", "dim"],
      ["2m30s", "info"],
      ["  (content ", "dim"],
      ["48s", "ok"],
    ];
    const line = narrate({ type: "log_parts", parts })!;
    expect(line.runs).toHaveLength(4);
    expect(line.runs.map(([, level]) => level)).toEqual(["dim", "info", "dim", "ok"]);
  });
});

describe("state events are narrated, not dumped as JSON", () => {
  it.each([
    ["run_started", "launching"],
    ["preview_started", "querying"],
    ["stop_requested", "stop requested"],
    ["kill_requested", "kill requested"],
  ])("%s reads as a sentence", (name, fragment) => {
    expect(text({ type: "state", name, payload: {} })).toContain(fragment);
  });

  it("names the process that exited", () => {
    expect(text({ type: "state", name: "process_exited", payload: { name: "cs2.exe" } })).toContain(
      "cs2.exe",
    );
  });

  it("shows the engine's own progress and summary text, unrewritten", () => {
    expect(text({ type: "state", name: "progress", payload: { text: "▰▰▱ 2/3" } })).toContain(
      "▰▰▱ 2/3",
    );
    expect(
      text({ type: "state", name: "summary", payload: { text: "  No clips found.", level: "muted" } }),
    ).toContain("No clips found.");
  });

  it("says nothing for the events that only steer the interface", () => {
    for (const name of ["buttons", "buttons_idle", "buttons_busy", "preview_ready", "demo_entry"]) {
      expect(narrate({ type: "state", name, payload: {} })).toBeNull();
    }
  });

  it("does not swallow an event it has never heard of", () => {
    // A silent unknown is how a new engine event goes unnoticed for a release.
    expect(narrate({ type: "state", name: "brand_new_event", payload: {} })).not.toBeNull();
  });

  it("never prints raw JSON for a known event", () => {
    expect(text({ type: "state", name: "progress", payload: { text: "x" } })).not.toContain("{");
  });
});

describe("the prompt follows the action", () => {
  it.each([
    ["run_started", PROMPT_COMMANDS.run],
    ["preview_started", PROMPT_COMMANDS.preview],
    ["stop_requested", PROMPT_COMMANDS.stopping],
    ["kill_requested", PROMPT_COMMANDS.killing],
    ["process_exited", PROMPT_COMMANDS.idle],
  ])("%s switches the prompt", (name, expected) => {
    expect(promptFor({ type: "state", name, payload: {} })).toBe(expected);
  });

  it("leaves the prompt alone for anything else", () => {
    expect(promptFor({ type: "log", message: "x", level: "" })).toBeNull();
    expect(promptFor({ type: "state", name: "progress", payload: {} })).toBeNull();
  });
});
