/**
 * Capture & Timing, "timeline" style (concept A): the clip is the control.
 *
 * Role / Team / Action / Also sit in a 2x2 block of toggle trays; the camera
 * paints the bar; three handles set the seconds before, the victim view and
 * the seconds after; a ghost second moment shows how close two moments must
 * be to share one clip. Every value comes from `useCaptureTiming`.
 */
import Segmented from "../../components/Segmented";
import ClipTimeline, { type TimelineHandle, type TimelineSpan } from "../../components/cardstyle/ClipTimeline";
import ToggleGroup from "../../components/cardstyle/ToggleGroup";
import SettingControl from "../../settings/SettingControl";
import { PERSPECTIVES, type CaptureTimingModel } from "./useCaptureTiming";
import { CAMERA_MARKS, Crosshair, FeedName, MatePovChips } from "./shared";

/** Seconds of margin drawn before the clip and after the ghost moment. */
const LEAD_MARGIN = 2;
const TAIL_MARGIN = 1.5;

export default function TimelineView({ m }: { m: CaptureTimingModel }) {
  const { clip } = m;
  const both = m.perspective.value === "both";
  const ghostStart = clip.mergeWithin - clip.before;

  const spans: TimelineSpan[] = both
    ? [
        { key: "lead", from: -clip.before, to: -clip.victimView, tone: "primary", label: `${clip.lead}s` },
        { key: "victim", from: -clip.victimView, to: 0, tone: "alt", label: clip.victimView ? `${clip.victimView}s` : "" },
      ]
    : [
        {
          key: "lead",
          from: -clip.before,
          to: 0,
          tone: m.perspective.value === "victim" ? "alt" : "primary",
          label: (
            <>
              {clip.before}s{" "}
              <small>{m.perspective.value === "victim" && m.matePov?.on ? "mate" : m.perspective.value}</small>
            </>
          ),
        },
      ];
  spans.push({
    key: "after",
    from: 0,
    to: clip.after,
    tone: "rest",
    label: (
      <>
        {clip.after}s <small>after</small>
      </>
    ),
  });

  const handles: TimelineHandle[] = [
    {
      id: "start",
      settingKey: m.before.key,
      at: -clip.before,
      label: "Seconds before",
      readout: `−${clip.before}s`,
      value: m.before.value,
      min: m.before.min,
      max: m.before.max,
      tip: m.before.tip,
      onMove: (at) => m.moveHandle("start", at),
    },
  ];
  if (m.victimView) {
    handles.push({
      id: "switch",
      settingKey: m.victimView.key,
      at: -clip.victimView,
      tone: "alt",
      label: "Victim view",
      readout: `−${clip.victimView}s`,
      value: m.victimView.value,
      min: m.victimView.min,
      max: m.victimView.max,
      tip: m.victimView.tip,
      onMove: (at) => m.moveHandle("switch", at),
    });
  }
  handles.push({
    id: "end",
    settingKey: m.after.key,
    at: clip.after,
    label: "Seconds after",
    readout: `+${clip.after}s`,
    value: m.after.value,
    min: m.after.min,
    max: m.after.max,
    tip: m.after.tip,
    onMove: (at) => m.moveHandle("end", at),
  });

  return (
    <div className="ct-a">
      <div className="ct-what">
        <span className="ct-k">Role</span>
        <ToggleGroup
          label="Event role"
          options={[
            { settingKey: m.actor.key, label: "Actor", on: m.actor.on, tip: m.actor.tip, onToggle: m.actor.toggle },
            { settingKey: m.target.key, label: "Target", on: m.target.on, tip: m.target.tip, onToggle: m.target.toggle },
          ]}
        />
        <span className="ct-k r">Team</span>
        <ToggleGroup
          label="Team"
          options={[
            { settingKey: m.ally.key, label: "Ally", on: m.ally.on, tip: m.ally.tip, onToggle: m.ally.toggle },
            { settingKey: m.enemy.key, label: "Enemy", on: m.enemy.on, tip: m.enemy.tip, onToggle: m.enemy.toggle },
          ]}
        />
        <span className="ct-k">Action</span>
        <ToggleGroup
          label="Action type"
          options={[m.lethal, m.nonLethal, m.other].map((t, i) => ({
            settingKey: t.key,
            label: ["Lethal", "Non-lethal", "Other"][i],
            on: t.on,
            disabled: t.disabled,
            tip: t.tip,
            onToggle: t.toggle,
          }))}
        />
        <span className="ct-k r">Also</span>
        <ToggleGroup
          label="Also"
          options={[
            { settingKey: m.rounds.key, label: "Full rounds", on: m.rounds.on, tip: m.rounds.tip, onToggle: m.rounds.toggle },
          ]}
        />
      </div>

      <div className="ct-tlhead">
        <span className="ct-kick">Clip · drag the handles</span>
        <SettingControl settingKey={m.perspective.key}>
          <div className="ct-cam">
            <Segmented
              options={PERSPECTIVES}
              value={m.perspective.value}
              onChange={(v) => m.perspective.set(v as typeof m.perspective.value)}
              label="Camera"
              tip={m.perspective.tip}
              optionMarks={CAMERA_MARKS}
              optionActions={Object.fromEntries(PERSPECTIVES.map((p) => [p, "L5"]))}
            />
          </div>
        </SettingControl>
      </div>

      <ClipTimeline
        label="Clip"
        spans={spans}
        handles={handles}
        markers={[
          {
            key: "kill",
            at: 0,
            label: (
              <>
                <Crosshair />
                KILL
              </>
            ),
          },
          {
            key: "next",
            at: clip.mergeWithin,
            ghost: true,
            label: (
              <>
                <Crosshair />+{clip.mergeWithin}s
              </>
            ),
          },
        ]}
        link={{ from: clip.after, to: ghostStart }}
        ghost={{ from: ghostStart, to: clip.mergeWithin + clip.after, label: "next moment" }}
        bracket={{
          from: 0,
          to: clip.mergeWithin,
          label: (
            <>
              moments up to <b>{clip.mergeWithin} s</b> apart → one clip
            </>
          ),
        }}
        extent={{ from: -clip.before - LEAD_MARGIN, to: clip.mergeWithin + clip.after + TAIL_MARGIN }}
      />
      <p className="ct-hint">
        Handles snap to whole seconds · <kbd>←</kbd>
        <kbd>→</kbd> on a focused handle · the scale re-fits when you let go
      </p>

      <div className="row ct-foot">
        {m.matePov && m.matePovReq && (
          <div className="ct-mate">
            <span className="lab">Mate POV</span>
            <MatePovChips enable={m.matePov} must={m.matePovReq} />
          </div>
        )}
        <FeedName m={m} />
      </div>
      <p className="ct-sum">
        <span className="ct-tot">{clip.total} s</span>
        <span data-testid="clip-window-summary">{m.summary}</span>
      </p>
    </div>
  );
}
