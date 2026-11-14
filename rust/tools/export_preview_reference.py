"""Export the 3.5.x tables and fixed values the Rust preview engine carries as data.

Dev tool only (retired with the Python engine at T13). Same contract as
`export_reference.py`: it imports the real `csdm` package of the checkout given
as first argument and prints what 3.5 holds, never a copy.

    python export_preview_reference.py <repo root>            # print the JSON
    python export_preview_reference.py <repo root> --write    # rewrite csdm-core/data/preview.json

Module-level tables are read as they are. Values that 3.5 keeps inside a method
body (the ECO weapon lists, the FERRARI PEEK windows...) are read from that
method's source with `ast`, never retyped. Per-filter behaviour that 3.5 spreads
over several methods (demo sections, positions, group and column rules) is
probed by calling those methods with one filter switched on at a time.
`csdm-core/tests/preview_parity.rs` runs the first form and compares.
"""
import ast
import inspect
import json
import os
import sys
import textwrap
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT))
os.cpu_count = lambda: 4  # same pin as export_reference.py (dp2_threads default)

from csdm import static_data as sd  # noqa: E402
from csdm.engine import core  # noqa: E402
from csdm.engine import preview_export as pe  # noqa: E402

E = core.EngineMixin


def plain(value):
    if isinstance(value, (set, frozenset)):
        return sorted(plain(v) for v in value)
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    return value


def method_locals(method, names):
    """Literal values assigned to `names` inside `method`'s body."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(method)))
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in names:
                found[name] = plain(ast.literal_eval(node.value))
    missing = [n for n in names if n not in found]
    if missing:
        raise SystemExit(f"{method.__qualname__}: no literal for {missing}")
    return found


def filter_behaviour():
    """What 3.5 does with each registry key, one key switched on at a time."""
    out = {}
    for f in sd.KILL_FILTER_REGISTRY:
        k = f.key
        on, excl = {k: True}, {f"{k}_exclude": True}
        nonkill = {"_events_non_lethal": True, "_events_other": True}
        out[k] = {
            "dp2_sections": plain(E._dp2_required_sections(on)),
            "dp2_sections_exclude": plain(E._dp2_required_sections(excl)),
            "dp2_sections_nonkill": plain(E._dp2_required_sections({**on, **nonkill})),
            "needs_positions": E._modifier_needs_positions(k),
            "event_rule": k in E._EVENT_RULES,
            "group_rule": k in E._GROUP_RULES,
            "never_matching": k in E._NEVER_MATCHING_FILTERS,
            "sql_mod": k in sd.KILL_FILTER_SQL_COLS,
            "auto_exclude": k not in sd._NO_AUTO_EXCLUDE and not f.hide_ui,
        }
    return out


def tables():
    stages = [{"label": label, "neutral": plain(neutral)} for label, neutral in E._EMPTY_RESULT_QUERY_STAGES]
    return {
        "trois_shot_thresholds": plain(sd.TROIS_SHOT_THRESHOLDS),
        "csdm_to_dp2_weapon": plain(sd.CSDM_TO_DP2_WEAPON),
        "dp2_tick_window": sd.DP2_TICK_WINDOW,
        "spray_transfer_weapons": plain(sd.SPRAY_TRANSFER_WEAPONS_LOWER),
        "spray_max_gap_ticks": sd.SPRAY_MAX_GAP_TICKS,
        "delayed_effect_weapons": plain(sd.DELAYED_EFFECT_WEAPONS),
        "suicide_weapons": plain(sd.SUICIDE_WEAPONS),
        "damage_hitgroups": plain(sd.DAMAGE_HITGROUPS),
        "map_name_prefixes": plain(core.MAP_NAME_PREFIXES),
        "cs2_demo_breaks": [{"cutoff": d.strftime("%Y-%m-%d"), "label": label, "tip": tip}
                            for d, label, tip in core._CS2_DEMO_BREAKS],
        "event_categories": plain(E._EVENT_CATEGORIES),
        "fixed_filter_logic_keys": plain(E._FIXED_FILTER_LOGIC_KEYS),
        "empty_result": {"stages": stages, "base_label": E._EMPTY_RESULT_BASE_LABEL,
                         "rest_label": E._EMPTY_RESULT_REST_LABEL},
        "mate_pov": {
            "eye_height": E._MATE_POV_EYE_HEIGHT, "fov_half_deg": E._MATE_POV_FOV_HALF_DEG,
            "max_dist": E._MATE_POV_MAX_DIST, "min_dist": E._MATE_POV_MIN_DIST,
            "max_z_delta": E._MATE_POV_MAX_Z_DELTA, "max_elevation": E._MATE_POV_MAX_ELEVATION,
            "sid_tolerance": E._DP2_SID_TOLERANCE,
        },
        "tick_match_window": E._TICK_MATCH_WINDOW,
        "clutch_cols": plain(E._CLUTCH_COLS),
        "export": {"formats": plain(pe.PREVIEW_EXPORT_FORMATS), "txt_columns": plain(pe.TXT_COLUMNS),
                   "txt_headers": plain(pe.TXT_HEADERS)},
        "db_postfilters": method_locals(E._apply_db_postfilters, ["PISTOLS", "FULL_BUY"]),
        "high_velocity": method_locals(E._high_velocity_filter,
                                       ["RESUME_THR", "PRE_WINDOW", "APPROACH_WIN", "RESUME_WIN", "SHOT_WINDOW"]),
        "flick": method_locals(E._flick_filter, ["LOOK_BACK"]),
        "savior": method_locals(E._savior_filter, ["SAVIOR_WINDOW"]),
        "filters": filter_behaviour(),
    }


def main():
    out = tables()
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    if "--write" in sys.argv:
        target = Path(__file__).resolve().parent.parent / "csdm-core" / "data" / "preview.json"
        target.write_text(text, encoding="utf-8", newline="\n")
        return
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
