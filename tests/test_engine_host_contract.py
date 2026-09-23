"""Every method the engine calls on `self` must exist on the host Electron runs.

The engine is written as a mixin; a method that only the Tkinter host defines
still passes every Tkinter test and fails only in the bridge, at runtime.
That is how `_dp2_cache_put_locked` broke every demoparser2 filter in the
Electron app (docs/audits/AUDIT_perf_ressources.md).
"""
import re
import unittest
from pathlib import Path

from csdm.bridge.host import BridgeHost
from csdm.engine.state import ENGINE_STATE_DEFAULTS

ENGINE_DIR = Path(__file__).resolve().parents[1] / "csdm" / "engine"
SELF_CALL = re.compile(r"self\.(\w+)\(")

# Names called on `self` that are not methods of BridgeHost on purpose.
# Each entry needs a reason; an empty dict is the goal.
NOT_ON_HOST_BY_DESIGN: dict = {
    "log": "instance attribute set in BridgeHost.__init__ from ports.log, not a class method",
    "log_parts": "instance attribute set in BridgeHost.__init__ from ports.log_parts, not a class method",
    "state": "instance attribute set in BridgeHost.__init__ from ports.state, not a class method",
    "ask": "instance attribute set in BridgeHost.__init__ from ports.ask, not a class method",
}


class EngineHostContractTests(unittest.TestCase):
    def test_every_self_call_in_the_engine_resolves_on_the_bridge_host(self):
        called = set()
        for source in ENGINE_DIR.glob("*.py"):
            called |= set(SELF_CALL.findall(source.read_text(encoding="utf-8")))
        missing = sorted(
            name for name in called
            if not hasattr(BridgeHost, name)
            and name not in ENGINE_STATE_DEFAULTS
            and name not in NOT_ON_HOST_BY_DESIGN
        )
        self.assertEqual(missing, [], f"engine calls these on self, BridgeHost lacks them: {missing}")


if __name__ == "__main__":
    unittest.main()
