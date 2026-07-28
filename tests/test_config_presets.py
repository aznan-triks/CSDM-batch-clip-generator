"""Preset category logic, extracted from the window so a pipe can call it."""
from csdm.config import build_preset, preset_keys_for, preset_payload


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


def test_preset_payload_reads_the_new_format():
    data, keys = preset_payload({"cats": ["date"], "data": {"date_from": "x"}})
    assert data == {"date_from": "x"}
    assert keys == ["date_from", "date_to"]


def test_preset_payload_still_reads_the_old_type_format():
    data, keys = preset_payload({"type": "full", "data": {"crf": 18}})
    assert data == {"crf": 18}
    assert keys is None
