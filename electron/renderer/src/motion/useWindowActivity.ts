import { useEffect } from "react";

import { setWindowActive } from "./engine";

/**
 * Tie the motion gate to the real window.
 *
 * Three signals, because none of them covers the case alone: `blur`/`focus`
 * catch another application taking over while this window stays visible (a
 * capture run), and `visibilitychange` catches minimising and virtual-desktop
 * switches, which raise no blur on every platform.
 *
 * `document.hasFocus()` rather than a flag toggled by each handler: the
 * handlers can fire in any order, and one source of truth cannot desynchronise
 * from another.
 */
export function useWindowActivity(): void {
  useEffect(() => {
    const sync = (): void => {
      setWindowActive(document.hasFocus() && !document.hidden);
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      // Unmounting must not leave the gate shut for whatever mounts next.
      setWindowActive(true);
    };
  }, []);
}
