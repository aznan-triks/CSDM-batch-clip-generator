"""Tests d'integrite UI des lignes de filtres de kill (v208).

Ces tests instancient reellement l'App Tk. Ils existent parce qu'aucun test pur
ne pouvait attraper le bug d'origine : une cle `<filtre>_exclude` etait generee
dans DEFAULT_CONFIG et honoree par le moteur, mais aucune case ne l'exposait
(ligne FERRARI PEEK construite a la main au lieu de passer par
`_build_filter_row`).

Invariant garde ici : toute cle `_exclude` generee par le registre doit avoir
une case a cocher visible dans l'onglet Capture.

Ignores automatiquement si aucun affichage Tk n'est disponible.
"""
import unittest

try:
    import tkinter as tk
    _root = tk.Tk()
    _root.destroy()
    TK_AVAILABLE = True
except Exception:
    TK_AVAILABLE = False

from csdm import static_data as sd


def _iter_widgets(widget):
    yield widget
    for child in widget.winfo_children():
        yield from _iter_widgets(child)


def _text_of(widget):
    try:
        return str(widget.cget("text"))
    except Exception:
        return ""


@unittest.skipUnless(TK_AVAILABLE, "aucun affichage Tk disponible")
class FilterRowWiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from csdm_batch_clips_generator import App
        cls.app = App()
        cls.app.update_idletasks()

    @classmethod
    def tearDownClass(cls):
        cls.app.destroy()

    def _rows_by_label(self):
        """Map {label du filtre: [textes des widgets de la ligne]}."""
        wanted = {f.label: f for f in sd.KILL_FILTER_REGISTRY if not f.hide_ui}
        rows = {}
        for w in _iter_widgets(self.app):
            texts = [_text_of(c) for c in w.winfo_children()]
            for label in wanted:
                if label in texts:
                    rows[label] = texts
        return rows

    def test_every_exclude_key_has_a_checkbox(self):
        rows = self._rows_by_label()
        for f in sd.KILL_FILTER_REGISTRY:
            if f.hide_ui or f.key in sd._NO_AUTO_EXCLUDE:
                continue
            with self.subTest(filter=f.key):
                self.assertIn(f.key + "_exclude", self.app.v,
                              "cle _exclude absente des variables Tk")
                self.assertIn(f.label, rows, "ligne de filtre introuvable dans l'UI")
                self.assertIn("Exclude", rows[f.label],
                              "case Exclude absente de la ligne")

    def test_every_visible_filter_has_enable_and_must(self):
        rows = self._rows_by_label()
        for f in sd.KILL_FILTER_REGISTRY:
            if f.hide_ui:
                continue
            with self.subTest(filter=f.key):
                self.assertIn(f.label, rows)
                self.assertIn("Enable", rows[f.label])
                self.assertIn("★ Must", rows[f.label])

    def test_ferrari_panel_follows_enable_var(self):
        v = self.app.v
        v["kill_mod_high_velocity"].set(True)
        self.app.update_idletasks()
        self.assertTrue(self.app._hv_inner.winfo_manager())
        # Exclude force Enable a False : le panneau doit se replier aussi.
        v["kill_mod_high_velocity_exclude"].set(True)
        v["kill_mod_high_velocity"].set(False)
        self.app.update_idletasks()
        self.assertFalse(self.app._hv_inner.winfo_manager())
        v["kill_mod_high_velocity_exclude"].set(False)

    def test_trois_shot_exclude_clears_trois_tap(self):
        v = self.app.v
        v["kill_mod_trois_tap"].set(True)
        v["kill_mod_trois_shot_exclude"].set(True)
        self.app._on_trois_shot_exclude()
        self.assertFalse(v["kill_mod_trois_tap"].get())
        v["kill_mod_trois_shot_exclude"].set(False)


if __name__ == "__main__":
    unittest.main()
