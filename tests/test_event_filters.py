"""C5bis — filters for non-lethal events (damage and shot filters).

Kill Filters only ever judged kills. These eight filters live in the same
registry (`FilterDef`, `applies_to` restricted to "damage" or "shot"), so
their Enable / ★ Must / Exclude keys, their settings, their capability and
their UI row are all derived from one entry. Every filter is proven here for
Must, Exclude and its setting; the two group rules (multi-nade, long spray)
also prove they yield one event per grenade / per burst.
"""
import unittest

from csdm.config import DEFAULT_CONFIG
from csdm.static_data import KILL_FILTER_REGISTRY

from tests.test_e2e_events_beyond_kill import ME, ENEMY, FakeConn, make_cfg, make_engine

MATE = "76561198000000003"
ENEMY2 = "76561198000000004"
ENEMY3 = "76561198000000005"

EXPECTED = {
    "dmg_mod_headshot_hit": (("damage",), {}),
    "dmg_mod_body_hit": (("damage",), {}),
    "dmg_mod_arm_hit": (("damage",), {}),
    "dmg_mod_leg_hit": (("damage",), {}),
    "dmg_mod_big_hit": (("damage",), {"dmg_mod_big_hit_min": 90}),
    "dmg_mod_low_hp": (("damage",), {"dmg_mod_low_hp_max": 5}),
    "dmg_mod_multi_nade": (("damage",), {"dmg_mod_multi_nade_min": 3}),
    "dmg_mod_team_damage": (("damage",), {}),
    "shot_mod_knife_swing": (("shot",), {}),
    "shot_mod_long_spray": (("shot",), {"shot_mod_long_spray_min": 10}),
    "shot_mod_run_gun": (("shot",), {"shot_mod_run_gun_speed": 200}),
}

DAMAGE_COLS = ["match_checksum", "tick", "attacker_steam_id", "victim_steam_id",
               "weapon_name", "hitgroup", "health_damage", "armor_damage",
               "victim_new_health", "attacker_side", "victim_side",
               "weapon_type", "weapon_unique_id",
               "attacker_team_name", "victim_team_name"]
SHOT_COLS = ["match_checksum", "tick", "player_steam_id", "weapon_name",
             "player_velocity_z", "player_velocity_x", "player_velocity_y",
             "recoil_index"]


def dmg(tick, victim=ENEMY, weapon="AK-47", hitgroup=2, hp=27, new_hp=73,
        a_side=2, v_side=3, wtype="rifle", uid="gun1"):
    return {"tick": tick, "type": "damage_actor", "attacker_sid": ME,
            "victim_sid": victim, "weapon": weapon, "hitgroup": hitgroup,
            "health_damage": hp, "victim_new_health": new_hp,
            "attacker_side": a_side, "victim_side": v_side,
            "weapon_type": wtype, "weapon_unique_id": uid}


def shot(tick, weapon="AK-47", recoil=1.0, vx=0.0, vy=0.0, etype="shot"):
    return {"tick": tick, "type": etype, "attacker_sid": ME, "weapon": weapon,
            "recoil_index": recoil, "player_velocity_x": vx,
            "player_velocity_y": vy, "player_velocity_z": 0.0}


class _Base(unittest.TestCase):
    def setUp(self):
        self.app = make_engine()
        self.app._db_schema["damages"] = list(DAMAGE_COLS)
        self.app._db_schema["shots"] = list(SHOT_COLS)

    def run_filters(self, events, **cfg):
        """Shared modifier layer then the global gate, as a preview does."""
        full = self.app.build_run_cfg(make_cfg(
            event_actor=True, event_non_lethal=True, event_other=True,
            event_ally=True, event_enemy=True, steam_ids=[ME], **cfg))
        results = {"d.dem": [dict(e) for e in events]}
        self.app._apply_shared_modifiers(full, results)
        out = self.app._apply_global_filter_gate_events(results["d.dem"], full)
        return sorted(e["tick"] for e in (out or []))


class RegistryTests(unittest.TestCase):
    def test_eight_event_filters_with_their_categories_and_settings(self):
        by_key = {f.key: f for f in KILL_FILTER_REGISTRY}
        for key, (applies, extra) in EXPECTED.items():
            self.assertIn(key, by_key)
            self.assertEqual(tuple(by_key[key].applies_to), applies, key)
            self.assertEqual(dict(by_key[key].extra_config or {}), extra, key)

    def test_every_event_filter_gets_enable_must_exclude_and_settings_keys(self):
        for key, (_applies, extra) in EXPECTED.items():
            for k in (key, f"{key}_req", f"{key}_exclude"):
                self.assertIs(DEFAULT_CONFIG.get(k), False, k)
            for k, v in extra.items():
                self.assertEqual(DEFAULT_CONFIG.get(k), v, k)

    def test_every_setting_has_a_label_for_its_row(self):
        for f in KILL_FILTER_REGISTRY:
            if f.key in EXPECTED:
                self.assertEqual(set(f.extra_ui or {}), set(f.extra_config or {}), f.key)


class QueryColumnsTests(_Base):
    def test_damages_query_selects_and_carries_the_new_columns(self):
        rows = [("d.dem", 10, ME, ENEMY, "HE Grenade", 0, 57, 3, 43, 2, 3,
                 "grenade", "nade1")]
        results = {}
        cfg = self.app.build_run_cfg(make_cfg(event_actor=True, event_non_lethal=True,
                                              steam_ids=[ME]))
        conn = FakeConn(rows)
        self.app._query_damages(cfg, [ME], conn, results)
        sql = conn.cursor_.executed
        for col in ("victim_new_health", "attacker_side", "victim_side",
                    "weapon_type", "weapon_unique_id"):
            self.assertEqual(sql.count(f'd."{col}"'), 1, col)
        e = results["d.dem"][0]
        self.assertEqual((e["weapon"], e["hitgroup"], e["health_damage"],
                          e["armor_damage"], e["victim_new_health"], e["attacker_side"],
                          e["victim_side"], e["weapon_type"], e["weapon_unique_id"]),
                         ("HE Grenade", 0, 57, 3, 43, 2, 3, "grenade", "nade1"))

    def test_shots_query_selects_and_carries_the_new_columns(self):
        rows = [("d.dem", 10, ME, "AK-47", 0.0, 150.0, 120.0, 7.0)]
        results = {}
        cfg = self.app.build_run_cfg(make_cfg(event_actor=True, event_other=True,
                                              steam_ids=[ME]))
        conn = FakeConn(rows)
        self.app._query_shots(cfg, [ME], conn, results)
        sql = conn.cursor_.executed
        for col in ("player_velocity_x", "player_velocity_y", "recoil_index"):
            self.assertEqual(sql.count(f's."{col}"'), 1, col)
        e = results["d.dem"][0]
        self.assertEqual((e["player_velocity_x"], e["player_velocity_y"],
                          e["recoil_index"]), (150.0, 120.0, 7.0))


class HitZoneTests(_Base):
    """E1 hit zone: head, body, arm, leg -- one filter each, on damages.hitgroup."""
    # One hit per hitgroup the database holds: generic (grenade), head, chest,
    # stomach, left/right arm, left/right leg, neck.
    EVENTS = [dmg(tick, hitgroup=tick) for tick in range(0, 9)]

    def test_each_zone_keeps_only_its_hitgroups(self):
        for key, ticks in (("dmg_mod_body_hit", [2, 3]),
                           ("dmg_mod_arm_hit", [4, 5]),
                           ("dmg_mod_leg_hit", [6, 7])):
            with self.subTest(key):
                self.assertEqual(self.run_filters(self.EVENTS, **{key: True, f"{key}_req": True}),
                                 ticks)

    def test_zones_ticked_together_keep_any_of_them(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_arm_hit=True,
                                          dmg_mod_leg_hit=True), [4, 5, 6, 7])

    def test_exclude_drops_the_zone(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_leg_hit_exclude=True),
                         [0, 1, 2, 3, 4, 5, 8])


class HeadshotHitTests(_Base):
    EVENTS = [dmg(1, hitgroup=1), dmg(2, hitgroup=2)]

    def test_must(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_headshot_hit=True,
                                          dmg_mod_headshot_hit_req=True), [1])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_headshot_hit_exclude=True), [2])

    def test_kills_and_shots_are_not_judged(self):
        kill = {"tick": 5, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY}
        self.assertEqual(self.run_filters(self.EVENTS + [kill, shot(6)],
                                          dmg_mod_headshot_hit=True,
                                          dmg_mod_headshot_hit_req=True), [1, 5, 6])


class BigHitTests(_Base):
    EVENTS = [dmg(1, hp=100), dmg(2, hp=90), dmg(3, hp=40)]

    def test_must(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_big_hit=True,
                                          dmg_mod_big_hit_req=True), [1, 2])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_big_hit_exclude=True), [3])

    def test_setting(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_big_hit=True,
                                          dmg_mod_big_hit_min="95"), [1])


class LowHpTests(_Base):
    # 0 = the hit killed: that is a kill, not a survivor.
    EVENTS = [dmg(1, new_hp=1), dmg(2, new_hp=5), dmg(3, new_hp=8), dmg(4, new_hp=0)]

    def test_must(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_low_hp=True,
                                          dmg_mod_low_hp_req=True), [1, 2])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_low_hp_exclude=True), [3, 4])

    def test_setting(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_low_hp=True,
                                          dmg_mod_low_hp_max=10), [1, 2, 3])


class TeamDamageTests(_Base):
    EVENTS = [dmg(1, victim=MATE, a_side=2, v_side=2), dmg(2, a_side=2, v_side=3)]

    def test_must(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_team_damage=True,
                                          dmg_mod_team_damage_req=True), [1])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_team_damage_exclude=True), [2])


class MultiNadeTests(_Base):
    # nadeA hits 3 enemies (4 impacts), nadeB hits 2, a rifle hits 3 over time.
    EVENTS = [
        dmg(10, victim=ENEMY, weapon="HE Grenade", wtype="grenade", uid="nadeA"),
        dmg(10, victim=ENEMY2, weapon="HE Grenade", wtype="grenade", uid="nadeA"),
        dmg(11, victim=ENEMY3, weapon="HE Grenade", wtype="grenade", uid="nadeA"),
        dmg(12, victim=ENEMY3, weapon="HE Grenade", wtype="grenade", uid="nadeA"),
        dmg(20, victim=ENEMY, weapon="Molotov", wtype="grenade", uid="nadeB"),
        dmg(21, victim=ENEMY2, weapon="Molotov", wtype="grenade", uid="nadeB"),
        dmg(30, victim=ENEMY, uid="gun1"),
        dmg(31, victim=ENEMY2, uid="gun1"),
        dmg(32, victim=ENEMY3, uid="gun1"),
    ]

    def test_must_keeps_one_event_per_grenade(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_multi_nade=True,
                                          dmg_mod_multi_nade_req=True), [10])

    def test_exclude_drops_every_impact_of_the_grenade(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_multi_nade_exclude=True),
                         [20, 21, 30, 31, 32])

    def test_setting(self):
        self.assertEqual(self.run_filters(self.EVENTS, dmg_mod_multi_nade=True,
                                          dmg_mod_multi_nade_min=2), [10, 20])

    def test_thrower_hurting_himself_is_not_a_victim(self):
        me_hit = dmg(13, victim=ME, weapon="HE Grenade", wtype="grenade", uid="nadeB")
        self.assertEqual(self.run_filters(self.EVENTS[4:6] + [me_hit],
                                          dmg_mod_multi_nade=True,
                                          dmg_mod_multi_nade_min=3), [])


class KnifeSwingTests(_Base):
    EVENTS = [shot(1, weapon="Knife", etype="knife_swing"), shot(2)]

    def test_must(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_knife_swing=True,
                                          shot_mod_knife_swing_req=True), [1])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_knife_swing_exclude=True), [2])

    def test_damages_are_not_judged(self):
        self.assertEqual(self.run_filters(self.EVENTS + [dmg(3)], shot_mod_knife_swing=True,
                                          shot_mod_knife_swing_req=True), [1, 3])


class LongSprayTests(_Base):
    # Burst 1 climbs 1..12 (reaches 10 at tick 110), burst 2 climbs 1..4,
    # burst 3 restarts after a partial decay (1.2, 2.2 .. 11.2) and reaches 10
    # at tick 310. A different weapon is its own sequence.
    EVENTS = ([shot(100 + i, recoil=float(i)) for i in range(1, 13)]
              + [shot(200 + i, recoil=float(i)) for i in range(1, 5)]
              + [shot(300 + i, recoil=i + 0.2) for i in range(1, 12)]
              + [shot(400, weapon="MP9", recoil=3.0)])

    def test_must_keeps_one_event_per_burst(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_long_spray=True,
                                          shot_mod_long_spray_req=True), [110, 310])

    def test_exclude_drops_every_shot_of_the_long_bursts(self):
        kept = self.run_filters(self.EVENTS, shot_mod_long_spray_exclude=True)
        self.assertEqual(kept, [201, 202, 203, 204, 400])

    def test_setting(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_long_spray=True,
                                          shot_mod_long_spray_min="4"), [104, 204, 304])


class RunGunTests(_Base):
    EVENTS = [shot(1, vx=180.0, vy=120.0), shot(2, vx=100.0, vy=0.0), shot(3, vx=200.0)]

    def test_must(self):
        # sqrt(180² + 120²) = 216 >= 200
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_run_gun=True,
                                          shot_mod_run_gun_req=True), [1, 3])

    def test_exclude(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_run_gun_exclude=True), [2])

    def test_setting(self):
        self.assertEqual(self.run_filters(self.EVENTS, shot_mod_run_gun=True,
                                          shot_mod_run_gun_speed=210), [1])

    def test_only_gun_shots_count(self):
        # Real data (2026-09-18): 1 in 4 fast "shots" were grenade throws or
        # knife swings -- not a run & gun moment.
        events = [shot(1, weapon="HE Grenade", vx=240.0),
                  shot(2, weapon="Knife", vx=250.0, etype="knife_swing"),
                  shot(3, weapon="MP9", vx=240.0)]
        self.assertEqual(self.run_filters(events, shot_mod_run_gun=True,
                                          shot_mod_run_gun_req=True), [3])


class KillGateTests(_Base):
    """A kill is judged only by the filters that apply to kills."""

    def test_damage_filter_alone_keeps_every_kill(self):
        kill = {"tick": 5, "type": "kill", "killer_sid": ME, "victim_sid": ENEMY}
        self.assertEqual(self.run_filters([kill, dmg(6, hitgroup=1), dmg(7)],
                                          dmg_mod_headshot_hit=True), [5, 6])


class CapabilityIdTests(unittest.TestCase):
    def test_capability_prefix_follows_the_event_category(self):
        from csdm.capabilities import CAPABILITIES
        ids = {c.config_keys[0]: c.id for c in CAPABILITIES if c.config_keys}
        self.assertEqual(ids["dmg_mod_big_hit"], "damage_filter_big_hit")
        self.assertEqual(ids["shot_mod_long_spray"], "shot_filter_long_spray")
        self.assertEqual(ids["kill_mod_airborne"], "kill_filter_airborne")


class DescribeFiltersTests(unittest.TestCase):
    def test_applies_to_and_settings_travel(self):
        from csdm.bridge.tables import describe_filters
        filters = {f["key"]: f for f in describe_filters()["filters"]}
        self.assertEqual(filters["kill_mod_airborne"]["applies_to"], ["kill", "shot"])
        self.assertEqual(filters["dmg_mod_big_hit"]["applies_to"], ["damage"])
        extras = filters["dmg_mod_big_hit"]["extras"]
        self.assertEqual([x["key"] for x in extras], ["dmg_mod_big_hit_min"])
        self.assertEqual(extras[0]["default"], 90)
        self.assertTrue(extras[0]["label"])
        self.assertEqual(filters["kill_mod_flick"]["extras"], [])


if __name__ == "__main__":
    unittest.main()
