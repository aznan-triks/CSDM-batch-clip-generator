/**
 * React's view of the diagnostic switch.
 *
 * The recorder is a plain module, not React state, because `bridge.ts` records
 * outgoing commands and `bridge.ts` is not a component -- a recorder living
 * inside a hook would be unreachable from the one place that has to write to
 * it. So the module owns the truth and this hook subscribes to it, the same
 * shape the rest of the window already uses for out-of-React state.
 *
 * `useSyncExternalStore` rather than a `useState` mirrored in an effect: the
 * chip must never show OFF while the recorder is on. A mirror can be stale for
 * one render; this cannot.
 */
import { useCallback, useSyncExternalStore } from "react";

import { isTracing, subscribeTrace } from "./trace";
import { exportTrace, setTracing } from "./tracing";

export interface TracingControl {
  tracing: boolean;
  setTracing: (on: boolean) => void;
  exportTrace: () => void;
}

export function useTracing(): TracingControl {
  const tracing = useSyncExternalStore(
    subscribeTrace,
    isTracing,
    // Server snapshot: there is no server, but a test renderer may ask.
    () => false,
  );
  return {
    tracing,
    setTracing: useCallback((on: boolean) => setTracing(on), []),
    exportTrace: useCallback(() => exportTrace(), []),
  };
}
