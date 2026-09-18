"""E3 (C6a, lot M2, engine part) — knife swings and the event category table.

A shot fired with the knife is a knife swing, not a gun shot. The category
table is explicit: an unknown event type no longer silently counts as a kill.
Jump and grenade-miss have no producer (see the C6a plan) and stay unknown.
"""
import unittest

from csdm.engine.core import EngineMixin

from tests.test_e2e_events_beyond_kill import ME, FakeConn
from tests.test_nonkill_filters import _Base


class KnifeSwingAndCategoryTests(_Base):
    """E3 (engine) — knife shots are knife swings; categories are explicit."""

    def test_knife_shot_is_a_knife_swing(self):
        rows = [("d1.dem", 500, ME, "Knife", 0.0), ("d1.dem", 600, ME, "AK-47", 0.0)]
        results = {}
        self.app._query_shots(self._cfg(), [ME], FakeConn(rows), results)
        types = [e["type"] for e in results["d1.dem"]]
        self.assertEqual(types, ["knife_swing", "shot"])

    def test_event_category_table(self):
        cat = EngineMixin._event_category
        self.assertEqual(cat("kill"), "kill")
        self.assertEqual(cat("death"), "kill")
        self.assertEqual(cat("damage_actor"), "damage")
        self.assertEqual(cat("damage_target"), "damage")
        self.assertEqual(cat("shot"), "shot")
        self.assertEqual(cat("knife_swing"), "shot")
        self.assertEqual(cat("round"), "round")
        self.assertEqual(cat("clutch_round"), "round")

    def test_kill_only_filter_lets_a_knife_swing_through_the_gate(self):
        swing = {"tick": 2, "type": "knife_swing", "attacker_sid": ME}
        out = self.app._apply_global_filter_gate_events(
            [swing], {"kill_mod_one_tap": True, "kill_mod_one_tap_req": True})
        self.assertEqual(out, [swing])

    def test_unknown_event_type_is_not_a_kill(self):
        self.assertIsNone(EngineMixin._event_category("jump"))
        self.assertIsNone(EngineMixin._event_category(None))


if __name__ == "__main__":
    unittest.main()
