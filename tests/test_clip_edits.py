"""Per-clip edits from the EDITING tab reach what the run records (clip_edits.py)."""
import pytest

from csdm.engine.clip_edits import apply_clip_edits, event_key, normalize_clip_selection
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin

TR = 64
DP = "d.dem"


def kill(tick, victim="v"):
    return {"tick": tick, "type": "kill", "killer_sid": "me", "victim_sid": victim}


def seqs_of(*events, before=3, after=2):
    return EngineMixin._build_sequences(None, list(events), TR, before, after)


def sel(seq, **edits):
    return normalize_clip_selection([{"demo_path": DP, "start_tick": seq["start_tick"], **edits}])


def test_no_selection_records_everything_untouched():
    seqs = seqs_of(kill(1000), kill(5000))
    assert apply_clip_edits(seqs, DP, None, TR) is seqs


def test_unedited_entry_keeps_the_engine_window():
    (seq,) = seqs_of(kill(1000))
    (out,) = apply_clip_edits([seq], DP, sel(seq), TR)
    assert (out["start_tick"], out["end_tick"]) == (seq["start_tick"], seq["end_tick"])


def test_override_start_and_end_in_whole_seconds():
    (seq,) = seqs_of(kill(1000))
    (out,) = apply_clip_edits([seq], DP, sel(seq, before_s=5, after_s=7), TR)
    assert out["start_tick"] == 1000 - 5 * TR
    assert out["end_tick"] == 1000 + 7 * TR


def test_override_one_side_keeps_the_other():
    (seq,) = seqs_of(kill(1000))
    (out,) = apply_clip_edits([seq], DP, sel(seq, after_s=0), TR)
    assert out["start_tick"] == seq["start_tick"]
    assert out["end_tick"] == 1000


def test_zero_seconds_both_sides_is_never_an_empty_clip():
    (seq,) = seqs_of(kill(1000))
    (out,) = apply_clip_edits([seq], DP, sel(seq, before_s=0, after_s=0), TR)
    assert out["end_tick"] - out["start_tick"] == 1


def test_start_never_goes_below_tick_zero():
    (seq,) = seqs_of(kill(100))
    (out,) = apply_clip_edits([seq], DP, sel(seq, before_s=15), TR)
    assert out["start_tick"] == 0


def test_excluded_clip_is_not_recorded():
    a, b = seqs_of(kill(1000), kill(9000))
    out = apply_clip_edits([a, b], DP, sel(b), TR)
    assert [s["start_tick"] for s in out] == [b["start_tick"]]


def test_selection_of_another_demo_does_not_leak():
    (seq,) = seqs_of(kill(1000))
    other = normalize_clip_selection([{"demo_path": "x.dem", "start_tick": seq["start_tick"]}])
    assert apply_clip_edits([seq], DP, other, TR) == []


def test_excluded_event_leaves_the_clip_and_moves_its_edge():
    # Two kills merged into one clip; taking out the first one starts the
    # clip at the second, with the same lead the engine gave it.
    (seq,) = seqs_of(kill(1000, "a"), kill(1300, "b"))
    assert len(seq["events"]) == 2
    first = event_key(seq["events"][0])
    (out,) = apply_clip_edits([seq], DP, sel(seq, excluded_events=[first]), TR)
    assert [e["victim_sid"] for e in out["events"]] == ["b"]
    assert out["start_tick"] == 1300 - 3 * TR
    assert out["end_tick"] == seq["end_tick"]
    assert len(seq["events"]) == 2  # the input is not mutated


def test_every_event_excluded_drops_the_clip():
    (seq,) = seqs_of(kill(1000))
    keys = [event_key(e) for e in seq["events"]]
    assert apply_clip_edits([seq], DP, sel(seq, excluded_events=keys), TR) == []


def test_clips_the_edits_make_overlap_are_joined():
    # Far apart: the engine's merge rule keeps them separate.
    a, b = seqs_of(kill(1000, "a"), kill(1000 + 20 * TR, "b"))
    selection = normalize_clip_selection([
        {"demo_path": DP, "start_tick": a["start_tick"], "after_s": 18},
        {"demo_path": DP, "start_tick": b["start_tick"]},
    ])
    (out,) = apply_clip_edits([a, b], DP, selection, TR)
    assert out["start_tick"] == a["start_tick"]
    assert out["end_tick"] == b["end_tick"]
    assert [e["victim_sid"] for e in out["events"]] == ["a", "b"]


def test_touching_but_not_overlapping_clips_stay_apart():
    a, b = seqs_of(kill(1000, "a"), kill(1000 + 20 * TR, "b"))
    gap_s = (b["start_tick"] - 1000) // TR
    selection = normalize_clip_selection([
        {"demo_path": DP, "start_tick": a["start_tick"], "after_s": gap_s},
        {"demo_path": DP, "start_tick": b["start_tick"]},
    ])
    assert len(apply_clip_edits([a, b], DP, selection, TR)) == 2


def test_excluded_event_in_a_merged_clip_updates_its_types():
    dmg = {"tick": 1100, "type": "damage_actor", "attacker_sid": "me", "victim_sid": "c"}
    (seq,) = seqs_of(kill(1000, "a"), dmg)
    assert seq["event_types"] == ["damage_actor", "kill"]
    (out,) = apply_clip_edits([seq], DP, sel(seq, excluded_events=[event_key(dmg)]), TR)
    assert out["event_type"] == "kill" and "event_types" not in out


@pytest.mark.parametrize("bad", [
    "nope",
    [{"start_tick": 1}],
    [{"demo_path": DP, "start_tick": 1, "before_s": -1}],
    [{"demo_path": DP, "start_tick": 1, "after_s": 2.5}],
    [{"demo_path": DP, "start_tick": 1, "after_s": True}],
    [{"demo_path": DP, "start_tick": 1, "excluded_events": "1:kill:v"}],
])
def test_malformed_selection_fails_fast(bad):
    with pytest.raises(ValueError):
        normalize_clip_selection(bad)


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self):
        self.init_engine_state()
        self._player_names = {"me": "Me", "a": "Alice"}


def test_preview_names_events_and_cameras_the_way_edits_read_them():
    host = _Host()
    cfg = {"tickrate": TR, "before": 3, "after": 2, "perspective": "killer", "steam_ids": ["me"]}
    (seq,) = host._preview_sequences({DP: [kill(1000, "a"), kill(1300, "b")]}, cfg)[DP]
    assert seq["event_keys"] == [event_key(e) for e in seq["events"]]
    assert seq["camera_segments"] == [
        {"from_tick": seq["start_tick"], "to_tick": seq["end_tick"], "steam_id": "me", "name": "Me"}]
    # A key the preview handed out takes that event out of the recording.
    (out,) = apply_clip_edits([seq], DP, sel(seq, excluded_events=seq["event_keys"][:1]), TR)
    assert len(out["events"]) == 1


def test_preview_folds_camera_points_on_one_player_into_one_span():
    host = _Host()
    cfg = {"tickrate": TR, "before": 3, "after": 2, "perspective": "both", "victim_pre_s": 1,
           "steam_ids": ["me"]}
    (seq,) = host._preview_sequences({DP: [kill(1000, "a")]}, cfg)[DP]
    assert [s["steam_id"] for s in seq["camera_segments"]] == ["me", "a"]
    assert seq["camera_segments"][0]["to_tick"] == seq["camera_segments"][1]["from_tick"]
    assert seq["camera_segments"][1]["name"] == "Alice"


def test_save_keeps_the_edits_with_the_selection():
    from csdm.config import build_preset, preset_payload
    clips = [{"demo_path": DP, "start_tick": 808, "before_s": 5, "excluded_events": ["1000:kill:v"]}]
    _, _, stored = preset_payload(build_preset({"before": 3}, ["full"], clips))
    assert normalize_clip_selection(stored) == clips
