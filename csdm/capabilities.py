"""The capability registry -- what a user can do, filed by what they want.

Menus today follow the history of the code (Capture / Video / Settings). A
user asks questions in another order: who, which demos, which moments, how to
film, what render, check, run, organise, reuse. Each capability below owns the
settings and the bridge commands that answer one such need, and each belongs to
exactly one intention. A future menu is an ordered list of capability ids; it
never needs to know a config key.

Same discipline as KILL_FILTER_REGISTRY: nothing that already exists as a table
is retyped here. Kill-filter and match-type capabilities are GENERATED from
their registries, so a filter added there has its capability without an edit
here. `tests/test_capabilities.py` fails the day a setting or a command has no
owner, or two.

Pure data: imports only `csdm.static_data`, never the config, the bridge or the
engine, so anything can read it without an import cycle.
"""

from typing import NamedTuple, Tuple as _Tuple

from csdm.static_data import (_FILTER_CONFIG_DEFAULTS, KILL_FILTER_REGISTRY,
                              MATCH_TYPE_DEFS)


class Capability(NamedTuple):
    id:          str
    intention:   str                # a code from INTENTIONS
    label:       str
    config_keys: _Tuple[str, ...] = ()
    commands:    _Tuple[str, ...] = ()


# Ordered as the user meets them, not as the tabs present them.
INTENTIONS: _Tuple[_Tuple[str, str], ...] = (
    ("I1",  "Set up the tool"),
    ("I2",  "Choose who"),
    ("I3",  "Choose which demos"),
    ("I4",  "Choose which moments"),
    ("I5",  "Choose how to film"),
    ("I6",  "Make the batch reliable"),
    ("I7",  "Tune the video render"),
    ("I8",  "Check before running"),
    ("I9",  "Run and control"),
    ("I10", "Organise with tags"),
    ("I11", "Save and reuse"),
    ("I12", "Monitor"),
    ("I13", "Personalise the window"),
    ("I14", "Diagnose"),
)


_HAND_WRITTEN: list = []


def _derived_filter_capabilities() -> list:
    """One capability per kill filter, owning every key the registry generated.

    The filter's own key comes first: it names the capability. A filter that
    supplies a camera (`camera_fn`) decides how the clip is filmed, so it is
    filed under I5; every other filter narrows which moments are kept (I4).
    """
    capabilities = []
    for f in KILL_FILTER_REGISTRY:
        generated = [k for k in (f.key, f"{f.key}_req", f"{f.key}_exclude")
                     if k in _FILTER_CONFIG_DEFAULTS]
        extra = [k for k in (f.extra_config or {}) if k not in generated]
        capabilities.append(Capability(
            id="kill_filter_" + f.key.removeprefix("kill_mod_"),
            intention="I5" if f.camera_fn else "I4",
            label=f.badge,
            config_keys=tuple(generated + extra),
        ))
    return capabilities


def _derived_match_type_capability() -> Capability:
    """Filtering by match type is one need: the master switch and every box."""
    return Capability(
        id="match_type_filter",
        intention="I3",
        label="Match type filter",
        config_keys=("match_type_filter_enabled",
                     *(cfg_key for _db, cfg_key, _label, _tip in MATCH_TYPE_DEFS)),
    )


CAPABILITIES: list = [
    *_HAND_WRITTEN,
    _derived_match_type_capability(),
    *_derived_filter_capabilities(),
]
