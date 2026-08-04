"""Backward-compatibility and migration tests for the 2-axis event model.

Covers the events-beyond-kill migration (Task 1 / Task 7):
  * old flat `events: ["Kills", "Deaths", "Rounds"]` configs → new
    `event_actor` / `event_target` / `event_ally` / `event_enemy` keys
  * `teamkills_mode` → `event_ally` / `event_enemy` 3-way mapping
  * no-op for already-migrated (new-format) configs
  * `derive_event_flags_v2` flag derivation
  * run-input validation on both old and new formats
"""
from csdm.config import DEFAULT_CONFIG, _migrate_config
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
    # no `events` key should have been synthesized
    assert "events" not in cfg


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
