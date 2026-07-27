/**
 * The weapon table. ONE animation frame, parameterised per weapon.
 *
 * Adding a weapon is: draw its silhouette as an SVG in `assets/`, add an entry
 * here. Nothing in `sequences.ts` may need to change -- if it does, the frame
 * is badly parameterised and that is the bug, not the new weapon.
 *
 * Numbers come from the approved mock (ui-v5.html, `SPEC`), converted from
 * milliseconds to seconds so they read like every other duration in the
 * renderer. Shared motion numbers are NOT here: they live in `motion/tokens.ts`
 * so that two weapons can never drift apart on how a tracer eases.
 */
import ak47Art from "./assets/ak47.svg?raw";
import awpArt from "./assets/awp.svg?raw";

export interface WeaponSpec {
  /** Stable key, used by the picker and by the settings file. */
  readonly id: string;
  /** Shown to the user. */
  readonly name: string;
  /** The silhouette, inlined. Drawn pointing right; the band mirrors it. */
  readonly art: string;
  /**
   * Where the barrel ends, in percent of the RENDERED silhouette box. Every
   * shot leaves from here, so it is per-weapon geometry and not a style.
   */
  readonly muzzle: { readonly x: string; readonly y: string };
  /** How many rounds one RUN fires. */
  readonly shots: number;
  /** Seconds between two rounds of a burst. Meaningless when `shots` is 1. */
  readonly gap: number;
  /** How far the weapon travels back, in pixels. */
  readonly kick: number;
  /** How far the barrel lifts, in degrees. Negative lifts the muzzle. */
  readonly rot: number;
  /** Muzzle-flash size multiplier; also thickens the tracer. */
  readonly flash: number;
  /** Impact-frame power, 0..1. Drives the star, the white flash and the ring. */
  readonly impact: number;
  /** Frame-shake amplitude in pixels, for the first round of the burst. */
  readonly shake: number;
  /** Ejected case size in pixels. */
  readonly shell: { readonly w: number; readonly h: number };
  /**
   * Seconds after the last round before the bolt is worked, or 0 for weapons
   * that do not cycle visibly. This alone is what makes the AWP read as a
   * bolt-action without a line of code of its own.
   */
  readonly bolt: number;
}

export const WEAPONS: Record<string, WeaponSpec> = {
  ak47: {
    id: "ak47",
    name: "AK-47",
    art: ak47Art,
    muzzle: { x: "4.1%", y: "52%" },
    shots: 3,
    gap: 0.092,
    kick: 13,
    rot: -6,
    flash: 1.0,
    impact: 0.55,
    shake: 2.6,
    shell: { w: 8, h: 4 },
    bolt: 0,
  },
  awp: {
    id: "awp",
    name: "AWP",
    art: awpArt,
    muzzle: { x: "2.5%", y: "52%" },
    shots: 1,
    gap: 0,
    kick: 30,
    rot: -9,
    flash: 1.75,
    impact: 1,
    shake: 4.2,
    shell: { w: 13, h: 4 },
    bolt: 0.48,
  },
};

/** The weapon shown until the user picks one. */
export const DEFAULT_WEAPON_ID = "ak47";

export function weaponById(id: string): WeaponSpec {
  const weapon = WEAPONS[id];
  if (!weapon) {
    // Fail fast: a silently substituted weapon would show the wrong recoil for
    // the rest of the session and look like an animation bug.
    throw new Error(`unknown weapon: ${id}`);
  }
  return weapon;
}

/** The C4 charge, drawn once. Colours come from the theme, never from here. */
export const C4_ART =
  '<svg viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">' +
  '<rect class="cbody" x="2" y="10" width="30" height="32" rx="2"/>' +
  '<rect class="tape" x="2" y="18" width="30" height="5"/>' +
  '<rect class="tape" x="2" y="32" width="30" height="5"/>' +
  '<rect class="cpanel" x="7" y="24" width="13" height="6" rx="1"/>' +
  '<circle class="led" cx="26" cy="27" r="3.2"/>' +
  '<rect class="cbody" x="15" y="1" width="3" height="10"/></svg>';
