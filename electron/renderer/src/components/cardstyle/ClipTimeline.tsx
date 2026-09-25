/**
 * A time axis whose bars are the control: drag a handle (or focus it and use
 * the arrow keys) to move one edge, snapped to whole seconds.
 *
 * Generic on purpose -- it knows seconds, spans, handles and markers, never
 * which setting a handle stands for. The card that uses it maps a handle's new
 * second back to its own keys (`onMove`).
 *
 * The scale fits `extent` to the width it is given. While a handle is being
 * dragged the scale is frozen (a scale that re-fits under the pointer makes the
 * handle run away from it) and re-fits when the handle is let go.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import SettingControl from "../../settings/SettingControl";
import "./cardstyle.css";

export type TimelineTone = "primary" | "alt" | "rest";

export interface TimelineSpan {
  key: string;
  from: number;
  to: number;
  tone: TimelineTone;
  label: ReactNode;
}

export interface TimelineHandle {
  id: string;
  /** Config key the handle writes, for the coverage guard. */
  settingKey: string;
  /** The second the handle sits on. */
  at: number;
  tone?: "primary" | "alt";
  /** Accessible name, e.g. "Seconds before". */
  label: string;
  /** Text under the handle, e.g. "-5s". */
  readout: string;
  /** The setting's own value and range, for assistive technology. */
  value: number;
  min: number;
  max: number;
  tip?: string;
  /** Called with a whole second whenever the handle is moved to a new one. */
  onMove: (at: number) => void;
}

export interface TimelineMarker {
  key: string;
  at: number;
  label: ReactNode;
  ghost?: boolean;
}

interface ClipTimelineProps {
  spans: TimelineSpan[];
  handles: TimelineHandle[];
  markers?: TimelineMarker[];
  /** A dashed second span (e.g. the next moment that would join this clip). */
  ghost?: { from: number; to: number; label: ReactNode };
  /** A dotted link between two seconds. */
  link?: { from: number; to: number };
  /** A bracket under the axis with its caption. */
  bracket?: { from: number; to: number; label: ReactNode };
  /** Seconds that must be visible; the scale fits them to the width. */
  extent: { from: number; to: number };
  /** A labelled tick every this many seconds. */
  majorEvery?: number;
  label?: string;
}

/** Inner margin, in pixels, so a handle at either end stays grabbable. */
const EDGE = 18;

interface Scale {
  t0: number;
  t1: number;
  pps: number;
}

function fit(extent: { from: number; to: number }, width: number): Scale {
  const span = Math.max(1, extent.to - extent.from);
  return { t0: extent.from, t1: extent.to, pps: Math.max(1, width - EDGE * 2) / span };
}

export default function ClipTimeline({
  spans,
  handles,
  markers = [],
  ghost,
  link,
  bracket,
  extent,
  majorEvery = 5,
  label,
}: ClipTimelineProps) {
  const axisRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const frozen = useRef<Scale | null>(null);

  useLayoutEffect(() => {
    const node = axisRef.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = dragging && frozen.current ? frozen.current : fit(extent, width);
  const x = (t: number) => EDGE + (t - scale.t0) * scale.pps;
  const w = (from: number, to: number) => Math.max(0, x(to) - x(from));

  function secondAt(clientX: number): number {
    const rect = axisRef.current?.getBoundingClientRect();
    const left = rect ? rect.left : 0;
    return Math.round(scale.t0 + (clientX - left - EDGE) / scale.pps);
  }

  function onPointerDown(handle: TimelineHandle, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    frozen.current = scale;
    setDragging(handle.id);
  }

  function onPointerMove(handle: TimelineHandle, event: PointerEvent<HTMLDivElement>) {
    if (dragging !== handle.id) return;
    const at = secondAt(event.clientX);
    if (at !== handle.at) handle.onMove(at);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    frozen.current = null;
    setDragging(null);
  }

  function onKeyDown(handle: TimelineHandle, event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    handle.onMove(handle.at + step);
  }

  const ticks: ReactNode[] = [];
  for (let t = Math.ceil(scale.t0); t <= scale.t1; t++) {
    const major = t % majorEvery === 0;
    ticks.push(<span key={`t${t}`} className={major ? "cs-tl-tick major" : "cs-tl-tick"} style={{ left: x(t) }} />);
    if (major) {
      ticks.push(
        <span key={`l${t}`} className="cs-tl-ticklab" style={{ left: x(t) }}>
          {t > 0 ? `+${t}` : t}s
        </span>,
      );
    }
  }

  const start = Math.min(...spans.map((s) => s.from));
  const end = Math.max(...spans.map((s) => s.to));

  return (
    <div
      className="cs-tl"
      role="group"
      aria-label={label}
      style={{ ["--pps" as string]: `${scale.pps}px`, ["--x0" as string]: `${x(Math.ceil(scale.t0))}px` }}
    >
      <div className="cs-tl-axis" ref={axisRef}>
        <span className="cs-tl-line" />
        {ticks}
        {link && <span className="cs-tl-link" style={{ left: x(link.from), width: w(link.from, link.to) }} />}
        {ghost && (
          <span className="cs-tl-ghost" style={{ left: x(ghost.from), width: w(ghost.from, ghost.to) }}>
            {ghost.label}
          </span>
        )}
        <div className="cs-tl-bar" style={{ left: x(start), width: w(start, end) }}>
          {spans.map((s) => (
            <span key={s.key} className={`cs-tl-span ${s.tone}`} style={{ width: w(s.from, s.to) }}>
              {s.label}
            </span>
          ))}
        </div>
        {markers.map((m) => (
          <span key={m.key}>
            <span className={m.ghost ? "cs-tl-mark ghost" : "cs-tl-mark"} style={{ left: x(m.at) - 1 }} />
            <span className={m.ghost ? "cs-tl-badge ghost" : "cs-tl-badge"} style={{ left: x(m.at) }}>
              {m.label}
            </span>
          </span>
        ))}
        {handles.map((h) => (
          <SettingControl key={h.id} settingKey={h.settingKey}>
            <div
              className={["cs-tl-handle", h.tone === "alt" ? "alt" : null, dragging === h.id ? "drag" : null]
                .filter(Boolean)
                .join(" ")}
              role="slider"
              tabIndex={0}
              aria-label={h.label}
              aria-valuenow={h.value}
              aria-valuemin={h.min}
              aria-valuemax={h.max}
              aria-valuetext={h.readout}
              title={h.tip}
              data-handle={h.id}
              style={{ left: x(h.at) }}
              onPointerDown={(e) => onPointerDown(h, e)}
              onPointerMove={(e) => onPointerMove(h, e)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => onKeyDown(h, e)}
            />
            <span className={h.tone === "alt" ? "cs-tl-readout alt" : "cs-tl-readout"} style={{ left: x(h.at) }}>
              {h.readout}
            </span>
          </SettingControl>
        ))}
        {bracket && (
          <>
            <span className="cs-tl-bracket" style={{ left: x(bracket.from), width: w(bracket.from, bracket.to) }} />
            <span className="cs-tl-bracketlab" style={{ left: (x(bracket.from) + x(bracket.to)) / 2 }}>
              {bracket.label}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
