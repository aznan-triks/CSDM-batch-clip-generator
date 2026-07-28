"""Database discovery must run with no window and no real server."""
import pytest

from csdm.engine.core import EngineMixin


class FakeCursor:
    """Answers each SQL statement by shape, in the order discover_database asks."""

    def __init__(self, script):
        self._script = script
        self._rows = []

    def execute(self, sql, params=None):
        for probe, rows in self._script:
            if probe in sql:
                if params is not None and probe == "information_schema.columns":
                    self._rows = rows.get(params[0], [])
                else:
                    self._rows = rows
                return
        self._rows = []

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else (0,)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


class Host(EngineMixin):
    """Bare host: the mixin plus the one method discovery depends on."""

    def __init__(self, conn):
        self._conn = conn
        self.logged = []

    def _pg_fresh(self):
        return self._conn

    def log(self, message, level="info"):
        self.logged.append((message, level))


COLUMNS = {
    "kills":    [("weapon_name", "text"), ("killer_steam_id", "bigint")],
    "matches":  [("checksum", "text"), ("date", "timestamp"), ("map_name", "text"),
                 ("game_mode_str", "text")],
    "players":  [("name", "text"), ("steam_id", "text"), ("match_checksum", "text")],
    "demos":    [],
    "rounds":   [],
    "tags":     [("id", "bigint"), ("name", "text"), ("color", "text")],
    "checksum_tags": [("checksum", "text"), ("tag_id", "bigint")],
    "match_tags":    [],
}


def make_host():
    cursor = FakeCursor([
        ("information_schema.columns", COLUMNS),
        ("DISTINCT ON (p.steam_id)", [("s1mple", "76561198", "2026-07-01")]),
        ("COUNT(DISTINCT", [(24,)]),
        ("DISTINCT weapon_name", [("ak47",), ("awp",)]),
        ('DISTINCT "game_mode_str"', [("premier",), ("competitive",)]),
        ('DISTINCT "map_name"', [("de_mirage",), ("de_nuke",)]),
        ("FROM tags", [(1, "aces", "#ff0000")]),
    ])
    return Host(FakeConn(cursor))


def test_discovery_returns_the_full_contract():
    data = make_host().discover_database()
    assert set(data) == {
        "players", "names", "date_col", "date_col_type", "weapons", "schema",
        "col_types", "tags", "tags_schema", "match_types", "maps",
        "map_col", "map_alias", "map_join",
    }


def test_discovery_labels_players_and_indexes_names():
    data = make_host().discover_database()
    assert data["players"] == [("s1mple  (76561198)", "76561198", "s1mple", "2026-07-01")]
    assert data["names"] == {"76561198": "s1mple"}


def test_discovery_strips_map_prefixes_when_deduplicating():
    data = make_host().discover_database()
    assert data["maps"] == [("mirage", ["de_mirage"]), ("nuke", ["de_nuke"])]
    assert data["map_col"] == "map_name"
    assert data["map_alias"] == "m"


def test_discovery_finds_weapons_match_types_and_tags():
    data = make_host().discover_database()
    assert data["weapons"] == ["ak47", "awp"]
    assert data["match_types"] == ["premier", "competitive"]
    assert data["tags"] == [(1, "aces", "#ff0000")]
    assert data["tags_schema"]["junction_table"] == "checksum_tags"


def test_discovery_closes_the_connection_even_on_failure():
    host = make_host()
    host.discover_database()
    assert host._conn.closed is True


def test_discovery_touches_no_widget_and_starts_no_thread():
    """The whole point: it must be callable from a host that has no event loop."""
    host = make_host()
    host.discover_database()
    assert not hasattr(host, "after")


def test_apply_discovery_writes_the_engine_state():
    host = make_host()
    host.apply_discovery(host.discover_database())

    assert host._date_col == "date"
    assert host._map_col == "map_name"
    assert host._map_alias == "m"
    assert host._player_names == {"76561198": "s1mple"}
    assert host._db_maps == [("mirage", ["de_mirage"]), ("nuke", ["de_nuke"])]
    assert host._db_match_types == ["premier", "competitive"]


def test_apply_discovery_resets_the_per_connection_caches():
    host = make_host()
    host._demo_checksums = {"stale": 1}
    host._warned_missing_mods = {"stale"}
    host.apply_discovery(host.discover_database())

    assert host._demo_checksums == {}
    assert host._warned_missing_mods == set()
    assert host._warned_require_win_no_data is False


def test_apply_discovery_warns_through_the_log_port_when_no_date_column():
    host = make_host()
    data = host.discover_database()
    data["date_col"] = None
    host.apply_discovery(data)

    assert any(level == "warn" and "Date column" in message
               for message, level in host.logged)
