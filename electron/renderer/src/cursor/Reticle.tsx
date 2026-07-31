import { useEffect, useRef } from "react";

import "./Reticle.css";

const SNAP_MAX_WIDTH = 220;
const SNAP_MAX_HEIGHT = 120;
const SNAP_PADDING = 10;
const DEFAULT_SIZE = 26;

/**
 * Elements over which the native cursor stays -- cards, form fields, tabs,
 * the console. The reticle only replaces the OS cursor over a button or over
 * bare background (see `onMove` below).
 */
const WIDGET_SELECTOR = "input, textarea, select, a[href], label, .panel-box, .tab, .shell-logs, .chip, .segment";

/**
 * The CS2 crosshair cursor (mockup-v12-hologlass.html `.tcursor`). Position
 * and size are painted as custom properties (`--cx`/`--cy`/`--cw`/`--ch`),
 * never as `style.left`/`.top`/`.width`/`.height`: this listens to
 * `mousemove`, which IS covered by `__tests__/no-hover-motion.test.ts`'s
 * `POINTER_HANDLERS` -- writing a layout style directly here would be
 * exactly the D13/D16 regression that test exists to catch. `Reticle.css`
 * consumes the custom properties instead (`left: var(--cx)`), which is legal
 * because a custom property can hold a full `px` value.
 */
export default function Reticle() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function reveal(snap: boolean) {
      document.body.classList.add("customcursor");
      el!.classList.toggle("snap", snap);
    }

    function hide() {
      document.body.classList.remove("customcursor");
    }

    function onMove(event: MouseEvent) {
      // `event.target` is `window` (not an `Element`) when the listener is
      // attached to `window` itself and the pointer sits over bare
      // background with no element beneath it in that path -- that is the
      // background case, not a reason to bail out silently.
      const target = event.target instanceof Element ? event.target : null;

      const button = target?.closest(".btn");
      if (button) {
        const rect = button.getBoundingClientRect();
        el!.style.setProperty("--cx", `${event.clientX}px`);
        el!.style.setProperty("--cy", `${event.clientY}px`);
        el!.style.setProperty("--cw", `${Math.min(rect.width + SNAP_PADDING, SNAP_MAX_WIDTH)}px`);
        el!.style.setProperty("--ch", `${Math.min(rect.height + SNAP_PADDING, SNAP_MAX_HEIGHT)}px`);
        reveal(true);
        return;
      }

      if (target?.closest(WIDGET_SELECTOR)) {
        hide();
        return;
      }

      el!.style.setProperty("--cx", `${event.clientX}px`);
      el!.style.setProperty("--cy", `${event.clientY}px`);
      el!.style.setProperty("--cw", `${DEFAULT_SIZE}px`);
      el!.style.setProperty("--ch", `${DEFAULT_SIZE}px`);
      reveal(false);
    }

    function onLeave() {
      hide();
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      hide();
    };
  }, []);

  return (
    <div className="cursor-reticle" ref={ref} aria-hidden="true">
      <span className="rc-tl" />
      <span className="rc-tr" />
      <span className="rc-bl" />
      <span className="rc-br" />
      <span className="rc-dot" />
    </div>
  );
}
