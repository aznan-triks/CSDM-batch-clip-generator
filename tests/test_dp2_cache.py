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

    def test_eviction_keeps_the_demo_player_positions(self):
        host = _Host({"dp2_cache_max_demos": 1})
        marker = object()
        host._player_positions_cache["a"] = marker
        with host._dp2_cache_lock:
            host._dp2_cache_put_locked("a", {})
            host._dp2_cache_put_locked("b", {})
        self.assertNotIn("a", host._dp2_cache)
        self.assertIs(host._player_positions_cache.get("a"), marker)

    def test_the_current_query_demos_are_never_evicted_by_each_other(self):
        # 169 demos against a cap of 150 used to evict the first 19 parsed
        # before the filters read them: each read re-parsed one and evicted
        # the next, ~20 s of re-parsing on every preview.
        host = _Host({"dp2_cache_max_demos": 2})
        working_set = ["a", "b", "c", "d"]
        host._dp2_cache_pin(working_set)
        with host._dp2_cache_lock:
            for path in working_set:
                host._dp2_cache_put_locked(path, {})
        self.assertEqual(list(host._dp2_cache), working_set)

    def test_demos_outside_the_current_query_are_evicted_first(self):
        host = _Host({"dp2_cache_max_demos": 2})
        with host._dp2_cache_lock:
            host._dp2_cache_put_locked("old1", {})
            host._dp2_cache_put_locked("old2", {})
        host._dp2_cache_pin(["a", "b", "c"])
        with host._dp2_cache_lock:
            for path in ("a", "b", "c"):
                host._dp2_cache_put_locked(path, {})
        self.assertEqual(list(host._dp2_cache), ["a", "b", "c"])

    def test_the_cap_still_bounds_what_a_new_query_leaves_behind(self):
        host = _Host({"dp2_cache_max_demos": 3})
        host._dp2_cache_pin(["a", "b", "c", "d"])
        with host._dp2_cache_lock:
            for path in ("a", "b", "c", "d"):
                host._dp2_cache_put_locked(path, {})
        host._dp2_cache_pin(["e"])
        with host._dp2_cache_lock:
            host._dp2_cache_put_locked("e", {})
        self.assertEqual(list(host._dp2_cache), ["c", "d", "e"])

    def test_preparse_pins_the_demos_of_the_query(self):
        host = _Host({"dp2_cache_max_demos": 1})
        pinned = []
        host._dp2_cache_pin = lambda paths: pinned.append(list(paths))
        host._dp2_required_sections = lambda cfg: {"fire"}
        host._dp2_parse_demo = lambda path, sections=None: True
        host.state = lambda name, payload: None
        host._preparse_dp2({}, [__file__])
        self.assertEqual(pinned, [[__file__]])


if __name__ == "__main__":
    unittest.main()
