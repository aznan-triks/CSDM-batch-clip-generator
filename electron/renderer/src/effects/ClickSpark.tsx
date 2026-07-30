import { useEffect } from "react";

import { effectiveIntensity } from "../motion/engine";
import { MOTION } from "../motion/tokens";
import "./ClickSpark.css";

/**
 * A HUD ring + a burst of particles on every mousedown, tinted by context:
 * accent over a button (`.btn`), holo cyan everywhere else.
 *
 * Listens to `mousedown`, not `mousemove`/`mouseover`/`mouseenter`
 * -- `__tests__/no-hover-motion.test.ts`'s `POINTER_HANDLERS` does not cover
 * that event, so this file is legally allowed to write `style.left`/`.top`
 * directly on the particles it spawns without joining
 * `CURSOR_DRIVEN_ALLOWLIST`: it is a one-shot click reaction, not motion tied
 * to hovering.
 *
 * Cleanup is a plain `setTimeout` sized to the animation's own duration, not
 * `motion/engine.ts`'s `play()`: there is no state to cancel here (a spark
 * never outlives its own animation the way an armed C4 charge does), so the
 * registry-and-cancel machinery would be complexity this effect does not
 * need (YAGNI).
 */
export default function ClickSpark() {
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (effectiveIntensity() === "none") return;

      const target = event.target;
      const isButton = target instanceof Element && target.closest(".btn") !== null;
      const color = isButton ? "var(--gold)" : "var(--holo)";
      const { count, sparkDuration, ringDuration, ringStartSize, ringEndSize } = MOTION.clickSpark;

      const ring = document.createElement("div");
      ring.className = "cspark-ring";
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      ring.style.setProperty("--sc", color);
      ring.style.setProperty("--ring-start", `${ringStartSize}px`);
      ring.style.setProperty("--ring-end", `${ringEndSize}px`);
      ring.style.animationDuration = `${ringDuration}s`;
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), ringDuration * 1000 + 20);

      for (let i = 0; i < count; i++) {
        const spark = document.createElement("div");
        spark.className = "cspark";
        spark.style.left = `${event.clientX}px`;
        spark.style.top = `${event.clientY}px`;
        spark.style.setProperty("--r", `${(i * 360) / count}deg`);
        spark.style.setProperty("--sc", color);
        spark.style.animationDuration = `${sparkDuration}s`;
        document.body.appendChild(spark);
        setTimeout(() => spark.remove(), sparkDuration * 1000 + 20);
      }
    }

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  return null;
}
