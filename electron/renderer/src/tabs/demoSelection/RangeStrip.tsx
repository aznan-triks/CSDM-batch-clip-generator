/**
 * The date range drawn on a calendar strip: months along the bottom, the
 * chosen range as a band, a handle at each end to drag (or arrow) a bound by
 * whole days. Loaded demos show as ticks, so the range can be set around them.
 *
 * The strip covers the last year up to today, or further back when the From
 * date is older. An empty bound sits at the strip's edge and reads "any".
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { DemoRow } from "../../components/DemoPicker";
import { fmt, parseDay } from "./useDemoSelection";

const DAY_MS = 86_400_000;
/** The strip shows at least this many days back from today. */
const MIN_SPAN_DAYS = 365;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Bound = "from" | "to";

interface RangeStripProps {
  from: string;
  to: string;
  demos: DemoRow[] | null;
  onChange: (from: string, to: string) => void;
  tips: { from: string; to: string };
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export default function RangeStrip({ from, to, demos, onChange, tips }: RangeStripProps) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromDay = parseDay(from);
  const toDay = parseDay(to);

  // Start on the first of a month, a year back or before the From date.
  const earliest = addDays(today, -MIN_SPAN_DAYS);
  const reach = fromDay && fromDay < earliest ? fromDay : earliest;
  const start = new Date(reach.getFullYear(), reach.getMonth(), 1);
  const span = Math.max(1, daysBetween(start, today));
  const at = (d: Date) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

  const lo = fromDay ?? start;
  const hi = toDay ?? today;

  const axisRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Bound | null>(null);

  function set(bound: Bound, day: Date) {
    const clamped = day < start ? start : day > today ? today : day;
    if (bound === "from") onChange(fmt(clamped > hi ? hi : clamped), to);
    else onChange(from, fmt(clamped < lo ? lo : clamped));
  }

  function dayAt(clientX: number): Date {
    const rect = axisRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return today;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return addDays(start, Math.round(ratio * span));
  }

  function onPointerDown(bound: Bound, event: PointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(bound);
  }

  function onPointerMove(bound: Bound, event: PointerEvent<HTMLElement>) {
    if (dragging !== bound) return;
    const day = dayAt(event.clientX);
    const current = bound === "from" ? lo : hi;
    if (day.getTime() !== current.getTime()) set(bound, day);
  }

  function onKeyDown(bound: Bound, event: KeyboardEvent<HTMLElement>) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -30, PageUp: 30 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    set(bound, addDays(bound === "from" ? lo : hi, step));
  }

  // Month ticks: the first of every month inside the strip.
  const months: { left: number; label: string; year: boolean }[] = [];
  for (let d = new Date(start); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ left: at(d), label: d.getMonth() === 0 ? String(d.getFullYear()) : MONTHS[d.getMonth()], year: d.getMonth() === 0 });
  }

  // One tick per day that holds at least one loaded demo.
  const demoDays = new Map<number, number>();
  for (const demo of demos ?? []) {
    const day = parseDay(demo.date);
    if (day && day >= start && day <= today) demoDays.set(day.getTime(), (demoDays.get(day.getTime()) ?? 0) + 1);
  }

  const noBounds = !fromDay && !toDay;
  const days = daysBetween(lo, hi) + 1;

  const handle = (bound: Bound) => {
    const day = bound === "from" ? lo : hi;
    const set_ = bound === "from" ? fromDay : toDay;
    const word = set_ ? fmt(day).slice(0, 5) : bound === "from" ? "any" : "today";
    return (
      <>
        <button
          type="button"
          role="slider"
          className={["ds-handle", bound, dragging === bound ? "drag" : null].filter(Boolean).join(" ")}
          style={{ left: `${at(day)}%` }}
          aria-label={bound === "from" ? "From date" : "To date"}
          aria-valuemin={0}
          aria-valuemax={span}
          aria-valuenow={daysBetween(start, day)}
          aria-valuetext={set_ ? fmt(day) : "no limit"}
          title={`${bound === "from" ? tips.from : tips.to}. Drag, or use the arrow keys (Page Up/Down: 30 days)`}
          onPointerDown={(e) => onPointerDown(bound, e)}
          onPointerMove={(e) => onPointerMove(bound, e)}
          onPointerUp={() => setDragging(null)}
          onKeyDown={(e) => onKeyDown(bound, e)}
        />
        <span className={`ds-readout ${bound}`} style={{ left: `${at(day)}%` }}>
          {word}
        </span>
      </>
    );
  };

  return (
    <div className="ds-strip">
      <div className="ds-axis" ref={axisRef}>
        {months.map((mo) => (
          <span key={mo.left} className={mo.year ? "ds-month year" : "ds-month"} style={{ left: `${mo.left}%` }}>
            <i aria-hidden="true" />
            {mo.label}
          </span>
        ))}
        <div
          className={noBounds ? "ds-band open" : "ds-band"}
          style={{ left: `${at(lo)}%`, width: `${Math.max(0.6, at(hi) - at(lo))}%` }}
        >
          <span>{noBounds ? "every demo, any date" : `${days} day${days === 1 ? "" : "s"}`}</span>
        </div>
        {[...demoDays].map(([time, count]) => (
          <i
            key={time}
            className="ds-demo"
            style={{ left: `${at(new Date(time))}%` }}
            title={`${count} demo${count === 1 ? "" : "s"} on ${fmt(new Date(time))}`}
          />
        ))}
        {handle("from")}
        {handle("to")}
        <span className="ds-today" style={{ left: "100%" }} aria-hidden="true" />
      </div>
    </div>
  );
}
