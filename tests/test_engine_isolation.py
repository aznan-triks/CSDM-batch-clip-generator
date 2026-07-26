"""Test de garde : le moteur ne touche pas a l'interface (chantier 1)."""
import inspect
import re
import unittest


class TestNoDirectWidgetReads(unittest.TestCase):
    def test_exec_takes_cfg_and_reads_no_widget(self):
        from csdm_batch_clips_generator import App
        sig = inspect.signature(App._exec)
        self.assertEqual(list(sig.parameters), ["self", "cmd", "cfg", "timeout_s"])
        src = inspect.getsource(App._exec)
        self.assertNotIn("self.v", src)
        self.assertIn('cfg.get("cs2_send_to_back")', src)


if __name__ == "__main__":
    unittest.main()
