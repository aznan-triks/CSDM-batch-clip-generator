// Pure lifecycle logic, deliberately free of any `require("electron")`: main.js
// starts a real application the moment it is imported, so nothing in it can be
// unit-tested. What lives here is exactly what a test needs to reach.
"use strict";

let engineBusy = false;

/**
 * Follow the engine's own account of what it is doing.
 *
 * The shell has to know, because closing the window mid-run must give the
 * engine a chance to kill cs2.exe and revert this batch's tags, while closing
 * it at rest must not delay anything or taskkill a cs2.exe this app never
 * started.
 */
function noteEngineState(message) {
  if (!message || message.type !== "state") return;
  if (message.name === "run_started" || message.name === "preview_started") {
    engineBusy = true;
  } else if (message.name === "buttons_idle" || message.name === "process_exited") {
    engineBusy = false;
  }
}

function engineIsBusy() {
  return engineBusy;
}

/** Forget any run in progress. Called when an engine is started or killed. */
function resetEngineState() {
  engineBusy = false;
}

/** The arguments that make taskkill walk the whole tree and force it. */
function buildTreeKillArgs(pid) {
  return ["/PID", String(pid), "/T", "/F"];
}

module.exports = { noteEngineState, engineIsBusy, resetEngineState, buildTreeKillArgs };
