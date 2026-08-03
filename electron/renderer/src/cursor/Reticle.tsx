import { useEffect, useRef } from "react";

import "./Reticle.css";

const SNAP_MAX_WIDTH = 220;
const SNAP_MAX_HEIGHT = 120;
const SNAP_PADDING = 10;
const DEFAULT_SIZE = 26;

/**
 * The BACKGROUND -- the only place, besides a button, where the reticle
 * replaces the OS cursor.
 *
 * An ALLOWLIST, matched on the target itself, exactly as the approved mock
 * does it (`BG_SEL` there). It used to be a denylist of widgets, and that is
 * how this broke: restyle 5 renamed the card and the segmented control, and
 * the list kept naming their two old names -- both dead, zero usages. A
 * denylist that goes stale shows the reticle EVERYWHERE, which is why it
 * stopped reading as an accroche on a button: something already on screen
 * over every card cannot be seen to arrive on one.
 *
 * An allowlist fails the safe way round -- a renamed container means the
 * reticle stops appearing there, which is visible immediately.
 *
 * `.shell-backdrop` is this window's own: the mock's grid canvas is `.grid`.
 */
const BACKGROUND_SELECTOR =
  "body, .app, .shell, .scrollwrap, .bento, .amb, .shell-backdrop";

/**
 * Every activatable control the reticle locks onto, mock v12's own language
 * for "a target, not a background": the run/preview/stop/kill buttons
 * (`.btn`), a tag or filter pill (`.chip`), and one option of a segmented
 * control (`.seg button` -- the mock's own segment is a bare `<span>`,
 * `Segmented.tsx` wraps a real `<button>` around it as the activatable
 * element). User feedback 2026-08-01: the mock's crosshair brackets are meant
 * to "lock onto buttons on hover", and everything in this list reads as a
 * button to a user even though only `.btn` is literally `ActionButton`.
 *
 * `.tab` is DELIBERATELY excluded (2026-08-02): tabs are a nav strip, not an
 * action button. Locking the reticle onto them fought the indicator animation
 * and made switching tabs feel like aiming at a menu.
 */
const SNAP_SELECTOR = ".btn, .chip, .seg button";

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

      // Nav tabs are explicitly excluded from the reticle. `.tab` was
      // removed from SNAP_SELECTOR but could still pass the background
      // check if the pointer lands on a child deep inside the tab strip
      // whose parent chain eventually sits in `.shell`. An early
      // closest(".tab") guards against every path into that strip.
      if (target?.closest(".tab")) {
        hide();
        return;
      }

      const button = target?.closest(SNAP_SELECTOR);
      if (button) {
        const rect = button.getBoundingClientRect();
        // Centered on the button's own box, not the pointer: user feedback
        // 2026-08-02 wants the four corner brackets to read as "locked" onto
        // the button regardless of where inside it the mouse sits. The mock's
        // own JS never does this either (it also follows clientX/clientY) --
        // this is a deliberate addition beyond the mock, not a ported bug.
        el!.style.setProperty("--cx", `${rect.left + rect.width / 2}px`);
        el!.style.setProperty("--cy", `${rect.top + rect.height / 2}px`);
        el!.style.setProperty("--cw", `${Math.min(rect.width + SNAP_PADDING, SNAP_MAX_WIDTH)}px`);
        el!.style.setProperty("--ch", `${Math.min(rect.height + SNAP_PADDING, SNAP_MAX_HEIGHT)}px`);
        reveal(true);
        return;
      }

      // `matches`, not `closest`: the background is the element under the
      // pointer ITSELF. A card sitting inside `.scrollwrap` must keep the
      // native cursor, and `closest` would have found the wrapper and shown
      // the reticle over the whole workspace.
      const onBackground = target === null || target.matches(BACKGROUND_SELECTOR);
      if (!onBackground) {
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
