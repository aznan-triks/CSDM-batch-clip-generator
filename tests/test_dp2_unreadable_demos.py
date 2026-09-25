"""Demos demoparser2 cannot read are skipped once, with an actionable message."""
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self, cfg=None):
        self.cfg = cfg or {}
        self.logs = []
        self.init_engine_state()

    def log(self, msg, *args, **kwargs):
        self.logs.append(msg)


def _demo_file(magic: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".dem")
    os.write(fd, magic + b"\0" * 64)
    os.close(fd)
    return path


class _FakeParser:
    """Stands in for demoparser2.DemoParser; counts constructions."""
    created = 0
    fail_with = None

    def __init__(self, path):
        type(self).created += 1
        if type(self).fail_with:
            raise type(self).fail_with

    def parse_event(self, *args, **kwargs):
        raise Exception("EntityNotFound")


class Dp2UnreadableDemoTests(unittest.TestCase):
    def setUp(self):
        _FakeParser.created = 0
        _FakeParser.fail_with = None
        fake_mod = types.SimpleNamespace(DemoParser=_FakeParser)
        patcher = mock.patch.dict(sys.modules, {"demoparser2": fake_mod})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _path(self, magic):
        path = _demo_file(magic)
        self.addCleanup(os.remove, path)
        return path

    def test_csgo_demo_is_skipped_without_invoking_demoparser2(self):
        host = _Host()
        path = self._path(b"HL2DEMO")
        self.assertFalse(host._dp2_parse_demo(path))
        self.assertEqual(_FakeParser.created, 0)
        self.assertIn(path, host._dp2_cache)
        self.assertTrue(any("CS:GO" in m for m in host.logs), host.logs)

    def test_csgo_demo_is_not_retried_on_the_next_preview(self):
        host = _Host()
        path = self._path(b"HL2DEMO")
        host._dp2_parse_demo(path)
        host._dp2_parse_demo(path)
        self.assertEqual(sum("CS:GO" in m for m in host.logs), 1)

    def test_parser_that_cannot_open_a_cs2_demo_is_cached_not_retried(self):
        _FakeParser.fail_with = Exception("ClassNotFound")
        host = _Host()
        path = self._path(b"PBDEMS2")
        self.assertFalse(host._dp2_parse_demo(path))
        host._dp2_parse_demo(path)
        self.assertEqual(_FakeParser.created, 1)

    def test_cs2_parse_failure_tells_the_user_to_update_demoparser2(self):
        host = _Host()
        path = self._path(b"PBDEMS2")
        host._dp2_parse_demo(path, {"death"})
        errors = [m for m in host.logs if "EntityNotFound" in m]
        self.assertTrue(errors, host.logs)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("pip install -U demoparser2", errors[0])

    def test_every_failing_section_is_reported_in_a_single_line(self):
        host = _Host()
        path = self._path(b"PBDEMS2")
        host._dp2_parse_demo(path, {"fire", "death", "hurt"})
        errors = [m for m in host.logs if "dp2 parse error" in m]
        self.assertEqual(len(errors), 1, errors)
        for section in ("fire", "death", "hurt"):
            self.assertIn(section, errors[0])


if __name__ == "__main__":
    unittest.main()
