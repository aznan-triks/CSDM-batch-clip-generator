/**
 * The four action sequences, on ONE frame parameterised per weapon.
 *
 * Extracted from the approved mock (ui-v5.html) rather than reinvented. Three
 * things about them are load-bearing:
 *
 * 1. STOP HAS NO TIMER. It plants the charge, withdraws the weapon and beeps,
 *    and then it stops doing anything. The detonation is a SEPARATE sequence,
 *    played only when the engine says `process_exited`. If the game refuses to
 *    close, the charge beeps forever -- which is exactly the information the
 *    user needs at that moment (D17, D18).
 * 2. NO NUMBER LIVES IN A FUNCTION HERE. Shared numbers come from MOTION,
 *    per-weapon numbers from WEAPONS. That is what makes a new weapon a table
 *    entry and a drawing, with no code.
 * 3. CLEANUP IS ON THE CLOCK. Every spawned element is handed to `hold` or
 *    removed by the canceller; nothing waits on `onfinish`, which never fires
 *    while the window is hidden.
 */
import { MOTION } from "../motion/tokens";
import { registerSequence, type SequenceContext } from "../motion/engine";
import { C4_ART, weaponById, type WeaponSpec } from "./weapons";

/** A point in the effects layer's own coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** What every action sequence is handed through the state payload. */
export interface ActionPayload {
  /** Which weapon is in the band. */
  weaponId: string;
  /** Where the barrel ends. */
  muzzle: Point;
  /** What is being shot at -- the button that triggered the engine action. */
  target: Point;
  /** The element that recoils. */
  kick: HTMLElement | null;
  /** The element that shakes: the whole window frame. */
  frame: HTMLElement | null;
}

/**
 * Run a Web Animations keyframe set, or do nothing where the API is absent.
 *
 * jsdom has no Web Animations API at all. Without this guard every sequence
 * would throw under test, and the tests that matter -- the ones proving STOP
 * waits -- could not run headless.
 */
function animate(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): void {
  if (!element || typeof (element as HTMLElement).animate !== "function") return;
  (element as HTMLElement).animate(keyframes, options);
}

/** Seconds to the milliseconds the Web Animations API wants. */
function ms(seconds: number): number {
  return Math.max(0, seconds) * 1000;
}

function payloadOf(context: SequenceContext): ActionPayload {
  return context.payload as unknown as ActionPayload;
}

function place(element: HTMLElement, at: Point): void {
  element.style.left = `${at.x}px`;
  element.style.top = `${at.y}px`;
}

// -- the shared pieces -------------------------------------------------------

/** The very short, very bright frames at the point of impact. */
function impactFrame(context: SequenceContext, at: Point, power: number): void {
  const { impact } = MOTION;
  const size = impact.starBase + power * impact.starPerPower;

  const star = context.spawn("istar", at.x, at.y);
  animate(
    star,
    [
      { opacity: 0, transform: `scale(${size * 0.3}) rotate(0deg)` },
      { opacity: 0.95, transform: `scale(${size}) rotate(14deg)`, offset: 0.2 },
      { opacity: 0.95, transform: `scale(${size * 1.05}) rotate(20deg)`, offset: 0.45 },
      { opacity: 0, transform: `scale(${size * 1.3}) rotate(30deg)` },
    ],
    { duration: ms(context.scale(impact.starDuration)), easing: `steps(${impact.frames}, end)` },
  );
  context.hold(star, context.scale(impact.starDuration));

  const flash = context.spawn("iflash");
  const peak = impact.flashOpacity * power;
  animate(
    flash,
    [{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: peak, offset: 0.5 }, { opacity: 0 }],
    { duration: ms(context.scale(impact.flashDuration)), easing: `steps(${impact.frames}, end)` },
  );
  context.hold(flash, context.scale(impact.flashDuration));

  const ring = context.spawn("ring", at.x, at.y);
  const end = impact.ringBase + power * impact.ringPerPower;
  animate(
    ring,
    [
      { opacity: 1, transform: "scale(.4)" },
      { opacity: 0, transform: `scale(${end})` },
    ],
    { duration: ms(context.scale(impact.ringDuration)), easing: impact.ringEase },
  );
  context.hold(ring, context.scale(impact.ringDuration));
}

/** One round: flash, tracer, spark, impact, and the case leaving the weapon. */
function shot(
  context: SequenceContext,
  weapon: WeaponSpec,
  from: Point,
  to: Point,
  weak: boolean,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const power = weak ? MOTION.weakShot.flash : weapon.flash;

  const flash = context.spawn("flash", from.x, from.y);
  flash.style.transform = `rotate(${angle}deg)`;
  animate(
    flash,
    [
      { opacity: 0, transform: `rotate(${angle}deg) scale(.3)` },
      { opacity: 1, transform: `rotate(${angle}deg) scale(${1.1 * power})`, offset: 0.25 },
      { opacity: 0, transform: `rotate(${angle}deg) scale(${0.5 * power})` },
    ],
    { duration: ms(context.scale(MOTION.flash.duration)), easing: MOTION.flash.ease },
  );
  context.hold(flash, context.scale(MOTION.flash.duration));

  const { tracer } = MOTION;
  const travel = context.scale(
    Math.max(
      tracer.minDuration,
      (distance * (weak ? tracer.weakDistanceFactor : tracer.distanceFactor)) / 1000,
    ),
  );
  const round = context.spawn("tracer", from.x, from.y);
  round.style.width = `${weak ? tracer.weakWidth : tracer.baseWidth + weapon.flash * tracer.perFlash}px`;
  round.style.height = `${weak ? tracer.weakHeight : tracer.baseHeight + weapon.flash * tracer.perFlashHeight}px`;
  round.style.transform = `rotate(${angle}deg)`;
  animate(
    round,
    [
      { transform: `rotate(${angle}deg) translateX(0px)`, opacity: 1 },
      {
        transform: `rotate(${angle}deg) translateX(${distance - tracer.shortfall}px)`,
        opacity: 0.9,
      },
    ],
    { duration: ms(travel), easing: tracer.ease },
  );
  context.hold(round, travel);

  // The hit lands when the round arrives, not on a guess.
  context.after(travel, () => {
    if (context.decorative) {
      const spark = context.spawn("spark", to.x, to.y);
      animate(
        spark,
        [
          { opacity: 1, transform: `scale(${MOTION.spark.startScale})` },
          { opacity: 0, transform: `scale(${MOTION.spark.endScale})` },
        ],
        { duration: ms(context.scale(MOTION.spark.duration)), easing: MOTION.spark.ease },
      );
      context.hold(spark, context.scale(MOTION.spark.duration));
    }
    if (!weak && context.decorative) impactFrame(context, to, weapon.impact);
  });

  if (weak || !context.decorative) return;

  const { shell } = MOTION;
  const case_ = context.spawn("shell", from.x + dx * shell.originFactor, from.y);
  case_.style.width = `${weapon.shell.w}px`;
  case_.style.height = `${weapon.shell.h}px`;
  const side = dx < 0 ? 1 : -1;
  animate(
    case_,
    [
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      {
        transform: `translate(${side * shell.riseX}px,${shell.riseY}px) rotate(${shell.riseSpin}deg)`,
        opacity: 1,
        offset: 0.42,
      },
      {
        transform: `translate(${side * shell.fallX}px,${shell.fallY}px) rotate(${shell.fallSpin}deg)`,
        opacity: 0,
      },
    ],
    { duration: ms(context.scale(shell.duration)), easing: shell.ease },
  );
  context.hold(case_, context.scale(shell.duration));
}

function recoil(context: SequenceContext, weapon: WeaponSpec, weak: boolean): void {
  const { kick } = payloadOf(context);
  const factor = weak ? MOTION.weakShot.recoilFactor : 1;
  const back = weapon.kick * factor;
  const rotation = weapon.rot * factor;
  const duration = weak
    ? MOTION.recoil.weakDuration
    : weapon.bolt
      ? MOTION.recoil.boltDuration
      : MOTION.recoil.duration;
  animate(
    kick,
    [
      { transform: "translateX(0) rotate(0deg)" },
      {
        transform: `translateX(${back}px) rotate(${rotation}deg)`,
        offset: weapon.bolt ? 0.12 : 0.16,
      },
      {
        transform: `translateX(${back * 0.3}px) rotate(${rotation * 0.3}deg)`,
        offset: 0.55,
      },
      { transform: "translateX(0) rotate(0deg)" },
    ],
    { duration: ms(context.scale(duration)), easing: MOTION.recoil.ease },
  );
}

function boltCycle(context: SequenceContext): void {
  const { kick } = payloadOf(context);
  animate(
    kick,
    [
      { transform: "translateX(0) rotate(0deg)" },
      { transform: "translateX(6px) rotate(2deg)", offset: 0.3 },
      { transform: "translateX(-3px) rotate(-1deg)", offset: 0.65 },
      { transform: "translateX(0) rotate(0deg)" },
    ],
    { duration: ms(context.scale(MOTION.bolt.duration)), easing: MOTION.bolt.ease },
  );
}

function shake(context: SequenceContext, amplitude: number, duration: number): void {
  const { frame } = payloadOf(context);
  const a = Math.max(0, amplitude);
  animate(
    frame,
    [
      { transform: "translate(0,0)" },
      { transform: `translate(${a}px,${-a}px)`, offset: 0.14 },
      { transform: `translate(${-a * 0.8}px,${a * 0.8}px)`, offset: 0.34 },
      { transform: `translate(${a * 0.5}px,${a * 0.3}px)`, offset: 0.56 },
      { transform: `translate(${-a * 0.25}px,0)`, offset: 0.78 },
      { transform: "translate(0,0)" },
    ],
    { duration: ms(context.scale(duration)), easing: MOTION.shake.ease },
  );
}

// -- the four actions --------------------------------------------------------

/** RUN: the weapon's own burst. Everything about it comes from the table. */
function playRun(context: SequenceContext): void {
  const payload = payloadOf(context);
  const weapon = weaponById(payload.weaponId);

  const fire = (index: number) => {
    shot(context, weapon, payload.muzzle, payload.target, false);
    recoil(context, weapon, false);
    shake(context, weapon.shake - index * MOTION.shake.burstFalloff, MOTION.shake.duration);
    if (index + 1 < weapon.shots) {
      context.after(weapon.gap * (index + 1), () => fire(index + 1));
    } else if (weapon.bolt) {
      context.after(weapon.bolt, () => boltCycle(context));
    }
  };
  fire(0);
}

/** PREVIEW: the opening reticle, then one contained shot. */
function playPreview(context: SequenceContext): void {
  const payload = payloadOf(context);
  const weapon = weaponById(payload.weaponId);
  const { reticle } = MOTION;

  const sight = context.spawn("reticle", payload.target.x, payload.target.y);
  animate(
    sight,
    [
      { opacity: 0, transform: `scale(${reticle.startScale}) rotate(0deg)` },
      { opacity: 1, transform: "scale(1) rotate(45deg)", offset: 0.4 },
      { opacity: 1, transform: "scale(1) rotate(45deg)", offset: 0.8 },
      { opacity: 0, transform: `scale(${reticle.endScale}) rotate(90deg)` },
    ],
    { duration: ms(context.scale(reticle.duration)), easing: reticle.ease },
  );
  context.hold(sight, context.scale(reticle.duration));

  context.after(context.scale(reticle.shotDelay), () => {
    shot(context, weapon, payload.muzzle, payload.target, true);
    recoil(context, weapon, true);
  });
}

/**
 * STOP: plant the charge, withdraw the weapon, and beep. Then WAIT.
 *
 * There is deliberately no `after` that ends this sequence. It runs until the
 * `detonate` sequence replaces it or the caller cancels it.
 */
function playStop(context: SequenceContext): void {
  const payload = payloadOf(context);
  const { c4Place, c4Plant, c4Withdraw, c4Beat } = MOTION;
  const at = {
    x: payload.muzzle.x + c4Place.offsetX,
    y: payload.muzzle.y + c4Place.offsetY,
  };

  const charge = context.spawn("c4", at.x, at.y);
  charge.innerHTML = `${C4_ART}<span class="tag">armed · waiting</span>`;
  animate(
    charge,
    [
      { opacity: 0, transform: `translateY(${c4Place.dropHeight}px) rotate(${c4Place.dropRotation}deg)` },
      { opacity: 1, transform: "translateY(0) rotate(0deg)", offset: 0.72 },
      { opacity: 1, transform: `translateY(0) rotate(0deg) scaleY(${c4Place.squash})`, offset: 0.84 },
      { opacity: 1, transform: "translateY(0) rotate(0deg) scaleY(1)" },
    ],
    { duration: ms(context.scale(c4Plant.duration)), easing: c4Plant.ease },
  );

  animate(
    payload.kick,
    [{ transform: "translateX(0)" }, { transform: `translateX(${c4Withdraw.distance}px)` }],
    {
      duration: ms(context.scale(c4Withdraw.duration)),
      delay: ms(context.scale(c4Withdraw.delay)),
      easing: c4Withdraw.ease,
      fill: "forwards",
    },
  );

  // The wait. This loops with no end condition of its own -- on purpose.
  context.every(c4Beat.interval, () => {
    const led = charge.querySelector(".led");
    animate(led, [{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }], {
      duration: ms(context.scale(c4Beat.ledDuration)),
    });
    const ping = context.spawn("beep", at.x + c4Beat.offsetX, at.y + c4Beat.offsetY);
    animate(
      ping,
      [
        { opacity: 0.9, transform: "scale(.5)" },
        { opacity: 0, transform: `scale(${c4Beat.ringEndScale})` },
      ],
      { duration: ms(context.scale(c4Beat.ringDuration)), easing: c4Beat.ringEase },
    );
    context.hold(ping, context.scale(c4Beat.ringDuration));
  });
}

/**
 * The detonation. Played ONLY on the engine's `process_exited` event.
 *
 * It is a sequence of its own rather than the tail of STOP precisely so that
 * no code path can reach it from a timer.
 */
function playDetonate(context: SequenceContext): void {
  const payload = payloadOf(context);
  const { detonation } = MOTION;
  const at = {
    x: payload.muzzle.x + MOTION.c4Place.offsetX,
    y: payload.muzzle.y + MOTION.c4Place.offsetY,
  };

  const blast = context.spawn("blastflash");
  animate(
    blast,
    [{ opacity: 0 }, { opacity: 0.62, offset: 0.2 }, { opacity: 0.5, offset: 0.45 }, { opacity: 0 }],
    { duration: ms(context.scale(detonation.blastFlash.duration)), easing: "steps(4, end)" },
  );
  context.hold(blast, context.scale(detonation.blastFlash.duration));

  const core = context.spawn("core", at.x, at.y);
  animate(
    core,
    [
      { opacity: 1, transform: "scale(.1)" },
      { opacity: 1, transform: "scale(1.6)", offset: 0.35 },
      { opacity: 0, transform: "scale(2.2)" },
    ],
    { duration: ms(context.scale(detonation.core.duration)), easing: detonation.core.ease },
  );
  context.hold(core, context.scale(detonation.core.duration));

  const fire = context.spawn("fire", at.x, at.y);
  animate(
    fire,
    [
      { opacity: 0, transform: "scale(.12)" },
      { opacity: 1, transform: "scale(.85)", offset: 0.22 },
      { opacity: 0.85, transform: "scale(1.25)", offset: 0.55 },
      { opacity: 0, transform: "scale(1.6)" },
    ],
    { duration: ms(context.scale(detonation.fire.duration)), easing: detonation.fire.ease },
  );
  context.hold(fire, context.scale(detonation.fire.duration));

  const shock = context.spawn("shock", at.x, at.y);
  animate(
    shock,
    [
      { opacity: 0.95, transform: "scale(.3)", borderWidth: "4px" },
      { opacity: 0, transform: "scale(26)", borderWidth: "1px" },
    ],
    { duration: ms(context.scale(detonation.shock.duration)), easing: detonation.shock.ease },
  );
  context.hold(shock, context.scale(detonation.shock.duration));

  const smoke = context.spawn("smoke", at.x, at.y);
  animate(
    smoke,
    [
      { opacity: 0, transform: "scale(.4) translateY(0)" },
      { opacity: 0.9, transform: "scale(1.3) translateY(-14px)", offset: 0.35 },
      { opacity: 0, transform: "scale(2.1) translateY(-46px)" },
    ],
    {
      duration: ms(context.scale(detonation.smoke.duration)),
      delay: ms(context.scale(detonation.smoke.delay)),
      easing: detonation.smoke.ease,
    },
  );
  context.hold(smoke, context.scale(detonation.smoke.duration + detonation.smoke.delay));

  const { debris } = detonation;
  for (let i = 0; i < debris.count; i += 1) {
    const angle = (Math.PI * 2 * i) / debris.count + (i % 3) * debris.spread;
    const distance = debris.baseDistance + (i % 5) * debris.perStep;
    const size = debris.baseSize + (i % 4) * debris.sizeStep;
    const fragment = context.spawn("debris", at.x, at.y);
    fragment.style.width = `${size}px`;
    fragment.style.height = `${Math.max(2, size - 1)}px`;
    const duration = context.scale(debris.duration + (i % 5) * debris.durationStep);
    animate(
      fragment,
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        {
          transform:
            `translate(${Math.cos(angle) * distance}px,` +
            `${Math.sin(angle) * distance * debris.verticalSquash + debris.fall}px) ` +
            `rotate(${debris.spin + i * debris.spinStep}deg)`,
          opacity: 0,
        },
      ],
      { duration: ms(duration), easing: debris.ease },
    );
    context.hold(fragment, duration);
  }

  shake(context, MOTION.shake.detonationAmplitude, MOTION.shake.detonationDuration);
}

/**
 * KILL: the shot that did it, then bolt slammed, frame shaken, weapon out of
 * frame. No waiting, ever. AUDIT_huit_pistes_post_v299.md P6 -- the fire
 * itself (flash, tracer, recoil) already existed for RUN/PREVIEW and was
 * never played here; the retraction it now leads into is unchanged.
 */
function playKill(context: SequenceContext): void {
  const payload = payloadOf(context);
  const weapon = weaponById(payload.weaponId);
  const { killRetract } = MOTION;

  shot(context, weapon, payload.muzzle, payload.target, false);
  recoil(context, weapon, false);
  boltCycle(context);
  shake(context, killRetract.shake, MOTION.shake.duration);
  context.after(context.scale(killRetract.delay), () => {
    animate(
      payload.kick,
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: `translateX(${killRetract.distance}px)`, opacity: 0, offset: 0.55 },
        { transform: `translateX(${killRetract.distance}px)`, opacity: 0, offset: 0.8 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: ms(context.scale(killRetract.duration)), easing: killRetract.ease },
    );
  });
}

/** The names the controller plays. Exported so nothing has to spell them twice. */
export const ACTION_SEQUENCES = {
  run: "weapon:run",
  preview: "weapon:preview",
  stop: "weapon:stop",
  detonate: "weapon:detonate",
  kill: "weapon:kill",
} as const;

let registered = false;

/**
 * Register the five sequences. Safe to call twice: the registry throws on a
 * duplicate name, and React mounts a component twice under StrictMode.
 */
export function registerWeaponSequences(): void {
  if (registered) return;
  registered = true;
  registerSequence(ACTION_SEQUENCES.run, { play: playRun });
  registerSequence(ACTION_SEQUENCES.preview, { play: playPreview });
  // Under `none` the charge still has to be visible and still has to say it is
  // waiting -- the state is real, only the movement is dropped.
  registerSequence(ACTION_SEQUENCES.stop, { play: playStop, settle: settleStop });
  registerSequence(ACTION_SEQUENCES.detonate, { play: playDetonate });
  registerSequence(ACTION_SEQUENCES.kill, { play: playKill });
}

/** Test seam: let a fresh registry be filled again. */
export function forgetWeaponSequences(): void {
  registered = false;
}

function settleStop(context: SequenceContext): void {
  const payload = payloadOf(context);
  const at = {
    x: payload.muzzle.x + MOTION.c4Place.offsetX,
    y: payload.muzzle.y + MOTION.c4Place.offsetY,
  };
  const charge = context.spawn("c4", at.x, at.y);
  charge.innerHTML = `${C4_ART}<span class="tag">armed · waiting</span>`;
  place(charge, at);
}
