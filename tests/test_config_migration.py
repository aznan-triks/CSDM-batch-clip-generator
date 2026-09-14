"""Backward-compatibility and migration tests for the 2-axis event model.

Covers the events-beyond-kill migration (Task 1 / Task 7):
  * old flat `events: ["Kills", "Deaths", "Rounds"]` configs → new
    `event_actor` / `event_target` / `event_ally` / `event_enemy` keys
  * `teamkills_mode` → `event_ally` / `event_enemy` 3-way mapping
  * no-op for already-migrated (new-format) configs
  * `derive_event_flags_v2` flag derivation
  * run-input validation on both old and new formats
"""
from csdm.config import DEFAULT_CONFIG, UI_SECTIONS_VERSION, _migrate_config
from csdm.engine.core import EngineMixin


def _migrated(saved):
    """Run `_migrate_config` the way `load_config` does.

    `_migrate_config(saved, cfg)` mutates `cfg` in place — a copy of
    DEFAULT_CONFIG pre-updated with `saved`, exactly like `load_config`.
    Returns the resulting cfg.
    """
    cfg = DEFAULT_CONFIG.copy()
    cfg.update(saved)
    _migrate_config(saved, cfg)
    return cfg


class _DummyEngine:
    """Minimal stand-in so `validate_run_inputs` has its `ask`."""

    def ask(self, *args, **kwargs):
        return None


# ── old `events` list → 2-axis model ─────────────────────────────────────────

def test_migrate_old_events_kills_only():
    """`events: ["Kills"]` → actor on, target off."""
    cfg = _migrated({"events": ["Kills"], "teamkills_mode": "include"})
    assert cfg["event_actor"] is True
    assert cfg["event_target"] is False
    assert cfg["event_enemy"] is True


def test_migrate_old_events_kills_and_deaths():
    """`events: ["Kills","Deaths"]` → both perspectives on."""
    cfg = _migrated({"events": ["Kills", "Deaths"]})
    assert cfg["event_actor"] is True
    assert cfg["event_target"] is True


def test_migrate_old_events_deaths_only():
    """`events: ["Deaths"]` → actor on (kill/death sharing), target on."""
    cfg = _migrated({"events": ["Deaths"]})
    assert cfg["event_actor"] is True
    assert cfg["event_target"] is True


def test_migrate_old_events_rounds_only():
    """`events: ["Rounds"]` → no perspective, Rounds preserved, still valid."""
    cfg = _migrated({"events": ["Rounds"]})
    assert cfg["event_actor"] is False
    assert cfg["event_target"] is False
    assert cfg["events"] == ["Rounds"]


# ── teamkills_mode → event_ally / event_enemy ────────────────────────────────

def test_migrate_teamkills_include():
    """`teamkills_mode: "include"` → ally + enemy both on."""
    cfg = _migrated({"events": ["Kills"], "teamkills_mode": "include"})
    assert cfg["event_ally"] is True
    assert cfg["event_enemy"] is True


def test_migrate_teamkills_exclude():
    """`teamkills_mode: "exclude"` → ally off, enemy on."""
    cfg = _migrated({"events": ["Kills"], "teamkills_mode": "exclude"})
    assert cfg["event_ally"] is False
    assert cfg["event_enemy"] is True


def test_migrate_teamkills_only():
    """`teamkills_mode: "only"` → ally on, enemy off."""
    cfg = _migrated({"events": ["Kills"], "teamkills_mode": "only"})
    assert cfg["event_ally"] is True
    assert cfg["event_enemy"] is False


def test_migrate_teamkills_defaults_to_include():
    """Missing `teamkills_mode` defaults to include (both on)."""
    cfg = _migrated({"events": ["Kills"]})
    assert cfg["event_ally"] is True
    assert cfg["event_enemy"] is True


# ── no-op for already-migrated configs ───────────────────────────────────────

def test_new_format_preserved_no_migration():
    """A config already using 2-axis keys is left untouched."""
    new = {"event_actor": True, "event_target": False, "event_enemy": True,
           "event_ally": True}
    cfg = _migrated(new)
    assert cfg["event_actor"] is True
    assert cfg["event_target"] is False
    assert cfg["event_enemy"] is True
    assert cfg["event_ally"] is True
    # nothing should have been synthesized into `events`
    assert cfg["events"] == []


def test_new_format_overrides_not_clobbered_by_defaults():
    """Non-default 2-axis values survive migration untouched."""
    new = {"event_actor": False, "event_target": True, "event_enemy": False}
    cfg = _migrated(new)
    assert cfg["event_actor"] is False
    assert cfg["event_target"] is True
    assert cfg["event_enemy"] is False


# ── derive_event_flags_v2 ────────────────────────────────────────────────────

def test_derive_flags_actor_only():
    """Actor only → lethal on, non-lethal/other off, actor perspective on."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": True, "event_target": False})
    assert flags["_events_lethal"] is True
    assert flags["_events_actor"] is True
    assert flags["_events_target"] is False
    assert flags["_events_non_lethal"] is False
    assert flags["_events_other"] is False


def test_derive_flags_target_only():
    """Target only → lethal on (via target), target perspective on."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": False, "event_target": True})
    assert flags["_events_lethal"] is True
    assert flags["_events_actor"] is False
    assert flags["_events_target"] is True


def test_derive_flags_neither_perspective():
    """No perspective → lethal off, no round flag."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": False, "event_target": False})
    assert flags["_events_lethal"] is False
    assert flags["_events_actor"] is False
    assert flags["_events_target"] is False
    assert flags["_events_rounds"] is False


def test_derive_flags_non_lethal_and_other():
    """Separate toggles are surfaced as their own derived flags."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": True, "event_target": False,
         "event_non_lethal": True, "event_other": True})
    assert flags["_events_non_lethal"] is True
    assert flags["_events_other"] is True
    assert flags["_events_lethal"] is True


def test_derive_flags_team_filters():
    """event_ally / event_enemy map straight onto the derived flags."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_ally": True, "event_enemy": False})
    assert flags["_events_ally"] is True
    assert flags["_events_enemy"] is False


def test_derive_flags_rounds():
    """`Rounds` in events list → `_events_rounds` True."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": True, "event_target": False, "events": ["Rounds"]})
    assert flags["_events_rounds"] is True


def test_derive_flags_legacy_booleans_backcompat():
    """`events_kills` / `events_deaths` legacy booleans mirror perspectives."""
    flags = EngineMixin.derive_event_flags_v2(
        {"event_actor": True, "event_target": True})
    assert flags["events_kills"] is True
    assert flags["events_deaths"] is True


# ── run-input validation, old vs new format ──────────────────────────────────

def test_old_format_run_validates_after_migration():
    """An old config (with steam_ids) passes validation once migrated."""
    cfg = _migrated({"events": ["Kills"], "teamkills_mode": "include",
                     "steam_ids": ["76561198000000000"]})
    assert EngineMixin.validate_run_inputs(_DummyEngine(), cfg) is True


def test_new_format_run_validates():
    """A new-format config passes validation."""
    cfg = {"event_actor": True, "event_target": False,
           "steam_ids": ["76561198000000000"]}
    assert EngineMixin.validate_run_inputs(_DummyEngine(), cfg) is True


def test_rounds_only_config_validates_without_perspective():
    """A config with only Rounds (no perspective) still passes."""
    cfg = _migrated({"events": ["Rounds"], "steam_ids": ["76561198000000000"]})
    assert EngineMixin.validate_run_inputs(_DummyEngine(), cfg) is True


# ---------------------------------------------------------------------------
# Card grid halved to a 48px column (v3 -> v4)
# ---------------------------------------------------------------------------


def test_half_step_widens_stored_rectangles_so_no_card_moves():
    # A rectangle is stored in COLUMNS. The column halved, so the same card
    # needs twice as many of them to keep the width the user chose.
    cfg = _migrated({
        "ui_card_block_size": 96,
        "ui_sections": {
            "capture": {
                "v": 3,
                "cards": {"players": {"x": 3, "y": 8, "w": 3, "h": 24}},
                "collapsed": ["timing"],
            }
        },
    })
    slot = cfg["ui_sections"]["capture"]["cards"]["players"]
    assert (slot["x"], slot["w"]) == (6, 6)
    # Rows are counted in `ui_card_row_height`, which this change never touched.
    assert (slot["y"], slot["h"]) == (8, 24)
    assert cfg["ui_sections"]["capture"]["v"] == UI_SECTIONS_VERSION
    assert cfg["ui_sections"]["capture"]["collapsed"] == ["timing"]
    assert cfg["ui_card_block_size"] == 48


def test_half_step_is_idempotent():
    once = _migrated({
        "ui_card_block_size": 96,
        "ui_sections": {"capture": {"v": 3, "cards": {"a": {"x": 2, "y": 0, "w": 4, "h": 12}}}},
    })
    twice = _migrated({
        "ui_card_block_size": once["ui_card_block_size"],
        "ui_sections": once["ui_sections"],
    })
    assert twice["ui_sections"] == once["ui_sections"]
    assert twice["ui_card_block_size"] == once["ui_card_block_size"]


def test_half_step_halves_a_column_size_the_user_chose_themselves():
    # The rectangles are rescaled whatever the column size is, so the column
    # has to follow on the same scale or every card doubles in width.
    cfg = _migrated({
        "ui_card_block_size": 120,
        "ui_sections": {"capture": {"v": 3, "cards": {"a": {"x": 0, "y": 0, "w": 2, "h": 8}}}},
    })
    assert cfg["ui_card_block_size"] == 60
    assert cfg["ui_sections"]["capture"]["cards"]["a"]["w"] == 4


def test_half_step_leaves_a_config_with_no_layouts_alone():
    cfg = _migrated({"ui_card_block_size": 96})
    # Nothing stored to rescale: the user simply gets the new default column
    # the next time a layout is written, and their explicit 96 is untouched.
    assert cfg["ui_card_block_size"] == 96
    assert "ui_sections" not in cfg or cfg["ui_sections"] == DEFAULT_CONFIG["ui_sections"]


# ── the old-format migration runs once, never on a config the app wrote ─────

_UI_STATE = {"event_actor": True, "event_target": True, "event_lethal": True,
             "event_ally": True, "event_enemy": True, "teamkills_mode": "exclude"}


def test_rounds_toggled_by_the_app_does_not_rerun_the_old_migration():
    cfg = _migrated({**_UI_STATE, "events": ["Rounds"]})
    assert (cfg["event_actor"], cfg["event_target"], cfg["event_lethal"]) == (True, True, True)
    assert (cfg["event_ally"], cfg["event_enemy"]) == (True, True)
    assert cfg["events"] == ["Rounds"]


def test_a_leftover_kills_entry_does_not_rerun_the_old_migration():
    cfg = _migrated({**_UI_STATE, "events": ["Kills"]})
    assert cfg["event_target"] is True
    assert (cfg["event_ally"], cfg["event_enemy"]) == (True, True)


def test_old_format_migration_is_idempotent():
    once = _migrated({"events": ["Kills", "Deaths", "Rounds"], "teamkills_mode": "exclude"})
    twice = _migrated(dict(once))
    for key in ("event_actor", "event_target", "event_lethal",
                "event_ally", "event_enemy", "events"):
        assert twice[key] == once[key], key


def test_old_format_migration_keeps_only_rounds_in_events():
    assert _migrated({"events": ["Kills", "Deaths"]})["events"] == []
    assert _migrated({"events": ["Kills", "Rounds"]})["events"] == ["Rounds"]
