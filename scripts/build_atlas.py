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
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ATLAS_SOURCES = {
    "python": ["csdm", "csdm_batch_clips_generator.py"],
    "python_tests": ["tests"],
    "typescript": ["electron/renderer/src"],
    "mock_css": "electron/renderer/src/theme/mock-v12.css",
    "registries": {
        "KILL_FILTER_REGISTRY": "csdm.static_data",
        "COMMANDS": "csdm.bridge.host",
    },
}

ATLAS_OPTIONS = {
    "md_rows_per_table": 40,  # the .md is a summary; the .json is exhaustive
    "skip_dirs": {"__pycache__", "node_modules", "dist", "dist-app", ".venv"},
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


def build_atlas() -> dict:
    functions, classes = walk_python(ATLAS_SOURCES["python"])
    return {
        "python_functions": functions,
        "python_classes": classes,
        "config_keys": read_config_keys(),
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
