"""Guard rails: nothing but the protocol may ever touch standard output.

`cs2.exe`, HLAE and the CSDM CLI all write to *their* stdout. If a subprocess
launch in the engine ever inherited the parent's stdout, its first raw line
would land on the pipe and corrupt the protocol. `csdm/engine/core.py::_exec`
already captures every child's output and re-emits it through the `log`
socket (checked below by AST, not by trust). This file also guards the other
half of the same risk: no stray `print()` or raw `sys.stdout.write` anywhere
in `csdm/bridge/` or `csdm/engine/`, except the one writer allowed to use it.
"""
import ast
import pathlib
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "csdm" / "engine"
BRIDGE_DIR = REPO_ROOT / "csdm" / "bridge"


def _parse(path):
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _iter_py_files(directory):
    return sorted(directory.glob("*.py"))


class TestNoInheritedChildStdout(unittest.TestCase):
    """Every subprocess.Popen / subprocess.run in the engine must redirect stdout."""

    def test_every_process_launch_declares_stdout_explicitly(self):
        offenders = []
        for path in _iter_py_files(ENGINE_DIR):
            tree = _parse(path)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                is_subprocess_call = (
                    isinstance(func, ast.Attribute)
                    and func.attr in ("Popen", "run")
                    and isinstance(func.value, ast.Name)
                    and func.value.id == "subprocess"
                )
                if not is_subprocess_call:
                    continue
                has_stdout_kwarg = any(kw.arg == "stdout" for kw in node.keywords)
                if not has_stdout_kwarg:
                    offenders.append(f"{path.name}:{node.lineno}")
        self.assertEqual(offenders, [],
                          f"subprocess call(s) without an explicit stdout=: {offenders}")


class TestNothingElseWritesToStdout(unittest.TestCase):
    """Only `protocol.py::LineWriter` may write to standard output."""

    def _find_offenders(self, directory, *, allow_file, allow_class):
        offenders = []
        for path in _iter_py_files(directory):
            tree = _parse(path)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                if isinstance(func, ast.Name) and func.id == "print":
                    has_file_kwarg = any(kw.arg == "file" for kw in node.keywords)
                    if not has_file_kwarg:
                        offenders.append(f"{path.name}:{node.lineno} print()")
                elif (isinstance(func, ast.Attribute) and func.attr == "write"
                      and isinstance(func.value, ast.Attribute)
                      and func.value.attr == "stdout"
                      and isinstance(func.value.value, ast.Name)
                      and func.value.value.id == "sys"):
                    if path.name == allow_file:
                        # Only the LineWriter class inside protocol.py may do this.
                        enclosing = _enclosing_class(tree, node)
                        if enclosing == allow_class:
                            continue
                    offenders.append(f"{path.name}:{node.lineno} sys.stdout.write()")
        return offenders

    def test_bridge_has_no_stray_stdout_writes(self):
        offenders = self._find_offenders(
            BRIDGE_DIR, allow_file="protocol.py", allow_class="LineWriter")
        self.assertEqual(offenders, [], f"unexpected stdout write(s): {offenders}")

    def test_engine_has_no_stray_stdout_writes(self):
        offenders = self._find_offenders(
            ENGINE_DIR, allow_file="__never__", allow_class="__never__")
        self.assertEqual(offenders, [], f"unexpected stdout write(s): {offenders}")


def _enclosing_class(tree, target):
    """Return the name of the class body that directly contains `target`, or None."""
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for child in ast.walk(node):
                if child is target:
                    return node.name
    return None


if __name__ == "__main__":
    unittest.main()
