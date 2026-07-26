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


ENGINE_METHODS = [
    "_qe_suicide_sql", "_mod_sql_expr", "_qe_mod_sql", "_qe_detect_date_col",
    "_qe_map_filter_sql", "_query_events", "_apply_db_postfilters",
    "_fetch_all_kills_for_demos", "_apply_clutch_filter", "_effective_before",
    "_build_sequences", "_get_sids", "_player_str", "_cfg_num", "_cfg_int",
    "_cfg_float", "_cfg_bool", "_common_cs2_injection", "_resolve_cs2_cfg_dir",
    "_inject_cs_runtime_cfg", "_inject_hlae_extra_args", "_seq_anchor_sid",
    "_build_cams_killer", "_build_cams_victim", "_build_cams_both",
    "_bj_players_options", "_bj_output_dir", "_bj_output_params", "_build_json",
    "_start_cs2_send_to_back_watcher", "_exec", "_preparse_dp2",
    "_dp2_required_sections", "_assemble_clips", "_get_dp2_filter_defs",
    "_DP2_FILTER_DEFS", "_apply_dp2_modifiers", "_apply_dp2_filters_to_events",
    "_worker",
]

# Forbidden patterns inside the engine: each one is a direct touch of the UI.
FORBIDDEN = [
    r"self\.after\(", r"messagebox", r"filedialog", r"self\.v\[", r"self\.v\.",
    r"self\._log\(", r"self\._async_log", r"self\._log_parts",
    r"self\._summary_lbl", r"self\.progress_lbl", r"self\._demo_tree",
    r"self\._picker_count_lbl", r"self\.stop_btn",
]


class TestEngineMethodsAreUIFree(unittest.TestCase):
    def test_no_forbidden_pattern_in_any_engine_method(self):
        from csdm_batch_clips_generator import App
        offenders = []
        for name in ENGINE_METHODS:
            obj = getattr(App, name)
            # _DP2_FILTER_DEFS is a property; unwrap to its getter for inspect.getsource.
            if isinstance(obj, property):
                obj = obj.fget
            src = inspect.getsource(obj)
            for pat in FORBIDDEN:
                for m in re.finditer(pat, src):
                    line = src[:m.start()].count("\n") + 1
                    offenders.append(f"{name}:{line} -> {m.group(0)}")
        self.assertEqual(offenders, [], "\n".join(offenders))


if __name__ == "__main__":
    unittest.main()
