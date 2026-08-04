"""Configuration: defaults, presets and persistence (Phase 1.1).

Extracted from the entry point. Holds DEFAULT_CONFIG, the preset groups, and
the functions that read and write the local JSON files.

The paths point at the project ROOT -- beside the entry point -- not at the
csdm/ package directory.
"""
import os
import json
from pathlib import Path

from csdm.static_data import (
    _FILTER_CONFIG_DEFAULTS, _FILTER_PRESET_PLAYER_KEYS, MATCH_TYPE_DEFS,
)

# The project root is the parent of the csdm/ package -- where the local data
# files live (csdm_config.json, ...), beside the entry point.
_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE    = str(_ROOT / "csdm_config.json")
PRESETS_FILE   = str(_ROOT / "csdm_presets.json")
PLAYERS_FILE   = str(_ROOT / "csdm_players.json")
ASM_NAMES_FILE = str(_ROOT / "csdm_asm_names.json")

DEFAULT_CONFIG = {
    "pg_host": "127.0.0.1", "pg_port": "5432",
    "pg_user": "postgres", "pg_pass": "", "pg_db": "csdm",
    "csdm_exe": r"C:\Users\Trois\AppData\Local\Programs\cs-demo-manager\csdm.CMD",
    "output_dir": r"H:\CS\CSVideos\Raws",
    "output_dir_clips":    r"H:\CS\CSVideos\Raws",   # raw clips per demo
    "output_dir_concat":   "",   # concatenated clips (empty = same as raw)
    "output_dir_assembled": "",  # final assembled file (empty = same as raw)
    "cs2_cfg_dir": "",
    "ui_window_w": 1600,
    "ui_window_h": 900,
    "ui_split_pct": 60,
    "ui_remember_layout": True,
    "ui_sections": {},  # per-tab {order: [...], collapsed: [...]}; empty = declared order, nothing folded
    "theme_bg": "dark",      # background preset: dark | amoled | deepblue | white
    "theme_accent": "green", # accent preset or custom hex: green | blue | orange | purple | red | cyan | pink | yellow | #rrggbb
    "ui_font_family": "auto", # "auto" = first available of UI_FONT_STACK; or a forced name (e.g. "JetBrains Mono")
    "steam_id": "", "player_name": "", "player_name_override": "",
    # Event model (2-axis: Actor/Target × Lethal/Non-lethal/Other)
    "event_actor": True,      # Actor perspective — I am the one acting
    "event_target": False,    # Target perspective — I am the one acted upon
    "event_lethal": True,     # Include lethal events (kills & deaths)
    "event_ally": False,      # Include ally-on-ally / ally-on-me events
    "event_enemy": True,      # Include enemy-on-me / me-on-enemy events
    "event_non_lethal": False,  # Include non-lethal damage events
    "event_other": False,     # Include "other" events (shots, jumps, grenade misses)
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
    **{cfg_k: False for _, cfg_k, _ in MATCH_TYPE_DEFS},
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
    "players":     ["steam_id", "player_name", "player_name_override"],
    "date":        ["date_from", "date_to"],
    "filters":     ["event_actor", "event_target", "event_lethal", "event_ally", "event_enemy",
                    "event_non_lethal", "event_other",
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
    "player":      ["steam_id", "player_name", "event_actor", "event_target",
                    "event_lethal", "event_ally", "event_enemy", "event_non_lethal", "event_other",
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
    return _load_json(PRESETS_FILE)

def save_presets(presets):
    _save_json(PRESETS_FILE, presets)


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
    `_apply_config(cfg, keys=None)` expects.
    `selected_clips` is None when the preset has no clip selection
    (saved before editing support, or intentionally omitted).
    """
    return (
        preset.get("data", {}),
        preset_keys_for(preset_cats(preset)),
        preset.get("selected_clips"),
    )


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
    return _load_json(PLAYERS_FILE, list)

def save_saved_players(players):
    _save_json(PLAYERS_FILE, players)

def load_asm_names():
    return _load_json(ASM_NAMES_FILE, list)

def save_asm_names(names):
    _save_json(ASM_NAMES_FILE, names)

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
    if "events" in saved and saved["events"]:
        old_events = saved["events"] or []
        cfg["event_actor"] = "Kills" in old_events or "Deaths" in old_events
        cfg["event_target"] = "Deaths" in old_events
        cfg["event_lethal"] = "Kills" in old_events or "Deaths" in old_events
        cfg["event_enemy"] = True
        # teamkills_mode migration:
        #   "include" → ally=True,  enemy=True  (both pass)
        #   "exclude" → ally=False, enemy=True  (only enemy passes)
        #   "only"    → ally=True,  enemy=False (only ally passes)
        old_tk_mode = saved.pop("teamkills_mode", "include")
        if old_tk_mode == "include":
            cfg["event_ally"] = True
            cfg["event_enemy"] = True
        elif old_tk_mode == "exclude":
            cfg["event_ally"] = False
            cfg["event_enemy"] = True
        elif old_tk_mode == "only":
            cfg["event_ally"] = True
            cfg["event_enemy"] = False
        # "Rounds" is kept in events list temporarily for backward compat
        if "Rounds" in old_events:
            cfg["events"] = ["Rounds"]


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
    saved = _load_json(CONFIG_FILE)
    if not saved:
        return DEFAULT_CONFIG.copy()
    cfg = DEFAULT_CONFIG.copy()
    cfg.update(saved)
    _migrate_config(saved, cfg)
    return cfg

def save_config(cfg):
    _save_json(CONFIG_FILE, cfg)
