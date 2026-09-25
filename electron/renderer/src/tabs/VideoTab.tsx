/**
 * The Video tab: FINAL ASSEMBLY, RESOLUTION/FRAMERATE/WINDOW, RECORDING
 * SYSTEM, HLAE OPTIONS, IN-GAME OPTIONS, CS2 EFFECTS and ENCODING.
 *
 * Ported from `_tab_video` in csdm_batch_clips_generator.py. Every card is
 * its own component, drawn in the user's card style (timeline / sentence /
 * tiles, `useCardStyle`) over one data model -- see videoKit/ for the pieces
 * they share.
 *
 * HLAE Options is mounted only while `recsys` is HLAE, ported from
 * `_on_recsys_change`'s `is_hlae` branch (`self._hlae_sec.pack`/`pack_forget`):
 * the mirv_* commands it writes do not apply in CS mode. CS2 Effects is
 * mounted unconditionally: the window's own heading for that block reads
 * "both HLAE and CS modes".
 */
import SectionList, { type SectionSpec } from "../shell/SectionList";
import { useSetting } from "../settings/store";
import Cs2EffectsCard from "./cs2Effects/Cs2EffectsCard";
import EncodingCard from "./encoding/EncodingCard";
import FinalAssemblyCard from "./finalAssembly/FinalAssemblyCard";
import HlaeOptionsCard from "./hlaeOptions/HlaeOptionsCard";
import InGameOptionsCard from "./inGameOptions/InGameOptionsCard";
import RecordingSystemCard, { RECSYS_OPTIONS } from "./recordingSystem/RecordingSystemCard";
import ResolutionCard from "./resolution/ResolutionCard";
import "./VideoTab.css";

export default function VideoTab() {
  const [recsys] = useSetting<string>("recsys");
  const isHlae = recsys === RECSYS_OPTIONS[0];

  // `isHlae`'s card is conditional at render time, so SECTIONS is built
  // inline (spread) rather than a module-level constant.
  const SECTIONS: SectionSpec[] = [
    { id: "final-assembly", element: <FinalAssemblyCard /> },
    { id: "resolution", element: <ResolutionCard className="wide" /> },
    { id: "recording-system", element: <RecordingSystemCard /> },
    ...(isHlae ? [{ id: "hlae-options", element: <HlaeOptionsCard /> }] : []),
    { id: "in-game-options", element: <InGameOptionsCard /> },
    { id: "cs2-effects", element: <Cs2EffectsCard className="wide" /> },
    { id: "encoding", element: <EncodingCard className="wide" /> },
  ];

  return (
    <div className="bento video-tab">
      <SectionList tabId="video" sections={SECTIONS} />
    </div>
  );
}
