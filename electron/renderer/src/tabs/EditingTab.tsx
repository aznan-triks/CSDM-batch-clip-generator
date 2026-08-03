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
import { sendCommand } from "../bridge";
import { useEngineState } from "../motion/useEngineState";
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

export const EditingTab: React.FC = () => {
  const state = useEngineState();
  const clips = state.previewClips;

  const totalDurationS = clips.reduce((sum, c) => sum + c.durationS, 0);
  const selectedCount = clips.filter((c) => c.selected).length;

  function handleToggle(idx: number) {
    sendCommand("editing_toggle", { index: idx });
  }

  if (clips.length === 0) {
    return (
      <div className="editing-tab">
        <div className="editing-empty">
          No preview available. Run a PREVIEW first.
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
        {clips.map((clip, idx) => (
          <div
            key={`${clip.demoPath}:${clip.startTick}`}
            className={`editing-clip${clip.selected ? " selected" : ""}`}
            onClick={() => handleToggle(idx)}
          >
            <div className="clip-check" />
            <span className="clip-duration">{formatDuration(clip.durationS)}</span>
            <span className="clip-type">{clip.eventType}</span>
            <span className="clip-player">{clip.playerName}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
