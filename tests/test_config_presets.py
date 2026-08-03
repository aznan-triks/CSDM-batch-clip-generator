"""Preset category logic, extracted from the window so a pipe can call it."""
from csdm.config import build_preset, normalize_presets, preset_keys_for, preset_payload


def test_full_means_every_key_not_a_key_list():
    """`full` is the whole configuration; turning it into a list would freeze it."""
    assert preset_keys_for(["full"]) is None
    assert preset_keys_for(["date", "full"]) is None


def test_keys_merge_without_duplicates_and_keep_their_order():
    keys = preset_keys_for(["date", "timing", "date"])
    assert keys[:2] == ["date_from", "date_to"]
    assert len(keys) == len(set(keys))


def test_unknown_category_contributes_nothing():
    assert preset_keys_for(["nope"]) == []


def test_build_preset_takes_only_the_covered_keys():
    cfg = {"date_from": "2026-01-01", "date_to": "", "crf": 18}
    preset = build_preset(cfg, ["date"])
    assert preset == {"cats": ["date"], "data": {"date_from": "2026-01-01", "date_to": ""}}


def test_build_preset_skips_a_key_the_config_does_not_have():
    preset = build_preset({"date_from": "2026-01-01"}, ["date"])
    assert preset["data"] == {"date_from": "2026-01-01"}


def test_build_preset_full_copies_everything_and_does_not_alias():
    cfg = {"crf": 18, "weapons": ["ak47"]}
    preset = build_preset(cfg, ["full"])
    assert preset["cats"] == ["full"]
    assert preset["data"] == cfg
    preset["data"]["crf"] = 99
    assert cfg["crf"] == 18, "the preset must not share the caller's dict"


def test_build_preset_stores_selected_clips_when_given():
    clips = [{"demo_path": "x.dem", "start_tick": 100}]
    preset = build_preset({"crf": 18}, ["capture"], clips)
    assert preset["selected_clips"] == clips


def test_build_preset_omits_selected_clips_when_absent():
    preset = build_preset({"crf": 18}, ["capture"])
    assert "selected_clips" not in preset


def test_preset_payload_reads_the_new_format():
    data, keys, _ = preset_payload({"cats": ["date"], "data": {"date_from": "x"}})
    assert data == {"date_from": "x"}
    assert keys == ["date_from", "date_to"]


def test_preset_payload_returns_none_for_selected_clips_when_absent():
    _, _, sc = preset_payload({"cats": ["date"], "data": {"date_from": "x"}})
    assert sc is None


def test_preset_payload_returns_selected_clips_when_present():
    clips = [{"demo_path": "x.dem", "start_tick": 100}]
    _, _, sc = preset_payload(
        {"cats": ["date"], "data": {"date_from": "x"}, "selected_clips": clips}
    )
    assert sc == clips


def test_preset_payload_still_reads_the_old_type_format():
    data, keys, _ = preset_payload({"type": "full", "data": {"crf": 18}})
    assert data == {"crf": 18}
    assert keys is None


def test_normalize_presets_gives_every_entry_a_cats_list():
    # A preset saved by an old version of the window carries {"type": "..."},
    # never {"cats": [...]}. `list_presets` sent this on the wire unchanged,
    # so the renderer's `preset.cats.join(...)` crashed on `undefined` --
    # exactly the "Something crashed" report this test locks down.
    raw = {
        "old one": {"type": "full", "data": {"crf": 18}},
        "new one": {"cats": ["date"], "data": {"date_from": "x"}},
    }
    normalized = normalize_presets(raw)
    assert normalized["old one"]["cats"] == ["full"]
    assert normalized["old one"]["data"] == {"crf": 18}
    assert normalized["new one"]["cats"] == ["date"]


def test_normalize_presets_defaults_a_missing_data_key_to_empty():
    normalized = normalize_presets({"bare": {"type": "date"}})
    assert normalized["bare"]["data"] == {}


def test_normalize_presets_keeps_selected_clips_when_present():
    clips = [{"demo_path": "x.dem", "start_tick": 100}]
    normalized = normalize_presets(
        {"p": {"cats": ["capture"], "data": {}, "selected_clips": clips}}
    )
    assert normalized["p"]["selected_clips"] == clips
    assert "selected_clips" not in normalize_presets(
        {"p": {"cats": ["capture"], "data": {}}}
    )["p"]
