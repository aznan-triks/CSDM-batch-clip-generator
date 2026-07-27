"""Every attribute the engine reads must be declared in one place.

The engine used to get its state from `App.__init__`. A host without a window
has no `App`, so the contract has to live in the engine package instead.
"""
import threading

import pytest

from csdm.engine.state import ENGINE_STATE_DEFAULTS, EngineStateMixin


class _BareHost(EngineStateMixin):
    """A host with no window and no engine -- only the contract."""


class TestEngineStateContract:
    def test_init_sets_every_declared_attribute(self):
        class Host(EngineStateMixin):
            pass

        host = Host()
        host.init_engine_state()
        for name in ENGINE_STATE_DEFAULTS:
            assert hasattr(host, name), f"init_engine_state did not set {name!r}"

    def test_factories_do_not_share_mutable_state(self):
        a, b = type("H", (EngineStateMixin,), {})(), type("H", (EngineStateMixin,), {})()
        a.init_engine_state()
        b.init_engine_state()
        a._demo_checksums["x"] = 1
        assert b._demo_checksums == {}, "hosts share a mutable default"

    def test_pg_params_defaults_to_empty_and_is_overridable(self):
        host = type("H", (EngineStateMixin,), {})()
        host.init_engine_state()
        assert host._pg_params == {}
        host.init_engine_state(pg_params={"host": "localhost"})
        assert host._pg_params == {"host": "localhost"}

    def test_preview_attributes_are_part_of_the_contract(self):
        """A headless host must get these two without an App to create them."""
        host = _BareHost()
        host.init_engine_state()
        assert host._previewing is False
        assert isinstance(host._preview_cancel, threading.Event)
        assert not host._preview_cancel.is_set()

    def test_two_hosts_never_share_a_preview_event(self):
        """A factory, not a value: cancelling one host must not cancel the other."""
        a, b = _BareHost(), _BareHost()
        a.init_engine_state()
        b.init_engine_state()
        a._preview_cancel.set()
        assert not b._preview_cancel.is_set()

    def test_module_imports_no_tkinter(self):
        import ast, pathlib
        src = pathlib.Path("csdm/engine/state.py").read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] + [getattr(node, "module", "") or ""]
                assert not any("tkinter" in (n or "") for n in names)
