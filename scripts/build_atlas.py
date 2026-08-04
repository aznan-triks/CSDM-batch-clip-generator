"""Generate PROJECT_ATLAS.{json,md}: the directory of everything reusable here.

WHY THIS EXISTS. context_guide.md section 4 requires citing the existing
functions, widgets and registries that might already cover a need before any
change over one line. Nothing listed them, so every session re-explored the
project from scratch and rebuilt what it failed to find. The four inventories
written by hand all drifted: two were extracted from v207, the architecture
sections of the guide aged with every commit, and the graph report predates
every chantier.

REGIME. Both outputs are GENERATED, versioned, and never hand-edited -- the
same discipline as electron/renderer/src/theme/mock-v12.css, and for the same
reason: a directory that can be edited is a directory that lies. tests/
test_atlas.py replays the generation and fails on any divergence.

READING IT. The .md is for a human. The .json is for a machine, and it is
queried -- never read whole. AEVO3's equivalent runs past a thousand lines;
loading that on every session would cost more than the exploration it saves.
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ATLAS_SOURCES = {
    "python": ["csdm", "csdm_batch_clips_generator.py"],
    "python_tests": ["tests"],
    "typescript": ["electron/renderer/src"],
    "mock_css": "electron/renderer/src/theme/mock-v12.css",
    "engine": ["csdm/engine"],
    "registries": {
        "KILL_FILTER_REGISTRY": "csdm.static_data",
        "COMMANDS": "csdm.bridge.host",
    },
}

ATLAS_OPTIONS = {
    "md_rows_per_table": 40,  # the .md is a summary; the .json is exhaustive
    "skip_dirs": {"__pycache__", "node_modules", "dist", "dist-app", ".venv"},
    "repeated_literal_min_files": 2,  # a literal in >= this many files is unnamed duplication
    "duplicate_body_min_statements": 5,  # bodies with more than this many statements get fingerprinted
}


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def iter_py_files(paths: list[str]):
    for entry in paths:
        p = ROOT / entry
        if p.is_file() and p.suffix == ".py":
            yield p
            continue
        if not p.is_dir():
            continue
        for f in sorted(p.rglob("*.py")):
            if ATLAS_OPTIONS["skip_dirs"] & set(f.relative_to(ROOT).parts):
                continue
            yield f


def _fmt_args(args: ast.arguments) -> str:
    parts: list[str] = []
    pos = list(args.posonlyargs) + list(args.args)
    defaults = list(args.defaults)
    n_no_default = len(pos) - len(defaults)
    for i, a in enumerate(pos):
        s = a.arg
        if i >= n_no_default:
            d = defaults[i - n_no_default]
            try:
                s = f"{s}={ast.unparse(d)}"
            except Exception:
                s = f"{s}=…"
        parts.append(s)
    if args.vararg:
        parts.append(f"*{args.vararg.arg}")
    if args.kwonlyargs:
        if not args.vararg:
            parts.append("*")
        for a, d in zip(args.kwonlyargs, args.kw_defaults):
            s = a.arg
            if d is not None:
                try:
                    s = f"{s}={ast.unparse(d)}"
                except Exception:
                    s = f"{s}=…"
            parts.append(s)
    if args.kwarg:
        parts.append(f"**{args.kwarg.arg}")
    return ", ".join(parts)


def _short_doc(node: ast.AST) -> str:
    doc = ast.get_docstring(node) or ""
    first = doc.strip().splitlines()[0] if doc.strip() else ""
    return first[:160]


def _count_usages(names: list[str], scan_paths: list[str], suffixes: tuple[str, ...]) -> dict[str, int]:
    """Files (across scan_paths) mentioning each name, minus the file it's defined in isn't excluded here.

    Heuristic attention counter, not semantic proof -- same caveat as AEVO3's.
    """
    counts = {n: 0 for n in names}
    if not names:
        return counts
    files: list[Path] = []
    for entry in scan_paths:
        p = ROOT / entry
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file() and f.suffix in suffixes:
                    if ATLAS_OPTIONS["skip_dirs"] & set(f.relative_to(ROOT).parts):
                        continue
                    files.append(f)
    BATCH = 200
    for i in range(0, len(names), BATCH):
        batch = names[i:i + BATCH]
        pat = re.compile(r"\b(" + "|".join(re.escape(n) for n in batch) + r")\b")
        for f in files:
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for h in set(pat.findall(text)):
                counts[h] += 1
    return counts


def walk_python(paths: list[str]) -> tuple[list[dict], list[dict]]:
    """AST walk over `paths` -- returns (functions, classes).

    Each entry: name, file (relative to ROOT), line, signature, doc,
    usages (files mentioning the name, minus its own definition file),
    tested (name appears under tests/).
    """
    functions: list[dict] = []
    classes: list[dict] = []
    for py in iter_py_files(paths):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        rp = rel(py)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions.append({
                    "name": node.name,
                    "file": rp,
                    "line": node.lineno,
                    "signature": f"{node.name}({_fmt_args(node.args)})",
                    "doc": _short_doc(node),
                })
            elif isinstance(node, ast.ClassDef):
                classes.append({
                    "name": node.name,
                    "file": rp,
                    "line": node.lineno,
                    "signature": f"class {node.name}",
                    "doc": _short_doc(node),
                })

    all_names = list({e["name"] for e in functions} | {e["name"] for e in classes})
    usage_counts = _count_usages(all_names, ATLAS_SOURCES["python"] + ["electron/renderer/src"], (".py", ".ts", ".tsx"))
    test_counts = _count_usages(all_names, ATLAS_SOURCES["python_tests"], (".py",))

    for e in functions + classes:
        # own definition file also matches the regex; subtract 1 so a
        # symbol used only where it's defined reads as 0, not 1.
        e["usages"] = max(0, usage_counts.get(e["name"], 0) - 1)
        e["tested"] = test_counts.get(e["name"], 0) > 0

    return functions, classes


def read_config_keys() -> list[dict]:
    """Import DEFAULT_CONFIG -- never parse the source, that's how it stays true."""
    sys.path.insert(0, str(ROOT))
    from csdm.config import DEFAULT_CONFIG
    return [{"name": k, "default": v} for k, v in DEFAULT_CONFIG.items()]


_COMPONENT_RE = re.compile(r"export\s+(?:default\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
_EXPORT_DEFAULT_NAME_RE = re.compile(r"export\s+default\s+([A-Za-z_][A-Za-z0-9_]*)\s*;")
_ANY_FUNC_DEF_RE = re.compile(r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_PROP_NAME_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:", re.M)


def _line_at(text: str, offset: int) -> int:
    return text[:offset].count("\n") + 1


def _extract_props(text: str, component_name: str) -> list[str]:
    m = re.search(rf"interface\s+{re.escape(component_name)}Props(?:\s+extends[^{{]*)?\s*\{{(.*?)\n\}}", text, re.S)
    if not m:
        return []
    return _PROP_NAME_RE.findall(m.group(1))


def walk_typescript(paths: list[str]) -> dict:
    """Regex sweep over .ts/.tsx -- we're citing names, not compiling (KISS).

    component = `export [default] function <Name>(` in a .tsx file whose
    name starts uppercase; props = the `<Name>Props` interface, if any.
    hook = exported function starting with `use`. Everything else exported
    lands in `exports`.
    """
    components: list[dict] = []
    hooks: list[dict] = []
    exports: list[dict] = []

    for entry in paths:
        root = ROOT / entry
        if not root.exists():
            continue
        for f in sorted(root.rglob("*.ts")) + sorted(root.rglob("*.tsx")):
            if ATLAS_OPTIONS["skip_dirs"] & set(f.relative_to(ROOT).parts):
                continue
            try:
                text = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            rp = rel(f)
            is_tsx = f.suffix == ".tsx"

            seen_names: set[str] = set()
            for m in _COMPONENT_RE.finditer(text):
                name = m.group(1)
                seen_names.add(name)
                line = _line_at(text, m.start())
                if is_tsx and name[0].isupper():
                    components.append({
                        "name": name, "file": rp, "line": line,
                        "props": _extract_props(text, name),
                    })
                elif name.startswith("use"):
                    hooks.append({"name": name, "file": rp, "line": line})
                else:
                    exports.append({"name": name, "file": rp, "line": line})

            for m in _EXPORT_CONST_RE.finditer(text):
                name = m.group(1)
                if name in seen_names:
                    continue
                seen_names.add(name)
                line = _line_at(text, m.start())
                if name.startswith("use"):
                    hooks.append({"name": name, "file": rp, "line": line})
                else:
                    exports.append({"name": name, "file": rp, "line": line})

            # `const Name = forwardRef(function Name(...` ends in `export default Name;`
            # rather than `export default function Name(` -- the definition and the
            # export live on different lines, so match them up by name.
            for m in _EXPORT_DEFAULT_NAME_RE.finditer(text):
                name = m.group(1)
                if name in seen_names or not is_tsx or not name[0].isupper():
                    continue
                found = next((d for d in _ANY_FUNC_DEF_RE.finditer(text) if d.group(1) == name), None)
                if not found:
                    continue
                seen_names.add(name)
                components.append({
                    "name": name, "file": rp, "line": _line_at(text, found.start()),
                    "props": _extract_props(text, name),
                })

    return {"components": components, "hooks": hooks, "exports": exports}


_MOCK_CLASS_RE = re.compile(r"\.([a-zA-Z][\w-]*)")


def read_mock_classes(path: Path) -> list[str]:
    """All `.classname` tokens in the generated mock stylesheet -- the cascade this app inherits from."""
    text = path.read_text(encoding="utf-8")
    return sorted(set(_MOCK_CLASS_RE.findall(text)))


def read_registries(sources: dict) -> dict:
    """Import each registry named in ATLAS_SOURCES["registries"] and render its keys. Import, never parse."""
    import importlib

    out: dict[str, list[str]] = {}
    for reg_name, module_path in sources.items():
        mod = importlib.import_module(module_path)
        value = getattr(mod, reg_name)
        if isinstance(value, dict):
            out[reg_name] = sorted(value.keys())
        elif isinstance(value, (list, tuple)):
            out[reg_name] = [getattr(item, "key", str(item)) for item in value]
        else:
            out[reg_name] = []
    return out


def read_bridge_commands() -> list[dict]:
    """Import COMMANDS -- the bridge <-> engine boundary, otherwise invisible."""
    import importlib

    mod = importlib.import_module(ATLAS_SOURCES["registries"]["COMMANDS"])
    commands = getattr(mod, "COMMANDS")
    return [{"name": name, "handler": fn.__name__} for name, fn in commands.items()]


def read_state_events(paths: list[str]) -> list[str]:
    """Every literal first argument of `self.state(...)` under `paths`, by AST.

    A React side listening for an event nobody emits waits forever, in silence.
    """
    events: set[str] = set()
    for py in iter_py_files(paths):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (isinstance(func, ast.Attribute) and func.attr == "state"):
                continue
            if not (isinstance(func.value, ast.Name) and func.value.id == "self"):
                continue
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                events.add(node.args[0].value)
    return sorted(events)


_TS_COMMENT_LINE_RE = re.compile(r"^\s*(//|/\*|\*)")


def _first_ts_comment(text: str) -> str:
    for line in text.splitlines()[:10]:
        s = line.strip()
        if _TS_COMMENT_LINE_RE.match(s):
            cleaned = s.lstrip("/*").strip()
            if cleaned.endswith("*/"):
                cleaned = cleaned[:-2].strip()
            if cleaned:
                return cleaned[:160]
        elif s and not s.startswith("import"):
            break
    return ""


def read_guards(paths: dict) -> list[dict]:
    """For each guard test file: `file` + `forbids`, the first line of its header.

    Guards live under tests/ (Python) and **/__tests__/** (TypeScript). Each
    is expected to open with a header stating what it forbids -- that's
    already how this project's guard tests are written, this just collects it.
    """
    out: list[dict] = []

    for py in sorted((ROOT / "tests").glob("*.py")):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            out.append({"file": rel(py), "forbids": ""})
            continue
        out.append({"file": rel(py), "forbids": _short_doc(tree)})

    for entry in paths["typescript"]:
        root = ROOT / entry
        if not root.exists():
            continue
        for f in sorted(root.rglob("*")):
            if not f.is_file() or f.suffix not in (".ts", ".tsx"):
                continue
            if "__tests__" not in f.relative_to(ROOT).parts:
                continue
            out.append({"file": rel(f), "forbids": _first_ts_comment(f.read_text(encoding="utf-8", errors="ignore"))})

    return out


def _is_trivial_literal(value: object) -> bool:
    """True/False/None/0/1/""/short strings appear everywhere legitimately -- not worth searching for."""
    if isinstance(value, bool) or value is None:
        return True
    if isinstance(value, str):
        return len(value) < 3
    if isinstance(value, (int, float)):
        return value in (0, 1)
    return True  # dict/list/other: not a literal worth searching for


def _collect_literal_occurrences() -> dict[tuple, list[dict]]:
    """Every non-trivial Constant across the Python sources, indexed by (type, value).

    Parsed once and shared by find_hardcoded_config_defaults and find_repeated_literals --
    parsing per config key (177 of them) instead of once made the atlas take ~50s to build,
    which is a real problem for a Stop hook that runs on every session end.
    """
    occurrences: dict[tuple, list[dict]] = defaultdict(list)
    for py in iter_py_files(ATLAS_SOURCES["python"]):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        rp = rel(py)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant):
                continue
            value = node.value
            if _is_trivial_literal(value) or not isinstance(value, (str, int, float)):
                continue
            occurrences[(type(value), value)].append({"file": rp, "line": node.lineno})
    return occurrences


def find_hardcoded_config_defaults(literal_index: dict[tuple, list[dict]]) -> list[dict]:
    """A DEFAULT_CONFIG value written literally elsewhere is a proven duplication, not a guess."""
    sys.path.insert(0, str(ROOT))
    from csdm.config import DEFAULT_CONFIG

    config_file = "csdm/config.py"
    suspects: list[dict] = []
    for key, value in DEFAULT_CONFIG.items():
        if _is_trivial_literal(value) or not isinstance(value, (str, int, float)):
            continue
        for hit in literal_index.get((type(value), value), []):
            if hit["file"] == config_file:
                continue
            suspects.append({
                "file": hit["file"], "line": hit["line"],
                "what": key,
                "why": f"the default value of `{key}` ({value!r}) is rewritten literally here",
            })
    return suspects


def find_repeated_literals(literal_index: dict[tuple, list[dict]]) -> list[dict]:
    """A literal shared across files without a name is a duplication waiting to drift apart."""
    min_files = ATLAS_OPTIONS["repeated_literal_min_files"]
    suspects: list[dict] = []
    for (_, value), hits in literal_index.items():
        files = sorted({h["file"] for h in hits})
        if len(files) < min_files:
            continue
        first = hits[0]
        suspects.append({
            "file": first["file"], "line": first["line"],
            "what": repr(value),
            "why": f"the literal {value!r} appears unnamed in {len(files)} files: {', '.join(files)}",
        })
    return suspects


class _BodyNormalizer(ast.NodeTransformer):
    """Erases local names so two functions that only differ by identifier naming fingerprint identically."""

    def visit_Name(self, node):
        return ast.copy_location(ast.Name(id="_VAR_", ctx=node.ctx), node)

    def visit_arg(self, node):
        node.arg = "_ARG_"
        return node


def _fingerprint_body(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str | None:
    body = list(node.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]  # drop the docstring -- it's prose, not logic
    if len(body) <= ATLAS_OPTIONS["duplicate_body_min_statements"]:
        return None
    normalized = [_BodyNormalizer().visit(copy.deepcopy(stmt)) for stmt in body]
    return ast.dump(ast.Module(body=normalized, type_ignores=[]), annotate_fields=False)


def find_duplicate_bodies() -> list[dict]:
    """Two functions sharing a body fingerprint (names erased, docstring stripped) are one function wearing two names."""
    fingerprints: dict[str, list[dict]] = defaultdict(list)
    for py in iter_py_files(ATLAS_SOURCES["python"]):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        rp = rel(py)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            fp = _fingerprint_body(node)
            if fp is None:
                continue
            fingerprints[fp].append({"file": rp, "line": node.lineno, "name": node.name})

    suspects: list[dict] = []
    for hits in fingerprints.values():
        if len(hits) < 2:
            continue
        first, *rest = hits
        rest_desc = ", ".join(f"{h['name']} ({h['file']}:{h['line']})" for h in rest)
        suspects.append({
            "file": first["file"], "line": first["line"],
            "what": first["name"],
            "why": f"identical body (names erased) shared with: {rest_desc}",
        })
    return suspects


def find_unused_symbols(functions: list[dict], classes: list[dict]) -> list[dict]:
    """Free to compute -- `usages` is already known from the phase-1 walk. Zero means nobody calls it."""
    suspects: list[dict] = []
    for entry in functions + classes:
        name = entry["name"]
        if name in ("main", "__main__") or name.startswith("test_"):
            continue
        if entry.get("usages", 0) != 0:
            continue
        suspects.append({
            "file": entry["file"], "line": entry["line"],
            "what": name,
            "why": f"`{name}` has zero usages outside its own definition",
        })
    return suspects


def find_swallowed_exceptions() -> list[dict]:
    """`except: pass` (or an except with no raise and no log call) hides the failure it caught."""
    suspects: list[dict] = []
    for py in iter_py_files(ATLAS_SOURCES["python"]):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        rp = rel(py)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            body_nodes = [n for stmt in node.body for n in ast.walk(stmt)]
            is_bare_pass = len(node.body) == 1 and isinstance(node.body[0], ast.Pass)
            has_raise = any(isinstance(n, ast.Raise) for n in body_nodes)
            has_log_call = any(
                isinstance(n, ast.Call)
                and (
                    (isinstance(n.func, ast.Attribute) and n.func.attr in ("log", "log_parts"))
                    or (isinstance(n.func, ast.Name) and n.func.id == "log")
                )
                for n in body_nodes
            )
            if is_bare_pass or not (has_raise or has_log_call):
                exc_name = ast.unparse(node.type) if node.type else "bare except"
                suspects.append({
                    "file": rp, "line": node.lineno,
                    "what": exc_name,
                    "why": "except handler neither re-raises nor logs -- the failure is swallowed silently",
                })
    return suspects


def build_atlas() -> dict:
    functions, classes = walk_python(ATLAS_SOURCES["python"])
    ts = walk_typescript(ATLAS_SOURCES["typescript"])
    return {
        "python_functions": functions,
        "python_classes": classes,
        "config_keys": read_config_keys(),
        "react_components": ts["components"],
        "react_hooks": ts["hooks"],
        "react_exports": ts["exports"],
        "mock_css_classes": read_mock_classes(ROOT / ATLAS_SOURCES["mock_css"]),
        "registries": read_registries(ATLAS_SOURCES["registries"]),
        "bridge_commands": read_bridge_commands(),
        "state_events": read_state_events(ATLAS_SOURCES["engine"]),
        "guards": read_guards(ATLAS_SOURCES),
        "principle_checks": build_principle_checks(functions, classes),
    }


def build_principle_checks(functions: list[dict], classes: list[dict]) -> dict:
    literal_index = _collect_literal_occurrences()
    return {
        "hardcoded_config_defaults": find_hardcoded_config_defaults(literal_index),
        "repeated_literals": find_repeated_literals(literal_index),
        "duplicate_bodies": find_duplicate_bodies(),
        "unused_symbols": find_unused_symbols(functions, classes),
        "swallowed_exceptions": find_swallowed_exceptions(),
    }


def render_markdown(atlas: dict) -> str:
    L: list[str] = []
    L.append("# PROJECT_ATLAS -- CSDM Batch Clips Generator")
    L.append("")
    L.append("> GENERATED FILE. DO NOT EDIT BY HAND.")
    L.append("> Regenerate: `python scripts/build_atlas.py`")
    L.append("> Freshness check: `python scripts/build_atlas.py --check`")
    L.append("")
    n = ATLAS_OPTIONS["md_rows_per_table"]

    L.append(f"## Python functions ({len(atlas['python_functions'])})")
    L.append("")
    L.append("| Name | File:line | Signature | Tested |")
    L.append("|---|---|---|---|")
    top = sorted(atlas["python_functions"], key=lambda e: (-e["usages"], e["name"]))[:n]
    for e in top:
        tested = "yes" if e["tested"] else "-"
        sig = e["signature"].replace("|", "\\|")
        L.append(f"| `{e['name']}` | `{e['file']}:{e['line']}` | `{sig}` | {tested} |")
    if len(atlas["python_functions"]) > n:
        L.append("")
        L.append(f"> {len(atlas['python_functions']) - n} more in PROJECT_ATLAS.json")
    L.append("")

    L.append(f"## Python classes ({len(atlas['python_classes'])})")
    L.append("")
    L.append("| Name | File:line | Tested |")
    L.append("|---|---|---|")
    topc = sorted(atlas["python_classes"], key=lambda e: (-e["usages"], e["name"]))[:n]
    for e in topc:
        tested = "yes" if e["tested"] else "-"
        L.append(f"| `{e['name']}` | `{e['file']}:{e['line']}` | {tested} |")
    if len(atlas["python_classes"]) > n:
        L.append("")
        L.append(f"> {len(atlas['python_classes']) - n} more in PROJECT_ATLAS.json")
    L.append("")

    L.append(f"## Config keys ({len(atlas['config_keys'])})")
    L.append("")
    L.append("| Key | Default |")
    L.append("|---|---|")
    for e in atlas["config_keys"][:n]:
        default = repr(e["default"])
        if len(default) > 50:
            default = default[:47] + "..."
        L.append(f"| `{e['name']}` | `{default}` |")
    if len(atlas["config_keys"]) > n:
        L.append("")
        L.append(f"> {len(atlas['config_keys']) - n} more in PROJECT_ATLAS.json")
    L.append("")

    L.append(f"## React components ({len(atlas['react_components'])})")
    L.append("")
    L.append("| Name | File:line | Props |")
    L.append("|---|---|---|")
    for e in atlas["react_components"][:n]:
        props = ", ".join(e["props"]) or "-"
        L.append(f"| `{e['name']}` | `{e['file']}:{e['line']}` | {props} |")
    if len(atlas["react_components"]) > n:
        L.append("")
        L.append(f"> {len(atlas['react_components']) - n} more in PROJECT_ATLAS.json")
    L.append("")

    L.append(f"## React hooks ({len(atlas['react_hooks'])})")
    L.append("")
    L.append("| Name | File:line |")
    L.append("|---|---|")
    for e in atlas["react_hooks"][:n]:
        L.append(f"| `{e['name']}` | `{e['file']}:{e['line']}` |")
    if len(atlas["react_hooks"]) > n:
        L.append("")
        L.append(f"> {len(atlas['react_hooks']) - n} more in PROJECT_ATLAS.json")
    L.append("")

    L.append(f"## Mock CSS classes ({len(atlas['mock_css_classes'])})")
    L.append("")
    L.append("Owned by `theme/mock-v12.css` -- naming an internal class that collides silently inherits its rule (section 10).")
    L.append("")
    L.append(", ".join(f"`{c}`" for c in atlas["mock_css_classes"][:n * 3]))
    if len(atlas["mock_css_classes"]) > n * 3:
        L.append("")
        L.append(f"> {len(atlas['mock_css_classes']) - n * 3} more in PROJECT_ATLAS.json")
    L.append("")

    L.append("## Registries")
    L.append("")
    for reg_name, keys in atlas["registries"].items():
        L.append(f"### {reg_name} ({len(keys)})")
        L.append("")
        L.append(", ".join(f"`{k}`" for k in keys[:n]) or "-")
        if len(keys) > n:
            L.append("")
            L.append(f"> {len(keys) - n} more in PROJECT_ATLAS.json")
        L.append("")

    L.append(f"## Bridge commands ({len(atlas['bridge_commands'])})")
    L.append("")
    L.append("| Command | Handler |")
    L.append("|---|---|")
    for c in atlas["bridge_commands"]:
        L.append(f"| `{c['name']}` | `{c['handler']}` |")
    L.append("")

    L.append(f"## Engine state events ({len(atlas['state_events'])})")
    L.append("")
    L.append(", ".join(f"`{e}`" for e in atlas["state_events"]) or "-")
    L.append("")

    L.append(f"## Guards -- what each test forbids ({len(atlas['guards'])})")
    L.append("")
    L.append("| File | Forbids |")
    L.append("|---|---|")
    for g in atlas["guards"][:n * 3]:
        forbids = g["forbids"].replace("|", "\\|")
        L.append(f"| `{g['file']}` | {forbids} |")
    if len(atlas["guards"]) > n * 3:
        L.append("")
        L.append(f"> {len(atlas['guards']) - n * 3} more in PROJECT_ATLAS.json")
    L.append("")

    L.append("## Principle-1 mechanisable checks")
    L.append("")
    L.append("Suspects, not verdicts -- each is a signal of a possible §1 violation, ranked by how sure the signal is. See context_guide.md §1.")
    L.append("")
    for family, suspects in atlas["principle_checks"].items():
        L.append(f"### {family} ({len(suspects)})")
        L.append("")
        if not suspects:
            L.append("_None found._")
        else:
            L.append("| File:line | What | Why |")
            L.append("|---|---|---|")
            for s in suspects[:n]:
                what = s["what"].replace("|", "\\|")
                why = s["why"].replace("|", "\\|")
                L.append(f"| `{s['file']}:{s['line']}` | `{what}` | {why} |")
            if len(suspects) > n:
                L.append("")
                L.append(f"> {len(suspects) - n} more in PROJECT_ATLAS.json")
        L.append("")

    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate PROJECT_ATLAS.md/.json")
    parser.add_argument("--check", action="store_true", help="Exit 1 if the atlas differs from the repo")
    args = parser.parse_args(argv)

    out_json = ROOT / "PROJECT_ATLAS.json"
    out_md = ROOT / "PROJECT_ATLAS.md"

    atlas = build_atlas()
    js = json.dumps(atlas, ensure_ascii=False, indent=2, sort_keys=False)
    md = render_markdown(atlas)

    if args.check:
        existing_js = out_json.read_text(encoding="utf-8") if out_json.exists() else ""
        existing_md = out_md.read_text(encoding="utf-8") if out_md.exists() else ""
        if existing_js != js or existing_md != md:
            print("PROJECT_ATLAS is stale -- rerun `python scripts/build_atlas.py`.", file=sys.stderr)
            return 1
        print("PROJECT_ATLAS is up to date.")
        return 0

    out_json.write_text(js, encoding="utf-8", newline="\n")
    out_md.write_text(md, encoding="utf-8", newline="\n")
    print(f"PROJECT_ATLAS generated: {rel(out_md)} + {rel(out_json)}")
    print(f"  functions={len(atlas['python_functions'])} classes={len(atlas['python_classes'])} config_keys={len(atlas['config_keys'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
