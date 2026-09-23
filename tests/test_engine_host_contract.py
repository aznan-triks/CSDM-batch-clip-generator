"""Every method the engine calls on `self` must exist on the host Electron runs.

The engine is written as a mixin; a method that only the Tkinter host defines
still passes every Tkinter test and fails only in the bridge, at runtime.
That is how `_dp2_cache_put_locked` broke every demoparser2 filter in the
Electron app (docs/audits/AUDIT_perf_ressources.md).

This also covers plain attribute READS, not just method calls: a class
attribute the Tkinter `App` defines (e.g. `RETRYABLE`, `ALL_ERR`) but the
engine mixins never assign is invisible to a calls-only scan and still
raises AttributeError on the bridge the first time it is read.
"""
import ast
import unittest
from pathlib import Path

from csdm.bridge.host import BridgeHost
from csdm.engine.state import ENGINE_STATE_DEFAULTS

ENGINE_DIR = Path(__file__).resolve().parents[1] / "csdm" / "engine"

# Only real engine mixins are scanned for self-attribute reads: ports.py also
# defines EnginePorts/CollectingPorts, plain dataclasses used as test doubles
# for the log/state/ask sockets, not part of the engine's own self-contract.
ENGINE_MIXIN_CLASS_NAMES = {"EngineMixin", "EngineStateMixin"}

# Names read or called on `self` that are not on BridgeHost on purpose.
# Each entry needs a reason; an empty dict is the goal.
NOT_ON_HOST_BY_DESIGN: dict = {
    "log": "instance attribute set in BridgeHost.__init__ from ports.log, not a class method",
    "log_parts": "instance attribute set in BridgeHost.__init__ from ports.log_parts, not a class method",
    "state": "instance attribute set in BridgeHost.__init__ from ports.state, not a class method",
    "ask": "instance attribute set in BridgeHost.__init__ from ports.ask, not a class method",
}

_STORE_CTX = (ast.Store, ast.AugStore, ast.Del)


def _self_attr_reads_and_writes(tree: ast.AST):
    """Collect `self.<name>` Load and Store/AugStore/Del attribute names,
    restricted to the bodies of engine-mixin classes."""
    read = set()
    written = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        if node.name not in ENGINE_MIXIN_CLASS_NAMES:
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Attribute) and isinstance(sub.value, ast.Name) and sub.value.id == "self":
                if isinstance(sub.ctx, ast.Load):
                    read.add(sub.attr)
                elif isinstance(sub.ctx, _STORE_CTX):
                    written.add(sub.attr)
    return read, written


class EngineHostContractTests(unittest.TestCase):
    def test_every_self_attribute_the_engine_reads_resolves_on_the_bridge_host(self):
        read = set()
        written = set()
        for source in ENGINE_DIR.glob("*.py"):
            tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
            r, w = _self_attr_reads_and_writes(tree)
            read |= r
            written |= w

        # A name the engine assigns to self anywhere (directly, or via +=)
        # is not something the host must predefine.
        never_assigned_by_engine = read - written

        missing = sorted(
            name for name in never_assigned_by_engine
            if not hasattr(BridgeHost, name)
            and name not in ENGINE_STATE_DEFAULTS
            and name not in NOT_ON_HOST_BY_DESIGN
        )
        self.assertEqual(
            missing, [],
            f"engine reads these on self, BridgeHost has none of them: {missing}",
        )


if __name__ == "__main__":
    unittest.main()
