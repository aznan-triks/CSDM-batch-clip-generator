/**
 * STOP has no timer. This is D18 written as a test.
 *
 * The charge is planted and beeps; sixty seconds of clock go by with no
 * confirmation from the engine, and nothing detonates. The explosion arrives
 * only when `process_exited` does -- the event the Python engine now raises
 * after actually watching cs2.exe leave the task list.
 *
 * The other half of the file proves the weapon table is the only thing a new
 * weapon touches: the AWP goes through every action with no change to
 * sequences.ts, which is what makes ~45 weapons tenable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSequences, setIntensity } from "../../motion/engine";
import { MOTION } from "../../motion/tokens";
import { createActionController, type Geometry } from "../controller";
import { forgetWeaponSequences } from "../sequences";
import { WEAPONS } from "../weapons";

function makeGeometry(): Geometry {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return {
    host,
    frame: document.createElement("div"),
    kick: document.createElement("span"),
    muzzle: () => ({ x: 10, y: 40 }),
    target: () => ({ x: 300, y: 20 }),
  };
}

function countOf(host: HTMLElement, className: string): number {
  return host.querySelectorAll(`.${className}`).length;
}

/** Record the class of everything the sequences add, as they add it. */
function recordSpawns(host: HTMLElement): string[] {
  const created: string[] = [];
  const append = host.appendChild.bind(host);
  host.appendChild = ((node: Node) => {
    created.push((node as HTMLElement).className ?? "");
    return append(node);
  }) as typeof host.appendChild;
  return created;
}

/** Everything the detonation puts on screen, and nothing the wait does. */
const DETONATION_CLASSES = ["core", "fire", "shock", "smoke", "debris", "blastflash"];

function detonationElements(host: HTMLElement): number {
  return DETONATION_CLASSES.reduce((total, name) => total + countOf(host, name), 0);
}

let geometry: Geometry;
let weaponId = "ak47";

beforeEach(() => {
  vi.useFakeTimers();
  resetSequences();
  forgetWeaponSequences();
  setIntensity("full");
  weaponId = "ak47";
  geometry = makeGeometry();
});

afterEach(() => {
  vi.useRealTimers();
  geometry.host.remove();
});

describe("STOP waits for the engine, not for a clock", () => {
  it("plants the charge and beeps, with nothing exploding", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("stop_requested");

    expect(countOf(geometry.host, "c4")).toBe(1);
    expect(controller.isArmed()).toBe(true);

    vi.advanceTimersByTime(MOTION.c4Beat.interval * 1000 * 3);
    expect(countOf(geometry.host, "beep")).toBeGreaterThan(0);
    expect(detonationElements(geometry.host)).toBe(0);
  });

  it("sixty seconds pass with no confirmation and still nothing detonates", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("stop_requested");

    vi.advanceTimersByTime(60_000);

    expect(detonationElements(geometry.host)).toBe(0);
    expect(countOf(geometry.host, "c4")).toBe(1);
    expect(controller.isArmed()).toBe(true);
  });

  it("detonates on the confirmation, and the effects layer empties", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("stop_requested");
    vi.advanceTimersByTime(60_000);

    controller.onState("process_exited", { name: "cs2.exe" });

    expect(controller.isArmed()).toBe(false);
    expect(countOf(geometry.host, "c4")).toBe(0);
    expect(detonationElements(geometry.host)).toBeGreaterThan(0);

    // Cleanup runs off the clock, so running it out must leave nothing behind.
    vi.advanceTimersByTime(10_000);
    expect(geometry.host.childElementCount).toBe(0);
  });

  it("a process exit nobody staged detonates nothing", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("process_exited", { name: "cs2.exe" });
    expect(detonationElements(geometry.host)).toBe(0);
  });

  it("a second stop while armed leaves the single charge alone", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("stop_requested");
    controller.onState("stop_requested");
    expect(countOf(geometry.host, "c4")).toBe(1);
  });
});

describe("the other three actions", () => {
  it("KILL is immediate and waits for nothing", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("kill_requested");
    expect(controller.isArmed()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(geometry.host.childElementCount).toBe(0);
  });

  it("PREVIEW opens its reticle -- the one that was lost once", () => {
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("preview_started");
    expect(countOf(geometry.host, "reticle")).toBe(1);
  });

  it("RUN fires as many rounds as the table says", () => {
    // Counted as they are CREATED, not as they are present: a muzzle flash
    // lasts 95 ms and the rounds are 92 ms apart, so the first one is already
    // gone when the third leaves.
    const created = recordSpawns(geometry.host);
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("run_started");
    expect(created.filter((name) => name === "flash")).toHaveLength(1);

    vi.advanceTimersByTime(WEAPONS.ak47.gap * 1000 * WEAPONS.ak47.shots);
    expect(created.filter((name) => name === "flash")).toHaveLength(WEAPONS.ak47.shots);
  });

  it("leaves nothing behind once every sequence has run out", () => {
    const controller = createActionController(geometry, () => weaponId);
    for (const event of ["run_started", "preview_started", "kill_requested"]) {
      controller.onState(event);
      vi.advanceTimersByTime(10_000);
    }
    expect(geometry.host.childElementCount).toBe(0);
  });
});

describe("adding a weapon is a table entry, not code", () => {
  it("the AWP plays every action through the same frame", () => {
    weaponId = "awp";
    const controller = createActionController(geometry, () => weaponId);

    controller.onState("run_started");
    expect(countOf(geometry.host, "flash")).toBe(WEAPONS.awp.shots);

    vi.advanceTimersByTime(10_000);
    controller.onState("stop_requested");
    expect(countOf(geometry.host, "c4")).toBe(1);
    controller.onState("process_exited", {});
    expect(detonationElements(geometry.host)).toBeGreaterThan(0);

    vi.advanceTimersByTime(10_000);
    expect(geometry.host.childElementCount).toBe(0);
  });

  it("every weapon declares the same fields, so none needs a special case", () => {
    const shape = Object.keys(WEAPONS.ak47).sort();
    for (const weapon of Object.values(WEAPONS)) {
      expect(Object.keys(weapon).sort()).toEqual(shape);
    }
  });
});

describe("intensity", () => {
  it("under `none` the charge is still there, it simply does not beep", () => {
    setIntensity("none");
    const controller = createActionController(geometry, () => weaponId);
    controller.onState("stop_requested");

    expect(countOf(geometry.host, "c4")).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(countOf(geometry.host, "beep")).toBe(0);
    expect(detonationElements(geometry.host)).toBe(0);
  });
});
