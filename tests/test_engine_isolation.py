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
    "_find_col", "_pg", "_pg_fresh", "_resolve_cli", "_qe_epoch_bounds",
    "_qe_match_type_sql", "_qe_headshot_sql", "_qe_teamkill_sql",
    "_mods_dp2_global_any_union_enabled",
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


class TestValidationUsesAskPort(unittest.TestCase):
    def test_validate_run_inputs_goes_through_ask(self):
        from csdm_batch_clips_generator import App
        src = inspect.getsource(App._validate_run_inputs)
        self.assertNotIn("messagebox", src)
        self.assertIn('self.ask("error"', src)


class TestEngineModuleIsTkFree(unittest.TestCase):
    def test_module_exists_and_carries_the_methods(self):
        from csdm.engine.core import EngineMixin
        for name in ENGINE_METHODS:
            self.assertTrue(hasattr(EngineMixin, name), f"missing: {name}")

    def test_app_inherits_the_mixin(self):
        from csdm.engine.core import EngineMixin
        from csdm_batch_clips_generator import App
        self.assertTrue(issubclass(App, EngineMixin))

    def test_module_imports_no_tkinter(self):
        import ast
        import csdm.engine.core as core
        tree = ast.parse(open(core.__file__, encoding="utf-8").read())
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        self.assertNotIn("tkinter", imported)

    def test_module_has_no_forbidden_pattern(self):
        import csdm.engine.core as core
        src = open(core.__file__, encoding="utf-8").read()
        offenders = []
        for pat in FORBIDDEN + [r"\btk\.", r"\bttk\."]:
            for m in re.finditer(pat, src):
                offenders.append(f"{src[:m.start()].count(chr(10)) + 1} -> {m.group(0)}")
        self.assertEqual(offenders, [], "\n".join(offenders))


if __name__ == "__main__":
    unittest.main()
