"""E4 (C6a, lot M2) — filters on non-kill events.

E4: the damage and shot queries used to filter on player and team only, so
weapons, match type, map, headshots and suicides were silently ignored for
them. Kill filters were declared applicable to every event category while
nothing could evaluate them there. These tests pin the SQL each query sends
(fake connection capturing SQL + params), the per-category applicability
table, and the global gate that only lets an applicable filter decide the
fate of a non-kill event.
"""
import unittest

from csdm.engine.core import EngineMixin
from csdm.static_data import KILL_FILTER_REGISTRY, SUICIDE_WEAPONS

from tests.test_e2e_events_beyond_kill import ME, ENEMY, FakeConn, make_cfg, make_engine


def _placeholders(sql):
    return sql.count("%s")


class _Base(unittest.TestCase):
    def setUp(self):
        self.app = make_engine()
        self.app._db_schema["matches"] = ["demo_path", "checksum", "game_mode_str", "map_name"]
        self.app._db_schema["shots"] = ["match_checksum", "tick", "player_steam_id",
                                        "weapon_name", "player_velocity_z"]

    def _cfg(self, **over):
        base = dict(event_actor=True, event_non_lethal=True, event_other=True,
                    event_ally=True, event_enemy=True, steam_ids=[ME])
        base.update(over)
        return self.app.build_run_cfg(make_cfg(**base))

    def _damages_sql(self, **over):
        conn = FakeConn([])
        self.app._query_damages(self._cfg(**over), [ME], conn, {})
        cur = conn.cursor_
        self.assertIsNotNone(cur.executed, "damages query did not run")
        self.assertEqual(_placeholders(cur.executed), len(cur.params))
        return cur.executed, list(cur.params)

    def _shots_sql(self, **over):
        conn = FakeConn([])
        self.app._query_shots(self._cfg(**over), [ME], conn, {})
        cur = conn.cursor_
        self.assertIsNotNone(cur.executed, "shots query did not run")
        self.assertEqual(_placeholders(cur.executed), len(cur.params))
        return cur.executed, list(cur.params)

    def _with_map(self):
        self.app._map_col = "map_name"
        self.app._map_alias = "m"
        self.app._map_join = ""
        self.app._db_maps = [("de_dust2", ["de_dust2"]), ("de_mirage", ["de_mirage"])]
        return dict(map_filter_enabled=True, map_filter=["de_mirage"])


class NonKillSqlTests(_Base):
    """E4 — damages and shots honour the same scope filters as kills."""

    def test_damages_filter_on_weapons(self):
        sql, params = self._damages_sql(weapons=["AK-47", "AWP"])
        self.assertIn('d."weapon_name" IN (%s,%s)', sql)
        self.assertIn("AK-47", params)
        self.assertIn("AWP", params)

    def test_shots_filter_on_weapons(self):
        sql, params = self._shots_sql(weapons=["AK-47"])
        self.assertIn('s."weapon_name" IN (%s)', sql)
        self.assertIn("AK-47", params)

    def test_damages_filter_on_match_type(self):
        sql, params = self._damages_sql(match_type_filter_enabled=True,
                                        match_type_premier=True,
                                        match_type_competitive=False,
                                        match_type_wingman=False)
        self.assertIn('m."game_mode_str" IN (%s)', sql)
        self.assertIn("premier", params)

    def test_shots_filter_on_match_type(self):
        sql, params = self._shots_sql(match_type_filter_enabled=True,
                                      match_type_premier=True,
                                      match_type_competitive=False,
                                      match_type_wingman=False)
        self.assertIn('m."game_mode_str" IN (%s)', sql)
        self.assertIn("premier", params)

    def test_damages_filter_on_map(self):
        sql, params = self._damages_sql(**self._with_map())
        self.assertIn('m."map_name" IN (%s)', sql)
        self.assertIn("de_mirage", params)
        self.assertNotIn("de_dust2", params)

    def test_shots_filter_on_map(self):
        sql, params = self._shots_sql(**self._with_map())
        self.assertIn('m."map_name" IN (%s)', sql)
        self.assertIn("de_mirage", params)

    def test_map_join_is_part_of_the_from_clause(self):
        self._with_map()
        self.app._map_join = "JOIN maps mp ON mp.checksum = m.checksum"
        self.app._map_alias = "mp"
        sql, _ = self._damages_sql(map_filter_enabled=True, map_filter=["de_mirage"])
        self.assertIn("JOIN maps mp ON mp.checksum = m.checksum", sql)
        self.assertIn('mp."map_name" IN (%s)', sql)
        sql, _ = self._shots_sql(map_filter_enabled=True, map_filter=["de_mirage"])
        self.assertIn("JOIN maps mp ON mp.checksum = m.checksum", sql)

    def test_damages_headshots_only_means_head_hitgroup(self):
        sql, _ = self._damages_sql(headshots_mode="only")
        self.assertIn('d."hitgroup" = 1', sql)

    def test_damages_headshots_exclude_keeps_other_hitgroups(self):
        sql, _ = self._damages_sql(headshots_mode="exclude")
        self.assertIn('d."hitgroup" IS DISTINCT FROM 1', sql)

    def test_shots_ignore_headshots_mode(self):
        # A shot has no hit location: "headshots only" does not apply to it.
        sql, _ = self._shots_sql(headshots_mode="only")
        self.assertNotIn("hitgroup", sql)

    def test_damages_suicide_exclude(self):
        sql, params = self._damages_sql(suicides_mode="exclude")
        self.assertIn('d."weapon_name" NOT IN', sql)
        for w in SUICIDE_WEAPONS:
            self.assertIn(w, params)

    def test_damages_suicide_only(self):
        sql, _ = self._damages_sql(suicides_mode="only")
        self.assertIn('AND d."weapon_name" IN', sql)

    def test_no_filter_adds_no_clause(self):
        sql, params = self._damages_sql()
        self.assertNotIn("weapon_name\" IN", sql)
        self.assertNotIn("game_mode_str", sql)
        self.assertNotIn("hitgroup\" =", sql)
        self.assertEqual(params, [ME])

    def test_all_filters_together_keep_params_aligned(self):
        over = self._with_map()
        over.update(weapons=["AK-47"], match_type_filter_enabled=True,
                    match_type_premier=True, match_type_competitive=False,
                    match_type_wingman=False, headshots_mode="only",
                    suicides_mode="exclude")
        sql, params = self._damages_sql(**over)
        self.assertEqual(params[0], ME)
        # Placeholder count equals param count (asserted in the helper), and the
        # values appear in the order their clauses appear in the SQL.
        order = [sql.index('d."weapon_name" IN'), sql.index("game_mode_str"),
                 sql.index('m."map_name"')]
        self.assertEqual(order, sorted(order))
        self.assertLess(params.index("AK-47"), params.index("premier"))
        self.assertLess(params.index("premier"), params.index("de_mirage"))


class AppliesToTests(unittest.TestCase):
    """E4 — a filter declares only the event categories it can really judge."""

    def test_registry_field_is_named_applies_to(self):
        for f in KILL_FILTER_REGISTRY:
            self.assertTrue(hasattr(f, "applies_to"), f.key)
            self.assertFalse(hasattr(f, "applicable_to"), f.key)

    def test_applies_to_values(self):
        expected = {f.key: ("kill",) for f in KILL_FILTER_REGISTRY}
        # shots.player_velocity_z lets airborne be judged on a shot.
        expected["kill_mod_airborne"] = ("kill", "shot")
        # C5bis damage / shot filters judge only their own category.
        for f in KILL_FILTER_REGISTRY:
            if f.key.startswith("dmg_mod_"):
                expected[f.key] = ("damage",)
            elif f.key.startswith("shot_mod_"):
                expected[f.key] = ("shot",)
        actual = {f.key: tuple(f.applies_to) for f in KILL_FILTER_REGISTRY}
        self.assertEqual(actual, expected)


class GateTests(unittest.TestCase):
    """E4 — the global gate judges a non-kill only by the filters that apply to it."""

    def setUp(self):
        self.app = make_engine()

    @staticmethod
    def _kill(tick, mf=()):
        e = {"tick": tick, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY}
        if mf:
            e["_mf"] = set(mf)
        return e

    @staticmethod
    def _ev(etype, tick, mf=()):
        e = {"tick": tick, "type": etype, "attacker_sid": ME}
        if mf:
            e["_mf"] = set(mf)
        return e

    def _gate(self, events, **cfg):
        return self.app._apply_global_filter_gate_events(events, cfg)

    def test_must_applicable_filter_drops_unmatched_shot(self):
        out = self._gate([self._ev("shot", 1, {"kill_mod_airborne"}), self._ev("shot", 2)],
                         kill_mod_airborne=True, kill_mod_airborne_req=True)
        self.assertEqual([e["tick"] for e in out], [1])

    def test_optional_applicable_filter_drops_unmatched_shot(self):
        out = self._gate([self._ev("shot", 1, {"kill_mod_airborne"}), self._ev("shot", 2)],
                         kill_mod_airborne=True)
        self.assertEqual([e["tick"] for e in out], [1])

    def test_non_applicable_filter_lets_non_kills_through(self):
        events = [self._ev("shot", 1), self._ev("damage_actor", 3),
                  {"tick": 4, "type": "round"}]
        out = self._gate(events, kill_mod_one_tap=True, kill_mod_one_tap_req=True)
        self.assertEqual(sorted(e["tick"] for e in out), [1, 3, 4])

    def test_damage_passes_airborne_filter_it_cannot_be_judged_on(self):
        out = self._gate([self._ev("damage_actor", 1)],
                         kill_mod_airborne=True, kill_mod_airborne_req=True)
        self.assertEqual([e["tick"] for e in out], [1])

    def test_exclude_applicable_filter_drops_matched_shot(self):
        out = self._gate([self._ev("shot", 1, {"kill_mod_airborne"}), self._ev("shot", 2)],
                         kill_mod_airborne_exclude=True)
        self.assertEqual([e["tick"] for e in out], [2])

    def test_kills_are_still_gated(self):
        out = self._gate([self._kill(1, {"kill_mod_one_tap"}), self._kill(2),
                          self._ev("shot", 3)],
                         kill_mod_one_tap=True)
        self.assertEqual(sorted(e["tick"] for e in out), [1, 3])

    def test_demo_with_only_non_kills_is_kept(self):
        out = self._gate([self._kill(1), self._ev("damage_actor", 2)],
                         kill_mod_one_tap=True, kill_mod_one_tap_req=True)
        self.assertEqual([e["tick"] for e in out], [2])

    def test_nothing_left_is_none(self):
        self.assertIsNone(self._gate([self._kill(1)],
                                     kill_mod_one_tap=True, kill_mod_one_tap_req=True))

    def test_death_events_are_unchanged(self):
        death = {"tick": 5, "type": "death", "killer_sid": ENEMY, "victim_sid": ME}
        out = self._gate([death], kill_mod_airborne=True, kill_mod_airborne_req=True)
        self.assertEqual(out, [death])


class Dp2ModifiersKeepNonKillsTests(unittest.TestCase):
    """E4 — excluding every kill of a demo must not discard its damages."""

    def test_all_kills_excluded_keeps_damages(self):
        app = make_engine()
        kill = {"tick": 1, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY}
        dmg = {"tick": 2, "type": "damage_actor", "attacker_sid": ME}
        app._airborne_dp2_filter = lambda dp, events, cfg: list(events)
        out = app._apply_dp2_modifiers("d.dem", [kill, dmg],
                                       {"kill_mod_airborne_exclude": True})
        self.assertEqual(out, [dmg])

    def test_all_kills_excluded_and_nothing_else_is_skipped(self):
        app = make_engine()
        kill = {"tick": 1, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY}
        app._airborne_dp2_filter = lambda dp, events, cfg: list(events)
        self.assertIsNone(app._apply_dp2_modifiers("d.dem", [kill],
                                                   {"kill_mod_airborne_exclude": True}))


class AirborneShotTests(_Base):
    """E4 — airborne is judged on a shot from shots.player_velocity_z."""

    def test_query_shots_carries_vertical_velocity(self):
        rows = [("d1.dem", 500, ME, "AK-47", 180.5)]
        results = {}
        self.app._query_shots(self._cfg(), [ME], FakeConn(rows), results)
        self.assertEqual(results["d1.dem"][0]["player_velocity_z"], 180.5)

    def test_airborne_shot_is_tagged_grounded_shot_is_not(self):
        cfg = self._cfg(kill_mod_airborne=True)
        results = {"d1.dem": [
            {"tick": 1, "type": "shot", "attacker_sid": ME, "player_velocity_z": 180.5},
            {"tick": 2, "type": "shot", "attacker_sid": ME, "player_velocity_z": 0.0},
        ]}
        self.app._apply_shared_modifiers(cfg, results)
        self.assertEqual(results["d1.dem"][0].get("_mf"), {"kill_mod_airborne"})
        self.assertNotIn("_mf", results["d1.dem"][1])

    def test_kill_only_filter_is_not_evaluated_on_damage(self):
        cfg = self._cfg(kill_mod_no_scope=True)
        results = {"d1.dem": [{"tick": 1, "type": "damage_actor", "attacker_sid": ME,
                               "is_no_scope": True}]}
        self.app._apply_shared_modifiers(cfg, results)
        self.assertNotIn("_mf", results["d1.dem"][0])

    def test_positions_parse_only_for_a_filter_judged_on_non_kills(self):
        sections = EngineMixin._dp2_required_sections
        self.assertEqual(sections({"_events_other": True, "kill_mod_no_scope": True}), set())
        self.assertIn("positions",
                      sections({"_events_other": True, "kill_mod_airborne_exclude": True}))


if __name__ == "__main__":
    unittest.main()
