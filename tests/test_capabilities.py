"""The capability registry: every setting and bridge command has one owner.

Nothing here is copied from the registries it checks. Keys come from
DEFAULT_CONFIG, commands from the bridge's COMMANDS, filters from
KILL_FILTER_REGISTRY, match types from MATCH_TYPE_DEFS -- all read at test
time, so a key added tomorrow is measured tomorrow.
"""
import pathlib
import unittest

# A registry filter's capability id ends with its key's suffix; the prefix is
# its event category (kill_filter_ / damage_filter_ / shot_filter_).
from csdm.capabilities import filter_capability_id
from csdm.static_data import KILL_FILTER_REGISTRY as _REG

_FILTER_ID_SUFFIXES = tuple(filter_capability_id(f) for f in _REG)


class TestDerivedCapabilities(unittest.TestCase):
    def test_every_kill_filter_has_one_capability(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import KILL_FILTER_REGISTRY

        derived = [c for c in CAPABILITIES if c.id.endswith(_FILTER_ID_SUFFIXES)]
        self.assertEqual(len(derived), len(KILL_FILTER_REGISTRY))
        owners = {c.config_keys[0] for c in derived}
        self.assertEqual(owners, {f.key for f in KILL_FILTER_REGISTRY})

    def test_filter_capability_owns_its_generated_keys(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import _FILTER_CONFIG_DEFAULTS, KILL_FILTER_REGISTRY

        by_first_key = {c.config_keys[0]: c for c in CAPABILITIES
                        if c.id.endswith(_FILTER_ID_SUFFIXES)}
        for f in KILL_FILTER_REGISTRY:
            expected = {k for k in (f.key, f"{f.key}_req", f"{f.key}_exclude")
                        if k in _FILTER_CONFIG_DEFAULTS}
            expected |= set(f.extra_config or {})
            self.assertEqual(set(by_first_key[f.key].config_keys), expected, f.key)

    def test_a_filter_that_supplies_a_camera_is_filed_under_filming(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import KILL_FILTER_REGISTRY

        by_first_key = {c.config_keys[0]: c for c in CAPABILITIES
                        if c.id.endswith(_FILTER_ID_SUFFIXES)}
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


def _owners(attribute):
    from collections import defaultdict
    from csdm.capabilities import CAPABILITIES

    owners = defaultdict(list)
    for capability in CAPABILITIES:
        for name in getattr(capability, attribute):
            owners[name].append(capability.id)
    return owners


class TestPartition(unittest.TestCase):
    def test_every_config_key_has_exactly_one_owner(self):
        from csdm.config import DEFAULT_CONFIG

        owners = _owners("config_keys")
        orphans = [k for k in DEFAULT_CONFIG if k not in owners]
        shared = {k: v for k, v in owners.items() if len(v) > 1}
        self.assertEqual(orphans, [], "settings with no capability -- give each an owner")
        self.assertEqual(shared, {}, "settings claimed by two capabilities -- keep one owner")

    def test_no_ghost_key(self):
        from csdm.config import DEFAULT_CONFIG

        ghosts = sorted(k for k in _owners("config_keys") if k not in DEFAULT_CONFIG)
        self.assertEqual(ghosts, [], "capabilities naming a setting DEFAULT_CONFIG does not have")

    def test_every_bridge_command_has_exactly_one_owner(self):
        from csdm.bridge.host import COMMANDS

        owners = _owners("commands")
        orphans = [c for c in COMMANDS if c not in owners]
        shared = {c: v for c, v in owners.items() if len(v) > 1}
        self.assertEqual(orphans, [], "bridge commands with no capability -- give each an owner")
        self.assertEqual(shared, {}, "bridge commands claimed by two capabilities -- keep one owner")

    def test_no_ghost_command(self):
        from csdm.bridge.host import COMMANDS

        ghosts = sorted(c for c in _owners("commands") if c not in COMMANDS)
        self.assertEqual(ghosts, [], "capabilities naming a command the bridge does not have")

    def test_ids_are_unique(self):
        from collections import Counter
        from csdm.capabilities import CAPABILITIES

        duplicates = [i for i, n in Counter(c.id for c in CAPABILITIES).items() if n > 1]
        self.assertEqual(duplicates, [])

    def test_every_capability_is_filed_and_owns_something(self):
        from csdm.capabilities import CAPABILITIES, INTENTIONS

        codes = {code for code, _label in INTENTIONS}
        for capability in CAPABILITIES:
            self.assertIn(capability.intention, codes, capability.id)
            self.assertTrue(capability.config_keys or capability.commands, capability.id)
            self.assertTrue(capability.label, capability.id)

    def test_every_intention_has_a_capability(self):
        from csdm.capabilities import CAPABILITIES, INTENTIONS

        used = {c.intention for c in CAPABILITIES}
        self.assertEqual([code for code, _ in INTENTIONS if code not in used], [])


class TestLevels(unittest.TestCase):
    def test_every_capability_has_a_valid_level(self):
        from csdm.capabilities import CAPABILITIES, LEVELS

        invalid = [c.id for c in CAPABILITIES if c.level not in LEVELS]
        self.assertEqual(invalid, [], "capabilities with no valid level -- assign one")

    def test_a_filter_that_supplies_a_camera_is_essential(self):
        from csdm.capabilities import CAPABILITIES
        from csdm.static_data import KILL_FILTER_REGISTRY

        by_first_key = {c.config_keys[0]: c for c in CAPABILITIES
                        if c.id.endswith(_FILTER_ID_SUFFIXES)}
        for f in KILL_FILTER_REGISTRY:
            expected = "essential" if f.camera_fn else "advanced"
            self.assertEqual(by_first_key[f.key].level, expected, f.key)

    def test_match_type_filter_is_advanced(self):
        from csdm.capabilities import CAPABILITIES

        match = next(c for c in CAPABILITIES if c.id == "match_type_filter")
        self.assertEqual(match.level, "advanced")

    def test_all_three_levels_are_used(self):
        from csdm.capabilities import CAPABILITIES, LEVELS

        used = {c.level for c in CAPABILITIES}
        self.assertEqual(used, set(LEVELS))


if __name__ == "__main__":
    unittest.main()
