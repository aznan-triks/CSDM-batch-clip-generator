"""Configuration: defaults, presets and persistence (Phase 1.1).

Extracted from the entry point. Holds DEFAULT_CONFIG, the preset groups, and
the functions that read and write the local JSON files.

The paths point at the project ROOT -- beside the entry point -- not at the
csdm/ package directory.
"""
import os
import json
import shutil
import time
from pathlib import Path

from csdm.static_data import (
    _FILTER_CONFIG_DEFAULTS, _FILTER_PRESET_PLAYER_KEYS, MATCH_TYPE_DEFS,
)

# The project root is the parent of the csdm/ package -- where the local data
# files live (csdm_config.json, ...), beside the entry point.
def _repo_root():
    """The project root the config files anchor on.

    CSDM_REPO_ROOT wins -- the same override electron/main.js honours when the
    portable exe is kept somewhere else entirely. The fallback is the package
    location, which is the real project root in every supported launch mode
    (the engine is never packaged inside the exe, so ``__file__`` never points
    at a temp extraction).
    """
    override = os.environ.get("CSDM_REPO_ROOT")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent


_ROOT = _repo_root()

# Where the four JSON files live, and how `config_dir` selects it:
#   ""        -> <script root>/<CONFIG_SUBDIR>          (default)
#   "appdata" -> %LOCALAPPDATA%/<CONFIG_SUBDIR>
#   "<path>"  -> <path>/<CONFIG_SUBDIR>                 (subfolder created inside)
# The same subfolder name is used everywhere so one constant drives all three.
CONFIG_SUBDIR = "CSDM-batch-clip_config"
# The pre-3.1.1 subfolder name, kept only to migrate existing installs.
LEGACY_CONFIG_SUBDIR = "CSDM Batch Clip Generator"
CONFIG_FILENAMES = ("csdm_config.json", "csdm_presets.json",
                    "csdm_players.json", "csdm_asm_names.json")

# Default-location paths, kept for the legacy Tkinter host import
# (`csdm_batch_clips_generator.py`). Active-location reads/writes go through
# the dynamic helpers below, never these constants.
CONFIG_FILE    = str(_ROOT / CONFIG_SUBDIR / "csdm_config.json")
PRESETS_FILE   = str(_ROOT / CONFIG_SUBDIR / "csdm_presets.json")
PLAYERS_FILE   = str(_ROOT / CONFIG_SUBDIR / "csdm_players.json")
ASM_NAMES_FILE = str(_ROOT / CONFIG_SUBDIR / "csdm_asm_names.json")

DEFAULT_CONFIG = {
    "pg_host": "127.0.0.1", "pg_port": "5432",
    "pg_user": "postgres", "pg_pass": "", "pg_db": "csdm",
    "csdm_exe": r"C:\Users\Trois\AppData\Local\Programs\cs-demo-manager\csdm.CMD",
    "output_dir": r"H:\CS\CSVideos\Raws",
    "output_dir_clips":    r"H:\CS\CSVideos\Raws",   # raw clips per demo
    "output_dir_concat":   "",   # concatenated clips (empty = same as raw)
    "output_dir_assembled": "",  # final assembled file (empty = same as raw)
    "cs2_cfg_dir": "",
    "config_dir": "",  # "" = script subfolder | "appdata" = %LOCALAPPDATA% | absolute path (subfolder created inside)
    "ui_window_w": 1600,
    "ui_window_h": 900,
    "ui_split_pct": 60,
    "ui_remember_layout": True,
    # Reference card layout (LAYOUT_VERSION 4, sectionLayout.ts), redesigned
    # 2026-09-17 for the real column count a 1600x900 window measures today
    # (15 columns of `ui_card_block_size`, content pane ~902px), and again
    # same day for per-card HEIGHT: a flat 24 rows for every card (the first
    # pass) is roughly what a form-heavy card like Paths needs but wildly
    # oversized for a short one like Performance (one slider), which is why
    # every tab still scrolled far past its real content. Heights below are
    # each card's real content height measured live (real engine, real
    # window, `.sb-scroll` intrinsic height with its flex-grow shrunk to 1px
    # so it can't mask short content as full-height), rounded up with margin
    # -- generous margin on cards whose content depends on a live DB
    # connection (weapon-filter, map-filter, resolution, kill-filters),
    # since that measurement ran without one and would otherwise understate
    # the real thing. The previous snapshot (v3, captured 2026-08-11) was
    # sized for the pre-3.3.0 8-column grid; left as-is post-halving it
    # rendered each non-wide card at half the pane width with a wide empty
    # gap beside it (measured live, e2e/default-window-proof.mjs
    # screenshots). This one packs non-wide cards two or three to a row so
    # the reference layout actually fills 1600x900 both ways.
    "ui_sections": {
        "capture": {
            "v": 4,
            "cards": {
                "player": {"x": 0, "y": 0, "w": 15, "h": 14},
                "demo-selection": {"x": 0, "y": 14, "w": 5, "h": 19},
                "capture-timing": {"x": 5, "y": 14, "w": 5, "h": 14},
                "timing-retries": {"x": 10, "y": 14, "w": 5, "h": 9},
                "weapon-filter": {"x": 0, "y": 33, "w": 15, "h": 17},
                "kill-filters": {"x": 0, "y": 50, "w": 10, "h": 39},
                "match-types": {"x": 10, "y": 50, "w": 5, "h": 13},
                "map-filter": {"x": 10, "y": 63, "w": 5, "h": 10},
            },
            "collapsed": [],
        },
        "video": {
            "v": 4,
            "cards": {
                "final-assembly": {"x": 0, "y": 0, "w": 7, "h": 8},
                "recording-system": {"x": 7, "y": 0, "w": 8, "h": 7},
                "resolution": {"x": 0, "y": 8, "w": 15, "h": 14},
                "hlae-options": {"x": 0, "y": 22, "w": 7, "h": 13},
                "in-game-options": {"x": 7, "y": 22, "w": 8, "h": 9},
                "cs2-effects": {"x": 0, "y": 35, "w": 15, "h": 13},
                "encoding": {"x": 0, "y": 48, "w": 15, "h": 12},
            },
            "collapsed": [],
        },
        "settings": {
            "v": 4,
            "cards": {
                "postgresql": {"x": 0, "y": 0, "w": 15, "h": 6},
                "paths": {"x": 0, "y": 6, "w": 15, "h": 14},
                "config-folder": {"x": 0, "y": 20, "w": 15, "h": 7},
                "presets": {"x": 0, "y": 27, "w": 5, "h": 12},
                "ui-theme": {"x": 5, "y": 27, "w": 5, "h": 10},
                "ui-layout": {"x": 10, "y": 27, "w": 5, "h": 11},
                "performance": {"x": 0, "y": 39, "w": 7, "h": 6},
                "injection-preview": {"x": 7, "y": 39, "w": 8, "h": 7},
            },
            "collapsed": [],
        },
    },
    "theme_bg": "dark",      # background preset: dark | amoled | deepblue | white
    "theme_accent": "green", # accent preset or custom hex: green | blue | orange | purple | red | cyan | pink | yellow | #rrggbb
    "ui_font_family": "auto", # "auto" = first available of UI_FONT_STACK; or a forced name (e.g. "JetBrains Mono")
    "steam_id": "", "player_name": "", "player_name_override": "",
    "saved_players": [],
    "steam_ids": [],          # every active player; steam_id mirrors the first one
    # Event model (2-axis: Actor/Target × Lethal/Non-lethal/Other)
    "event_actor": True,      # Actor perspective — I am the one acting
    "event_target": False,    # Target perspective — I am the one acted upon
    "event_lethal": True,     # Include lethal events (kills & deaths)
    "event_ally": False,      # Include ally-on-ally / ally-on-me events
    "event_enemy": True,      # Include enemy-on-me / me-on-enemy events
    "event_non_lethal": False,  # Include non-lethal damage events
    "event_other": False,     # Include "other" events (shots, jumps, grenade misses)
    "events": [],             # ["Rounds"] when full-round clips are on (legacy list name)
    # Derived booleans (set by build_run_cfg, NOT stored):
    #   events_lethal, events_non_lethal, events_other
    "weapons": [],
    "date_from": "", "date_to": "",
    "before": 3, "after": 5,
    "encoder": "FFmpeg", "recsys": "HLAE",
    "tickrate": 64,
    "use_config_file_mode": True, "close_game_after": True,
    "subfolder_per_demo": True,
    "width": 1920, "height": 1080, "framerate": 60,
    "crf": 18, "video_codec": "libx264", "audio_codec": "libmp3lame",
    "audio_bitrate": 256, "video_container": "mp4",
    "ffmpeg_input_params": "", "ffmpeg_output_params": "",
    "death_notices_duration": 5, "show_only_death_notices": True,
    "concatenate_sequences": False, "true_view": True,
    "tag_on_export": "", "tag_enabled": False,
    "ui_active_tags": [],
    # Width of ONE grid column, in pixels. Halved from 96 in 3.3.0: a card can
    # only be a whole number of columns wide, so the column size IS the list of
    # widths a card can have. At 96px a normal content pane offered eight or
    # nine of them and nothing between "a third" and "a half"; at 48px it
    # offers twice as many, at the same smallest size the eye can still read as
    # a card (two columns). Stored layouts are rescaled by
    # `_migrate_card_grid_half_step` so nothing moves the first time.
    "ui_card_block_size": 48,
    # Fine row height of the card grid, in pixels. Cards resize vertically by
    # this step, so it decides how free the height feels: one quarter of a
    # block (96 / 4) reads as free without losing alignment.
    "ui_card_row_height": 24,
    # Height of a COLLAPSED card, in fine grid rows. Two rows (2*24 + 10 gap
    # = 58px) clears the 54px header without leaving a visible margin under
    # it. Raise it if the header ever grows a second line.
    "ui_card_collapsed_rows": 2,
    "retry_count": 2, "retry_delay": 15, "delay_between_demos": 3,
    "recording_timeout": 0,   # minutes; 0 = disabled (kill CS2 + retry if exceeded)
    # Final assembly of all clips after batch
    "assemble_after": False,      # concatenate all clips after batch
    "delete_after_assemble": False,  # delete source clips after assembly
    "assemble_output": "assembled.mp4",
    # Perspective / POV
    "perspective": "killer",   # "killer" | "victim" | "both"
    # In victim/both mode: duration (s) to follow killer before switching to victim
    "victim_pre_s": 2,
    # Clip recording order
    "clip_order": "chrono",    # "chrono" | "random"
    # Headshot filter — independent of kill-mod logic
    # "all" = include all kills  |  "only" = headshots only  |  "exclude" = non-headshots only
    "headshots_mode": "all",
    "teamkills_mode": "include",
    "suicides_mode": "include",  # "include" | "exclude" | "only"
    # Kill modifiers — auto-populated from KILL_FILTER_REGISTRY
    # Logic mode keys kept for backward compat
    "kill_mod_logic_mods": "mixed",
    "kill_mod_logic_dp2":  "mixed",
    "kill_mod_logic_db":   "mixed",
    # All filter enable/req/extra_config keys are injected below at startup
    **_FILTER_CONFIG_DEFAULTS,
        # Clutch — player is last alive on his team, facing ≥1 opponent(s)
    "clutch_enabled":   False,   # master toggle
    "clutch_wins_only": False,   # only keep rounds the player won
    "clutch_mode":      "kills_only",  # "kills_only" | "full_clutch"
    # 1vX size filter — which opponent counts are included (all False = all sizes)
    "clutch_1v1": False,
    "clutch_1v2": False,
    "clutch_1v3": False,
    "clutch_1v4": False,
    "clutch_1v5": False,
    # Match type filter — all False = include every type (no filter applied)
    # Populated dynamically from MATCH_TYPE_DEFS; all default False
    **{cfg_k: False for _, cfg_k, _, _ in MATCH_TYPE_DEFS},
    # When True, *only* checked types pass; when False, all types pass (no filter).
    "match_type_filter_enabled": False,
    "map_filter_enabled": False,
    "map_filter": [],          # list of display-key strings (stripped prefix, lowercased)
    # Sequence options
    "show_xray": True,
    # Encoding preset (libx264/libx265/libsvtav1 only — no effect on GPU)
    "video_preset": "medium",
    # HLAE options (used when recsys == "HLAE")
    "hlae_fov": 90,
    "hlae_slow_motion": 100,   # game speed multiplier in % (100 = normal, 200 = 2x)
    "hlae_afx_stream": False,  # record separate HLAE AFX streams
    "hlae_no_spectator_ui": True,
    "hlae_fix_scope_fov": True,   # mirv_fov handleZoom enabled 1 — fixes scope FOV zoom override
    "hlae_extra_args": "",

    # CS2 physics (injected as console commands via extraArgs)
    "phys_ragdoll_gravity": 600,       # cl_ragdoll_gravity (default 600, negative = float)
    "phys_ragdoll_scale": 1.0,         # ragdoll_gravity_scale (default 1.0)
    "phys_ragdoll_enable": True,       # cl_ragdoll_physics_enable
    "phys_sv_gravity": 800,            # sv_gravity (default 800)
    "phys_blood": True,                # violence_hblood
    "phys_dynamic_lighting": True,     # r_dynamic
    # CS2 window mode injected as Launch Option
    "cs2_window_mode": "none",   # "none" | "fullscreen" | "windowed" | "noborder"
    # Send CS2 behind all windows on launch (requires pywin32)
    "cs2_send_to_back": False,
    # demoparser2 performance
    "dp2_threads": min(8, max(2, os.cpu_count() or 4)),  # auto-scaled to CPU count (1–8)

    # How long to wait for a killed process to actually disappear, and how
    # often to look. The UI detonates its charge on the real exit, never on a
    # timer, so these govern a real observation and not an animation.
    "process_exit_poll_interval": 0.5,
    "process_exit_timeout": 60.0,
    "cs2_process_name": "cs2.exe",
}

PRESET_CATEGORIES = {
    "full": "All (full config)",
    "player": "Player + events + weapons",
    "video": "Video/encoding settings",
    "timing": "Timing + robustness",
}
PRESET_KEYS = {
    "full":        None,
    # ── Capture group ──────────────────────────────────────────────────────────
    "players":     ["steam_id", "steam_ids", "player_name", "player_name_override"],
    "date":        ["date_from", "date_to"],
    "filters":     ["event_actor", "event_target", "event_lethal", "event_ally", "event_enemy",
                    "event_non_lethal", "event_other", "events",
                    "weapons", "perspective", "victim_pre_s",
                    "headshots_mode", "suicides_mode", "teamkills_mode",
                    "kill_mod_logic_mods", "kill_mod_logic_dp2", "kill_mod_logic_db",
                    *_FILTER_PRESET_PLAYER_KEYS,
                    "clip_order", "show_xray",
                    "clutch_enabled", "clutch_wins_only", "clutch_mode",
                    "clutch_1v1", "clutch_1v2", "clutch_1v3", "clutch_1v4", "clutch_1v5",
                    "map_filter_enabled", "map_filter"],
    # ── Video group ────────────────────────────────────────────────────────────
    "mode":        ["recsys", "encoder"],
    "output_name": ["assemble_output", "output_dir_clips", "output_dir_concat",
                    "output_dir_assembled"],
    "encoding":    ["width", "height", "framerate", "crf", "video_codec", "video_preset",
                    "audio_codec", "audio_bitrate", "video_container",
                    "ffmpeg_input_params", "ffmpeg_output_params",
                    "death_notices_duration", "show_only_death_notices",
                    "concatenate_sequences", "subfolder_per_demo", "true_view"],
    "hlae_opts":   ["hlae_fov", "hlae_slow_motion", "hlae_afx_stream",
                    "hlae_no_spectator_ui", "hlae_fix_scope_fov",
                    "hlae_extra_args"],
    "physics":     ["phys_ragdoll_gravity", "phys_ragdoll_scale", "phys_ragdoll_enable",
                    "phys_sv_gravity", "phys_blood", "phys_dynamic_lighting"],
    # ── Timing group ───────────────────────────────────────────────────────────
    "timing":      ["before", "after", "close_game_after",
                    "retry_count", "retry_delay", "delay_between_demos", "recording_timeout"],
    # ── Backward-compat aliases (old format → new granular keys) ───────────────
    "player":      ["steam_id", "steam_ids", "player_name", "event_actor", "event_target",
                    "event_lethal", "event_ally", "event_enemy", "event_non_lethal", "event_other", "events",
                    "weapons", "date_from", "date_to",
                    "perspective", "victim_pre_s", "headshots_mode", "suicides_mode",
                    "teamkills_mode", "kill_mod_logic_mods", "kill_mod_logic_dp2",
                    "kill_mod_logic_db", *_FILTER_PRESET_PLAYER_KEYS, "clip_order",
                    "show_xray", "clutch_enabled", "clutch_wins_only", "clutch_mode",
                    "clutch_1v1", "clutch_1v2", "clutch_1v3", "clutch_1v4", "clutch_1v5"],
    "video":       ["encoder", "recsys", "width", "height", "framerate",
                    "crf", "video_codec", "video_preset", "audio_codec", "audio_bitrate",
                    "video_container", "ffmpeg_input_params", "ffmpeg_output_params",
                    "death_notices_duration", "show_only_death_notices",
                    "concatenate_sequences", "subfolder_per_demo", "true_view",
                    "hlae_fov", "hlae_slow_motion", "hlae_afx_stream",
                    "hlae_no_spectator_ui", "hlae_fix_scope_fov",
                    "hlae_extra_args",
                    "phys_ragdoll_gravity", "phys_ragdoll_scale", "phys_ragdoll_enable",
                    "phys_sv_gravity", "phys_blood", "phys_dynamic_lighting"],
}

# Canonical new categories (used by the UI tab selector)
_PRESET_TAB_GROUPS = [
    ("CAPTURE", [
        ("players",  "Active players"),
        ("date",     "Date range"),
        ("filters",  "Filters"),
    ]),
    ("VIDEO", [
        ("mode",        "Mode  (HLAE / CS)"),
        ("output_name", "Output name"),
        ("encoding",    "Encoding"),
        ("hlae_opts",   "HLAE options"),
        ("physics",     "Physics"),
    ]),
    ("TIMING", [
        ("timing", "Timing & retry"),
    ]),
]
_PRESET_ALL_CATS = [k for _, items in _PRESET_TAB_GROUPS for k, _ in items]

# ═══════════════════════════════════════════════════════
#  Config location (v3.0.1)
# ═══════════════════════════════════════════════════════
def _app_data_dir():
    """The per-user Local AppData folder (Windows), with a portable fallback."""
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local)
    return Path.home() / "AppData" / "Local"


def resolve_config_dir(value):
    """Resolve a `config_dir` setting to the directory holding the JSON files.

    ``""`` keeps the default script subfolder, ``"appdata"`` moves to the
    user's Local AppData, and any other string is a parent directory under
    which the same subfolder is created.
    """
    if not value:
        return _ROOT / CONFIG_SUBDIR
    if value == "appdata":
        return _app_data_dir() / CONFIG_SUBDIR
    return Path(value) / CONFIG_SUBDIR


def _default_dir():
    """The default location: a subfolder of the script root."""
    return _ROOT / CONFIG_SUBDIR


def _migrate_legacy_root_files():
    """Copy the pre-3.0.1 flat files (beside the entry point) into the default
    subfolder, once, when the subfolder has no config yet.

    Copy, never move: the legacy files stay where they were -- same rule as
    the user-chosen switches.
    """
    default_dir = _default_dir()
    if (default_dir / "csdm_config.json").exists():
        return
    try:
        default_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    for name in CONFIG_FILENAMES:
        src = _ROOT / name
        if src.exists():
            try:
                shutil.copy2(src, default_dir / name)
            except OSError:
                pass


def _pointer_config_dir():
    """`config_dir` as recorded by the default-location config file.

    That file is the bootstrap pointer: wherever the live configuration went,
    the default copy keeps the location so the next launch can find it. The
    pre-rename folder is consulted when the new-name copy does not exist yet,
    so a location chosen before 3.1.1 survives the subfolder rename.
    """
    for base in (_default_dir(), _ROOT / LEGACY_CONFIG_SUBDIR):
        saved = _load_json(str(base / "csdm_config.json"))
        if isinstance(saved, dict) and "config_dir" in saved:
            return saved["config_dir"]
    return ""


def _migrate_legacy_subdir_name():
    """Copy the pre-3.1.1 subfolder into the new name, once, when the new
    subfolder has no config yet.

    Copy, never move: the old folder stays intact -- same rule as every
    user-chosen switch. The default and AppData locations are always covered;
    a custom location is covered through the recorded pointer.
    """
    parents = [_ROOT, _app_data_dir()]
    pointer = _pointer_config_dir()
    if pointer and pointer not in ("", "appdata"):
        parents.append(Path(pointer))
    for parent in parents:
        new_dir = parent / CONFIG_SUBDIR
        if (new_dir / "csdm_config.json").exists():
            continue
        old_dir = parent / LEGACY_CONFIG_SUBDIR
        if not (old_dir / "csdm_config.json").exists():
            continue
        try:
            new_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        for name in CONFIG_FILENAMES:
            src = old_dir / name
            if src.exists():
                try:
                    shutil.copy2(src, new_dir / name)
                except OSError:
                    pass


def _bootstrap_dir():
    """The active directory, resolved from the pointer, with a safe fallback.

    If the pointed-to location no longer has a config file (folder deleted,
    drive unplugged), fall back to the default subfolder rather than handing
    the app an empty configuration.
    """
    default_dir = _default_dir()
    target = resolve_config_dir(_pointer_config_dir())
    if target != default_dir and not (target / "csdm_config.json").exists():
        return default_dir
    return target


_ACTIVE_DIR = None  # resolved once; loaders/savers below all agree on it


def _file_dir():
    """The active config directory, bootstrapped on first use."""
    global _ACTIVE_DIR
    if _ACTIVE_DIR is None:
        _migrate_legacy_subdir_name()
        _migrate_legacy_root_files()
        _ACTIVE_DIR = _bootstrap_dir()
    return _ACTIVE_DIR


# ═══════════════════════════════════════════════════════
#  Persistence
# ═══════════════════════════════════════════════════════
def _load_json(path, default_factory=dict):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
    return default_factory()

def _save_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except OSError:
        pass

def load_presets():
    return _load_json(str(_file_dir() / "csdm_presets.json"))

def save_presets(presets):
    _save_json(str(_file_dir() / "csdm_presets.json"), presets)


def preset_keys_for(cats):
    """Return the config keys a preset of these categories covers.

    None means "every key". The `full` category is not a key list, it is the
    whole configuration: expanding it into names would freeze today's key set
    into every preset saved from now on.
    """
    if "full" in cats:
        return None
    keys = []
    for cat in cats:
        for k in (PRESET_KEYS.get(cat) or []):
            if k not in keys:
                keys.append(k)
    return keys


def build_preset(cfg, cats, selected_clips=None):
    """Extract from `cfg` the preset the user asked to save.

    selected_clips: optional list of {demo_path, start_tick} dicts — the
    user's clip selection from the editing page, stored alongside the config.
    """
    keys = preset_keys_for(cats)
    preset = {"cats": ["full"], "data": dict(cfg)} if keys is None \
        else {"cats": list(cats), "data": {k: cfg[k] for k in keys if k in cfg}}
    if selected_clips:
        preset["selected_clips"] = selected_clips
    return preset


def preset_cats(preset):
    """A stored preset's categories, old format or new.

    Old presets carry {"type": "..."}, new ones {"cats": [...]}.
    """
    return preset.get("cats") or [preset.get("type", "full")]


def preset_payload(preset):
    """Return `(data, keys, selected_clips)` for a stored preset.

    `keys` is None for a full preset, which is exactly what
    `_apply_config(cfg, keys=None)` expects. Otherwise it lists only the keys
    the preset really stored: a category that gained a key after the preset
    was saved must not overwrite the user's current value with nothing.
    A preset saved before `steam_ids` existed gets it from its `steam_id`,
    or loading it would change the name and not the player (audit E8).
    `selected_clips` is None when the preset has no clip selection
    (saved before editing support, or intentionally omitted).
    """
    data = dict(preset.get("data", {}))
    if "steam_id" in data and "steam_ids" not in data:
        data["steam_ids"] = [data["steam_id"]] if data["steam_id"] else []
    if ("event_ally" not in data and "event_enemy" not in data
            and data.get("teamkills_mode") in TEAMKILLS_MODE_SIDES):
        data["event_ally"], data["event_enemy"] = TEAMKILLS_MODE_SIDES[data["teamkills_mode"]]
    keys = preset_keys_for(preset_cats(preset))
    if keys is not None:
        keys = [k for k in keys if k in data]
    return data, keys, preset.get("selected_clips")


def normalize_presets(presets):
    """Presets as the bridge should send them: `cats` always present.

    `list_presets`/`save_preset`/`delete_preset` used to hand the on-disk
    dict to the renderer unchanged. A preset saved by an old version of the
    window carries {"type": "..."}, never {"cats": [...]}, and the renderer
    reads `preset.cats` unconditionally (it has no reason to know the file
    format's history) -- normalizing here, once, is cheaper than teaching
    every renderer reader about a storage detail two formats deep.
    """
    result = {}
    for name, preset in presets.items():
        entry = {"cats": preset_cats(preset), "data": preset.get("data", {})}
        if "selected_clips" in preset:
            entry["selected_clips"] = preset["selected_clips"]
        result[name] = entry
    return result

def load_saved_players():
    return _load_json(str(_file_dir() / "csdm_players.json"), list)

def save_saved_players(players):
    _save_json(str(_file_dir() / "csdm_players.json"), players)

def load_asm_names():
    return _load_json(str(_file_dir() / "csdm_asm_names.json"), list)

def save_asm_names(names):
    _save_json(str(_file_dir() / "csdm_asm_names.json"), names)

# The old three-way teamkill choice as (event_ally, event_enemy). One table for
# the config migration and the preset loader, so both decide the same way.
TEAMKILLS_MODE_SIDES = {"include": (True, True), "exclude": (False, True), "only": (True, False)}


def legacy_event_axes(events, teamkills_mode):
    """The 2-axis event keys a flat Kills/Deaths/Rounds list and the old
    three-way teamkill choice stand for.

    One mapping for `_migrate_config` (old saved files) and the Tkinter window,
    which still shows the flat model: the engine reads only the 2-axis keys, so
    the window's choices must be translated before every run. Kills and Deaths
    share the actor perspective, as they always did. An unknown teamkill value
    leaves the ally side to whatever the caller already holds.
    """
    events = events or []
    lethal = "Kills" in events or "Deaths" in events
    axes = {"event_actor": lethal, "event_target": "Deaths" in events,
            "event_lethal": lethal, "event_enemy": True}
    if teamkills_mode in TEAMKILLS_MODE_SIDES:
        axes["event_ally"], axes["event_enemy"] = TEAMKILLS_MODE_SIDES[teamkills_mode]
    return axes

# The 2-axis event keys. A saved config carrying ANY of them was written by the
# 2-axis app and must never go through the flat-`events` migration again.
_EVENT_AXIS_KEYS = ("event_actor", "event_target", "event_lethal", "event_non_lethal",
                    "event_other", "event_ally", "event_enemy")


def _migrate_config(saved: dict, cfg: dict) -> None:
    """Apply all backward-compatibility migrations from a saved config dict into cfg.

    Each block handles one historical rename or type change. Add new migrations at the
    bottom — oldest first — so that chained renames work correctly.

    Args:
        saved: the raw dict read from disk (may be an old schema)
        cfg:   the target dict (already pre-populated from DEFAULT_CONFIG + saved)
    """
    # headshots_only bool → headshots_mode enum  (pre-v140)
    if "headshots_only" in saved and "headshots_mode" not in saved:
        cfg["headshots_mode"] = "only" if saved["headshots_only"] else "all"

    # cs2_minimize → cs2_send_to_back  (pre-v155)
    if "cs2_minimize" in saved and "cs2_send_to_back" not in saved:
        cfg["cs2_send_to_back"] = bool(saved["cs2_minimize"])

    # include_suicides bool → suicides_mode enum  (pre-v160)
    if "include_suicides" in saved and "suicides_mode" not in saved:
        cfg["suicides_mode"] = "include" if saved["include_suicides"] else "exclude"

    # French kill-mod names → English  (pre-v162)
    for _fr, _en in [("kill_mod_sauveur",   "kill_mod_savior"),
                     ("kill_mod_bourreau",   "kill_mod_bully"),
                     ("kill_mod_bourreau_n", "kill_mod_bully_n")]:
        if _fr in saved and _en not in saved:
            cfg[_en] = saved[_fr]
        for _sfx in ("_req", "_exclude"):
            if f"{_fr}{_sfx}" in saved and f"{_en}{_sfx}" not in saved:
                cfg[f"{_en}{_sfx}"] = saved[f"{_fr}{_sfx}"]

    migrate_legacy_filter_keys(cfg)

    # flat events list → 2-axis event model  (events-beyond-kill, Task 1)
    # Old configs stored `events: ["Kills", "Deaths", "Rounds"]`; derive the
    # new Actor/Target/team keys from it so old configs migrate transparently.
    # Only a config with NONE of the 2-axis keys is old. The app still writes
    # `events` for ROUNDS; replaying this on every load wiped the user's
    # Actor/Target/Lethal/Ally/Enemy choices (audit 2026-09-15, E16).
    if saved.get("events") and not any(k in saved for k in _EVENT_AXIS_KEYS):
        old_events = saved["events"] or []
        cfg.update(legacy_event_axes(old_events, saved.pop("teamkills_mode", "include")))
        # Only "Rounds" still means something in `events`.
        cfg["events"] = ["Rounds"] if "Rounds" in old_events else []

    # Card grid halved to a 48px column  (3.3.0). Last, and after every key
    # rename above: it reads `ui_sections` and `ui_card_block_size` as they
    # finally stand.
    _migrate_card_grid_half_step(saved, cfg)

# Legacy filter keys dropped from KILL_FILTER_REGISTRY, mapped onto their
# replacement. Applied to the main config AND to preset payloads, since both
# may have been written before the key was retired.
_LEGACY_FILTER_KEYS = {
    # kill_mod_no_trois_shot was the hand-wired inverse of TROIS SHOT; the
    # generic per-filter Exclude mechanism now covers it identically.
    "kill_mod_no_trois_shot": "kill_mod_trois_shot_exclude",
}
# Retired companion keys with no replacement (never read by anything).
_DEAD_FILTER_KEYS = ("kill_mod_no_trois_shot_req",)


# Schema version of the `ui_sections` card layouts. THE RENDERER MIRRORS THIS
# in `electron/renderer/src/shell/sectionLayout.ts::LAYOUT_VERSION`, and
# `shell/__tests__/layout-version-parity.test.ts` reads this file to prove the
# two agree -- the same discipline as the settings coverage guard, which reads
# its key list from Python rather than keeping a TypeScript copy.
UI_SECTIONS_VERSION = 4

# Columns per stored column when the grid halved (v3 -> v4).
_GRID_HALF_STEP_SCALE = 2


def _migrate_card_grid_half_step(saved: dict, cfg: dict) -> None:
    """Halve the grid column and widen every stored rectangle to match (v3 -> v4).

    A card's rectangle is stored in COLUMNS, so halving the column would halve
    every card on screen. The two changes are therefore one migration, not two:
    the column size and the rectangles move together or the window reopens with
    every card at half width.

    Only `x` and `w` scale. `y` and `h` are in fine rows (`ui_card_row_height`),
    which this change does not touch.

    Idempotent: keyed on the stored version, and a tab already stamped `v: 4`
    is left alone.
    """
    sections = saved.get("ui_sections")
    if not isinstance(sections, dict):
        return

    migrated = {}
    touched = False
    for tab_id, layout in sections.items():
        if not isinstance(layout, dict) or layout.get("v") == UI_SECTIONS_VERSION:
            migrated[tab_id] = layout
            continue
        cards = layout.get("cards")
        if not isinstance(cards, dict):
            migrated[tab_id] = layout
            continue
        touched = True
        scaled = {}
        for card_id, slot in cards.items():
            if not isinstance(slot, dict):
                continue
            widened = dict(slot)
            for key in ("x", "w"):
                value = slot.get(key)
                if isinstance(value, (int, float)):
                    widened[key] = int(value) * _GRID_HALF_STEP_SCALE
            scaled[card_id] = widened
        migrated[tab_id] = {**layout, "v": UI_SECTIONS_VERSION, "cards": scaled}

    if not touched:
        return

    cfg["ui_sections"] = migrated
    # The rectangles above are now counted in HALF columns, so the column must
    # actually halve or every card doubles in width. A user who set a column
    # size of their own keeps the choice, halved on the same scale.
    stored_block = saved.get("ui_card_block_size")
    if isinstance(stored_block, (int, float)) and stored_block > 0:
        cfg["ui_card_block_size"] = max(8, round(stored_block / _GRID_HALF_STEP_SCALE))


def migrate_legacy_filter_keys(d: dict) -> None:
    """Rewrite retired kill-filter keys in place. Idempotent.

    A truthy legacy key is OR-ed into its replacement so that neither an old
    config nor an already-migrated one loses the user's intent.
    """
    for _old, _new in _LEGACY_FILTER_KEYS.items():
        if _old in d:
            if d.pop(_old):
                d[_new] = True
    for _dead in _DEAD_FILTER_KEYS:
        d.pop(_dead, None)


def load_config():
    """Read the configuration from wherever `config_dir` points.

    Bootstraps on every call: the default-location file records the live
    location (the pointer), so a process started anywhere always lands on the
    config the user last switched to. The old-name subfolder migrates BEFORE
    the flat legacy files: when both exist, the subfolder is the more recent
    state, and the flat copy must not shadow it.
    """
    _migrate_legacy_subdir_name()
    _migrate_legacy_root_files()
    active = _bootstrap_dir()
    global _ACTIVE_DIR
    _ACTIVE_DIR = active
    saved = _load_json(str(active / "csdm_config.json"))
    if not saved:
        return DEFAULT_CONFIG.copy()
    cfg = DEFAULT_CONFIG.copy()
    cfg.update(saved)
    _migrate_config(saved, cfg)
    return cfg


def save_config(cfg):
    """Write the configuration to the location `cfg["config_dir"]` selects."""
    global _ACTIVE_DIR
    target = resolve_config_dir(cfg.get("config_dir", ""))
    _ACTIVE_DIR = target
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass  # _save_json reports the real failure if the dir stays unwritable
    _save_json(str(target / "csdm_config.json"), cfg)


def probe_config_dir(target=None):
    """Describe the current location and what copying to `target` would do.

    With `target` omitted the call is a pure status read: `same` is True and
    `conflicts` is empty. With a target, `conflicts` lists the files that
    already exist there and would be overwritten by a switch.

    `kind` names WHICH location is active so the UI can highlight the matching
    choice: ``"app"`` (the script subfolder), ``"appdata"`` (Local AppData) or
    ``"custom"`` (any other path). The renderer cannot derive this itself --
    the script root and %LOCALAPPDATA% are engine knowledge.
    """
    current = _file_dir()
    target_dir = resolve_config_dir(target) if target is not None else current
    conflicts = [name for name in CONFIG_FILENAMES
                 if target_dir != current and (target_dir / name).exists()]
    return {
        "current": str(current),
        "target": str(target_dir),
        "conflicts": conflicts,
        "same": target_dir == current,
        "kind": _location_kind(current),
    }


def _location_kind(directory):
    """Which of the three locations `directory` is: ``"app"``, ``"appdata"`` or ``"custom"``.

    Windows paths are case-insensitive, so the comparison is normalised before
    it happens; the resolved targets use the same subfolder name everywhere.
    """
    current = os.path.normcase(os.path.abspath(str(directory)))
    for value, kind in (("", "app"), ("appdata", "appdata")):
        if current == os.path.normcase(os.path.abspath(str(resolve_config_dir(value)))):
            return kind
    return "custom"


def apply_config_dir(target):
    """Copy the four JSON files to `target`'s folder, then switch to it.

    COPY, never move: the source files stay in place as a snapshot. Any
    same-named file at the target is first backed up into a
    `backup-<YYYYMMDD-HHMMSS>` subfolder of the target. The copied config
    records the new location, and the default-location copy is updated as the
    bootstrap pointer for the next launch.
    """
    target_dir = resolve_config_dir(target)
    current = _file_dir()
    if target_dir == current:
        return probe_config_dir(target)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise OSError(f"cannot create config folder {target_dir}: {exc}") from exc

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = target_dir / f"backup-{stamp}"
    for name in CONFIG_FILENAMES:
        dst = target_dir / name
        if dst.exists():
            try:
                backup_dir.mkdir(exist_ok=True)
                shutil.copy2(dst, backup_dir / name)
            except OSError as exc:
                raise OSError(f"cannot back up {dst}: {exc}") from exc
    for name in CONFIG_FILENAMES:
        src = current / name
        if src.exists():
            try:
                shutil.copy2(src, target_dir / name)
            except OSError as exc:
                raise OSError(f"cannot copy {name} to {target_dir}: {exc}") from exc

    cfg = _load_json(str(target_dir / "csdm_config.json"))
    if not isinstance(cfg, dict) or not cfg:
        cfg = DEFAULT_CONFIG.copy()
    cfg["config_dir"] = target
    save_config(cfg)  # writes to the target, updates the active dir

    default_dir = _default_dir()
    if default_dir != target_dir:
        pointer = _load_json(str(default_dir / "csdm_config.json"))
        if not isinstance(pointer, dict) or not pointer:
            pointer = dict(cfg)
        pointer["config_dir"] = target
        try:
            _save_json(str(default_dir / "csdm_config.json"), pointer)
        except OSError:
            pass  # pointer write is best-effort; the live copy still switched
    return probe_config_dir(target)
