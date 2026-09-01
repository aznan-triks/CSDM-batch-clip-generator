/**
 * The engine's state, as the interface sees it.
 *
 * This subscribes to the `state` channel and nothing else. It deliberately
 * covers ONLY the events the Python engine actually raises today, verified by
 * reading `csdm/engine/core.py` rather than trusting the documented list:
 *
 *     progress · buttons_idle · summary · demos_unchecked ·
 *     preview_ready · demo_entry
 *
 * Since v213 the engine also raises `buttons`, `buttons_busy`, `run_started`,
 * `preview_started`, `stop_requested`, `kill_requested` and `process_exited`.
 *
 * There is still deliberately NO mapping from a state event to an animation
 * here: that lives in `weapon/controller.ts`, which takes engine events and
 * nothing else. Keeping it out of this hook is what stops a click from ever
 * becoming an animation trigger (D18).
 */
import { useSyncExternalStore } from "react";

import { getEngineState, subscribeEngineState } from "./engineStore";

export type { EngineState, PreviewClip, SummaryLine } from "./engineStore";
export {
  INITIAL_ENGINE_STATE,
  dispatchEngineMessage,
  markEditingViewed,
  reduceEngineState,
  toggleClipSelection,
} from "./engineStore";
import type { EngineState } from "./engineStore";

/**
 * Read the engine's state.
 *
 * `useSyncExternalStore` rather than a `useState` mirror: the store is the
 * truth and a mirror can be one render behind it. Every caller now reads the
 * SAME store -- see `engineStore.ts` for why that matters.
 */
export function useEngineState(): EngineState {
  return useSyncExternalStore(subscribeEngineState, getEngineState, getEngineState);
}
