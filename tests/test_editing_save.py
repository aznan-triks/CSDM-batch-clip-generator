"""EDITING's SAVE and preset load, and the inspector's cameras, at the bridge.

SAVE has no name field: `save_preset` with `ask_name` asks it on the console's
question panel. Loading a preset gives back the EDITING selection it holds,
matched to the last PREVIEW. `clip_cameras` plans an edited clip's cameras
with the same calls a run makes.
"""
import pytest

import csdm.bridge.host as host_module
from csdm.bridge.host import COMMANDS, PRESET_NAME_QUESTION, BridgeHost
from csdm.engine.clip_edits import apply_clip_edits, normalize_clip_selection
from csdm.engine.ports import CollectingPorts
from csdm.errors import UserError

TR = 64
DP = "d.dem"
CFG = {"tickrate": TR, "before": 3, "after": 2, "perspective": "both", "victim_pre_s": 1,
       "steam_ids": ["me"]}


def kill(tick, victim):
    return {"tick": tick, "type": "kill", "killer_sid": "me", "victim_sid": victim}


@pytest.fixture
def store(monkeypatch):
    """The presets file, in memory: the tests never touch the real one."""
    presets = {}
    monkeypatch.setattr(host_module, "load_presets", lambda: dict(presets))
    monkeypatch.setattr(host_module, "save_presets", lambda p: (presets.clear(), presets.update(p)))
    return presets


def make_host(*answers):
    ports = CollectingPorts(answers=list(answers))
    host = BridgeHost(ports)
    host._player_names = {"me": "Me", "a": "Alice", "b": "Bob"}
    return host, ports


def previewed(host, events):
    seqs = host._preview_sequences({DP: events}, CFG)
    host._remember_preview(seqs, CFG)
    return seqs[DP]


EDITED = {"demo_path": DP, "start_tick": 808, "before_s": 5, "excluded_events": ["1000:kill:a"]}


# -- SAVE ---------------------------------------------------------------------

def test_save_asks_the_name_and_stores_selection_with_edits(store):
    host, ports = make_host("  Clutch reel ")
    result = COMMANDS["save_preset"](host, {"ask_name": True, "cats": ["full"],
                                            "cfg": {"before": 3}, "selected_clips": [EDITED]})
    assert ports.asks == [("text", "Name for this preset", list(PRESET_NAME_QUESTION))]
    assert result["preset"] == "Clutch reel"
    assert store["Clutch reel"]["selected_clips"] == [EDITED]
    assert store["Clutch reel"]["data"] == {"before": 3}
    assert any("Clutch reel" in m and "1 EDITING clip" in m and lvl == "ok"
               for m, lvl in ports.logs)


def test_save_cancelled_question_saves_nothing(store):
    host, ports = make_host(None)
    result = COMMANDS["save_preset"](host, {"ask_name": True, "cats": ["full"], "cfg": {},
                                            "selected_clips": [EDITED]})
    assert result == {"cancelled": True}
    assert store == {}


def test_save_blank_answer_refuses_in_one_sentence(store):
    host, _ = make_host("   ")
    with pytest.raises(UserError, match="name"):
        COMMANDS["save_preset"](host, {"ask_name": True, "cats": ["full"], "cfg": {}})
    assert store == {}


def test_settings_save_keeps_its_own_name_and_never_asks(store):
    host, ports = make_host()
    COMMANDS["save_preset"](host, {"preset": "p", "cats": ["full"], "cfg": {"a": 1}})
    assert ports.asks == [] and "p" in store


# -- load ---------------------------------------------------------------------

def test_load_restores_the_selection_the_preview_still_lists(store):
    host, ports = make_host()
    (seq,) = previewed(host, [kill(1000, "a"), kill(1300, "b")])
    kept = {"demo_path": DP, "start_tick": seq["start_tick"], "after_s": 4}
    gone = {"demo_path": DP, "start_tick": 99999}
    store["p"] = {"cats": ["full"], "data": {"before": 3}, "selected_clips": [kept, gone]}
    result = COMMANDS["load_preset"](host, {"preset": "p"})
    assert result["selected_clips"] == [kept]
    assert any("restored" in m and "1 saved clip(s) are not in this PREVIEW" in m and lvl == "warn"
               for m, lvl in ports.logs)


def test_load_without_a_preview_says_to_run_one(store):
    host, ports = make_host()
    store["p"] = {"cats": ["full"], "data": {}, "selected_clips": [EDITED]}
    result = COMMANDS["load_preset"](host, {"preset": "p"})
    assert "selected_clips" not in result
    assert any("run PREVIEW" in m for m, _ in ports.logs)


def test_load_with_no_matching_clip_leaves_the_selection(store):
    host, ports = make_host()
    previewed(host, [kill(5000, "a")])
    store["p"] = {"cats": ["full"], "data": {}, "selected_clips": [EDITED]}
    result = COMMANDS["load_preset"](host, {"preset": "p"})
    assert "selected_clips" not in result
    assert any("None of the 1 clip(s)" in m for m, _ in ports.logs)


def test_load_of_a_preset_without_selection_says_so(store):
    host, ports = make_host()
    store["p"] = {"cats": ["full"], "data": {}}
    result = COMMANDS["load_preset"](host, {"preset": "p"})
    assert "selected_clips" not in result
    assert any("holds no EDITING clip selection" in m for m, _ in ports.logs)


def test_load_of_an_unreadable_selection_still_loads_the_settings(store):
    host, ports = make_host()
    store["p"] = {"cats": ["full"], "data": {"before": 3}, "selected_clips": "junk"}
    result = COMMANDS["load_preset"](host, {"preset": "p"})
    assert result["data"] == {"before": 3} and "selected_clips" not in result
    assert any("unreadable" in m for m, _ in ports.logs)


# -- inspector cameras --------------------------------------------------------

def test_clip_cameras_follow_the_edited_clip_like_the_run():
    host, _ = make_host()
    (seq,) = previewed(host, [kill(1000, "a"), kill(1300, "b")])
    assert "a" in [c["steam_id"] for c in seq["camera_segments"]]
    entry = {"demo_path": DP, "start_tick": seq["start_tick"],
             "excluded_events": [seq["event_keys"][0]]}
    cameras = COMMANDS["clip_cameras"](host, {"clip": entry})["cameras"]
    # Alice's kill is out: the recording never cuts to her any more.
    assert "a" not in [c["steam_id"] for c in cameras]
    # ...and it is exactly what the run plans for the clip it records.
    (recorded,) = apply_clip_edits([seq], DP, normalize_clip_selection([entry]), TR)
    _, sids, primary = host._camera_players(CFG)
    assert cameras == host._preview_camera_segments(DP, recorded, CFG, sids, primary)
    assert cameras[0]["from_tick"] >= recorded["start_tick"]


def test_clip_cameras_of_a_clip_with_every_event_out_is_none():
    host, _ = make_host()
    (seq,) = previewed(host, [kill(1000, "a")])
    entry = {"demo_path": DP, "start_tick": seq["start_tick"], "excluded_events": seq["event_keys"]}
    assert COMMANDS["clip_cameras"](host, {"clip": entry}) == {"cameras": None}


def test_clip_cameras_before_any_preview_refuses_readably():
    host, _ = make_host()
    with pytest.raises(UserError, match="PREVIEW"):
        COMMANDS["clip_cameras"](host, {"clip": {"demo_path": DP, "start_tick": 1}})
