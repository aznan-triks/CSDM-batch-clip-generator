"""The demoparser2 cache lives on the engine, so every host (bridge included) can fill it."""
import unittest

from csdm.bridge.host import BridgeHost
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin


class _Host(EngineStateMixin, EngineMixin):
    """Smallest host the engine accepts: state defaults, a config, a log sink."""

    def __init__(self, cfg=None):
        self.cfg = cfg or {}
        self.logs = []
        self.init_engine_state()

    def log(self, msg, *args, **kwargs):
        self.logs.append(msg)


class Dp2CacheTests(unittest.TestCase):
    def test_bridge_host_can_store_dp2_results(self):
        self.assertTrue(hasattr(BridgeHost, "_dp2_cache_put_locked"))

    def test_parse_of_a_missing_demo_is_cached_instead_of_raising(self):
        host = _Host()
        missing = r"Z:\missing\x.dem"
        self.assertFalse(host._dp2_parse_demo(missing))
        self.assertIn(missing, host._dp2_cache)

    def test_oldest_demo_is_evicted_beyond_the_configured_cap(self):
        host = _Host({"dp2_cache_max_demos": 2})
        with host._dp2_cache_lock:
            for path in ("a", "b", "c"):
                host._dp2_cache_put_locked(path, {})
        self.assertEqual(list(host._dp2_cache), ["b", "c"])

    def test_rewriting_a_demo_keeps_its_original_slot(self):
        host = _Host({"dp2_cache_max_demos": 2})
        with host._dp2_cache_lock:
            host._dp2_cache_put_locked("a", {})
            host._dp2_cache_put_locked("b", {})
            host._dp2_cache_put_locked("a", {"x": 1})
            host._dp2_cache_put_locked("c", {})
        self.assertEqual(list(host._dp2_cache), ["b", "c"])

    def test_eviction_also_drops_the_demo_player_positions(self):
        host = _Host({"dp2_cache_max_demos": 1})
        host._player_positions_cache["a"] = object()
        with host._dp2_cache_lock:
            host._dp2_cache_put_locked("a", {})
            host._dp2_cache_put_locked("b", {})
        self.assertNotIn("a", host._player_positions_cache)


if __name__ == "__main__":
    unittest.main()
