import { useEffect, useRef } from "react";

import "./Reticle.css";

const SNAP_PADDING = 10;
const DEFAULT_SIZE = 26;

/**
 * Where the OS cursor WINS, and the only place it does.
 *
 * This list used to be the opposite: an allowlist of BACKGROUND surfaces, and
 * the reticle appeared only when the pointer sat on one of thirteen named
 * classes. A background cannot be enumerated -- a card is full of labels,
 * glyphs, values, checkboxes and spans that are none of those thirteen names,
 * so crossing a single card made the crosshair blink out and back a dozen
 * times. That is the reported symptom ("the crosshair keeps getting replaced
 * by the cursor"), and no amount of adding names to the allowlist ends it.
 *
 * The set that CAN be enumerated is the other one: the handful of surfaces
 * where a system cursor is the right answer. Three of the four entries are
 * HTML TAG names, which no restyle can rename -- that is the property the old
 * denylist of widget classes lacked (its two widget class
 * names were both renamed by restyle 5, and both went silently dead).
 *
 *  - text entry (`input`, `textarea`, `select`, `[contenteditable]`): a caret
 *    is the correct cursor over text, and stealing it makes a field feel
 *    broken.
 *  - `.console .body`: the log is text the user selects and copies.
 *  - `.tab`: the nav strip, excluded since 2026-08-02 -- locking onto tabs
 *    fought the indicator animation.
 *  - `.drag-handle` / `.react-resizable-handle`: their own cursor (grab,
 *    se-resize) IS the affordance; replacing it hides what the handle does.
 *
 * Matched with `closest`, unlike the old allowlist: a caret must win from
 * anywhere inside a field's box, and a resize handle draws an inner layer.
 */
const NATIVE_CURSOR_SELECTOR =
  "input, textarea, select, [contenteditable], " +
  ".console .body, .tab, .drag-handle, .react-resizable-handle";

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

      // The system cursor wins first: a caret inside a field must not be
      // taken away by a snap target that happens to wrap it, and the tab
      // strip is excluded from the reticle whichever child the pointer
      // actually landed on.
      if (target?.closest(NATIVE_CURSOR_SELECTOR)) {
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
        //
        // No size cap (2026-08-04, user feedback: "it has a max size, that's
        // bad; it works great except on giga-long buttons -- loosen it"). The
        // brackets should hug the button's four corners; a long button
        // (a wide action button, a long filter chip) just gets a long
        // reticle. The old 220x120 caps made the brackets float mid-button
        // instead of framing it.
        el!.style.setProperty("--cx", `${rect.left + rect.width / 2}px`);
        el!.style.setProperty("--cy", `${rect.top + rect.height / 2}px`);
        el!.style.setProperty("--cw", `${rect.width + SNAP_PADDING}px`);
        el!.style.setProperty("--ch", `${rect.height + SNAP_PADDING}px`);
        reveal(true);
        return;
      }

      // Everything left is ordinary window: the crosshair follows the
      // pointer. No further test -- that test is what used to make it
      // disappear, and there is nothing left it needs to ask.
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
