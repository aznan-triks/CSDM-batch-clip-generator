/**
 * Timing & Retries, "tiles" style: one big number tile per setting and the
 * demo order as two pictures.
 */
import { PictureChoice, type PictureOption } from "../../components/cardstyle/IconTile";
import SmallCardCountTile from "../../components/cardstyle/SmallCardCountTile";
import SettingControl from "../../settings/SettingControl";
import { GLYPHS, ORDER_ART } from "./shared";
import { ORDER_WORDS, type ClipOrder, type CountSetting, type TimingRetriesModel } from "./useTimingRetries";

const ORDER_OPTIONS: readonly PictureOption<ClipOrder>[] = (["chrono", "random"] as const).map((value) => ({
  value,
  title: ORDER_WORDS[value].title,
  subtitle: ORDER_WORDS[value].words,
  art: ORDER_ART[value],
  color: value === "chrono" ? "var(--cam-k)" : "var(--cam-v)",
}));

function Tile({ n, title, icon, caption, auto }: { n: CountSetting; title: string; icon: keyof typeof GLYPHS; caption: string; auto?: boolean }) {
  return (
    <SettingControl settingKey={n.key}>
      <SmallCardCountTile
        icon={GLYPHS[icon]}
        title={title}
        value={n.value}
        unit={n.unit}
        min={n.min}
        max={n.max}
        special={auto ? { value: 0, word: "auto" } : undefined}
        caption={caption}
        tip={n.tip}
        onChange={n.set}
      />
    </SettingControl>
  );
}

export default function TilesView({ m }: { m: TimingRetriesModel }) {
  return (
    <div className="tr-c">
      <div className="tr-c-grid">
        <Tile n={m.retries} title="Retries" icon="retry" caption={m.retries.value ? "after a failure" : "fail at once"} />
        <Tile n={m.retryDelay} title="Wait between" icon="wait" caption="before each retry" />
        <Tile n={m.timeout} title="Stop if stuck" icon="stuck" caption="a recording that hangs" auto />
        <Tile n={m.demoPause} title="Pause" icon="demo" caption="between two demos" />
      </div>
      <SettingControl settingKey={m.order.key}>
        <div className="tr-c-order" title={m.order.tip}>
          <PictureChoice label="Demo order" options={ORDER_OPTIONS} value={m.order.value} onChange={m.order.set} />
        </div>
      </SettingControl>
    </div>
  );
}
