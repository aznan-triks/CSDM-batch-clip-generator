"""Every free name used by an engine module must resolve inside that module.

`EngineMixin` methods resolve their globals in `csdm.engine.core`, NOT in the
module of the class that inherits them. A method moved out of the main file
therefore loses every global it used to read from there — silently, until it
runs. Import-only checks cannot see this; regex checks cannot either. Walk the
AST instead.
"""
import ast
import builtins
import pathlib

ENGINE_DIR = pathlib.Path(__file__).resolve().parent.parent / "csdm" / "engine"


def _unresolved_names(path):
    """Return {name: [line, ...]} for every global loaded but never provided."""
    tree = ast.parse(path.read_text(encoding="utf-8"))

    provided, loaded = set(dir(builtins)), {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                provided.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.Name):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                provided.add(node.id)
            else:
                loaded.setdefault(node.id, []).append(node.lineno)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            # A lambda has no .name, but its parameters are bound just the same
            # -- including default-value bindings such as `lambda _k=k: ...`.
            provided.add(getattr(node, "name", None) or "<lambda>")
            args = node.args
            for a in (*args.posonlyargs, *args.args, *args.kwonlyargs):
                provided.add(a.arg)
            for extra in (args.vararg, args.kwarg):
                if extra:
                    provided.add(extra.arg)
        elif isinstance(node, ast.ClassDef):
            provided.add(node.name)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            provided.add(node.name)
        elif isinstance(node, ast.Global):
            provided.update(node.names)

    return {n: lines for n, lines in loaded.items() if n not in provided}


class TestEngineGlobalsResolve:
    def test_no_unresolved_global_in_any_engine_module(self):
        offenders = {}
        for path in sorted(ENGINE_DIR.glob("*.py")):
            found = _unresolved_names(path)
            if found:
                offenders[path.name] = found
        assert not offenders, f"unresolved globals in csdm/engine/: {offenders}"
