/**
 * The switch (A1): one call turns the whole diagnostic chain on, both ends.
 *
 * Three things have to move together or the trace lies. The recorder has to
 * start keeping entries; a listener has to be mounted on the pipe so incoming
 * messages reach it; and the Python side has to start emitting its own trace
 * lines, because a renderer-only trace cannot tell "the engine never received
 * it" from "the engine received it and stayed silent" -- the exact question
 * this instrument exists to answer.
 *
 * They also have to come back down together: turning tracing off must remove
 * the listener, not merely stop recording (A6 -- OFF costs nothing
 * observable).
 *
 * This module sits above `bridge.ts` and `trace.ts` on purpose. `bridge.ts`
 * imports the recorder and nothing else, so the pipe has no idea a switch
 * exists; the cycle that would come from wiring the listener inside the
 * recorder never forms.
 */
import { onMessage, runCommand } from "../bridge";
import type { BridgeMessage } from "../bridge";
import {
  clearTrace,
  disableTrace,
  enableTrace,
  isTracing,
  recordIncoming,
  recordNote,
  snapshot,
  traceToText,
} from "./trace";

/** HC.1: the file name offered by the export, named once. */
export const TRACING = { exportName: "csdm-trace.txt" } as const;

let unsubscribe: (() => void) | null = null;

/**
 * What the page exposes while tracing is on.
 *
 * It exists for the automated harness (`electron/e2e/`), which drives the
 * real window and needs to read the trace out of it without a file dialog. A
 * human uses the DEBUG chip; a script uses this. It is installed on enable and
 * removed on disable, so a normal session carries nothing extra on `window`.
 */
export interface TraceWindowHook {
  entries: typeof snapshot;
  text: typeof traceToText;
  clear: typeof clearTrace;
  note: typeof recordNote;
}

declare global {
  interface Window {
    __csdmTrace?: TraceWindowHook;
  }
}

/**
 * Turn the chain on or off.
 *
 * The `set_debug` command is fired and not awaited: the engine may be dead
 * (the window stays usable when it is), and a switch that hangs because the
 * far end is gone would be worse than a switch that traces only the near end.
 * A rejection is swallowed for that reason and that reason only -- the local
 * half of the trace still works and will show the engine's silence.
 */
export function setTracing(on: boolean): void {
  if (on === isTracing()) return;

  if (on) {
    enableTrace();
    unsubscribe = onMessage((message: BridgeMessage) => recordIncoming(message));
    if (typeof window !== "undefined") {
      window.__csdmTrace = {
        entries: snapshot,
        text: traceToText,
        clear: clearTrace,
        note: recordNote,
      };
    }
    recordNote("tracing on");
  } else {
    recordNote("tracing off");
    unsubscribe?.();
    unsubscribe = null;
    if (typeof window !== "undefined") delete window.__csdmTrace;
    disableTrace();
  }

  void runCommand("set_debug", { on }).catch(() => {
    // Engine unreachable: the renderer half of the trace is still worth having.
  });
}

/**
 * Hand the recorded trace to the user as a file.
 *
 * Same mechanism the console export already uses (`LogConsole.tsx`): a Blob
 * behind an `<a download>`. Reusing it rather than adding a `pickSavePath`
 * round trip keeps this instrument free of new IPC surface -- the audit is
 * supposed to observe the app, not enlarge it.
 */
export function exportTrace(): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    console.warn("trace export unavailable: no Blob/URL support in this environment");
    return;
  }
  const blob = new Blob([traceToText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = TRACING.exportName;
  anchor.click();
  URL.revokeObjectURL(url);
}
