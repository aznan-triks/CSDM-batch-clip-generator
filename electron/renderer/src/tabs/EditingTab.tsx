/**
 * The Editing tab: the preview clip checklist.
 *
 * Reads the clips the engine's last PREVIEW produced (`previewClips` on the
 * engine state) and lets the user choose which ones a run will actually
 * record by toggling each row. Toggling is a one-way command to the engine --
 * `editing_toggle` -- and the engine echoes the new selection back as state,
 * so this component never mutates the list itself. A row that is not
 * selected is skipped when the run happens, which is why the count in the
 * header is "N of M clips", not just "M clips".
 *
 * The composite key is `demoPath:startTick`, the same pair the engine uses to
 * address a clip uniquely (two clips in one demo can never share a start tick).
 *
 * Two views of the same clips, switched in the header: the Timeline (default:
 * one lane per demo, a clip opens in the inspector to be edited on its own --
 * tabs/editing/) and the List (the checklist). The pager is shared: it pages
 * clips in the list, demo lanes on the timeline.
 */
import { useEffect, useMemo, useState } from "react";

import Pager from "../components/Pager";
import Segmented from "../components/Segmented";
import { toggleClipSelection, useEngineSelector } from "../motion/useEngineState";
import ClipInspector from "./editing/ClipInspector";
import { buildLanes, editedWindow } from "./editing/clipEdits";
import EditingTimeline, { EDITING_TIMELINE } from "./editing/EditingTimeline";
import "./EditingTab.css";
import "./editing/EditingTimeline.css";

/**
 * How many clips reach the DOM at once. Measured: a 8 465-clip preview put
 * 41 000 nodes in this always-mounted tab (+250 MB renderer) and froze the
 * next PREVIEW (AUDIT_perf_ressources.md). Same remedy and same HC.1 status
 * as PLAYER_LIST. The timeline view bounds itself the same way (EDITING_TIMELINE).
 */
export const EDITING_LIST = { pageSize: 100 } as const;

/** Format a clip's length as M:SS.t, e.g. "0:03.4" or "1:45.0". */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${String(secs).padStart(4, "0")}`;
}

/** Format a running total as a human sentence, e.g. "2 min 34 s". */
function formatTotal(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins} min ${secs} s`;
}

/**
 * Human label + visual kind for every event type the engine can produce.
 * Unknown types fall back to their raw string under the "other" kind so the
 * checklist never renders an empty badge for a future event type.
 */
const EVENT_TYPE_META: Record<string, { label: string; kind: string }> = {
  kill:          { label: "💀 Kill",  kind: "kill" },
  death:         { label: "☠ Death", kind: "kill" },
  damage_actor:  { label: "🔫 Dmg",  kind: "damage" },
  damage_target: { label: "🩹 Hit",  kind: "damage" },
  shot:          { label: "🎯 Shot", kind: "shot" },
  knife_swing:   { label: "🔪 Swing", kind: "shot" },
};

// No Jump / Miss badge: the engine produces no jump and no grenade-miss event
// (no DB source for either, C6 E3), so a badge for them would promise clips
// that never come.
export function eventTypeMeta(eventType: string): { label: string; kind: string } {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, kind: "other" };
}

/** The header's view switch; the first one is where the tab opens. */
export const EDITING_VIEWS = ["Timeline", "List"] as const;
type EditingView = (typeof EDITING_VIEWS)[number];

export const EditingTab: React.FC = () => {
  const clips = useEngineSelector((s) => s.previewClips);
  const previewSerial = useEngineSelector((s) => s.previewSerial);
  const emptyReason = useEngineSelector((s) => s.previewEmptyReason);
  const tickrate = useEngineSelector((s) => s.previewTickrate);

  // As the run will record them: edited windows, excluded-event clips at 0.
  const durations = useMemo(() => clips.map((c) => editedWindow(c, tickrate)?.durationS ?? 0), [clips, tickrate]);
  const totalDurationS = durations.reduce((sum, d) => sum + d, 0);
  const selectedCount = clips.filter((c) => c.selected).length;
  const lanes = useMemo(() => buildLanes(clips), [clips]);

  const [view, setView] = useState<EditingView>(EDITING_VIEWS[0]);
  const [activeClip, setActiveClip] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  // A new PREVIEW starts on page 1 with nothing open; toggling a clip must not move the reader.
  useEffect(() => {
    setPage(0);
    setActiveClip(null);
  }, [previewSerial]);
  const onList = view === "List";
  const pageSize = onList ? EDITING_LIST.pageSize : EDITING_TIMELINE.lanesPerPage;
  const pageCount = Math.max(1, Math.ceil((onList ? clips.length : lanes.length) / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * pageSize;
  const visible = clips.slice(start, start + EDITING_LIST.pageSize);
  const activeLane = activeClip === null ? undefined : lanes.find((l) => l.indices.includes(activeClip));

  /**
   * Include or exclude this clip.
   *
   * Local. It used to send `editing_toggle` to the engine and wait for the
   * echo -- a command the engine never implemented, on a channel that never
   * reads a reply, so the checklist had been inert since it shipped
   * (AUDIT_retours_ui_8_points.md, ecart E2). The selection is screen state;
   * the engine learns it once, as `selected_clips` on GENERATE.
   */
  function handleToggle(idx: number) {
    toggleClipSelection(idx);
  }

  if (clips.length === 0) {
    // A preview that found nothing says why (engine `explain_empty_result`),
    // never the "run a PREVIEW first" line meant for no preview at all.
    return (
      <div className="editing-tab">
        <div className="editing-empty">
          <div className="editing-empty-box">
            {emptyReason ? (
              <div className="editing-empty-reason" role="status">
                <p className="editing-empty-headline">{emptyReason.headline}</p>
                <ol className="editing-empty-stages">
                  {emptyReason.stages.map((stage, i) => (
                    <li key={i}>
                      <span className="editing-empty-count">{stage.count.toLocaleString("en-US")}</span>
                      {" "}
                      {stage.label}
                    </li>
                  ))}
                </ol>
                <p className="editing-empty-hint">{emptyReason.hint}</p>
              </div>
            ) : (
              "No preview available. Run a PREVIEW first."
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={onList ? "editing-tab" : "editing-tab editing-tab--timeline"}>
      <div className="editing-header">
        <span className="editing-summary">
          <strong>{selectedCount}</strong> of <strong>{clips.length}</strong> clips
          {" · "}
          <strong>{formatTotal(totalDurationS)}</strong>
        </span>
        <Segmented
          label="Editing view"
          tip="Timeline: clips on each demo's time axis, editable one by one. List: the plain checklist."
          options={EDITING_VIEWS}
          value={view}
          onChange={(v) => {
            setView(v as EditingView);
            setPage(0);
          }}
        />
        {pageCount > 1 && (
          <div className="row editing-pager">
            <Pager page={currentPage} pageCount={pageCount} onPage={setPage} />
          </div>
        )}
      </div>
      {!onList && (
        <EditingTimeline
          clips={clips}
          lanes={lanes.slice(start, start + pageSize)}
          tickrate={tickrate}
          activeIndex={activeClip}
          onSelect={setActiveClip}
          previewSerial={previewSerial}
        />
      )}
      {!onList && activeClip !== null && activeLane && (
        <ClipInspector
          clips={clips}
          index={activeClip}
          lane={activeLane}
          tickrate={tickrate}
          onClose={() => setActiveClip(null)}
        />
      )}
      {onList && (
        <div className="editing-list">
          {visible.map((clip, i) => {
            const idx = start + i;
            const meta = eventTypeMeta(clip.eventType);
            return (
              <div
                key={`${clip.demoPath}:${clip.startTick}`}
                className={`editing-clip${clip.selected ? " selected" : ""}`}
                title="Click to include or exclude this clip from the recording run"
                onClick={() => handleToggle(idx)}
              >
                <div className="clip-check" />
                <span className="clip-duration">{formatDuration(durations[idx])}</span>
                <span
                  className={`clip-type clip-badge clip-badge--${meta.kind}`}
                  title="Type of in-game event that triggered this clip"
                >
                  {meta.label}
                </span>
                <span className="clip-player">{clip.playerName}</span>
                {clip.edit && (
                  <span className="clip-edited" title="Edited on the timeline">
                    ✎ edited
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
