"""End-to-end integration test — events beyond kill (Task 9).

Verifies the full pipeline PLUMBING for non-lethal / \"other\" events:

    config (2-axis model) -> derived flags -> _query_damages / _query_shots
      -> shared modifier layer (_apply_shared_modifiers) -> _build_sequences
      -> merged kill + damage + shot clip sequences

All DB access is mocked (FakeConn / FakeCursor) and no real demo data is
used. This is a wiring test: it proves the new code paths from the
events-beyond-kill feature are connected to one another and to the existing
kill pipeline, not a test of CSDM's actual database contents.
"""
import unittest
from unittest import mock

from csdm import config as cfgmod
from csdm.engine.core import EngineMixin

# Steam IDs used across the fake demos.
ME = "76561198000000001"    # tracked player
MATE = "76561198000000002"  # a teammate of ME
ENEMY = "76561198000000003"  # an opponent


def make_cfg(**over):
    """DEFAULT_CONFIG plus the caller's overrides (steam_ids, event_*, mods)."""
    cfg = cfgmod.DEFAULT_CONFIG.copy()
    cfg.update(over)
    return cfg


def make_engine():
    """A bare EngineMixin instance with the attributes _query_events needs."""
    app = EngineMixin.__new__(EngineMixin)
    app._col_cache = {}
    app._db_schema = {
        "matches": ["demo_path", "checksum"],
        "kills": ["match_checksum", "tick", "killer_steam_id",
                  "victim_steam_id", "weapon_name"],
        "damages": ["match_checksum", "tick", "attacker_steam_id",
                    "victim_steam_id", "weapon_name", "hitgroup",
                    "health_damage", "armor_damage",
                    "attacker_team_name", "victim_team_name"],
        "shots": ["match_checksum", "tick", "player_steam_id", "weapon_name"],
    }
    app._db_col_types = {"matches": {}}
    app._date_col = None
    app._date_col_type = ""
    app._map_col = None
    app._map_alias = "m"
    app._map_join = ""
    app._demo_checksums = {}
    app._demo_dates = {}
    app._demo_map_cache = {}
    app._player_positions_cache = {}
    app._player_names = {}
    app._warned_missing_mods = frozenset()
    app.log = lambda *a, **k: None
    return app


class FakeCursor:
    """Record the last SQL, return preloaded rows from fetchall."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.executed = None
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.executed = sql
        self.params = params

    def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self, rows=()):
        self.cursor_ = FakeCursor(rows)

    def cursor(self):
        return self.cursor_


class ConfigToFlagsTests(unittest.TestCase):
    """Stage 1 — config (2-axis model) -> derived _events_* query flags."""

    def setUp(self):
        self.app = make_engine()

    def test_build_run_cfg_derives_all_event_flags(self):
        cfg = make_cfg(event_actor=True, event_target=True,
                       event_non_lethal=True, event_other=True,
                       event_ally=True, event_enemy=True,
                       steam_ids=[ME])
        built = self.app.build_run_cfg(cfg)
        # action-type flags
        self.assertTrue(built["_events_lethal"])
        self.assertTrue(built["_events_non_lethal"])
        self.assertTrue(built["_events_other"])
        # perspective flags
        self.assertTrue(built["_events_actor"])
        self.assertTrue(built["_events_target"])
        # team filter flags
        self.assertTrue(built["_events_ally"])
        self.assertTrue(built["_events_enemy"])
        # legacy booleans kept alive for the existing kills query
        self.assertTrue(built["events_kills"])
        self.assertTrue(built["events_deaths"])

    def test_build_run_cfg_non_lethal_off_by_default(self):
        cfg = make_cfg(event_actor=True, event_target=False, steam_ids=[ME])
        built = self.app.build_run_cfg(cfg)
        self.assertFalse(built["_events_non_lethal"])
        self.assertFalse(built["_events_other"])
        self.assertFalse(built["_events_target"])


class ConfigMigrationTests(unittest.TestCase):
    """Stage 1b — old flat `events` list still migrates end-to-end."""

    def _migrate(self, saved):
        cfg = cfgmod.DEFAULT_CONFIG.copy()
        cfg.update(saved)
        cfgmod._migrate_config(saved, cfg)
        return cfg

    def test_old_kills_and_deaths_migrate_to_actor_and_target(self):
        cfg = self._migrate({"events": ["Kills", "Deaths"]})
        self.assertTrue(cfg["event_actor"])
        self.assertTrue(cfg["event_target"])
        self.assertTrue(cfg["event_enemy"])

    def test_old_teamkills_exclude_maps_to_enemy_only(self):
        cfg = self._migrate({"events": ["Kills"], "teamkills_mode": "exclude"})
        self.assertFalse(cfg["event_ally"])
        self.assertTrue(cfg["event_enemy"])

    def test_migrated_config_flows_through_build_run_cfg(self):
        # A fully migrated old config must be a valid input to the new pipeline.
        app = make_engine()
        cfg = self._migrate({"events": ["Kills", "Deaths"],
                             "teamkills_mode": "include"})
        cfg["steam_ids"] = [ME]
        built = app.build_run_cfg(cfg)
        self.assertTrue(built["_events_lethal"])
        self.assertTrue(built["_events_ally"])
        self.assertTrue(built["_events_enemy"])
        self.assertTrue(built["events_kills"])


class QueryDamagesTests(unittest.TestCase):
    """Stage 2 — _query_damages turns DB rows into damage_actor/target events."""

    def setUp(self):
        self.app = make_engine()

    def _damage_cfg(self, **over):
        return self.app.build_run_cfg(make_cfg(
            event_actor=True, event_target=True, event_non_lethal=True,
            event_ally=True, event_enemy=True, steam_ids=[ME, MATE], **over))

    def test_actor_and_target_events_produced(self):
        rows = [
            ("d1.dem", 100, ME, ENEMY, "ak-47", 1, 60, 0),    # ME attacks → actor
            ("d1.dem", 200, ENEMY, ME, "ak-47", 2, 40, 0),    # ME hit     → target
            ("d2.dem", 300, MATE, ENEMY, "deagle", 1, 30, 0), # mate attacks → actor
        ]
        results = {}
        self.app._query_damages(self._damage_cfg(), [ME, MATE], FakeConn(rows), results)

        self.assertIn("d1.dem", results)
        self.assertIn("d2.dem", results)

        types = {e["type"] for e in results["d1.dem"]}
        self.assertIn("damage_actor", types)
        self.assertIn("damage_target", types)

        actor_ev = next(e for e in results["d1.dem"] if e["type"] == "damage_actor")
        self.assertEqual(actor_ev["attacker_sid"], ME)
        self.assertEqual(actor_ev["victim_sid"], ENEMY)
        self.assertEqual(actor_ev["weapon"], "ak-47")
        self.assertEqual(actor_ev["hitgroup"], 1)
        self.assertEqual(actor_ev["health_damage"], 60)

        self.assertEqual(results["d2.dem"][0]["type"], "damage_actor")

    def test_non_lethal_disabled_queries_nothing(self):
        cfg = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_non_lethal=False, steam_ids=[ME]))
        conn = FakeConn([("d1.dem", 100, ME, ENEMY, "ak-47", 1, 60, 0)])
        results = {}
        self.app._query_damages(cfg, [ME], conn, results)
        self.assertEqual(results, {})
        self.assertIsNone(conn.cursor_.executed)  # never even built a query

    def test_ally_enemy_filter_applied(self):
        # enemy-only → "!=" clause in the SELECT
        cfg_enemy = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_non_lethal=True,
            event_ally=False, event_enemy=True, steam_ids=[ME]))
        conn = FakeConn([])
        self.app._query_damages(cfg_enemy, [ME], conn, {})
        self.assertIn('d."attacker_team_name" != d."victim_team_name"', conn.cursor_.executed)

        # ally-only → "=" clause in the SELECT
        cfg_ally = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_non_lethal=True,
            event_ally=True, event_enemy=False, steam_ids=[ME]))
        conn2 = FakeConn([])
        self.app._query_damages(cfg_ally, [ME], conn2, {})
        self.assertIn('d."attacker_team_name" = d."victim_team_name"', conn2.cursor_.executed)


class QueryShotsTests(unittest.TestCase):
    """Stage 2 — _query_shots turns DB rows into shot events."""

    def setUp(self):
        self.app = make_engine()

    def test_shot_events_produced(self):
        cfg = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_other=True, steam_ids=[ME]))
        rows = [("d1.dem", 500, ME, "ak-47")]
        results = {}
        self.app._query_shots(cfg, [ME], FakeConn(rows), results)

        ev = results["d1.dem"][0]
        self.assertEqual(ev["type"], "shot")
        self.assertEqual(ev["attacker_sid"], ME)
        self.assertEqual(ev["tick"], 500)
        self.assertEqual(ev["weapon"], "ak-47")

    def test_shots_skipped_without_actor_perspective(self):
        # Shots are inherently actor actions — with target-only they don't run.
        cfg = self.app.build_run_cfg(make_cfg(
            event_actor=False, event_target=True, event_other=True, steam_ids=[ME]))
        conn = FakeConn([("d1.dem", 500, ME, "ak-47")])
        results = {}
        self.app._query_shots(cfg, [ME], conn, results)
        self.assertEqual(results, {})
        self.assertIsNone(conn.cursor_.executed)


class SharedModifierLayerTests(unittest.TestCase):
    """Stage 3 — the shared modifier layer tags non-kill events with _mf."""

    def setUp(self):
        self.app = make_engine()

    def _mod_cfg(self, **mods):
        return self.app.build_run_cfg(make_cfg(
            event_actor=True, event_non_lethal=True, event_ally=True,
            event_enemy=True, steam_ids=[ME], **mods))

    def test_no_scope_detected_on_damage_event(self):
        cfg = self._mod_cfg(kill_mod_no_scope=True)
        results = {
            "d1.dem": [{
                "tick": 100, "type": "damage_actor",
                "attacker_sid": ME, "victim_sid": ENEMY,
                "is_no_scope": True,
            }],
        }
        self.app._apply_shared_modifiers(cfg, results)
        self.assertIn("kill_mod_no_scope", results["d1.dem"][0]["_mf"])

    def test_modifier_not_matched_stays_untagged(self):
        cfg = self._mod_cfg(kill_mod_no_scope=True)
        results = {
            "d1.dem": [{
                "tick": 100, "type": "damage_actor",
                "attacker_sid": ME, "victim_sid": ENEMY,
                # is_no_scope missing / falsy → conservative: no match
            }],
        }
        self.app._apply_shared_modifiers(cfg, results)
        self.assertNotIn("_mf", results["d1.dem"][0])

    def test_kill_events_are_left_untouched(self):
        cfg = self._mod_cfg(kill_mod_no_scope=True)
        results = {
            "d1.dem": [{"tick": 1, "type": "kill",
                        "killer_sid": ME, "victim_sid": ENEMY,
                        "_mf": {"kill_mod_one_tap"}}],
        }
        self.app._apply_shared_modifiers(cfg, results)
        self.assertEqual(results["d1.dem"][0]["_mf"], {"kill_mod_one_tap"})


class BuildSequencesTests(unittest.TestCase):
    """Stage 4 — _build_sequences merges kill + damage + shot events into clips."""

    def setUp(self):
        self.app = make_engine()

    def test_mixed_kill_damage_shot_merge_into_one_sequence(self):
        events = [
            {"tick": 100, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY},
            {"tick": 150, "type": "damage_actor", "attacker_sid": ME, "victim_sid": ENEMY},
            {"tick": 200, "type": "shot", "attacker_sid": ME},
        ]
        seqs = self.app._build_sequences(events, 64, 1.0, 1.0)
        self.assertEqual(len(seqs), 1)  # all within the merge window
        types = {e["type"] for s in seqs for e in s["events"]}
        self.assertEqual(types, {"kill", "damage_actor", "shot"})
        self.assertEqual(seqs[0]["event_type"], "kill")

    def test_damage_and_shot_produce_distinct_sequences(self):
        events = [
            {"tick": 1000, "type": "damage_actor", "attacker_sid": ME, "victim_sid": ENEMY},
            {"tick": 5000, "type": "shot", "attacker_sid": ME},
        ]
        seqs = self.app._build_sequences(events, 64, 1.0, 1.0)
        self.assertEqual(len(seqs), 2)
        self.assertEqual(seqs[0]["event_type"], "damage_actor")
        self.assertEqual(seqs[1]["event_type"], "shot")

    def test_non_kill_sequence_has_clip_shape(self):
        # A damage-only sequence carries the same start/end/events shape as a kill.
        seqs = self.app._build_sequences(
            [{"tick": 1000, "type": "damage_actor", "attacker_sid": ME, "victim_sid": ENEMY}],
            64, 3.0, 5.0)
        self.assertEqual(len(seqs), 1)
        s = seqs[0]
        self.assertIn("start_tick", s)
        self.assertIn("end_tick", s)
        self.assertIn("events", s)
        self.assertEqual(s["events"][0]["type"], "damage_actor")
        self.assertEqual(s["start_tick"], 1000 - int(3.0 * 64))
        self.assertEqual(s["end_tick"], 1000 + int(5.0 * 64))


class QueryEventsWiringTests(unittest.TestCase):
    """Stage 2+3 wiring — _query_events invokes damages, shots and modifiers.

    This is the closest to a real run the mocks can get without a live DB: it
    drives the whole _query_events orchestration and proves the non-kill query
    methods and the shared modifier layer are actually reached on a run.
    """

    def setUp(self):
        self.app = make_engine()

    def test_query_events_calls_damages_shots_and_modifier_layer(self):
        cfg = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_target=True,
            event_non_lethal=True, event_other=True,
            event_ally=True, event_enemy=True, steam_ids=[ME]))
        conn = FakeConn([])  # no kills/damages/shots rows → empty results
        self.app._pg = lambda: conn

        with mock.patch.object(self.app, "_query_damages",
                               wraps=self.app._query_damages) as m_dam, \
             mock.patch.object(self.app, "_query_shots",
                               wraps=self.app._query_shots) as m_shot, \
             mock.patch.object(self.app, "_apply_shared_modifiers",
                               wraps=self.app._apply_shared_modifiers) as m_mod:
            results = self.app._query_events(cfg)

        self.assertEqual(results, {})
        m_dam.assert_called_once()
        m_shot.assert_called_once()
        m_mod.assert_called_once()

    def test_query_events_with_damage_rows_returns_damage_events(self):
        # A single demo carries both a kill and a non-lethal damage row; the
        # full _query_events orchestration must surface both in `results`.
        cfg = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_target=False,
            event_non_lethal=True, event_other=False,
            event_ally=True, event_enemy=True, steam_ids=[ME]))

        class _MultiConn(FakeConn):
            """Return kill rows first, then damage rows, then nothing."""

            def __init__(self):
                super().__init__([])
                self.batch = [
                    [("d1.dem", 100, "chk1", None, None, "ak-47",
                      ME, ENEMY, "", "")],  # kill row (dc, tick, chk, k, v, w)
                    [("d1.dem", 150, ME, ENEMY, "ak-47", 1, 40, 0)],  # damage row
                    [],
                ]

            def cursor(self):
                cur = FakeCursor(self.batch.pop(0) if self.batch else [])
                return cur

        conn = _MultiConn()
        self.app._pg = lambda: conn

        results = self.app._query_events(cfg)

        self.assertIn("d1.dem", results)
        types = {e["type"] for e in results["d1.dem"]}
        self.assertIn("kill", types)
        self.assertIn("damage_actor", types)


if __name__ == "__main__":
    unittest.main()
