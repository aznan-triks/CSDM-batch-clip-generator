"""The capability registry: every setting and bridge command has one owner.

Nothing here is copied from the registries it checks. Keys come from
DEFAULT_CONFIG, commands from the bridge's COMMANDS, filters from
KILL_FILTER_REGISTRY, match types from MATCH_TYPE_DEFS -- all read at test
time, so a key added tomorrow is measured tomorrow.
"""
import pathlib
import unittest


class TestDerivedCapabilities(unittest.TestCase):
    def test_every_kill_filter_has_one_capability(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import KILL_FILTER_REGISTRY

        derived = [c for c in CAPABILITIES if c.id.startswith("kill_filter_")]
        self.assertEqual(len(derived), len(KILL_FILTER_REGISTRY))
        owners = {c.config_keys[0] for c in derived}
        self.assertEqual(owners, {f.key for f in KILL_FILTER_REGISTRY})

    def test_filter_capability_owns_its_generated_keys(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import _FILTER_CONFIG_DEFAULTS, KILL_FILTER_REGISTRY

        by_first_key = {c.config_keys[0]: c for c in CAPABILITIES
                        if c.id.startswith("kill_filter_")}
        for f in KILL_FILTER_REGISTRY:
            expected = {k for k in (f.key, f"{f.key}_req", f"{f.key}_exclude")
                        if k in _FILTER_CONFIG_DEFAULTS}
            expected |= set(f.extra_config or {})
            self.assertEqual(set(by_first_key[f.key].config_keys), expected, f.key)

    def test_a_filter_that_supplies_a_camera_is_filed_under_filming(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import KILL_FILTER_REGISTRY

        by_first_key = {c.config_keys[0]: c for c in CAPABILITIES
                        if c.id.startswith("kill_filter_")}
        for f in KILL_FILTER_REGISTRY:
            self.assertEqual(by_first_key[f.key].intention,
                             "I5" if f.camera_fn else "I4", f.key)

    def test_match_types_are_one_capability(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import MATCH_TYPE_DEFS

        match = [c for c in CAPABILITIES if c.id == "match_type_filter"]
        self.assertEqual(len(match), 1)
        self.assertEqual(
            match[0].config_keys,
            ("match_type_filter_enabled",
             *(cfg_key for _db, cfg_key, _label, _tip in MATCH_TYPE_DEFS)))

    def test_module_is_pure_data(self):
        # Imports are read from the syntax tree, not searched as text: the
        # registry legitimately NAMES the `tkinter_check` command.
        import ast

        tree = ast.parse(pathlib.Path("csdm/capabilities.py").read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module)
        self.assertEqual(imported - {"typing", "csdm.static_data"}, set())


if __name__ == "__main__":
    unittest.main()
