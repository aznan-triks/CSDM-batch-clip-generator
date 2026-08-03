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
  /**
   * Local click feedback on an action button: the squash, the flash and the
   * conic burst. The approved mock runs the three together off a single `.hit`
   * class (`hit` .28s, `flash` .35s, `burst` .4s), so the class comes off on
   * the LONGEST of them -- taken off earlier, the burst is cut mid-flight.
   *
   * This is the button saying "I took your click", not the weapon saying a run
   * started (D18). The two never share a trigger.
   */
  buttonImpact: { duration: 0.4 },

  /**
   * The silhouettes beside the weapon filter's chips. Every icon appears
   * together at its own proportion (width driven by the SVG viewBox), and a
   * deselected one fades out in `casc-out` seconds instead of vanishing.
   */
  weaponCascade: { out: 0.25 },

  /**
   * The console's typewriter, measured in the approved mock's own `pump()`:
   * a line is inserted empty and written a character at a time (26ms), and the
   * next one waits 110ms after it finishes.
   *
   * `maxTyped` is this window's, not the mock's: the mock types seven scripted
   * lines, this console can take a burst of a hundred from a real batch. Past
   * that many waiting, the queue lands them at once -- a log that is still
   * typing out what happened a minute ago is a log nobody can read.
   */
  consoleType: { charMs: 26, lineGapMs: 110, maxTyped: 12 },

  /** Muzzle flash at the barrel. */
  flash: { duration: 0.095, ease: "ease-out" },

  /** The round in flight. `distanceFactor` scales travel time with distance. */
  tracer: {
    ease: "cubic-bezier(.2,.7,.4,1)",
    minDuration: 0.13,
    distanceFactor: 0.62,
    weakDistanceFactor: 0.95,
    /** Length in px: `base + flash * perFlash`. A weak shot uses `weakWidth`. */
    baseWidth: 46,
    perFlash: 22,
    weakWidth: 44,
    /** Thickness in px, same shape: `baseHeight + flash * perFlashHeight`. */
    baseHeight: 1,
    perFlashHeight: 1.6,
    weakHeight: 2,
    /** The round stops short of the target by this much, so the spark reads. */
    shortfall: 24,
  },

  /** A shot the weapon does not commit to (PREVIEW): scaled down from a real one. */
  weakShot: { flash: 0.35, recoilFactor: 0.35 },

  /** The hit: a spark, then the impact frames. */
  spark: { duration: 0.34, ease: "ease-out", endScale: 4.4, startScale: 0.4 },
  impact: {
    frames: 3,
    starDuration: 0.09,
    flashDuration: 0.066,
    ringDuration: 0.4,
    ringEase: "cubic-bezier(.1,.8,.3,1)",
    /** Star size: `starBase + power * starPerPower`. */
    starBase: 0.5,
    starPerPower: 0.9,
    /** White-screen flash opacity at full power. */
    flashOpacity: 0.34,
    /** Ring end scale: `ringBase + power * ringPerPower`. */
    ringBase: 7,
    ringPerPower: 6,
  },

  /** The ejected case. */
  shell: {
    duration: 0.68,
    ease: "cubic-bezier(.3,.1,.6,1)",
    /** Where along the shot line the case leaves the weapon. */
    originFactor: 0.16,
    /** Arc: up and out, then down and away. Pixels, mirrored by ejection side. */
    riseX: 26,
    riseY: -30,
    fallX: 52,
    fallY: 40,
    riseSpin: 200,
    fallSpin: 460,
  },

  /** Frame shake. Amplitude is per-weapon and lives in WEAPONS. */
  shake: {
    duration: 0.21,
    ease: "ease-out",
    detonationDuration: 0.62,
    detonationAmplitude: 9,
    /** Each round of a burst shakes less than the one before. */
    burstFalloff: 0.55,
  },

  /** Recoil and the bolt working. */
  recoil: { duration: 0.25, boltDuration: 0.42, weakDuration: 0.19, ease: "cubic-bezier(.15,.9,.3,1)" },
  bolt: { duration: 0.3, ease: "cubic-bezier(.4,.1,.3,1)" },

  /** PREVIEW's opening reticle. Restored in v5 after being lost -- do not lose it again. */
  reticle: { duration: 0.72, ease: "ease-out", startScale: 1.9, endScale: 0.7, shotDelay: 0.33 },

  /**
   * Planting the charge. NO overshoot easing: a bouncy landing reads as a toy,
   * and a military charge is set down firmly. Corrected in session 2, keep it.
   */
  c4Plant: { duration: 0.26, ease: "cubic-bezier(.22,.9,.28,1)" },

  /** The charge withdrawing the weapon from frame while it waits. */
  c4Withdraw: { duration: 0.52, delay: 0.18, ease: "cubic-bezier(.4,0,.3,1)", distance: 120 },

  /** Where the charge is set down, relative to the muzzle. */
  c4Place: { offsetX: 120, offsetY: 4, dropHeight: -30, dropRotation: -24, squash: 0.94 },

  /** The wait. This LOOPS until the engine confirms -- it is never a countdown. */
  c4Beat: {
    interval: 0.62,
    ledDuration: 0.18,
    ringDuration: 0.34,
    ringEase: "ease-out",
    ringEndScale: 3.4,
    /** The beep ring sits on the charge's indicator light, not on its centre. */
    offsetX: 9,
    offsetY: 5,
  },

  /** Detonation, once the engine confirms the process is actually gone. */
  detonation: {
    blastFlash: { duration: 0.12 },
    core: { duration: 0.19, ease: "cubic-bezier(.05,.8,.3,1)" },
    fire: { duration: 0.56, ease: "cubic-bezier(.1,.75,.3,1)" },
    shock: { duration: 0.56, ease: "cubic-bezier(.05,.85,.25,1)" },
    smoke: { duration: 1.1, delay: 0.11, ease: "cubic-bezier(.2,.6,.4,1)" },
    debris: {
      count: 16,
      duration: 0.64,
      spread: 0.09,
      ease: "cubic-bezier(.15,.7,.4,1)",
      /** Throw distance: `baseDistance + (i % 5) * perStep`, so it is not a ring. */
      baseDistance: 150,
      perStep: 46,
      /** Fragment size: `baseSize + (i % 4) * sizeStep`. */
      baseSize: 3,
      sizeStep: 2,
      /** Gravity pulls the whole pattern down as it flies out. */
      fall: 38,
      verticalSquash: 0.7,
      /** Longer flights for some fragments: `duration + (i % 5) * durationStep`. */
      durationStep: 0.09,
      spin: 360,
      spinStep: 40,
    },
  },

  /** KILL: brutal, immediate, no waiting. */
  killRetract: {
    duration: 0.95,
    delay: 0.15,
    ease: "cubic-bezier(.5,0,.2,1)",
    distance: 160,
    shake: 3.6,
  },

  /**
   * ClickSpark: a HUD ring + a burst of particles on every mousedown, tinted
   * by context. `count`/durations/ring sizes measured in the approved mock
   * (`sparkfly .42s`, `cringpop .4s`, 8px -> 44px, 6 particles).
   */
  clickSpark: {
    count: 6,
    sparkDuration: 0.42,
    ringDuration: 0.4,
    ringStartSize: 8,
    ringEndSize: 44,
  },

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
