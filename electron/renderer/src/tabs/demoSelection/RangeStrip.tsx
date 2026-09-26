/**
 * The date range drawn on a calendar strip: dates along the bottom, the
 * chosen range as a band, a handle at each end to drag (or arrow) a bound by
 * whole days. Loaded demos show as ticks, so the range can be set around them.
 *
 * The strip ends on today and zooms to the range: it starts a little before
 * the From date (never less than LEAST_SPAN_DAYS back), or a year back when
 * there is no From date. The scale holds still during a drag and re-fits when
 * the handle is let go. An empty bound sits at the strip's edge.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { DemoRow } from "../../components/DemoPicker";
import { fmt, parseDay } from "./useDemoSelection";

const DAY_MS = 86_400_000;
/** Shortest stretch the strip shows, so a one-day range still has room to drag. */
const LEAST_SPAN_DAYS = 60;
/** How far back the strip reaches when no From date is set. */
const OPEN_SPAN_DAYS = 365;
/** Minimum room between two date labels on the axis, in pixels. */
const LABEL_GAP_PX = 42;
/**
 * Half a handle's width. The dates run from this far inside the axis's left
 * edge to this far inside its right one, so a handle centred on the first or
 * last day stays inside the axis instead of hanging 7px out of it.
 */
const INSET_PX = 7;
/** Where a percentage of the date span sits on the axis (CSS `left`). */
const place = (pct: number) => `calc(${INSET_PX}px + (100% - ${2 * INSET_PX}px) * ${pct / 100})`;
/** How wide a percentage of the date span is on the axis (CSS `width`). */
const stretch = (pct: number) => `calc((100% - ${2 * INSET_PX}px) * ${pct / 100})`;
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

/** The strip's first day, fitted to the range. */
function fitStart(fromDay: Date | null, toDay: Date | null, today: Date): Date {
  if (!fromDay) return addDays(today, -OPEN_SPAN_DAYS);
  const length = daysBetween(fromDay, toDay ?? today);
  const start = addDays(fromDay, -Math.max(7, Math.round(length / 2)));
  const least = addDays(today, -LEAST_SPAN_DAYS);
  return start < least ? start : least;
}

/** Tick candidates: first of each month on a long strip, Mondays on a short one. */
function ticks(start: Date, today: Date): { day: Date; label: string; strong: boolean }[] {
  const out: { day: Date; label: string; strong: boolean }[] = [];
  if (daysBetween(start, today) > 100) {
    for (let d = new Date(start.getFullYear(), start.getMonth() + 1, 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const jan = d.getMonth() === 0;
      out.push({ day: d, label: jan ? String(d.getFullYear()) : MONTHS[d.getMonth()], strong: jan });
    }
    return out;
  }
  const first = addDays(start, (8 - start.getDay()) % 7);
  for (let d = first; d <= today; d = addDays(d, 7)) {
    out.push({ day: d, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, strong: d.getDate() <= 7 });
  }
  return out;
}

export default function RangeStrip({ from, to, demos, onChange, tips }: RangeStripProps) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromDay = parseDay(from);
  const toDay = parseDay(to);

  const axisRef = useRef<HTMLDivElement>(null);
  const frozen = useRef<Date | null>(null);
  const [dragging, setDragging] = useState<Bound | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = axisRef.current;
    if (!node) return;
    setWidth(node.clientWidth - 2 * INSET_PX);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth - 2 * INSET_PX));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const start = (dragging && frozen.current) || fitStart(fromDay, toDay, today);
  const span = Math.max(1, daysBetween(start, today));
  const at = (d: Date) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

  const lo = fromDay && fromDay > start ? fromDay : start;
  const hi = toDay ?? today;

  function set(bound: Bound, day: Date) {
    const clamped = day > today ? today : day;
    if (bound === "from") onChange(fmt(clamped > hi ? hi : clamped), to);
    else onChange(from, fmt(clamped < lo ? lo : clamped));
  }

  function dayAt(clientX: number): Date {
    const rect = axisRef.current?.getBoundingClientRect();
    const railWidth = (rect?.width ?? 0) - 2 * INSET_PX;
    if (!rect || railWidth <= 0) return today;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - INSET_PX) / railWidth));
    return addDays(start, Math.round(ratio * span));
  }

  function onPointerDown(bound: Bound, event: PointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    frozen.current = start;
    setDragging(bound);
  }

  function onPointerMove(bound: Bound, event: PointerEvent<HTMLElement>) {
    if (dragging !== bound) return;
    const day = dayAt(event.clientX);
    const current = bound === "from" ? lo : hi;
    if (day.getTime() !== current.getTime()) set(bound, day);
  }

  function release() {
    frozen.current = null;
    setDragging(null);
  }

  function onKeyDown(bound: Bound, event: KeyboardEvent<HTMLElement>) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -30, PageUp: 30 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    set(bound, addDays(bound === "from" ? lo : hi, step));
  }

  // Every tick keeps its line; a label only shows where it has room.
  let lastLabelPx = Number.NEGATIVE_INFINITY;
  const axisTicks = ticks(start, today).map((t) => {
    const left = at(t.day);
    const px = (left / 100) * width;
    const labelled = width > 0 && px - lastLabelPx >= LABEL_GAP_PX && px <= width - LABEL_GAP_PX / 2;
    if (labelled) lastLabelPx = px;
    return { ...t, left, labelled };
  });

  // One tick per day that holds at least one loaded demo.
  const demoDays = new Map<number, number>();
  for (const demo of demos ?? []) {
    const day = parseDay(demo.date);
    if (day && day >= start && day <= today) demoDays.set(day.getTime(), (demoDays.get(day.getTime()) ?? 0) + 1);
  }

  const noBounds = !fromDay && !toDay;
  const days = daysBetween(lo, hi) + 1;
  const caption = noBounds
    ? "any date"
    : `${fromDay ? fmt(lo).slice(0, 5) : "any"} → ${toDay ? fmt(hi).slice(0, 5) : "today"}`;
  // The caption rides above the band's middle, kept inside the strip.
  const captionAt = Math.min(84, Math.max(16, (at(lo) + at(hi)) / 2));

  const handle = (bound: Bound) => {
    const day = bound === "from" ? lo : hi;
    const isSet = bound === "from" ? !!fromDay : !!toDay;
    return (
      <button
        type="button"
        role="slider"
        className={["ds-handle", bound, dragging === bound ? "drag" : null].filter(Boolean).join(" ")}
        style={{ left: place(at(day)) }}
        aria-label={bound === "from" ? "From date" : "To date"}
        aria-valuemin={0}
        aria-valuemax={span}
        aria-valuenow={daysBetween(start, day)}
        aria-valuetext={isSet ? fmt(day) : "no limit"}
        title={`${bound === "from" ? tips.from : tips.to}. Drag, or use the arrow keys (Page Up/Down: 30 days)`}
        onPointerDown={(e) => onPointerDown(bound, e)}
        onPointerMove={(e) => onPointerMove(bound, e)}
        onPointerUp={release}
        onKeyDown={(e) => onKeyDown(bound, e)}
      />
    );
  };

  return (
    <div className="ds-strip">
      <div className="ds-axis" ref={axisRef}>
        {axisTicks.map((t) => (
          <span key={t.day.getTime()} className={t.strong ? "ds-month year" : "ds-month"} style={{ left: place(t.left) }}>
            <i aria-hidden="true" />
            {t.labelled ? t.label : null}
          </span>
        ))}
        <span className="ds-readout" style={{ left: place(captionAt) }}>
          {caption}
        </span>
        <div
          className={noBounds ? "ds-band open" : "ds-band"}
          style={{ left: place(at(lo)), width: stretch(Math.max(0.6, at(hi) - at(lo))) }}
        >
          <span>{noBounds ? "every demo" : `${days} day${days === 1 ? "" : "s"}`}</span>
        </div>
        {[...demoDays].map(([time, count]) => (
          <i
            key={time}
            className="ds-demo"
            style={{ left: place(at(new Date(time))) }}
            title={`${count} demo${count === 1 ? "" : "s"} on ${fmt(new Date(time))}`}
          />
        ))}
        {handle("from")}
        {handle("to")}
        <span className="ds-today" aria-hidden="true" title="Today" />
      </div>
    </div>
  );
}
