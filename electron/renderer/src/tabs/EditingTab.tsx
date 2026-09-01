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
 */
import { toggleClipSelection, useEngineState } from "../motion/useEngineState";
import "./EditingTab.css";

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
  jump:          { label: "🦘 Jump", kind: "shot" },
  knife_swing:   { label: "🔪 Swing", kind: "shot" },
  grenade_miss:  { label: "💣 Miss", kind: "shot" },
};

function eventTypeMeta(eventType: string): { label: string; kind: string } {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, kind: "other" };
}

export const EditingTab: React.FC = () => {
  const state = useEngineState();
  const clips = state.previewClips;

  const totalDurationS = clips.reduce((sum, c) => sum + c.durationS, 0);
  const selectedCount = clips.filter((c) => c.selected).length;

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
    return (
      <div className="editing-tab">
        <div className="editing-empty">
          <div className="editing-empty-box">
            No preview available. Run a PREVIEW first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editing-tab">
      <div className="editing-header">
        <span className="editing-summary">
          <strong>{selectedCount}</strong> of <strong>{clips.length}</strong> clips
          {" · "}
          <strong>{formatTotal(totalDurationS)}</strong>
        </span>
      </div>
      <div className="editing-list">
        {clips.map((clip, idx) => {
          const meta = eventTypeMeta(clip.eventType);
          return (
            <div
              key={`${clip.demoPath}:${clip.startTick}`}
              className={`editing-clip${clip.selected ? " selected" : ""}`}
              title="Click to include or exclude this clip from the recording run"
              onClick={() => handleToggle(idx)}
            >
              <div className="clip-check" />
              <span className="clip-duration">{formatDuration(clip.durationS)}</span>
              <span
                className={`clip-type clip-badge clip-badge--${meta.kind}`}
                title="Type of in-game event that triggered this clip"
              >
                {meta.label}
              </span>
              <span className="clip-player">{clip.playerName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
