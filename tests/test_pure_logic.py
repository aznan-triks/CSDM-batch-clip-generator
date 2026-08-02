"""Tests de la logique pure et des donnees statiques (Phase 2.3 — filet de securite).

Ces tests ne touchent ni la base de donnees, ni demoparser2, ni l'interface.
Ils couvrent :
  - l'integrite du registre de filtres et des structures derivees,
  - la classification des armes,
  - les migrations de config (compatibilite ascendante),
  - la persistance JSON,
  - les conversions de dates.

But : grossir le filet AVANT de decouper le coeur metier (DB / dp2 / recording),
pour qu'une regression saute aux yeux.
"""
import tempfile
import unittest
from pathlib import Path

from csdm import static_data as sd
from csdm import config as cfgmod
from csdm_batch_clips_generator import (
    App, iso_to_display, display_to_iso,
    fmt_duration, safe_folder_name, build_camera_ticks,
    _generate_id_for_type, _count_kills, progress_bar,
)


# ════════════════════════════════════════════════════════════════════════════
#  Registre de filtres + structures derivees
# ════════════════════════════════════════════════════════════════════════════
class FilterRegistryTests(unittest.TestCase):
    def test_keys_are_unique(self):
        keys = [f.key for f in sd.KILL_FILTER_REGISTRY]
        self.assertEqual(len(keys), len(set(keys)), "Cles de filtres dupliquees")

    def test_primary_keys_exclude_hidden(self):
        # Les entrees hide_ui ne doivent PAS apparaitre dans les cles principales.
        hidden = {f.key for f in sd.KILL_FILTER_REGISTRY if f.hide_ui}
        self.assertTrue(hidden, "Au moins un filtre hide_ui attendu")
        self.assertFalse(set(sd.KILL_FILTER_KEYS) & hidden)
        # ... mais elles restent dans la liste complete.
        self.assertTrue(hidden <= set(sd.KILL_FILTER_KEYS_ALL))

    def test_all_keys_superset_of_primary(self):
        self.assertTrue(set(sd.KILL_FILTER_KEYS) <= set(sd.KILL_FILTER_KEYS_ALL))
        self.assertLess(len(sd.KILL_FILTER_KEYS), len(sd.KILL_FILTER_KEYS_ALL))

    def test_labels_cover_every_key(self):
        for f in sd.KILL_FILTER_REGISTRY:
            self.assertIn(f.key, sd.KILL_FILTER_LABELS)
            self.assertEqual(sd.KILL_FILTER_LABELS[f.key], f.badge)

    def test_every_key_has_enable_and_req_default(self):
        for f in sd.KILL_FILTER_REGISTRY:
            self.assertIn(f.key, sd._FILTER_CONFIG_DEFAULTS)
            self.assertIs(sd._FILTER_CONFIG_DEFAULTS[f.key], False)
            self.assertIn(f"{f.key}_req", sd._FILTER_CONFIG_DEFAULTS)

    def test_extra_config_is_merged_into_defaults(self):
        # ONE TAP declare un sous-reglage de fenetre temporelle.
        self.assertEqual(sd._FILTER_CONFIG_DEFAULTS.get("kill_mod_one_tap_s"), 2)
        # FLICK declare son seuil d'angle.
        self.assertEqual(sd._FILTER_CONFIG_DEFAULTS.get("kill_mod_flick_deg"), 50)

    def test_categories_are_known(self):
        for f in sd.KILL_FILTER_REGISTRY:
            self.assertIn(f.category, {"mods", "dp2", "db"})

    def test_sql_cols_only_on_mods(self):
        for f in sd.KILL_FILTER_REGISTRY:
            if f.sql_cols:
                self.assertEqual(f.category, "mods",
                                 f"{f.key} a des colonnes SQL mais n'est pas 'mods'")

    def test_no_auto_exclude_entries_still_exist(self):
        # Une cle restee dans _NO_AUTO_EXCLUDE apres suppression du filtre
        # supprimerait silencieusement la case Exclude d'un autre filtre.
        keys = {f.key for f in sd.KILL_FILTER_REGISTRY}
        self.assertTrue(sd._NO_AUTO_EXCLUDE <= keys,
                        f"cles orphelines: {sd._NO_AUTO_EXCLUDE - keys}")

    def test_exclude_defaults_match_registry_exactly(self):
        expected = {f"{f.key}_exclude" for f in sd.KILL_FILTER_REGISTRY
                    if not f.hide_ui and f.key not in sd._NO_AUTO_EXCLUDE}
        actual = {k for k in sd._FILTER_CONFIG_DEFAULTS if k.endswith("_exclude")}
        self.assertEqual(expected, actual)

    def test_retired_trois_shot_keys_are_gone(self):
        # v208 — remplacees par le mecanisme generique kill_mod_trois_shot_exclude.
        for dead in ("kill_mod_no_trois_shot", "kill_mod_no_trois_shot_req"):
            self.assertNotIn(dead, sd._FILTER_CONFIG_DEFAULTS)
            self.assertNotIn(dead, cfgmod.DEFAULT_CONFIG)
        self.assertIn("kill_mod_trois_shot_exclude", cfgmod.DEFAULT_CONFIG)


# ════════════════════════════════════════════════════════════════════════════
#  Classification des armes
# ════════════════════════════════════════════════════════════════════════════
class WeaponCategoryTests(unittest.TestCase):
    def test_known_weapons(self):
        cases = {
            "awp": "Snipers",
            "AWP": "Snipers",
            "ak-47": "Rifles",
            "deagle": "Pistols",
            "desert eagle": "Pistols",
            "knife": "Knives",
            "smokegrenade": "Grenades & Utility",
        }
        for weapon, expected in cases.items():
            self.assertEqual(sd._weapon_category(weapon), expected, weapon)

    def test_weapon_prefix_is_stripped(self):
        self.assertEqual(sd._weapon_category("weapon_ak47"), "Rifles")
        self.assertEqual(sd._weapon_category("weapon_awp"), "Snipers")

    def test_substring_fallback(self):
        # Orthographe variante non listee exactement -> repli par sous-chaine.
        self.assertEqual(sd._weapon_category("cz75_auto_variant"), "Pistols")

    def test_unknown_is_other(self):
        self.assertEqual(sd._weapon_category("banana"), "Other")
        self.assertEqual(sd._weapon_category(""), "Other")


# ════════════════════════════════════════════════════════════════════════════
#  Config : valeurs par defaut + migrations ascendantes
# ════════════════════════════════════════════════════════════════════════════
class ConfigDefaultsTests(unittest.TestCase):
    def test_filter_defaults_all_present_in_default_config(self):
        for k, v in sd._FILTER_CONFIG_DEFAULTS.items():
            self.assertIn(k, cfgmod.DEFAULT_CONFIG)

    def test_match_types_default_false(self):
        for _, cfg_key, _ in sd.MATCH_TYPE_DEFS:
            self.assertIs(cfgmod.DEFAULT_CONFIG.get(cfg_key), False)


class ConfigMigrationTests(unittest.TestCase):
    def _migrate(self, saved):
        cfg = cfgmod.DEFAULT_CONFIG.copy()
        cfg.update(saved)
        cfgmod._migrate_config(saved, cfg)
        return cfg

    def test_headshots_only_true_becomes_only(self):
        cfg = self._migrate({"headshots_only": True})
        self.assertEqual(cfg["headshots_mode"], "only")

    def test_headshots_only_false_becomes_all(self):
        cfg = self._migrate({"headshots_only": False})
        self.assertEqual(cfg["headshots_mode"], "all")

    def test_cs2_minimize_becomes_send_to_back(self):
        cfg = self._migrate({"cs2_minimize": 1})
        self.assertIs(cfg["cs2_send_to_back"], True)

    def test_include_suicides_false_becomes_exclude(self):
        cfg = self._migrate({"include_suicides": False})
        self.assertEqual(cfg["suicides_mode"], "exclude")

    def test_french_kill_mod_names_renamed(self):
        cfg = self._migrate({
            "kill_mod_sauveur": True,
            "kill_mod_sauveur_req": True,
            "kill_mod_bourreau": True,
            "kill_mod_bourreau_n": 4,
        })
        self.assertIs(cfg["kill_mod_savior"], True)
        self.assertIs(cfg["kill_mod_savior_req"], True)
        self.assertIs(cfg["kill_mod_bully"], True)
        self.assertEqual(cfg["kill_mod_bully_n"], 4)

    def test_migration_is_noop_when_new_key_already_present(self):
        # Si la cle moderne est deja fournie, on ne l'ecrase pas avec l'ancienne.
        cfg = self._migrate({"headshots_only": True, "headshots_mode": "exclude"})
        self.assertEqual(cfg["headshots_mode"], "exclude")

    def test_no_trois_shot_becomes_trois_shot_exclude(self):
        cfg = self._migrate({"kill_mod_no_trois_shot": True,
                             "kill_mod_no_trois_shot_req": False})
        self.assertIs(cfg["kill_mod_trois_shot_exclude"], True)
        self.assertNotIn("kill_mod_no_trois_shot", cfg)
        self.assertNotIn("kill_mod_no_trois_shot_req", cfg)

    def test_no_trois_shot_false_does_not_force_exclude(self):
        cfg = self._migrate({"kill_mod_no_trois_shot": False})
        self.assertIs(cfg["kill_mod_trois_shot_exclude"], False)

    def test_legacy_filter_migration_is_idempotent(self):
        d = {"kill_mod_no_trois_shot": True}
        cfgmod.migrate_legacy_filter_keys(d)
        cfgmod.migrate_legacy_filter_keys(d)
        self.assertEqual(d, {"kill_mod_trois_shot_exclude": True})


# ════════════════════════════════════════════════════════════════════════════
#  Persistance JSON
# ════════════════════════════════════════════════════════════════════════════
class JsonPersistenceTests(unittest.TestCase):
    def test_roundtrip_preserves_data(self):
        data = {"a": 1, "name": "éàü", "nested": {"x": [1, 2, 3]}, "flag": True}
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "out.json")
            cfgmod._save_json(path, data)
            self.assertEqual(cfgmod._load_json(path), data)

    def test_missing_file_uses_default_factory(self):
        missing = str(Path(tempfile.gettempdir()) / "definitely_absent_csdm_xyz.json")
        self.assertEqual(cfgmod._load_json(missing, list), [])
        self.assertEqual(cfgmod._load_json(missing, dict), {})

    def test_unicode_written_without_escaping(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "u.json"
            cfgmod._save_json(str(path), {"k": "é"})
            raw = path.read_text(encoding="utf-8")
            self.assertIn("é", raw)  # ensure_ascii=False


# ════════════════════════════════════════════════════════════════════════════
#  Conversions de dates DD-MM-YYYY <-> YYYY-MM-DD
# ════════════════════════════════════════════════════════════════════════════
class DateHelperTests(unittest.TestCase):
    def test_iso_to_display(self):
        self.assertEqual(iso_to_display("2026-05-31"), "31-05-2026")

    def test_display_to_iso(self):
        self.assertEqual(display_to_iso("31-05-2026"), "2026-05-31")

    def test_roundtrip(self):
        self.assertEqual(display_to_iso(iso_to_display("2026-01-09")), "2026-01-09")

    def test_empty_inputs(self):
        self.assertEqual(iso_to_display(""), "")
        self.assertEqual(display_to_iso(""), "")
        self.assertEqual(display_to_iso("   "), "")

    def test_already_in_target_format_is_kept(self):
        # Une date deja au format affichage reste inchangee.
        self.assertEqual(iso_to_display("31-05-2026"), "31-05-2026")

    def test_garbage_display_becomes_empty(self):
        self.assertEqual(display_to_iso("not a date"), "")


# ════════════════════════════════════════════════════════════════════════════
#  Theme : valeurs uniques (corrige le bug "couleurs collees" au changement)
# ════════════════════════════════════════════════════════════════════════════
from csdm import theme as th


class ThemeUniquenessTests(unittest.TestCase):
    def test_every_theme_combo_has_unique_values(self):
        # Le re-paint runtime mappe ancienne couleur -> nouvelle PAR VALEUR :
        # deux roles avec la meme valeur rendent le mapping ambigu. On garantit
        # donc l'unicite pour CHAQUE combinaison fond x accent.
        for bg in th._BG_PRESETS:
            for ac in th._ACCENT_PRESETS:
                t = th._build_theme(bg, ac)
                vals = [v.lower() for v in t.values()]
                self.assertEqual(len(vals), len(set(vals)),
                                 f"valeurs dupliquees dans le theme {bg}/{ac}")

    def test_amoled_backgrounds_distinct_but_still_black(self):
        t = th._build_theme("amoled", "green")
        # Les 3 fonds amoled etaient tous #000000 -> maintenant distincts...
        self.assertNotEqual(t["BG"], t["BG2"])
        self.assertNotEqual(t["BG"], t["LOG_BG"])
        self.assertNotEqual(t["BG2"], t["LOG_BG"])
        # ... mais toujours visuellement noirs (decalage imperceptible).
        for k in ("BG", "BG2", "LOG_BG"):
            self.assertLess(int(t[k].lstrip("#"), 16), 0x10, k)

    def test_first_occurrence_keeps_exact_value(self):
        # Le premier role garde sa valeur canonique ; seuls les doublons bougent.
        self.assertEqual(th._build_theme("amoled", "green")["BG"], "#000000")

    def test_custom_hex_accent_is_preserved(self):
        self.assertEqual(th._build_theme("dark", "#abcdef")["ORANGE"], "#abcdef")


# ════════════════════════════════════════════════════════════════════════════
#  Assistants purs de App (testes sur une instance nue, sans Tk ni DB)
# ════════════════════════════════════════════════════════════════════════════
class AppPureHelperTests(unittest.TestCase):
    def setUp(self):
        self.app = App.__new__(App)

    def test_normalize_recsys(self):
        self.assertEqual(App._normalize_recsys("CS"), "CS")
        self.assertEqual(App._normalize_recsys("cs"), "CS")
        self.assertEqual(App._normalize_recsys("  Cs "), "CS")
        self.assertEqual(App._normalize_recsys("HLAE"), "HLAE")
        self.assertEqual(App._normalize_recsys(""), "HLAE")
        self.assertEqual(App._normalize_recsys(None), "HLAE")
        self.assertEqual(App._normalize_recsys("anything else"), "HLAE")

    def test_hms_formats(self):
        self.assertEqual(self.app._hms(0), "0s")
        self.assertEqual(self.app._hms(45), "45s")
        self.assertEqual(self.app._hms(90), "1m30s")
        self.assertEqual(self.app._hms(600), "10m00s")
        self.assertEqual(self.app._hms(3661), "1h01m01s")

    def test_hms_truncates_float(self):
        self.assertEqual(self.app._hms(59.9), "59s")

    def test_fmt_summary_singular_vs_plural(self):
        s1 = self.app._fmt_summary(1, 1, 10, 10)
        self.assertIn("1 clip ", s1)   # singulier (pas de 's')
        self.assertIn("1 demo", s1)
        s2 = self.app._fmt_summary(3, 5, 100, 20)
        self.assertIn("5 clips", s2)   # pluriel
        self.assertIn("3 demos", s2)

    def test_fuzzy_sid_in_set_within_tolerance(self):
        # Tolerance de classe = 16 (derive float64 sur les SteamID64).
        base = 76561198000000000
        sids = {str(base)}
        self.assertTrue(self.app._fuzzy_sid_in_set(str(base), sids))
        self.assertTrue(self.app._fuzzy_sid_in_set(str(base + 16), sids))
        self.assertTrue(self.app._fuzzy_sid_in_set(str(base - 16), sids))
        self.assertFalse(self.app._fuzzy_sid_in_set(str(base + 17), sids))

    def test_fuzzy_sid_in_set_rejects_bad_input(self):
        self.assertFalse(self.app._fuzzy_sid_in_set("notanumber", {"123"}))
        self.assertFalse(self.app._fuzzy_sid_in_set("123", set()))
        self.assertFalse(self.app._fuzzy_sid_in_set(None, {"123"}))


# ════════════════════════════════════════════════════════════════════════════
#  Utilitaires du coeur metier (fonctions pures au niveau module)
# ════════════════════════════════════════════════════════════════════════════
class CoreUtilTests(unittest.TestCase):
    def test_fmt_duration_minutes(self):
        self.assertEqual(fmt_duration(0), "0:00")
        self.assertEqual(fmt_duration(65), "1:05")
        self.assertEqual(fmt_duration(599), "9:59")

    def test_fmt_duration_hours(self):
        self.assertEqual(fmt_duration(3600), "1:00:00")
        self.assertEqual(fmt_duration(3661), "1:01:01")

    def test_fmt_duration_truncates_float(self):
        self.assertEqual(fmt_duration(65.9), "1:05")

    def test_safe_folder_name_strips_invalid_chars(self):
        # Note: '/' and '\\' are path separators (Path.stem drops them), so we
        # test the other forbidden characters: < > " | ? *
        self.assertEqual(safe_folder_name('a<b>c|d?e*f"g'), "a_b_c_d_e_f_g")

    def test_safe_folder_name_drops_extension(self):
        # Path.stem -> extension removed.
        self.assertEqual(safe_folder_name("match_2026.dem"), "match_2026")

    def test_progress_bar_full_and_empty(self):
        self.assertEqual(progress_bar(0, 4, width=4), "▱▱▱▱ 0/4")
        self.assertEqual(progress_bar(4, 4, width=4), "▰▰▰▰ 4/4")
        self.assertEqual(progress_bar(2, 4, width=4), "▰▰▱▱ 2/4")

    def test_progress_bar_clamps_and_guards_zero(self):
        self.assertEqual(progress_bar(9, 4, width=4), "▰▰▰▰ 4/4")   # clampe
        self.assertEqual(progress_bar(-3, 4, width=4), "▱▱▱▱ 0/4")  # clampe bas
        self.assertEqual(progress_bar(0, 0), "0/0")                 # total <= 0

    def test_safe_folder_name_truncates_to_100(self):
        self.assertEqual(len(safe_folder_name("x" * 200)), 100)

    def test_count_kills(self):
        events = [{"type": "kill"}, {"type": "round"}, {"type": "kill"}, {"type": "death"}]
        self.assertEqual(_count_kills(events), 2)
        self.assertEqual(_count_kills([]), 0)

    def test_generate_id_for_int_types(self):
        for t in ("bigint", "integer", "int4", "smallint", "serial"):
            v = _generate_id_for_type(t)
            self.assertIsInstance(v, int)
            self.assertGreaterEqual(v, 100_000_000)

    def test_generate_id_for_text_and_uuid(self):
        for t in ("uuid", "text", "varchar(64)", "character varying"):
            v = _generate_id_for_type(t)
            self.assertIsInstance(v, str)


# ════════════════════════════════════════════════════════════════════════════
#  Construction des ticks de camera (logique sensible : clips au bon moment)
# ════════════════════════════════════════════════════════════════════════════
class CameraTickTests(unittest.TestCase):
    def test_basic_offsets(self):
        # tickrate 64 -> pre = 32, post = 8.
        seq = {"start_tick": 1000, "end_tick": 2000, "events": [{"tick": 1500}]}
        self.assertEqual(build_camera_ticks(seq, 64), [1000, 1468, 1508])

    def test_clamped_to_sequence_bounds(self):
        # An event near the edges must not produce ticks outside [start, end].
        seq = {"start_tick": 1000, "end_tick": 2000,
               "events": [{"tick": 1010}, {"tick": 1995}]}
        ticks = build_camera_ticks(seq, 64)
        self.assertEqual(min(ticks), 1000)
        self.assertEqual(max(ticks), 2000)
        self.assertEqual(ticks, sorted(ticks))

    def test_start_tick_always_present(self):
        seq = {"start_tick": 500, "end_tick": 900, "events": []}
        self.assertEqual(build_camera_ticks(seq, 64), [500])

    def test_result_is_sorted_and_unique(self):
        seq = {"start_tick": 0, "end_tick": 10000,
               "events": [{"tick": 5000}, {"tick": 5000}, {"tick": 3000}]}
        ticks = build_camera_ticks(seq, 128)
        self.assertEqual(ticks, sorted(set(ticks)))


# ════════════════════════════════════════════════════════════════════════════
#  Detection de la colonne "map" (schema DB variable — bug silencieux possible)
# ════════════════════════════════════════════════════════════════════════════
class MapColumnDetectionTests(unittest.TestCase):
    def test_direct_candidate_in_matches(self):
        col, alias, join = App._detect_map_col({"matches": ["id", "map_name"], "demos": []})
        self.assertEqual((col, alias, join), ("map_name", "m", ""))

    def test_substring_fallback_in_matches(self):
        # No exact candidate, but a column containing "map".
        col, alias, join = App._detect_map_col({"matches": ["id", "the_map_field"]})
        self.assertEqual((col, alias), ("the_map_field", "m"))
        self.assertEqual(join, "")

    def test_join_demos_on_checksum(self):
        schema = {"matches": ["id", "checksum"], "demos": ["checksum", "map_name"]}
        col, alias, join = App._detect_map_col(schema)
        self.assertEqual(col, "map_name")
        self.assertEqual(alias, "d")
        self.assertIn("LEFT JOIN demos d", join)
        self.assertIn("checksum", join)

    def test_no_map_column_anywhere(self):
        col, alias, join = App._detect_map_col({"matches": ["id", "score"], "demos": []})
        self.assertEqual((col, alias, join), (None, "m", ""))

    def test_demos_map_without_checksum_link_is_unusable(self):
        # map lives in demos but there's no checksum to join on -> give up cleanly.
        schema = {"matches": ["id"], "demos": ["map_name"]}
        self.assertEqual(App._detect_map_col(schema), (None, "m", ""))


# ════════════════════════════════════════════════════════════════════════════
#  Camera builders (statiques depuis Phase 1.3 — coeur du fix v194)
# ════════════════════════════════════════════════════════════════════════════
def _seq(events, start=100, end=900):
    return {"start_tick": start, "end_tick": end, "events": events}


def _kill(tick, killer, victim, **extra):
    return {"tick": tick, "type": "kill",
            "killer_sid": killer, "victim_sid": victim, **extra}


class CameraBuilderTests(unittest.TestCase):
    ACTIVE = {"111"}
    PRIMARY = "111"

    def test_killer_single_kill_one_cam_on_killer(self):
        seq = _seq([_kill(300, "111", "222")])
        cams = App._build_cams_killer(seq, self.ACTIVE, self.PRIMARY)
        self.assertEqual(cams, [{"tick": 100, "playerSteamId": "111",
                                 "playerName": ""}])

    def test_killer_change_adds_switch_entry(self):
        active = {"111", "333"}
        seq = _seq([_kill(300, "111", "222"), _kill(500, "333", "444")])
        cams = App._build_cams_killer(seq, active, "111")
        self.assertEqual([c["playerSteamId"] for c in cams], ["111", "333"])
        self.assertEqual(cams[1]["tick"], 500)

    def test_killer_same_killer_no_duplicate_entries(self):
        seq = _seq([_kill(300, "111", "222"), _kill(500, "111", "444")])
        cams = App._build_cams_killer(seq, self.ACTIVE, self.PRIMARY)
        self.assertEqual(len(cams), 1)

    def test_killer_no_active_kill_falls_back_to_primary(self):
        seq = _seq([_kill(300, "999", "888")])
        cams = App._build_cams_killer(seq, self.ACTIVE, self.PRIMARY)
        self.assertEqual(cams[0]["playerSteamId"], "111")

    def test_victim_follows_first_victim(self):
        seq = _seq([_kill(300, "111", "222")])
        cams = App._build_cams_victim(seq, self.ACTIVE, self.PRIMARY, {})
        self.assertEqual(cams, [{"tick": 100, "playerSteamId": "222",
                                 "playerName": ""}])

    def test_victim_our_death_follows_us(self):
        seq = _seq([{"tick": 300, "type": "death",
                     "killer_sid": "999", "victim_sid": "111"}])
        cams = App._build_cams_victim(seq, self.ACTIVE, self.PRIMARY, {})
        self.assertEqual(cams[0]["playerSteamId"], "111")

    def test_victim_mate_pov_overrides_victim(self):
        seq = _seq([_kill(300, "111", "222", _mate_pov_sid="555")])
        cams = App._build_cams_victim(seq, self.ACTIVE, self.PRIMARY,
                                      {"kill_mod_mate_pov": True})
        self.assertEqual(cams[0]["playerSteamId"], "555")

    def test_victim_mate_pov_ignored_when_disabled(self):
        seq = _seq([_kill(300, "111", "222", _mate_pov_sid="555")])
        cams = App._build_cams_victim(seq, self.ACTIVE, self.PRIMARY, {})
        self.assertEqual(cams[0]["playerSteamId"], "222")

    def test_both_starts_on_killer_then_switches_to_victim(self):
        tickrate, pre_ticks = 64, 2 * 64
        seq = _seq([_kill(500, "111", "222")], start=100, end=900)
        cams = App._build_cams_both(seq, self.ACTIVE, self.PRIMARY, {},
                                    tickrate, pre_ticks)
        # Before the switch tick (500-128=372) the camera is on the killer,
        # from 372 onwards it is on the victim.
        for c in cams:
            expected = "111" if c["tick"] < 372 else "222"
            self.assertEqual(c["playerSteamId"], expected,
                             f"tick {c['tick']}")

    def test_both_our_death_follows_us_whole_sequence(self):
        seq = _seq([{"tick": 500, "type": "death",
                     "killer_sid": "999", "victim_sid": "111"}])
        cams = App._build_cams_both(seq, self.ACTIVE, self.PRIMARY, {}, 64, 128)
        self.assertTrue(all(c["playerSteamId"] == "111" for c in cams))

    def test_anchor_prefers_active_killer_over_active_victim(self):
        active = {"111", "222"}
        seq = _seq([_kill(300, "999", "222"), _kill(400, "111", "888")])
        self.assertEqual(App._seq_anchor_sid(seq, active, "222"), "111")


class BuildJsonHelperTests(unittest.TestCase):
    def test_output_params_injects_preset_for_cpu_codec(self):
        cfg = {"video_codec": "libx264", "video_preset": "slow",
               "ffmpeg_output_params": ""}
        self.assertEqual(App._bj_output_params(cfg), "-preset slow")

    def test_output_params_no_preset_for_gpu_codec(self):
        cfg = {"video_codec": "h264_nvenc", "video_preset": "slow",
               "ffmpeg_output_params": "-b:v 20M"}
        self.assertEqual(App._bj_output_params(cfg), "-b:v 20M")

    def test_output_params_user_preset_wins(self):
        cfg = {"video_codec": "libx264", "video_preset": "slow",
               "ffmpeg_output_params": "-preset fast"}
        self.assertEqual(App._bj_output_params(cfg), "-preset fast")

    def test_players_options_killer_mode_shows_cam_target(self):
        seq = _seq([_kill(300, "111", "222")])
        cams = [{"tick": 100, "playerSteamId": "111", "playerName": ""}]
        opts = App._bj_players_options(
            seq, cams, "killer", {"111"}, ["111"],
            lambda sid: {"111": "Us", "222": "Them"}.get(str(sid), ""), "")
        by_sid = {o["steamId"]: o for o in opts}
        self.assertTrue(by_sid["111"]["showKill"])
        self.assertTrue(by_sid["111"]["highlightKill"])
        self.assertEqual(by_sid["111"]["playerName"], "Us")
        self.assertIn("222", by_sid)          # victim listed
        self.assertFalse(by_sid["222"]["highlightKill"])

    def test_players_options_name_override_applies_to_active_only(self):
        seq = _seq([_kill(300, "111", "222")])
        cams = [{"tick": 100, "playerSteamId": "111", "playerName": ""}]
        opts = App._bj_players_options(
            seq, cams, "killer", {"111"}, ["111"],
            lambda sid: "DemoName", "Forced")
        by_sid = {o["steamId"]: o for o in opts}
        self.assertEqual(by_sid["111"]["playerName"], "Forced")
        self.assertEqual(by_sid["222"]["playerName"], "DemoName")


def test_detect_map_col_lives_on_the_engine():
    """The map-column detector must be reachable from a windowless host."""
    from csdm.engine.core import EngineMixin

    schema = {"matches": ["checksum", "map_name", "game_mode_str"]}
    col, alias, join = EngineMixin._detect_map_col(schema)
    assert (col, alias, join) == ("map_name", "m", "")


def test_detect_map_col_falls_back_to_demos_over_checksum():
    from csdm.engine.core import EngineMixin

    schema = {"matches": ["checksum"], "demos": ["checksum", "map_name"]}
    col, alias, join = EngineMixin._detect_map_col(schema)
    assert col == "map_name"
    assert alias == "d"
    assert 'LEFT JOIN demos d ON d."checksum" = m."checksum"' == join


def test_detect_map_col_returns_none_when_absent():
    from csdm.engine.core import EngineMixin

    col, alias, join = EngineMixin._detect_map_col({"matches": ["checksum"]})
    assert col is None
    assert alias == "m"
    assert join == ""


if __name__ == "__main__":
    unittest.main()
