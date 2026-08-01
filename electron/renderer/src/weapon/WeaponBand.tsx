/**
 * The bottom band: status, progress, and the weapon (D11).
 *
 * The band owns the geometry -- where the barrel is, where each action button
 * sits -- and hands it to the controller, which owns the choreography. Neither
 * one owns both, so a sequence can be tested without React and a layout change
 * cannot silently break an animation.
 */
import { useEffect, useRef } from "react";

import { onMessage } from "../bridge";
import StatStrip from "../components/StatStrip";
import { createActionController, type Geometry } from "./controller";
import { DEFAULT_WEAPON_ID, weaponById } from "./weapons";
import "./WeaponBand.css";

export interface WeaponBandProps {
  /** Which weapon is shown. Any key of the WEAPONS table. */
  weaponId?: string;
  /** The status line, already worded by the caller. */
  status?: string;
  /** Progress from 0 to 1, or null when nothing is running. */
  progress?: number | null;
  /** The quiet counter line under the bar. */
  counter?: string;
  /** The element that shakes. Defaults to the band itself. */
  frameRef?: React.RefObject<HTMLElement | null>;
  /** How to find an action button by name, for shots to aim at. */
  buttonRef?: (action: string) => HTMLElement | null;
}

/** The centre of `element` in `host`'s coordinates. */
function centreIn(element: Element | null, host: Element): { x: number; y: number } {
  if (!element) {
    // Aim at the middle of the layer rather than at (0,0): a missing button is
    // a layout bug, and a shot into the corner reads as a broken animation
    // instead of a missing target.
    const box = host.getBoundingClientRect();
    return { x: box.width / 2, y: box.height / 2 };
  }
  const a = element.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
}

export default function WeaponBand({
  weaponId = DEFAULT_WEAPON_ID,
  status = "idle",
  progress = null,
  counter = "",
  frameRef,
  buttonRef,
}: WeaponBandProps) {
  const bandRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const kickRef = useRef<HTMLSpanElement>(null);
  const muzzleRef = useRef<HTMLSpanElement>(null);
  // Read through a ref so the controller is built once and still sees the
  // current weapon: rebuilding it on every weapon change would drop an armed
  // charge on the floor.
  const weaponRef = useRef(weaponId);
  weaponRef.current = weaponId;

  const weapon = weaponById(weaponId);

  useEffect(() => {
    const host = fxRef.current;
    if (!host) return;

    const geometry: Geometry = {
      host,
      frame: frameRef?.current ?? bandRef.current,
      kick: kickRef.current,
      muzzle: () => centreIn(muzzleRef.current, host),
      target: (action) => centreIn(buttonRef?.(action) ?? null, host),
    };
    const controller = createActionController(geometry, () => weaponRef.current);

    const unsubscribe = onMessage((message) => {
      if (message.type !== "state") return;
      controller.onState(message.name, message.payload);
    });

    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [buttonRef, frameRef]);

  return (
    <div className="wband" ref={bandRef}>
      <div className="band-meta">
        <div className="band-status">{status}</div>
        <div className="band-progress">
          <i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress ?? 0)) * 100)}%` }} />
        </div>
        <div className="band-counter">{counter}</div>
        {/* User feedback 2026-08-01: Demos/Clips/Total/Avg-per-clip used to sit
            in their own card at the bottom of the Capture tab only -- gone the
            moment another tab was open. The band is mounted for the app's
            whole life (AppShell.tsx), so this is the one place they are
            always on screen. */}
        <StatStrip compact />
      </div>

      <div className="band-weapon">
        <span className="band-kick" ref={kickRef}>
          {/* The silhouette is authored SVG from `assets/`, inlined so its
              shapes inherit the accent colour. */}
          <span dangerouslySetInnerHTML={{ __html: weapon.art }} />
          <span
            className="band-muzzle"
            ref={muzzleRef}
            style={{ left: weapon.muzzle.x, top: weapon.muzzle.y }}
          />
        </span>
      </div>

      <div className="fx" ref={fxRef} />
    </div>
  );
}
