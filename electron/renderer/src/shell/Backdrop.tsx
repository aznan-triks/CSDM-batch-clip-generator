/**
 * The backdrop: ONE canvas, redrawn in a single pass per frame.
 *
 * It reads its colours from the theme tokens at run time, so day/night and a
 * changed accent need no JavaScript here -- only a re-read, triggered by the
 * `data-mode` attribute changing on <html>.
 *
 * Under intensity `none` (or the system's reduced-motion preference, which
 * wins) it paints the resting state ONCE and starts no loop at all: a work
 * tool must be able to hold still.
 */
import { useEffect, useRef } from "react";

import { effectiveIntensity, onIntensityChange } from "../motion/engine";
// "backdropField", not "backdrop": a file named "backdrop.ts" next to this
// "Backdrop.tsx" differs only in casing, which TypeScript's own portability
// check (forceConsistentCasingInFileNames) refuses regardless of host OS.
import { borderAlpha, cellIntensity, fieldForTab, parseAlpha } from "./backdropField";
import type { BackdropField } from "./backdropField";

/** The tokens the canvas needs as concrete values, since it cannot use var(). */
interface Palette {
  fill: string;
  bevel: string;
  holo: [number, number, number];
  /** Resting/active border alpha, read from `--glow-in`/`--glow-out` -- the
   *  mode-reactive strength of the holographic glow (weaker in light mode,
   *  where the ground already carries most of the brightness). */
  glowInAlpha: number;
  glowOutAlpha: number;
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const holo = style.getPropertyValue("--holo").trim();
  const parse = (from: number): number => parseInt(holo.slice(from, from + 2), 16);
  return {
    fill: style.getPropertyValue("--tile-fill").trim(),
    bevel: style.getPropertyValue("--tile-bevel").trim(),
    holo: [parse(1), parse(3), parse(5)],
    glowInAlpha: parseAlpha(style.getPropertyValue("--glow-in").trim()),
    glowOutAlpha: parseAlpha(style.getPropertyValue("--glow-out").trim()),
  };
}

export default function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // jsdom has no 2D context. The backdrop is decoration: skip it rather
    // than crash the whole shell in a test environment.
    if (!ctx) return;

    let palette = readPalette();
    let plates: Float32Array = new Float32Array(0);
    let cols = 0;
    let rows = 0;
    let cursorX = -1e4;
    let cursorY = -1e4;
    let frame = 0;

    // The field is per TAB (`BACKDROP_BY_TAB`): a `let`, re-read whenever the
    // shell stamps a different `data-tab` on <html>. `plateSize` and `offset`
    // derive from it, so they move with it.
    let field: BackdropField = fieldForTab(document.documentElement.dataset.tab);
    let plateSize = field.cell - field.gap;
    let offset = field.gap / 2;

    function layout(): void {
      const ratio = Math.min(field.maxPixelRatio, window.devicePixelRatio || 1);
      // Non-null assertions, same as every `ctx!` below: TS resets narrowing
      // for a variable captured by a nested function declaration, even a
      // `const` that was null-checked just above in the enclosing effect.
      canvas!.width = Math.ceil(window.innerWidth * ratio);
      canvas!.height = Math.ceil(window.innerHeight * ratio);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.ceil(window.innerWidth / field.cell) + 1;
      rows = Math.ceil(window.innerHeight / field.cell) + 1;
      plates = new Float32Array(cols * rows);
    }

    /** One full pass. `time` drifts the field; `animated` eases, else it snaps. */
    function draw(time: number, animated: boolean): void {
      const [r, g, b] = palette.holo;
      const cursorCol = cursorX / field.cell;
      const cursorRow = cursorY / field.cell;

      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Pass 1 -- the plates themselves, all in one fill/stroke style.
      ctx!.fillStyle = palette.fill;
      ctx!.strokeStyle = `rgba(${r},${g},${b},${palette.glowInAlpha})`;
      ctx!.lineWidth = 1;
      const active: number[] = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const target = cellIntensity(col, row, cursorCol, cursorRow, time, field);
          const previous = plates[index];
          const value = animated ? previous + (target - previous) * field.ease : target;
          plates[index] = value;

          const x = col * field.cell + offset;
          const y = row * field.cell + offset;
          ctx!.fillRect(x, y, plateSize, plateSize);
          ctx!.strokeRect(x + 0.5, y + 0.5, plateSize - 1, plateSize - 1);
          if (value > field.visibleFloor) active.push(x, y, value);
        }
      }

      // Pass 2 -- the holographic sheen, only where the cursor reaches.
      const { tintAlpha, topBarAlpha, topBarHeight, scanAlpha, scanStep } = field.sheen;
      for (let i = 0; i < active.length; i += 3) {
        const x = active[i];
        const y = active[i + 1];
        const a = active[i + 2];

        ctx!.fillStyle = `rgba(${r},${g},${b},${a * tintAlpha})`;
        ctx!.fillRect(x, y, plateSize, plateSize);

        ctx!.fillStyle = palette.bevel;
        ctx!.fillRect(x, y, plateSize, 1);

        ctx!.fillStyle = `rgba(${r},${g},${b},${a * topBarAlpha})`;
        ctx!.fillRect(x, y, plateSize, topBarHeight);

        ctx!.fillStyle = `rgba(${r},${g},${b},${a * scanAlpha})`;
        for (let line = y + topBarHeight; line < y + plateSize - 1; line += scanStep) {
          ctx!.fillRect(x + 2, line, plateSize - 4, 1);
        }

        ctx!.strokeStyle = `rgba(${r},${g},${b},${borderAlpha(palette.glowInAlpha, palette.glowOutAlpha, a)})`;
        ctx!.strokeRect(x + 0.5, y + 0.5, plateSize - 1, plateSize - 1);
      }
    }

    function loop(time: number): void {
      draw(time, true);
      frame = requestAnimationFrame(loop);
    }

    /**
     * Start or stop the loop for the intensity in force. `none` paints the
     * resting state once and schedules nothing: no frame is ever requested,
     * which is the difference between "still" and "animating invisibly".
     */
    function applyIntensity(): void {
      cancelAnimationFrame(frame);
      frame = 0;
      if (effectiveIntensity() === "none") {
        cursorX = -1e4;
        cursorY = -1e4;
        draw(0, false);
        return;
      }
      frame = requestAnimationFrame(loop);
    }

    function onPointerMove(event: MouseEvent): void {
      cursorX = event.clientX;
      cursorY = event.clientY;
    }

    function onPointerLeave(): void {
      cursorX = -1e4;
      cursorY = -1e4;
    }

    function onResize(): void {
      layout();
      if (effectiveIntensity() === "none") draw(0, false);
    }

    // A theme change swaps every token; the canvas holds concrete values, so
    // it has to re-read them. Cheap, and only when the attribute changes.
    const themeWatcher = new MutationObserver(() => {
      palette = readPalette();
      // The tab may have changed too, which changes the FIELD, which changes
      // the grid size -- so the plate buffer has to be rebuilt, not just
      // repainted. Cheap, and only when an attribute actually moved.
      const next = fieldForTab(document.documentElement.dataset.tab);
      if (next.cell !== field.cell || next.gap !== field.gap) {
        field = next;
        plateSize = field.cell - field.gap;
        offset = field.gap / 2;
        layout();
      } else {
        field = next;
      }
      if (effectiveIntensity() === "none") draw(0, false);
    });
    // `style` as well as `data-mode`: theme/accent.ts writes the accent -- and
    // now `--holo`, the ground's own hue -- as inline custom properties on
    // <html>, so an accent change surfaces as a style-attribute mutation and
    // nothing else. Watching only `data-mode` meant a new accent repainted
    // every surface in the window except this one.
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode", "style", "data-tab"],
    });

    layout();
    applyIntensity();
    const stopIntensity = onIntensityChange(applyIntensity);
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    document.addEventListener("mouseleave", onPointerLeave);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      themeWatcher.disconnect();
      stopIntensity();
      window.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas className="shell-backdrop" ref={canvasRef} aria-hidden="true" />;
}
