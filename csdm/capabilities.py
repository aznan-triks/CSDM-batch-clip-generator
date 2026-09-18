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


_C = Capability

_HAND_WRITTEN: list = [
    # ── I1 Set up the tool ─────────────────────────────────────────────────
    _C("database_connection", "I1", "Database connection",
       ("pg_host", "pg_port", "pg_db", "pg_user", "pg_pass"), ("connect_db",)),
    _C("csdm_executable", "I1", "CS Demo Manager executable", ("csdm_exe",)),
    _C("output_folders", "I1", "Output folders",
       ("output_dir_clips", "output_dir_concat", "output_dir_assembled",
        "subfolder_per_demo", "output_dir")),
    _C("cs2_cfg_folder", "I1", "CS2 cfg folder override", ("cs2_cfg_dir",)),
    _C("settings_location", "I1", "Settings location",
       ("config_dir",), ("probe_config_dir", "apply_config_dir")),
    _C("demo_parse_threads", "I1", "Demo pre-parse threads", ("dp2_threads",)),
    _C("engine_internals", "I1", "Engine internals",
       ("encoder", "tickrate", "use_config_file_mode",
        "process_exit_poll_interval", "process_exit_timeout", "cs2_process_name")),
    # ── I2 Choose who ──────────────────────────────────────────────────────
    _C("player_selection", "I2", "Players",
       ("steam_id", "steam_ids", "player_name", "saved_players")),
    _C("player_name_override", "I2", "In-game name override", ("player_name_override",)),
    # ── I3 Choose which demos ──────────────────────────────────────────────
    _C("demo_date_range", "I3", "Date range", ("date_from", "date_to")),
    _C("manual_demo_pick", "I3", "Pick demos by hand", (), ("list_demos",)),
    _C("map_filter", "I3", "Map filter", ("map_filter_enabled", "map_filter")),
    _C("tagged_demo_search", "I3", "Find demos by tag", (), ("tags_search", "tags_calc_range")),
    _C("clip_order", "I3", "Processing order", ("clip_order",)),
    # ── I4 Choose which moments ────────────────────────────────────────────
    _C("event_role", "I4", "Event role", ("event_actor", "event_target")),
    _C("event_kind", "I4", "Event kind", ("event_lethal", "event_non_lethal", "event_other")),
    # teamkills_mode is the model Ally / Enemy replaced, kept for migration.
    _C("event_side", "I4", "Other player's side", ("event_ally", "event_enemy", "teamkills_mode")),
    _C("round_clips", "I4", "Full-round clips", ("events",)),
    _C("weapon_filter", "I4", "Weapons", ("weapons",)),
    _C("headshot_filter", "I4", "Headshots", ("headshots_mode",)),
    _C("suicide_filter", "I4", "Suicides", ("suicides_mode",)),
    _C("clutch_filter", "I4", "Clutches",
       ("clutch_enabled", "clutch_wins_only", "clutch_mode",
        "clutch_1v1", "clutch_1v2", "clutch_1v3", "clutch_1v4", "clutch_1v5")),
    _C("filter_logic", "I4", "Filter logic",
       ("kill_mod_logic_mods", "kill_mod_logic_dp2", "kill_mod_logic_db")),
    # ── I5 Choose how to film ──────────────────────────────────────────────
    _C("camera_perspective", "I5", "Camera perspective", ("perspective", "victim_pre_s")),
    _C("clip_window", "I5", "Seconds before and after", ("before", "after")),
    _C("recording_system", "I5", "Recording system", ("recsys",)),
    _C("hlae_options", "I5", "HLAE options",
       ("hlae_fov", "hlae_slow_motion", "hlae_afx_stream", "hlae_no_spectator_ui",
        "hlae_fix_scope_fov", "hlae_extra_args")),
    _C("in_game_display", "I5", "In-game display",
       ("true_view", "show_only_death_notices", "death_notices_duration", "show_xray")),
    _C("cs2_effects", "I5", "CS2 effects",
       ("phys_ragdoll_gravity", "phys_ragdoll_scale", "phys_sv_gravity",
        "phys_ragdoll_enable", "phys_blood", "phys_dynamic_lighting")),
    _C("cs2_window", "I5", "CS2 window", ("cs2_window_mode", "cs2_send_to_back")),
    # ── I6 Make the batch reliable ─────────────────────────────────────────
    _C("retries", "I6", "Retries", ("retry_count", "retry_delay")),
    _C("batch_pacing", "I6", "Pacing and timeout", ("delay_between_demos", "recording_timeout")),
    _C("close_game_between_demos", "I6", "Close CS2 after each demo", ("close_game_after",)),
    # ── I7 Tune the video render ───────────────────────────────────────────
    _C("resolution_framerate", "I7", "Resolution and framerate", ("width", "height", "framerate")),
    _C("video_encoding", "I7", "Video encoding",
       ("video_codec", "crf", "video_preset", "video_container")),
    _C("audio_encoding", "I7", "Audio encoding", ("audio_codec", "audio_bitrate")),
    _C("ffmpeg_raw_params", "I7", "Raw FFmpeg parameters",
       ("ffmpeg_input_params", "ffmpeg_output_params")),
    _C("sequence_concatenation", "I7", "Join a demo's sequences", ("concatenate_sequences",)),
    _C("final_assembly", "I7", "Final assembly",
       ("assemble_after", "assemble_output", "delete_after_assemble")),
    # ── I8 Check before running ────────────────────────────────────────────
    _C("preview", "I8", "Preview", (), ("start_preview", "cancel_preview")),
    # ── I9 Run and control ─────────────────────────────────────────────────
    _C("batch_run", "I9", "Run, stop, kill", (), ("start_run", "request_stop", "request_kill")),
    # ── I10 Organise with tags ─────────────────────────────────────────────
    _C("tag_management", "I10", "Tags",
       ("ui_active_tags",), ("tag_create", "tag_delete", "tags_set_active")),
    _C("tag_demos", "I10", "Tag demos", (), ("tags_apply", "tags_remove")),
    _C("tag_on_export", "I10", "Tag on export", ("tag_enabled", "tag_on_export")),
    _C("tag_transfer", "I10", "Export and import tags",
       (), ("tags_export", "tags_import_scan", "tags_import_apply")),
    # ── I11 Save and reuse ─────────────────────────────────────────────────
    _C("presets", "I11", "Presets",
       (), ("list_presets", "save_preset", "load_preset", "delete_preset")),
    _C("config_persistence", "I11", "Settings saved automatically", (), ("load_config", "save_config")),
    # ── I12 Monitor ────────────────────────────────────────────────────────
    _C("debug_trace", "I12", "Debug trace", (), ("set_debug",)),
    # ── I13 Personalise the window ─────────────────────────────────────────
    _C("theme", "I13", "Theme", ("theme_bg", "theme_accent")),
    _C("window_layout", "I13", "Window size and split",
       ("ui_window_w", "ui_window_h", "ui_split_pct", "ui_remember_layout")),
    _C("card_layout", "I13", "Card layout",
       ("ui_sections", "ui_card_block_size", "ui_card_row_height", "ui_card_collapsed_rows")),
    _C("font", "I13", "Font", ("ui_font_family",)),
    # ── I14 Diagnose ───────────────────────────────────────────────────────
    _C("engine_handshake", "I14", "Engine handshake", (), ("ping", "hello", "describe_filters")),
    _C("developer_probes", "I14", "Developer probes", (), ("demo_logs", "demo_ask", "tkinter_check")),
]


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
