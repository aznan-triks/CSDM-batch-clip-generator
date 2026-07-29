"""The static tables, shaped for the pipe.

Every list here already exists in `csdm/static_data.py`. This module does not
redefine any of them -- it reshapes them into plain JSON so the renderer can
build its rows from the same source the engine filters on. A table copied into
TypeScript would drift the day someone adds a filter, and the window would then
silently stop showing it.
"""
from csdm.config import PRESET_KEYS
from csdm.static_data import (AUDIO_CODECS, FRAMERATES, KILL_FILTER_REGISTRY,
                              MATCH_TYPE_DEFS, RESOLUTIONS, VIDEO_CODECS,
                              WEAPON_CATEGORIES)


def describe_filters():
    """Every table the Capture and Video tabs need, in one round trip."""
    return {
        "filters": [
            {"key": f.key, "label": f.label, "tip": f.tip,
             "category": f.category, "hidden": bool(f.hide_ui)}
            for f in KILL_FILTER_REGISTRY
        ],
        "match_types": [
            {"key": cfg_key, "label": label}
            for _db_names, cfg_key, label in MATCH_TYPE_DEFS
        ],
        "weapon_categories": {name: list(items)
                              for name, items in WEAPON_CATEGORIES.items()},
        "resolutions": [{"label": label, "width": w, "height": h}
                        for label, w, h in RESOLUTIONS],
        "framerates": list(FRAMERATES),
        "video_codecs": list(VIDEO_CODECS),
        "audio_codecs": list(AUDIO_CODECS),
        # The preset checkbox list (PresetSection) reads its category keys
        # from here rather than retyping PRESET_KEYS in TypeScript -- a copy
        # would drift the day a category is added or renamed (D20 / R1).
        "preset_categories": list(PRESET_KEYS),
    }
