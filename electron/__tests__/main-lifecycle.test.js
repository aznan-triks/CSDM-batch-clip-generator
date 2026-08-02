import { beforeEach, describe, expect, it } from "vitest";

import { buildTreeKillArgs, engineIsBusy, noteEngineState, resetEngineState } from "../lifecycle.js";

beforeEach(() => {
  resetEngineState();
});

describe("killing the engine takes its children with it", () => {
  it("asks taskkill to walk the tree and force it", () => {
    // /T is the whole point: Windows has no inherited process group, so the
    // CSDM CLI and the cs2.exe it drives outlive a plain kill of Python.
    expect(buildTreeKillArgs(4242)).toEqual(["/PID", "4242", "/T", "/F"]);
  });
});

describe("the shell knows whether a run is under way", () => {
  it("starts idle", () => {
    noteEngineState({ type: "state", name: "buttons_idle", payload: {} });
    expect(engineIsBusy()).toBe(false);
  });

  it("becomes busy on run_started and on preview_started", () => {
    noteEngineState({ type: "state", name: "run_started", payload: {} });
    expect(engineIsBusy()).toBe(true);
    noteEngineState({ type: "state", name: "buttons_idle", payload: {} });
    noteEngineState({ type: "state", name: "preview_started", payload: {} });
    expect(engineIsBusy()).toBe(true);
  });

  it("goes idle again when the engine says the buttons are free", () => {
    noteEngineState({ type: "state", name: "run_started", payload: {} });
    noteEngineState({ type: "state", name: "buttons_idle", payload: {} });
    expect(engineIsBusy()).toBe(false);
  });

  it("ignores anything that is not a state line", () => {
    noteEngineState({ type: "state", name: "run_started", payload: {} });
    noteEngineState({ type: "log", message: "buttons_idle", level: "info" });
    expect(engineIsBusy()).toBe(true);
  });
});
