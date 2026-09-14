"""One team model: Ally / Enemy, applied to kills AND damages (audit 2026-09-15, E15, E2)."""
import pathlib

from csdm.engine.core import EngineMixin

KILLS = ["killer_steam_id", "victim_steam_id", "killer_team_name", "victim_team_name"]


class _Engine(EngineMixin):
    def __init__(self, kills_cols):
        self._col_cache = {}
        self._db_schema = {"kills": kills_cols,
                           "damages": ["attacker_team_name", "victim_team_name"]}
        self.logs = []

    def log(self, message, level=""):
        self.logs.append((level, message))


def test_ally_only_on_kills_compares_the_killer_and_victim_teams():
    clause, needs = _Engine(KILLS)._build_team_filter_sql(
        {"_events_ally": True, "_events_enemy": False}, "k", [], table="kills")
    assert clause == ' AND k."killer_team_name" = k."victim_team_name"'
    assert needs is True


def test_enemy_only_on_kills_excludes_teamkills():
    clause, _ = _Engine(KILLS)._build_team_filter_sql(
        {"_events_ally": False, "_events_enemy": True}, "k", [], table="kills")
    assert clause == ' AND k."killer_team_name" != k."victim_team_name"'


def test_damages_keep_their_attacker_columns():
    clause, _ = _Engine(KILLS)._build_team_filter_sql(
        {"_events_ally": True, "_events_enemy": False}, "d", [], table="damages")
    assert clause == ' AND d."attacker_team_name" = d."victim_team_name"'


def test_a_requested_side_filter_without_team_columns_is_announced():
    engine = _Engine(["killer_steam_id", "victim_steam_id"])
    clause, _ = engine._build_team_filter_sql(
        {"_events_ally": True, "_events_enemy": False}, "k", [], table="kills")
    assert clause == ""
    assert any(level == "warn" and "Ally" in message for level, message in engine.logs)


def test_the_engine_reads_no_teamkills_mode():
    """Ally / Enemy is the only team model; the old key lives in config migration only."""
    core = pathlib.Path(__file__).resolve().parent.parent / "csdm" / "engine" / "core.py"
    assert "teamkills_mode" not in core.read_text(encoding="utf-8")
