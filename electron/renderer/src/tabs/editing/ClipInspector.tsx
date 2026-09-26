/**
 * The EDITING inspector: one clip, edited on its own.
 *
 * The clip is drawn with the Capture & Timing card's `ClipTimeline`, seconds
 * relative to its first kept event: the bar is painted by the camera spans
 * the recording will follow, the two handles set this clip's seconds before
 * and after, and every event is a marker (a ghost once taken out). Every
 * change goes to the engine store (`editClip`, `toggleClipEvent`), never to a
 * setting: the edits travel with the selection on GENERATE / SAVE.
 */
import ClipTimeline, { type TimelineMarker, type TimelineSpan } from "../../components/cardstyle/ClipTimeline";
import {
  editClip,
  toggleClipEvent,
  toggleClipSelection,
  type PreviewClip,
} from "../../motion/useEngineState";
import { clampTo } from "../clipWindow";
import { eventTypeMeta } from "../EditingTab";
import {
  CLIP_EDIT_RANGE,
  editedWindow,
  formatClock,
  isExcluded,
  overlapsAnother,
  type Lane,
} from "./clipEdits";

/** Seconds of axis drawn past each end of the clip, so both handles stay grabbable. */
const AXIS_MARGIN_S = 2;

interface ClipInspectorProps {
  clips: readonly PreviewClip[];
  index: number;
  lane: Lane;
  tickrate: number;
  onClose: () => void;
}

export default function ClipInspector({ clips, index, lane, tickrate, onClose }: ClipInspectorProps) {
  const clip = clips[index];
  const win = editedWindow(clip, tickrate);
  const position = lane.indices.indexOf(index) + 1;
  const sec = (tick: number) => tick / tickrate;

  // Axis origin: the first kept event (the first event when none is left).
  const origin = (win?.kept[0] ?? clip.events[0])?.tick ?? clip.startTick;
  const rel = (tick: number) => (tick - origin) / tickrate;
  const startAt = win ? rel(win.startTick) : rel(clip.startTick);
  const endAt = win ? rel(win.endTick) : rel(clip.endTick);
  const lastKeptAt = win ? rel(win.kept[win.kept.length - 1]?.tick ?? origin) : 0;

  const markers: TimelineMarker[] = clip.events.map((e) => {
    const meta = eventTypeMeta(e.type);
    return {
      key: e.key,
      at: rel(e.tick),
      label: meta.label.split(" ")[0],
      ghost: isExcluded(clip, e.key),
    };
  });

  const handles = win
    ? [
        {
          id: "start",
          at: startAt,
          label: "Seconds before this clip's first event",
          readout: `-${Math.round(win.leadS)}s`,
          value: Math.round(win.leadS),
          min: CLIP_EDIT_RANGE.min,
          max: CLIP_EDIT_RANGE.max,
          tip: "Drag to change how early this clip starts",
          onMove: (at: number) => editClip(index, { beforeS: clampTo(-at, CLIP_EDIT_RANGE) }),
        },
        {
          id: "end",
          at: endAt,
          label: "Seconds after this clip's last event",
          readout: `+${Math.round(win.tailS)}s`,
          value: Math.round(win.tailS),
          min: CLIP_EDIT_RANGE.min,
          max: CLIP_EDIT_RANGE.max,
          tip: "Drag to change how late this clip ends",
          onMove: (at: number) => editClip(index, { afterS: clampTo(at - lastKeptAt, CLIP_EDIT_RANGE) }),
        },
      ]
    : [];

  const overlap = overlapsAnother(clips, lane, index, tickrate);
  const firstEventAt = Math.min(0, ...markers.map((m) => m.at));
  const lastEventAt = Math.max(0, ...markers.map((m) => m.at));
  const extent = {
    from: Math.floor(Math.min(startAt, firstEventAt) - AXIS_MARGIN_S),
    to: Math.ceil(Math.max(endAt, lastEventAt) + AXIS_MARGIN_S),
  };
  const length = extent.to - extent.from;

  return (
    <section className="edtl-inspector" aria-label="Clip inspector">
      <header className="edtl-insp-head">
        <label className="edtl-insp-include" title="Record this clip on GENERATE, or skip it">
          <input
            type="checkbox"
            checked={clip.selected}
            onChange={() => toggleClipSelection(index)}
          />
          Include
        </label>
        <span className="edtl-insp-title">
          <strong>{lane.name}</strong> · clip {position} of {lane.indices.length}
        </span>
        <span className="edtl-insp-when">
          {win
            ? `${formatClock(sec(win.startTick))} → ${formatClock(sec(win.endTick))} · ${win.durationS.toFixed(1)} s`
            : "Every event is taken out: this clip will not be recorded"}
        </span>
        <button
          type="button"
          className="chip"
          disabled={clip.edit === undefined}
          title="Put this clip back as the preview found it"
          onClick={() => editClip(index, null)}
        >
          Reset
        </button>
        <button type="button" className="chip" aria-label="Close the inspector" title="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      {win && (
        <ClipTimeline
          label="This clip, around its events"
          spans={cameraSpans(clip, win.startTick, win.endTick, rel)}
          handles={handles}
          markers={markers}
          extent={extent}
          majorEvery={length > 60 ? 10 : 5}
        />
      )}

      {overlap && (
        <p className="edtl-insp-note" role="status">
          This clip now overlaps another kept clip of the same demo: they will be recorded as one.
        </p>
      )}

      <div className="edtl-insp-events" role="group" aria-label="Events in this clip">
        {clip.events.map((e) => {
          const meta = eventTypeMeta(e.type);
          const out = isExcluded(clip, e.key);
          return (
            <button
              key={e.key}
              type="button"
              role="checkbox"
              aria-checked={!out}
              className={`edtl-insp-event kind-${meta.kind}${out ? " out" : ""}`}
              title={out ? "Put this event back in the clip" : "Take this event out of the clip"}
              onClick={() => toggleClipEvent(index, e.key)}
            >
              {meta.label} <small>{formatClock(sec(e.tick))}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The camera spans the preview planned, cut to the edited clip: the first and
 * last span stretch to the new edges (the recording holds its target), one
 * colour per change of player so a switch reads at a glance.
 */
function cameraSpans(
  clip: PreviewClip,
  startTick: number,
  endTick: number,
  rel: (tick: number) => number,
): TimelineSpan[] {
  const inside = clip.cameras.filter((c) => c.toTick > startTick && c.fromTick < endTick);
  if (inside.length === 0) {
    return [{ key: "clip", from: rel(startTick), to: rel(endTick), tone: "primary", label: "" }];
  }
  return inside.map((c, i) => ({
    key: `${c.fromTick}:${c.steamId}`,
    from: rel(i === 0 ? startTick : c.fromTick),
    to: rel(i === inside.length - 1 ? endTick : c.toTick),
    tone: i % 2 === 0 ? "primary" : "alt",
    label: (
      <>
        <small>cam</small> {c.name || c.steamId || "?"}
      </>
    ),
  }));
}
