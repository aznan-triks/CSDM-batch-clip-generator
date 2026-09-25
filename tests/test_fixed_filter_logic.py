"""One fixed filter model: the old AND/OR selector is gone from the engine.

v124 removed the "any"/"all" selector from the UI and `build_run_cfg` forces
every run, preview and search onto "mixed" (required filters AND-ed, optional
ones only tag). The engine used to keep "any"/"all" branches behind those keys;
they were unreachable and are removed. These tests pin that the kill filters
no longer read the keys at all: a stale "any"/"all" gives the "mixed" result.
"""
import inspect
import re
import unittest

from csdm.engine.core import EngineMixin

from tests.test_e2e_events_beyond_kill import ME, ENEMY, make_engine

LOGIC_KEYS = ("kill_mod_logic_mods", "kill_mod_logic_dp2", "kill_mod_logic_db")
STALE = ({}, {k: "any" for k in LOGIC_KEYS}, {k: "all" for k in LOGIC_KEYS})


def _kills():
    return [{"tick": 1, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY},
            {"tick": 2, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY},
            {"tick": 3, "type": "damage_actor", "attacker_sid": ME}]


def _airborne_on_tick_1(dp, events, cfg):
    return [e for e in events if e.get("type") != "kill" or e["tick"] == 1]


class FixedLogicTests(unittest.TestCase):
    def _engine(self):
        app = make_engine()
        app._airborne_dp2_filter = _airborne_on_tick_1
        return app

    def _ticks(self, events):
        return sorted(e["tick"] for e in events or [])

    def test_dp2_worker_path_ignores_stale_logic(self):
        for required, expected in ((False, [1, 2, 3]), (True, [1, 3])):
            base = {"kill_mod_airborne": True, "kill_mod_airborne_req": required}
            for stale in STALE:
                with self.subTest(required=required, stale=stale):
                    out = self._engine()._apply_dp2_modifiers(
                        "d.dem", _kills(), {**base, **stale})
                    self.assertEqual(self._ticks(out), expected)

    def test_dp2_preview_path_ignores_stale_logic(self):
        for required, expected in ((False, [1, 2, 3]), (True, [1, 3])):
            base = {"kill_mod_airborne": True, "kill_mod_airborne_req": required}
            for stale in STALE:
                with self.subTest(required=required, stale=stale):
                    out = self._engine()._apply_dp2_filters_to_events(
                        {"d.dem": _kills()}, {**base, **stale})
                    self.assertEqual(self._ticks(out.get("d.dem")), expected)

    def test_mods_sql_ands_required_only_whatever_the_stale_logic(self):
        app = make_engine()
        app._db_schema["kills"] += ["is_through_smoke", "is_no_scope"]
        app._warned_missing_mods = frozenset()
        base = {"kill_mod_through_smoke": True, "kill_mod_no_scope": True,
                "kill_mod_no_scope_req": True}
        for stale in STALE:
            with self.subTest(stale=stale):
                sql, active, empty = app._qe_mod_sql({**base, **stale})
                self.assertEqual(sql, ' AND (k."is_no_scope" = TRUE)')
                self.assertFalse(empty)

    def test_no_kill_filter_reads_the_logic_keys(self):
        # Only build_run_cfg still names them (it normalises stale configs).
        for name in ("_qe_mod_sql", "_apply_db_postfilters",
                     "_apply_dp2_modifiers", "_apply_dp2_filters_to_events"):
            src = inspect.getsource(getattr(EngineMixin, name))
            self.assertIsNone(re.search(r"kill_mod_logic_", src), name)
        self.assertFalse(hasattr(EngineMixin, "_mods_dp2_global_any_union_enabled"))


if __name__ == "__main__":
    unittest.main()
