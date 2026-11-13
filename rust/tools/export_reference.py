"""Export the 3.5.x reference tables the Rust rewrite carries as data.

Dev tool only (retired with the Python engine at T13). It imports the real
`csdm` package of the checkout given as first argument, so what it prints is the
3.5 source of truth, never a copy.

    python export_reference.py <repo root>            # print {"settings", "registries"}
    python export_reference.py <repo root> --write    # rewrite csdm-core/data/*.json

The parity tests (csdm-core/tests/parity.rs) run the first form and compare it
with the files embedded in csdm-core: a 3.5 change that is not carried over
fails there.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT))
# dp2_threads' default is computed from the CPU count at import time. Pinned to
# 3.5's own fallback (4) so the table is the same on every machine; the Rust
# engine applies the CPU rule when it builds the live settings.
os.cpu_count = lambda: 4

from csdm import capabilities as caps  # noqa: E402
from csdm import config, static_data as sd  # noqa: E402

# Bridge commands that do not survive in Rust (ticket 07): diagnostics only.
# `set_debug` becomes a trace setting, not a command.
RETIRED_COMMANDS = ("ping", "set_debug", "demo_logs", "demo_ask", "tkinter_check")

TYPE_NAMES = ((bool, "bool"), (int, "int"), (float, "float"), (str, "text"),
              (list, "list"), (dict, "object"))


def type_name(value):
    for py_type, name in TYPE_NAMES:  # bool before int: bool is an int in Python
        if isinstance(value, py_type):
            return name
    raise SystemExit(f"no setting type for {value!r}")


def plain(value):
    """Tuples and sets as JSON lists (sets sorted, so the output is stable)."""
    if isinstance(value, (set, frozenset)):
        return sorted(plain(v) for v in value)
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    return value


def settings():
    owners = {}
    capabilities = []
    for c in caps.CAPABILITIES:
        for key in c.config_keys:
            if key in owners:
                raise SystemExit(f"{key} has two owners: {owners[key]}, {c.id}")
            owners[key] = c.id
        commands = [name for name in c.commands if name not in RETIRED_COMMANDS]
        if not c.config_keys and not commands:
            continue  # only owned retired commands
        capabilities.append({"id": c.id, "intention": c.intention, "label": c.label,
                             "level": c.level, "commands": commands})
    table = []
    for key, default in config.DEFAULT_CONFIG.items():
        if key not in owners:
            raise SystemExit(f"{key} has no owner capability")
        table.append({"key": key, "type": type_name(default), "default": plain(default),
                      "owner": owners[key]})
    return {
        "settings": table,
        "capabilities": capabilities,
        "intentions": plain(caps.INTENTIONS),
        "levels": plain(caps.LEVELS),
        "ui_sections_version": config.UI_SECTIONS_VERSION,
        "presets": {
            "categories": config.PRESET_CATEGORIES,
            "keys": config.PRESET_KEYS,
            "tab_groups": plain(config._PRESET_TAB_GROUPS),
            "excluded_keys": plain(config.PRESET_EXCLUDED_KEYS),
            "excluded_prefixes": plain(config.PRESET_EXCLUDED_PREFIXES),
        },
    }


def registries():
    return {
        "kill_filters": [plain(f._asdict()) for f in sd.KILL_FILTER_REGISTRY],
        "no_auto_exclude": plain(sd._NO_AUTO_EXCLUDE),
        "match_types": [{"db_values": db, "key": key, "label": label, "tip": tip}
                        for db, key, label, tip in sd.MATCH_TYPE_DEFS],
        "weapon_categories": plain(sd.WEAPON_CATEGORIES),
        "weapon_category_tips": sd.WEAPON_CATEGORY_TIPS,
        "weapon_icons": sd.WEAPON_ICONS,
        "weapon_lookup": sd._WEAPON_LOOKUP,
        "weapon_substring_fallback": plain(sd._WEAPON_SUBSTR_FALLBACK),
        "gun_weapons": plain(sd.GUN_WEAPONS_LOWER),
        "video_codecs": sd.VIDEO_CODECS_INFO,
        "cpu_video_codecs": plain(sd.CPU_VIDEO_CODECS),
        "audio_codecs": sd.AUDIO_CODECS_INFO,
        "resolutions": [{"label": label, "width": w, "height": h} for label, w, h in sd.RESOLUTIONS],
        "framerates": sd.FRAMERATES,
        "perspective_labels": sd.PERSP_LABELS,
    }


def main():
    out = {"settings": settings(), "registries": registries()}
    if "--write" not in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")  # labels carry emoji; the console code page cannot
        json.dump(out, sys.stdout, ensure_ascii=False)
        return
    data = Path(__file__).resolve().parent.parent / "csdm-core" / "data"
    for name, value in out.items():
        text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
        (data / f"{name}.json").write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
