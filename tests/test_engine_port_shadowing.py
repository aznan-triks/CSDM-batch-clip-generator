"""No instance attribute may shadow an engine port.

`App.log` the method (the engine port) was shadowed by `App.log` the Text widget
for two releases: every `self.log(...)` in the engine raised TypeError, silently,
because no test ever called a port on a real App. Names are the contract; guard them.
"""
import ast
import pathlib

import pytest

PORTS = ("log", "log_parts", "state", "ask")
MAIN = pathlib.Path(__file__).resolve().parent.parent / "csdm_batch_clips_generator.py"


def _self_attribute_assignments(tree):
    """Yield (attr_name, lineno) for every `self.X = ...` in the file."""
    for node in ast.walk(tree):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            targets = [node.target]
        for t in targets:
            if (isinstance(t, ast.Attribute)
                    and isinstance(t.value, ast.Name) and t.value.id == "self"):
                yield t.attr, t.lineno


@pytest.mark.parametrize("port", PORTS)
def test_no_instance_attribute_shadows_a_port(port):
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    clashes = [ln for name, ln in _self_attribute_assignments(tree) if name == port]
    assert not clashes, (
        f"self.{port} is assigned at line(s) {clashes}, shadowing the engine port "
        f"of the same name — the engine's calls would raise TypeError"
    )


def test_log_port_is_callable_on_the_class():
    import csdm_batch_clips_generator as main
    assert callable(main.App.log)
    assert main.App.log.__qualname__.startswith("App.")


def test_main_file_never_calls_the_state_port_itself():
    """`App.state` is the engine port and deliberately overrides `tk.Tk.state`.

    Only the engine may call it. The UI's own window-state checks must go
    through `wm_state`, which is the very same Tk function under its other
    name -- calling `self.state()` here would hit the port instead and raise.
    """
    src = MAIN.read_text(encoding="utf-8")
    assert "self.state(" not in src, (
        "the main file calls self.state(...), which resolves to the engine port, "
        "not to tk.Tk.state -- use self.wm_state(...) instead"
    )
