/**
 * Every motion number lives here. A duration inside an animation function is a bug.
 *
 * Values are the ones measured in the approved mock (ui-v5.html), not
 * reinvented. Per-weapon numbers do NOT belong here -- they live in the
 * WEAPONS table, so that adding a weapon never touches this file.
 *
 * CSS state transitions (a hover tint, a focus ring) are NOT here either:
 * those are `--dur-fast` / `--dur-base` in tokens.css. Two different things,
 * and neither reaches into the other.
 */

export const MOTION = {
  /** Action button reflection. Mirrors the `sweep` keyframes in ActionButton.css. */
  sweep: { duration: 0.6, ease: "cubic-bezier(.3,.7,.4,1)" },

  /** The armed pulse, while a charge waits for confirmation. */
  armedPulse: { duration: 1.0, ease: "ease-in-out" },

  /** Muzzle flash at the barrel. */
  flash: { duration: 0.095, ease: "ease-out" },

  /** The round in flight. `distanceFactor` scales travel time with distance. */
  tracer: {
    ease: "cubic-bezier(.2,.7,.4,1)",
    minDuration: 0.13,
    distanceFactor: 0.62,
    weakDistanceFactor: 0.95,
  },

  /** The hit: a spark, then the impact frames. */
  spark: { duration: 0.34, ease: "ease-out" },
  impact: {
    frames: 3,
    starDuration: 0.09,
    flashDuration: 0.066,
    ringDuration: 0.4,
    ringEase: "cubic-bezier(.1,.8,.3,1)",
  },

  /** The ejected case. */
  shell: { duration: 0.68, ease: "cubic-bezier(.3,.1,.6,1)" },

  /** Frame shake. Amplitude is per-weapon and lives in WEAPONS. */
  shake: { duration: 0.21, ease: "ease-out", detonationDuration: 0.62 },

  /** Recoil and the bolt working. */
  recoil: { duration: 0.25, boltDuration: 0.42, weakDuration: 0.19, ease: "cubic-bezier(.15,.9,.3,1)" },
  bolt: { duration: 0.3, ease: "cubic-bezier(.4,.1,.3,1)" },

  /** PREVIEW's opening reticle. Restored in v5 after being lost -- do not lose it again. */
  reticle: { duration: 0.72, ease: "ease-out" },

  /**
   * Planting the charge. NO overshoot easing: a bouncy landing reads as a toy,
   * and a military charge is set down firmly. Corrected in session 2, keep it.
   */
  c4Plant: { duration: 0.26, ease: "cubic-bezier(.22,.9,.28,1)" },

  /** The charge withdrawing the weapon from frame while it waits. */
  c4Withdraw: { duration: 0.52, delay: 0.18, ease: "cubic-bezier(.4,0,.3,1)" },

  /** The wait. This LOOPS until the engine confirms -- it is never a countdown. */
  c4Beat: { interval: 0.62, ledDuration: 0.18, ringDuration: 0.34, ringEase: "ease-out" },

  /** Detonation, once the engine confirms the process is actually gone. */
  detonation: {
    blastFlash: { duration: 0.12 },
    core: { duration: 0.19, ease: "cubic-bezier(.05,.8,.3,1)" },
    fire: { duration: 0.56, ease: "cubic-bezier(.1,.75,.3,1)" },
    shock: { duration: 0.56, ease: "cubic-bezier(.05,.85,.25,1)" },
    smoke: { duration: 1.1, delay: 0.11, ease: "cubic-bezier(.2,.6,.4,1)" },
    debris: { count: 16, duration: 0.64, spread: 0.09, ease: "cubic-bezier(.15,.7,.4,1)" },
  },

  /** KILL: brutal, immediate, no waiting. */
  killRetract: { duration: 0.95, delay: 0.15, ease: "cubic-bezier(.5,0,.2,1)" },

  /** Smoothed scrolling. Short on purpose: this is a work tool and aiming at a
      checkbox in a column of 25 sections has to stay precise. */
  scroll: { duration: 0.35, wheelMultiplier: 1 },

  /**
   * How the `sober` intensity is derived from `full`. Sober does not get its
   * own copy of every number -- it scales the one set, so the two can never
   * drift apart.
   */
  sober: { durationFactor: 0.6 },

  /**
   * Safety margin added to a sequence's own length before its elements are
   * removed. Cleanup runs off the CLOCK, never off `onfinish`: `onfinish` does
   * not fire while the window is hidden or the tab is throttled, so effects
   * stayed pinned and elements piled up. Session 2 correction, keep it.
   */
  cleanupGrace: 0.08,
} as const;

/** Sequences that exist only to decorate. `sober` drops these; `full` plays them. */
export const DECORATIVE_SEQUENCES = ["shell", "impact", "spark"] as const;
