/**
 * Injection Preview: the args injected into CS2 for the current config.
 *
 * No bridge command returns that text yet (`_refresh_injection_preview` never
 * left the Tkinter process; ledgered as M8), so every style says so plainly
 * rather than reimplementing engine logic here. The styles only differ in
 * how they frame the same answer: a console, a sentence, a tile.
 */
import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { BigTile } from "../../components/cardstyle/StyledParts";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { ICONS } from "../../icons";
import { Glyph } from "./shared";
import "./SettingsCards.css";

interface InjectionModel {
  /** The preview text, or null while no engine command provides it. */
  text: string | null;
}

const ABOUT = "Live preview of the args injected into CS2 for the current configuration.";

function Refresh() {
  return (
    <button type="button" className="chip" disabled title="Not available yet: the engine does not provide the preview">
      ⟳ Refresh
    </button>
  );
}

function TimelineView({ m }: { m: InjectionModel }) {
  return (
    <div className="ip-a">
      <p className="settings-hint">{ABOUT}</p>
      <pre className="settings-injection-preview">{m.text ?? "not available yet"}</pre>
      <Refresh />
    </div>
  );
}

function SentenceView({ m }: { m: InjectionModel }) {
  return (
    <div className="ip-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">The commands sent to CS2 for these settings</span>{" "}
          {m.text ? <code>{m.text}</code> : <span className="w">cannot be previewed yet.</span>}
        </div>
      </div>
      <Refresh />
    </div>
  );
}

function TilesView({ m }: { m: InjectionModel }) {
  return (
    <div className="ip-c sx-tiles">
      <BigTile icon={<Glyph g="term" />} title="CS2 injection" caption={m.text ? undefined : "not available yet"} wide>
        {m.text && <pre className="settings-injection-preview">{m.text}</pre>}
        <Refresh />
      </BigTile>
    </div>
  );
}

const VIEWS: CardViews<InjectionModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function InjectionPreviewCard(grid: GridProps) {
  const m: InjectionModel = { text: null };
  return <StyledCard cardId="injection-preview" title="Injection Preview" icon={<ICONS.injectionPreview />} prefix="ip" m={m} views={VIEWS} grid={grid} />;
}
