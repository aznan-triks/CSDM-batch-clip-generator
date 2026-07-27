/**
 * The typed edge of the JSON pipe.
 *
 * Mirrors the shapes actually written by the Python side -- read from
 * `csdm/bridge/ports.py` (log / log_parts / state / ask), `csdm/bridge/host.py`
 * (result / fatal) and `csdm/bridge/protocol.py` (the type strings). Both ends
 * must agree on these exact strings, so they are protocol constants, never
 * configuration.
 *
 * `child_exit` and `child_error` are not protocol: `main.js` synthesises them
 * when the engine process dies, so the window reports it instead of freezing.
 */

/** Levels the engine actually emits (grepped from `csdm/engine/core.py`). */
export type LogLevel = "info" | "warn" | "err" | "ok" | "dim" | "";

/**
 * Every state event the engine can raise. The last six arrived in v213, when
 * stop, kill and preview cancellation moved into the engine: `process_exited`
 * in particular is raised only after the task list confirms the game is gone,
 * which is what the waiting charge in the band is watching for.
 */
export type StateName =
  | "progress"
  | "buttons_idle"
  | "buttons_busy"
  | "buttons"
  | "summary"
  | "demos_unchecked"
  | "preview_ready"
  | "demo_entry"
  | "run_started"
  | "preview_started"
  | "stop_requested"
  | "kill_requested"
  | "process_exited";

export type BridgeMessage =
  | { type: "log"; message: string; level: LogLevel }
  /** One multicolour line, as a list of [text, level] runs. */
  | { type: "log_parts"; parts: [string, LogLevel][] }
  | { type: "state"; name: StateName | string; payload: Record<string, unknown> }
  /**
   * A blocking question. The engine worker thread is stopped until an `answer`
   * carrying this same `id` comes back.
   *
   * `options[0]` is the dialog TITLE, not a choice: the answers are
   * `options.slice(1)`. Answering `null` means Cancel, which the engine handles
   * as its own branch (see `csdm/engine/core.py:2857`).
   */
  | { type: "ask"; id: string; kind: string; message: string; options: string[] }
  /**
   * One command's outcome. `error` is absent on success, and a handler may
   * spread extra keys into the payload, hence the index signature.
   */
  | { type: "result"; id: string | null; ok: boolean; error?: string; [key: string]: unknown }
  | { type: "fatal"; error: string; traceback: string }
  | { type: "child_exit"; code: number | null; signal: string | null }
  | { type: "child_error"; error: string };

export type BridgeCommand =
  | { type: "command"; id: string; name: string }
  | { type: "answer"; id: string; value: string | null };

/** What `preload.js` puts on `window`. Nothing else crosses the isolation boundary. */
interface BridgeApi {
  send(command: BridgeCommand): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (message: BridgeMessage) => void): () => void;
}

declare global {
  interface Window {
    bridge: BridgeApi;
  }
}

/**
 * The preload bridge, or null when the page is open outside Electron.
 *
 * Inside the app it is always there. Outside -- a plain browser tab used to
 * look at the layout -- it is not, and reaching straight through `window`
 * threw during mount, which unmounted the whole tree and left a white page
 * with the real cause buried in the console. Say it once, plainly, and let
 * the interface render.
 */
function bridge(): Window["bridge"] | null {
  const available = typeof window !== "undefined" ? window.bridge : undefined;
  if (available) return available;
  if (!warnedAboutMissingBridge) {
    warnedAboutMissingBridge = true;
    console.warn("no engine bridge on this page: running outside Electron, nothing will move");
  }
  return null;
}

let warnedAboutMissingBridge = false;

export function send(command: BridgeCommand): void {
  bridge()?.send(command);
}

let commandCounter = 0;

/** Send a command under a fresh id and return that id. */
export function sendCommand(name: string): string {
  commandCounter += 1;
  const id = String(commandCounter);
  send({ type: "command", id, name });
  return id;
}

/** Subscribe to engine messages. Returns an unsubscribe function for React effects. */
export function onMessage(cb: (message: BridgeMessage) => void): () => void {
  return bridge()?.onMessage(cb) ?? (() => {});
}
