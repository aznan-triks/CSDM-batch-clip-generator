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
import json
import tempfile
import unittest
from pathlib import Path

from csdm import static_data as sd
from csdm import config as cfgmod
from csdm_batch_clips_generator import iso_to_display, display_to_iso


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


if __name__ == "__main__":
    unittest.main()
