/**
 * The fill-in words of a sentence card.
 *
 *   - `ChoiceToken`: a word that opens a popover holding its choices;
 *   - `NumberToken`: a number you drag sideways (or scroll, or arrow) to change,
 *     and click to open a popover with its slider.
 *
 * Both are generic: the card passes the words and the popover's content, and
 * the popover closes on Escape or on a click outside it.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import "./cardstyle.css";

/** Pixels of sideways drag per step of a number token. */
const DRAG_PX_PER_STEP = 12;

type Tone = "primary" | "alt";

/** Open/close state shared by both tokens, closed by Escape or an outside click. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the popover inside the card: slide it left when it would cross the
  // card body's right edge.
  useLayoutEffect(() => {
    if (!open) return setShift(0);
    const pop = popRef.current;
    const body = pop?.closest(".sb")?.getBoundingClientRect();
    if (!pop || !body) return;
    const overflow = pop.getBoundingClientRect().right - (body.right - 4);
    if (overflow > 0) setShift(-overflow);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  return { open, setOpen, rootRef, popRef, shift, onKeyDown };
}

function Popover({
  pop,
  label,
  children,
}: {
  pop: ReturnType<typeof usePopover>;
  label: string;
  children: ReactNode;
}) {
  if (!pop.open) return null;
  return (
    <div
      ref={pop.popRef}
      className="cs-pop"
      role="dialog"
      aria-label={label}
      style={{ transform: `translateX(${pop.shift}px)`, ["--ax" as string]: `${22 - pop.shift}px` }}
    >
      {children}
    </div>
  );
}

interface ChoiceTokenProps {
  /** The word shown in the sentence. */
  children: ReactNode;
  /** Accessible name of the popover, e.g. "Camera". */
  label: string;
  tone?: Tone;
  tip?: string;
  /** The popover's content: chips, options, a preview line. */
  popover: ReactNode | ((close: () => void) => ReactNode);
}

export function ChoiceToken({ children, label, tone = "primary", tip, popover }: ChoiceTokenProps) {
  const pop = usePopover();
  const close = () => pop.setOpen(false);
  return (
    <span className="cs-tokwrap" ref={pop.rootRef} onKeyDown={pop.onKeyDown}>
      <button
        type="button"
        className={["cs-tok", tone, pop.open ? "open" : null].filter(Boolean).join(" ")}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        aria-label={label}
        title={tip}
        onClick={() => pop.setOpen(!pop.open)}
      >
        {children}
        <span className="cs-tok-cv" aria-hidden="true">
          ▾
        </span>
      </button>
      <Popover pop={pop} label={label}>
        {typeof popover === "function" ? popover(close) : popover}
      </Popover>
    </span>
  );
}

interface NumberTokenProps {
  value: number;
  min: number;
  max: number;
  unit: string;
  /** Accessible name, e.g. "Seconds before". */
  label: string;
  tone?: Tone;
  tip?: string;
  onChange: (value: number) => void;
  /** The popover's content, opened by a click that did not drag. */
  popover: ReactNode;
}

export function NumberToken({ value, min, max, unit, label, tone = "primary", tip, onChange, popover }: NumberTokenProps) {
  const pop = usePopover();
  const tokenRef = useRef<HTMLButtonElement>(null);
  const scrub = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const latest = useRef({ value, onChange, clamp });
  latest.current = { value, onChange, clamp };

  // A wheel listener that may cancel the scroll: React's own is passive.
  useEffect(() => {
    const node = tokenRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { value: v, onChange: change, clamp: c } = latest.current;
      const next = c(v + (event.deltaY < 0 ? 1 : -1));
      if (next !== v) change(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrub.current = { x: event.clientX, from: value, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const s = scrub.current;
    if (!s) return;
    const steps = Math.round((event.clientX - s.x) / DRAG_PX_PER_STEP);
    if (steps) s.moved = true;
    const next = clamp(s.from + steps);
    if (next !== value) onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = clamp(value + step);
    if (next !== value) onChange(next);
  }

  return (
    <span className="cs-tokwrap" ref={pop.rootRef} onKeyDown={pop.onKeyDown}>
      <button
        ref={tokenRef}
        type="button"
        role="slider"
        className={["cs-tok", "num", tone, pop.open ? "open" : null].filter(Boolean).join(" ")}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${value}${unit}`}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        title={tip ? `${tip}. Drag sideways or scroll to change` : "Drag sideways or scroll to change"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          const moved = scrub.current?.moved;
          scrub.current = null;
          if (!moved) pop.setOpen(!pop.open);
        }}
        // Enter / Space: a click with no pointer behind it (`detail` 0).
        onClick={(event) => {
          if (event.detail === 0) pop.setOpen(!pop.open);
        }}
        onKeyDown={onKeyDown}
      >
        {value}
        {unit}
      </button>
      <Popover pop={pop} label={label}>
        {popover}
      </Popover>
    </span>
  );
}
