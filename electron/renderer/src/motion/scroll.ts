/**
 * Smoothed scrolling, kept SHORT on purpose.
 *
 * This is a work tool: aiming at one checkbox in a column of 25 sections has
 * to stay precise, so the inertia is just enough to take the step out of a
 * wheel notch and no more. The duration lives in MOTION, never in the call.
 *
 * It is off entirely under intensity `none` and under `prefers-reduced-motion`
 * -- smoothed scrolling IS motion, and a user who asked for none gets none.
 */
import Lenis from "lenis";

import { effectiveIntensity, onIntensityChange } from "./engine";
import { MOTION } from "./tokens";

let instance: Lenis | null = null;
let frame = 0;

function start(): void {
  if (instance) return;
  instance = new Lenis({
    duration: MOTION.scroll.duration,
    wheelMultiplier: MOTION.scroll.wheelMultiplier,
  });
  const tick = (time: number) => {
    instance?.raf(time);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

function stop(): void {
  if (!instance) return;
  cancelAnimationFrame(frame);
  instance.destroy();
  instance = null;
}

/** Match the scrolling to the intensity actually in force, right now. */
export function syncScrollToIntensity(): void {
  if (effectiveIntensity() === "none") stop();
  else start();
}

/**
 * Turn smoothed scrolling on and keep it in step with the intensity setting.
 * Returns a teardown, so a test or a hot reload never leaves two loops running.
 */
export function installSmoothScroll(): () => void {
  syncScrollToIntensity();
  const unsubscribe = onIntensityChange(() => syncScrollToIntensity());
  return () => {
    unsubscribe();
    stop();
  };
}
