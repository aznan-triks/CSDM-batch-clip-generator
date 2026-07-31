import { useEffect, useRef, useState } from "react";

import { effectiveIntensity } from "../motion/engine";
import { MOTION } from "../motion/tokens";

/**
 * The console's typewriter: how much of each line is on screen.
 *
 * The approved mock writes each console line a character at a time and holds
 * the next one back until it finishes (`pump()` there). This is that, with
 * three differences the mock never had to face.
 *
 * ONE -- the mock types seven scripted lines; a real batch emits hundreds in a
 * burst. Only the last `MOTION.consoleType.maxTyped` lines are ever typed:
 * when more than that are waiting, the queue jumps forward and lands them
 * complete. A log still spelling out what happened a minute ago is a log
 * nobody can read.
 *
 * TWO -- a work tool must be able to hold still. Under motion intensity
 * `none`, or the system's reduced-motion preference which wins over it,
 * nothing types at all and every line is complete the instant it arrives.
 *
 * THREE -- one interval owns the whole queue, cleared the moment the queue
 * empties. Not a timer per line, and never `onfinish`: a window hidden
 * mid-batch would leave the timers behind (context_guide section 10).
 *
 * @param lengths character count of each line, oldest first
 * @returns how many characters of line `index` to show; `Infinity` means all
 */
export function useTypewriter(lengths: number[]): (index: number) => number {
  // `done` lines are fully written; `chars` is the progress into line `done`.
  const [state, setState] = useState({ done: 0, chars: 0 });
  const lengthsRef = useRef(lengths);
  lengthsRef.current = lengths;

  const still = effectiveIntensity() === "none";
  const total = lengths.length;

  useEffect(() => {
    if (still) return;
    // A burst arrived while we were typing: skip to the tail rather than
    // narrate the backlog.
    const floor = Math.max(0, total - MOTION.consoleType.maxTyped);
    setState((previous) => (previous.done < floor ? { done: floor, chars: 0 } : previous));
  }, [total, still]);

  useEffect(() => {
    if (still) return;
    if (state.done >= total) return;

    const current = lengthsRef.current[state.done] ?? 0;
    const finished = state.chars >= current;
    // The mock pauses between lines; within a line it steps per character.
    const delay = finished ? MOTION.consoleType.lineGapMs : MOTION.consoleType.charMs;

    const timer = window.setTimeout(() => {
      setState((previous) => {
        const length = lengthsRef.current[previous.done] ?? 0;
        return previous.chars >= length
          ? { done: previous.done + 1, chars: 0 }
          : { done: previous.done, chars: previous.chars + 1 };
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [state, total, still]);

  return (index: number): number => {
    if (still) return Infinity;
    if (index < state.done) return Infinity;
    if (index > state.done) return 0;
    return state.chars;
  };
}
