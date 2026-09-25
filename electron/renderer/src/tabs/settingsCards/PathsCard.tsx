/**
 * Paths: one model, drawn in its card style.
 *
 *   - timeline: the files' journey, top to bottom -- CS Demo Manager, the
 *     CS2 commands it injects, then the raw, concatenated and assembled
 *     clips -- each stop holding its own folder;
 *   - sentence: "Launch CS Demo Manager from <…>. Save raw clips in <…>, <one
 *     subfolder per demo> …";
 *   - tiles: one folder tile per path.
 *
 * An empty path means "the engine's default": the placeholder says what that
 * resolves to on this machine (`useTables().defaultPaths`), so a blank box
 * never reads as "not set up".
 */
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { BigTile, WordOptions } from "../../components/cardstyle/StyledParts";
import { ChoiceToken } from "../../components/cardstyle/SentenceToken";
import ToggleSwitch from "../../components/cardstyle/ToggleSwitch";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import SettingControl from "../../settings/SettingControl";
import { useTables } from "../../settings/useTables";
import { Glyph, TextBox, TextToken, useText, useToggle, type TextSetting, type ToggleSetting } from "./shared";
import "./SettingsCards.css";

interface PathsModel {
  csdmExe: TextSetting;
  cs2Cfg: TextSetting;
  clips: TextSetting;
  concat: TextSetting;
  assembled: TextSetting;
  subfolder: ToggleSetting;
}

function usePaths(): PathsModel {
  const defaults = useTables().tables?.defaultPaths;
  const csdmExe = useText({
    key: "csdm_exe",
    id: "csdm-exe",
    label: "CSDM Executable",
    path: "file",
    empty: defaults?.csdmExe ? "auto-detected" : "not found yet",
    tip: "CS Demo Manager's csdm.CMD (or csdm.exe), which records the clips",
    placeholder: !defaults
      ? "csdm.CMD or csdm.exe"
      : defaults.csdmExe
        ? `Empty = auto-detected: ${defaults.csdmExe}`
        : "Not found automatically: Browse to CS Demo Manager's csdm.CMD",
  });
  const cs2Cfg = useText({
    key: "cs2_cfg_dir",
    id: "cs2-cfg-dir",
    label: "CS2 cfg folder",
    path: "dir",
    empty: "auto-detected",
    tip: "Where CSDM writes injected CS2 console commands before recording. Leave empty to auto-detect",
    placeholder: "Optional override (…\\Counter-Strike Global Offensive\\game\\csgo\\cfg)",
  });
  const clips = useText({
    key: "output_dir_clips",
    id: "output-dir-clips",
    label: "Raw clips folder",
    path: "dir",
    empty: "the default clips folder",
    tip: "Where the recorded clips are written",
    placeholder: defaults?.clipsDir
      ? `Empty = ${defaults.clipsDir} (a subfolder per demo is created inside)`
      : "A subfolder per demo is created here",
  });
  const concat = useText({
    key: "output_dir_concat",
    id: "output-dir-concat",
    label: "Concatenated clips folder",
    path: "dir",
    empty: "the raw clips folder",
    tip: "Where the clips joined per demo are written",
    placeholder: "Empty = same folder as raw clips",
  });
  const assembled = useText({
    key: "output_dir_assembled",
    id: "output-dir-assembled",
    label: "Assembled file folder",
    path: "dir",
    empty: "the raw clips folder",
    tip: "Where the final assembled video is written",
    placeholder: "Empty = same folder as raw clips",
  });
  const subfolder = useToggle(
    "subfolder_per_demo",
    "Subfolder per demo",
    "When on, each demo's clips go in their own subfolder instead of sharing the raw clips folder",
  );
  return { csdmExe, cs2Cfg, clips, concat, assembled, subfolder };
}

function Subfolder({ m }: { m: PathsModel }) {
  return (
    <SettingControl settingKey={m.subfolder.key}>
      <ToggleSwitch label={m.subfolder.label} on={m.subfolder.on} tip={m.subfolder.tip} onToggle={m.subfolder.toggle} />
    </SettingControl>
  );
}

const STOPS: ReadonlyArray<{ pick: keyof Omit<PathsModel, "subfolder">; glyph: Parameters<typeof Glyph>[0]["g"]; step: string }> = [
  { pick: "csdmExe", glyph: "app", step: "Records" },
  { pick: "cs2Cfg", glyph: "cfg", step: "Injects commands" },
  { pick: "clips", glyph: "film", step: "Writes raw clips" },
  { pick: "concat", glyph: "join", step: "Joins them" },
  { pick: "assembled", glyph: "reel", step: "Assembles the video" },
];

function TimelineView({ m }: { m: PathsModel }) {
  return (
    <ol className="pa-a st-flow">
      {STOPS.map((s) => (
        <li key={s.pick} className="st-stop">
          <span className="st-ic">
            <Glyph g={s.glyph} />
          </span>
          <span className="st-step">{s.step}</span>
          <div className="st-stop-body">
            <TextBox t={m[s.pick]} />
            {s.pick === "clips" && (
              <div className="st-sub">
                <Subfolder m={m} />
                <span className="st-sub-eg">{m.subfolder.on ? "…\\clips\\<demo>\\clip.mp4" : "…\\clips\\clip.mp4"}</span>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function SentenceView({ m }: { m: PathsModel }) {
  return (
    <div className="pa-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Record with CS Demo Manager from</span> <TextToken t={m.csdmExe} />
          <span className="w">, writing CS2 commands into</span> <TextToken t={m.cs2Cfg} />
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Save raw clips in</span> <TextToken t={m.clips} />
          <span className="w">,</span>{" "}
          <SettingControl settingKey={m.subfolder.key}>
            <ChoiceToken
              label={m.subfolder.label}
              tone="alt"
              tip={m.subfolder.tip}
              popover={(close) => (
                <WordOptions
                  label={m.subfolder.label}
                  options={[
                    { value: "on", words: "one subfolder per demo", sub: "…\\clips\\<demo>\\clip.mp4" },
                    { value: "off", words: "all in the same folder", sub: "…\\clips\\clip.mp4" },
                  ]}
                  value={m.subfolder.on ? "on" : "off"}
                  onChange={m.subfolder.toggle}
                  close={close}
                />
              )}
            >
              {m.subfolder.on ? "one subfolder per demo" : "all in the same folder"}
            </ChoiceToken>
          </SettingControl>
          <span className="w">.</span>
        </div>
        <div className="sc-line">
          <span className="w">Put the concatenated clips in</span> <TextToken t={m.concat} />{" "}
          <span className="w">and the assembled video in</span> <TextToken t={m.assembled} />
          <span className="w">.</span>
        </div>
      </div>
    </div>
  );
}

function TilesView({ m }: { m: PathsModel }) {
  return (
    <div className="pa-c sx-tiles st-tiles-2">
      {STOPS.map((s) => (
        <BigTile key={s.pick} icon={<Glyph g={s.glyph} />} title={m[s.pick].label} caption={m[s.pick].value ? undefined : `Empty = ${m[s.pick].empty}`}>
          <TextBox t={m[s.pick]} bare />
        </BigTile>
      ))}
      <BigTile icon={<Glyph g="tree" />} title="Subfolder per demo" on={m.subfolder.on} caption={m.subfolder.on ? "…\\clips\\<demo>\\clip.mp4" : "…\\clips\\clip.mp4"}>
        <Subfolder m={m} />
      </BigTile>
    </div>
  );
}

const VIEWS: CardViews<PathsModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function PathsCard(grid: GridProps) {
  const m = usePaths();
  return <StyledCard cardId="paths" title="Paths" icon={<ICONS.paths />} prefix="pa" m={m} views={VIEWS} grid={grid} />;
}
