/**
 * The EDITING timeline: one lane per demo, each clip a block on the demo's
 * own time axis, its events as marks inside it.
 *
 * Bounded by construction (AUDIT_perf_ressources.md: 41 000 nodes froze the
 * app): the tab pages the lanes (`EDITING_TIMELINE.lanesPerPage`), and inside
 * the page only the blocks the scroll window shows are mounted -- a block's
 * event marks only once it is wide enough to show them. Zoom is pixels per
 * second, one scale for every lane so the same second lines up down the page.
 */
import { useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from "react";

import type { PreviewClip } from "../../motion/useEngineState";
import { eventTypeMeta } from "../EditingTab";
import { editedWindow, formatClock, isEdited, isExcluded, type EditedWindow, type Lane } from "./clipEdits";

/**
 * The timeline's fixed dimensions and budget. Same HC.1 status as
 * EDITING_LIST: widget geometry and a DOM budget, not user configuration.
 */
export const EDITING_TIMELINE = {
  /** Demo lanes mounted per page. */
  lanesPerPage: 10,
  /** Zoom bounds, pixels per second of demo. */
  minPps: 0.05,
  maxPps: 40,
  /** One zoom step multiplies / divides the scale by this. */
  zoomStep: 1.5,
  /** Width of the sticky demo-name column. */
  labelWidth: 188,
  /** Blocks mounted beyond each edge of the scroll window. */
  overscanPx: 400,
  /** A block narrower than this shows no event marks. */
  marksMinPx: 18,
  /** Every block keeps at least this width, so a 1-second clip stays clickable. */
  blockMinPx: 4,
  /** A labelled ruler tick at least this far from the next one. */
  rulerMinGapPx: 72,
  /** Seconds of empty axis after the latest clip on the page. */
  tailS: 10,
} as const;

const RULER_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];

interface EditingTimelineProps {
  clips: readonly PreviewClip[];
  lanes: readonly Lane[];
  tickrate: number;
  activeIndex: number | null;
  onSelect: (index: number) => void;
  /** Changes whenever a new preview lands: the zoom fits it again. */
  previewSerial: number;
}

export default function EditingTimeline({
  clips,
  lanes,
  tickrate,
  activeIndex,
  onSelect,
  previewSerial,
}: EditingTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 0 });
  const [pps, setPps] = useState<number | null>(null); // null = fit to width
  const frame = useRef(0);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setView({ left: node.scrollLeft, width: node.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setPps(null), [previewSerial]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const windows = lanes.map((lane) => lane.indices.map((i) => editedWindow(clips[i], tickrate)));
  let maxEnd = 0;
  for (const lane of windows) for (const w of lane) if (w) maxEnd = Math.max(maxEnd, w.endTick);
  const spanS = maxEnd / tickrate + EDITING_TIMELINE.tailS;
  const trackViewport = Math.max(1, view.width - EDITING_TIMELINE.labelWidth);
  const fitPps = clampPps(trackViewport / spanS);
  const scale = pps ?? fitPps;
  const trackWidth = Math.ceil(spanS * scale);

  function zoom(factor: number, anchorX?: number) {
    const node = scrollRef.current;
    const next = clampPps(scale * factor);
    if (next === scale) return;
    // Keep the second under the anchor (the pointer, else the view's middle) in place.
    const ax = anchorX ?? trackViewport / 2;
    const second = (view.left + ax) / scale;
    setPps(next);
    if (node) {
      requestAnimationFrame(() => {
        node.scrollLeft = Math.max(0, second * next - ax);
      });
    }
  }

  function onScroll() {
    const node = scrollRef.current;
    if (!node) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setView({ left: node.scrollLeft, width: node.clientWidth }));
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoom(event.deltaY < 0 ? EDITING_TIMELINE.zoomStep : 1 / EDITING_TIMELINE.zoomStep,
      event.clientX - rect.left - EDITING_TIMELINE.labelWidth);
  }

  // The track x range the scroll window shows, with overscan.
  const x0 = view.left - EDITING_TIMELINE.overscanPx;
  const x1 = view.left + trackViewport + EDITING_TIMELINE.overscanPx;
  const x = (tick: number) => (tick / tickrate) * scale;

  return (
    <div className="edtl">
      <div className="edtl-toolbar" role="toolbar" aria-label="Timeline zoom">
        <button type="button" className="chip" aria-label="Zoom out" title="Zoom out (Ctrl + wheel)"
          onClick={() => zoom(1 / EDITING_TIMELINE.zoomStep)}>−</button>
        <span className="lab edtl-zoom" title="Pixels drawn per second of demo">
          {scale >= 1 ? `${scale.toFixed(1)} px/s` : `${(1 / scale).toFixed(1)} s/px`}
        </span>
        <button type="button" className="chip" aria-label="Zoom in" title="Zoom in (Ctrl + wheel)"
          onClick={() => zoom(EDITING_TIMELINE.zoomStep)}>+</button>
        <button type="button" className="chip" title="Fit the longest demo of this page to the width"
          disabled={pps === null} onClick={() => setPps(null)}>Fit</button>
        <span className="edtl-hint">Click a clip to edit it · Ctrl + wheel to zoom</span>
      </div>
      <div
        className="edtl-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={onWheel}
        style={{ ["--edtl-label-w" as string]: `${EDITING_TIMELINE.labelWidth}px` }}
      >
        <div className="edtl-row edtl-ruler" style={{ width: EDITING_TIMELINE.labelWidth + trackWidth }}>
          <span className="edtl-label" />
          <div className="edtl-track" style={{ width: trackWidth }}>
            {rulerTicks(scale, x0, x1, spanS).map((t) => (
              <span key={t} className="edtl-tick" style={{ left: t * scale }}>
                {formatClock(t)}
              </span>
            ))}
          </div>
        </div>
        {lanes.map((lane, li) => (
          <div key={lane.demoPath} className="edtl-row edtl-lane" style={{ width: EDITING_TIMELINE.labelWidth + trackWidth }}>
            <span className="edtl-label" title={lane.demoPath}>
              <span className="edtl-demo">{lane.name}</span>
              <small>
                {lane.indices.filter((i) => clips[i].selected).length}/{lane.indices.length} clips
              </small>
            </span>
            <div className="edtl-track" style={{ width: trackWidth }}>
              {lane.indices.map((idx, k) => {
                const w = windows[li][k];
                const clip = clips[idx];
                const from = x(w ? w.startTick : clip.startTick);
                const width = Math.max(EDITING_TIMELINE.blockMinPx, x(w ? w.endTick : clip.endTick) - from);
                if (from + width < x0 || from > x1) return null;
                return (
                  <ClipBlock
                    key={idx}
                    clip={clip}
                    win={w}
                    left={from}
                    width={width}
                    x={x}
                    tickrate={tickrate}
                    active={idx === activeIndex}
                    onSelect={() => onSelect(idx)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  win,
  left,
  width,
  x,
  tickrate,
  active,
  onSelect,
}: {
  clip: PreviewClip;
  win: EditedWindow | null;
  left: number;
  width: number;
  x: (tick: number) => number;
  tickrate: number;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = eventTypeMeta(clip.eventType);
  const cls = [
    "edtl-clip",
    `kind-${meta.kind}`,
    clip.selected && win ? "in" : "out",
    isEdited(clip) ? "edited" : null,
    active ? "active" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const when = formatClock((win?.startTick ?? clip.startTick) / tickrate);
  return (
    <button
      type="button"
      className={cls}
      style={{ left, width }}
      aria-pressed={active}
      title={`${meta.label} · ${when} · ${win ? `${win.durationS.toFixed(1)} s` : "no event left"}${
        clip.selected ? "" : " · excluded"
      }${isEdited(clip) ? " · edited" : ""}`}
      onClick={onSelect}
    >
      {width >= EDITING_TIMELINE.marksMinPx &&
        clip.events.map((e) => (
          <span
            key={e.key}
            className={isExcluded(clip, e.key) ? "edtl-mark ghost" : "edtl-mark"}
            style={{ left: x(e.tick) - left }}
          />
        ))}
    </button>
  );
}

function clampPps(value: number): number {
  return Math.min(EDITING_TIMELINE.maxPps, Math.max(EDITING_TIMELINE.minPps, value));
}

/** Labelled ruler seconds inside [x0, x1], spaced by the smallest readable step. */
function rulerTicks(pps: number, x0: number, x1: number, spanS: number): number[] {
  const step = RULER_STEPS_S.find((s) => s * pps >= EDITING_TIMELINE.rulerMinGapPx) ?? RULER_STEPS_S[RULER_STEPS_S.length - 1];
  const first = Math.max(0, Math.ceil(x0 / pps / step) * step);
  const last = Math.min(spanS, x1 / pps);
  const out: number[] = [];
  for (let t = first; t <= last; t += step) out.push(t);
  return out;
}
