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

import { recordCommand } from "./debug/trace";

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
  | "process_exited"
  | "editing_toggle"
  | "editing_viewed";

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
  | { type: "fatal"; error: string }
  /**
   * One diagnostic line from the engine's own recorder, emitted only while
   * `set_debug` is on (`csdm/bridge/host.py`). It is protocol -- both ends
   * agree on the string -- but it is NOT engine state: nothing in the
   * interface may change because a trace line arrived.
   */
  | { type: "trace"; phase: string; id: string | null; name: string; ms: number; detail?: string }
  | { type: "child_exit"; code: number | null; signal: string | null }
  | { type: "child_error"; error: string };

export type BridgeCommand =
  | { type: "command"; id: string; name: string; [key: string]: unknown }
  | { type: "answer"; id: string; value: string | null };

/** What `preload.js` puts on `window`. Nothing else crosses the isolation boundary. */
interface BridgeApi {
  send(command: BridgeCommand): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (message: BridgeMessage) => void): () => void;
  pickPath(options?: { file?: boolean }): Promise<string | null>;
  pickSavePath(options?: { defaultName?: string }): Promise<string | null>;
  /** Returns an unsubscribe function. */
  onFlushRequest(handler: () => Promise<void>): () => void;
  restartEngine(): Promise<void>;
  setWindowBounds(width: number, height: number): Promise<void>;
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

/** Extra fields a command carries beside `type`, `id` and `name`. */
export type CommandPayload = Record<string, unknown>;

/** One command's outcome, as the Python side writes it. */
export type ResultMessage = Extract<BridgeMessage, { type: "result" }>;

interface PendingCommand {
  resolve: (result: ResultMessage) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingCommand>();
let routerInstalled = false;

/**
 * Route `result` lines back to whoever is waiting for them.
 *
 * Installed on the first `runCommand` rather than at module load: importing
 * this file must stay free of side effects, or a test that only wants
 * `sendCommand` would silently subscribe to the pipe.
 */
function installResultRouter(): void {
  if (routerInstalled) return;
  routerInstalled = true;
  onMessage((message) => {
    if (message.type === "result") {
      if (message.id === null) return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message);
      else waiting.reject(new Error(message.error ?? "command failed"));
      return;
    }
    // The engine is gone: nothing will ever answer. Break every waiting
    // promise now instead of leaving them pending for the life of the window.
    if (message.type === "child_exit") {
      failAllPending(`engine exited (code=${message.code}, signal=${message.signal})`);
    } else if (message.type === "child_error" || message.type === "fatal") {
      failAllPending(message.error);
    }
  });
}

function failAllPending(cause: string): void {
  for (const [id, waiting] of [...pending]) {
    pending.delete(id);
    waiting.reject(new Error(cause));
  }
}

let commandCounter = 0;

/** Send a command under a fresh id and return that id. */
export function sendCommand(name: string, payload: CommandPayload = {}): string {
  commandCounter += 1;
  const id = String(commandCounter);
  // Recorded BEFORE the send, so a command that never leaves still shows in
  // the trace: "the click did nothing" and "the click sent something that
  // died on the way" are different bugs and must not look alike.
  recordCommand(name, id, payload);
  // Protocol fields last: a payload key can never rewrite them.
  send({ ...payload, type: "command", id, name });
  return id;
}

/** Send a command and wait for its result line. Rejects on failure or engine death. */
export function runCommand(
  name: string,
  payload: CommandPayload = {},
): Promise<ResultMessage> {
  // Outside Electron there is nobody to answer, and `send` is a no-op: the
  // promise would stay pending for the life of the page. Say so at once, the
  // way a dead engine already does, so a caller can show the reason instead of
  // waiting on a result that cannot arrive.
  if (!bridge()) {
    return Promise.reject(new Error(`no engine bridge on this page: ${name} cannot run`));
  }
  installResultRouter();
  const key = SHARED_WHILE_IN_FLIGHT.has(name) ? `${name} ${JSON.stringify(payload)}` : null;
  const twin = key === null ? undefined : inFlightReads.get(key);
  if (twin) return twin;
  const promise = new Promise<ResultMessage>((resolve, reject) => {
    const id = sendCommand(name, payload);
    pending.set(id, { resolve, reject });
  });
  if (key !== null) {
    inFlightReads.set(key, promise);
    const forget = () => inFlightReads.delete(key);
    promise.then(forget, forget);
  }
  return promise;
}

/**
 * Reads the window fires on MOUNT, answered once while an identical one is
 * still in flight.
 *
 * React's StrictMode mounts every effect twice in development, so each of
 * these went to the engine twice -- and the engine answers some of them on the
 * log socket (`hello`'s banner) or with a failed result the console narrates
 * (`connect_db`'s PostgreSQL error): every such line showed twice outside the
 * packaged exe. Sharing the in-flight promise makes the mount idempotent at
 * the one place every caller goes through, instead of guarding each effect.
 * Only side-effect-free reads belong here: a second RUN click must still send.
 */
const SHARED_WHILE_IN_FLIGHT = new Set([
  "hello",
  "load_config",
  "connect_db",
  "describe_filters",
  "list_demos",
  "list_presets",
  "probe_config_dir",
]);
const inFlightReads = new Map<string, Promise<ResultMessage>>();

/** Subscribe to engine messages. Returns an unsubscribe function for React effects. */
export function onMessage(cb: (message: BridgeMessage) => void): () => void {
  return bridge()?.onMessage(cb) ?? (() => {});
}

/**
 * Register what to do when the main process is about to close the window:
 * write whatever is still pending. Main waits for `handler` to settle (with a
 * ceiling) before letting the window go. No-op outside Electron.
 */
export function onFlushRequest(handler: () => Promise<void>): () => void {
  return bridge()?.onFlushRequest(handler) ?? (() => {});
}

/** Open the native picker. Resolves to null outside Electron, where there is none. */
export function pickPath(options?: { file?: boolean }): Promise<string | null> {
  return bridge()?.pickPath(options) ?? Promise.resolve(null);
}

/** Open the native save-as picker. Resolves to null outside Electron, where there is none. */
export function pickSavePath(options?: { defaultName?: string }): Promise<string | null> {
  return bridge()?.pickSavePath(options) ?? Promise.resolve(null);
}

/** Resize the live OS window. No-op outside Electron, where there is none to resize. */
export function setWindowBounds(width: number, height: number): Promise<void> {
  return bridge()?.setWindowBounds(width, height) ?? Promise.resolve();
}
