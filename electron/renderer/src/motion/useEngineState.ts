/**
 * The engine's state, as the interface sees it -- one slice at a time.
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

export type { CameraSegment, ClipEdit, EngineState, PreviewClip, PreviewEvent, SavedClip, SummaryLine } from "./engineStore";
export {
  INITIAL_ENGINE_STATE,
  cameraSegment,
  dispatchEngineMessage,
  editClip,
  markEditingViewed,
  reduceEngineState,
  restoreClipSelection,
  toggleClipEvent,
  toggleClipSelection,
} from "./engineStore";
import type { EngineState } from "./engineStore";

/**
 * Read ONE slice of the engine state.
 *
 * `useSyncExternalStore` rather than a `useState` mirror: the store is the
 * truth and a mirror can be one render behind it. Every caller reads the
 * SAME store -- see `engineStore.ts` for why that matters. There is no
 * whole-state hook on purpose: a reader of the whole object re-renders on
 * every `progress` line of a run: a `progress` tick replaces the state
 * object, and a component that only needs `busy` must not re-render for it.
 *
 * The selector must return a primitive or a reference already held by the
 * state -- a freshly built array/object would never compare equal.
 */
export function useEngineSelector<T>(selector: (state: EngineState) => T): T {
  const read = () => selector(getEngineState());
  return useSyncExternalStore(subscribeEngineState, read, read);
}
