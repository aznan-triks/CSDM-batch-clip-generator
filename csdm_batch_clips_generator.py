#!/usr/bin/env python3
"""CSDM Batch Clips Generator — version courante : voir APP_VERSION ci-dessous."""


import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog, colorchooser
import subprocess, threading, json, os, tempfile, time, shutil, re, uuid, random, shlex
import bisect, concurrent.futures, math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, date
from pathlib import Path

# Limit Rayon (Rust) + BLAS thread pools to 1 per worker so that
# ThreadPoolExecutor(max_workers=dp2_threads) is the sole concurrency
# knob — must be set before demoparser2 / numpy / pandas are imported.
os.environ.setdefault("RAYON_NUM_THREADS",   "1")
os.environ.setdefault("OMP_NUM_THREADS",     "1")
os.environ.setdefault("MKL_NUM_THREADS",     "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS","1")

try:
    import psycopg2
    HAS_PG = True
except ImportError:
    HAS_PG = False

# ═══════════════════════════════════════════════════════
#  Version
# ═══════════════════════════════════════════════════════
APP_VERSION = "v214"

# ═══════════════════════════════════════════════════════
#  Theme system
# ═══════════════════════════════════════════════════════

# ── Palettes + theme VIVANT partage (Phase 1.1 / 1.2) ───────────────────────
#  Les couleurs courantes vivent dans csdm/theme.py (_THEME mute en place +
#  accesseur _t). On les importe ici. Les ~640 lectures du fichier utilisent
#  encore les globales BG/BG2/... ci-dessous : on les garde synchronisees a
#  partir du dict partage. Les futurs modules de widgets, eux, utilisent _t().
from csdm.theme import _build_theme, _ACCENT_PRESETS, _THEME, _t, apply_theme as _apply_theme_dict

# Apply the initial theme to module-level globals for backward compat
BG       = _THEME["BG"]
BG2      = _THEME["BG2"]
BG3      = _THEME["BG3"]
BORDER   = _THEME["BORDER"]
ORANGE   = _THEME["ORANGE"]
ORANGE2  = _THEME["ORANGE2"]
TEXT     = _THEME["TEXT"]
MUTED    = _THEME["MUTED"]
GREEN    = _THEME["GREEN"]
RED      = _THEME["RED"]
YELLOW   = _THEME["YELLOW"]
BLUE     = _THEME["BLUE"]
DESC_COLOR = _THEME["DESC_COLOR"]

_THEME_GLOBAL_NAMES = (
    "BG", "BG2", "BG3", "BORDER", "ORANGE", "ORANGE2", "TEXT", "MUTED",
    "GREEN", "RED", "YELLOW", "BLUE", "DESC_COLOR",
)

def _apply_theme_globals(bg_name: str, accent: str):
    """Recompute _THEME and update every module-level colour global in-place.

    Called at startup (before widgets) and again when user changes theme.
    After this, any new widget creation will use the updated globals.
    Existing widgets are updated by App._apply_theme_to_widgets().
    """
    # Mute le theme PARTAGE en place (csdm/theme._THEME) — pas de reassignation,
    # sinon les autres modules garderaient l'ancien dictionnaire.
    _apply_theme_dict(bg_name, accent)
    g = globals()
    for name in _THEME_GLOBAL_NAMES:
        g[name] = _THEME[name]
    # Keep shared widget-kwarg dicts in sync — they're built at import time with
    # default dark/green values, so we must update them here for every theme change
    # (including the initial one at startup) so widgets created with **_CHK_KW /
    # **_BTN_KW always receive the current theme colours.
    _CHK_KW.update(bg=_THEME["BG2"], fg=_THEME["MUTED"],
                   activebackground=_THEME["BG2"], activeforeground=_THEME["ORANGE"],
                   selectcolor=_THEME["BG3"])
    _BTN_KW.update(activebackground=_THEME["BORDER"], activeforeground=_THEME["ORANGE"])

# ── Boite a outils UI : polices, espacements, styles (Phase 1.2) ────────────
#  Extraits dans csdm/ui_kit.py. _CHK_KW/_BTN_KW sont les MEMES objets dict
#  que ceux mis a jour en place par _apply_theme_globals ci-dessus.
from csdm.ui_kit import (
    FONT_MONO, FONT_MONO_B, FONT_SM, FONT_SM_B, FONT_DESC, FONT_TITLE_B,
    init_fonts, apply_ttk_style,
    UI_TAB_PAD, UI_SEC_PADX, UI_SEC_PADY, UI_SEC_GAP, UI_ROW_PAD,
    UI_BTN_IPADX, UI_BTN_IPADY, UI_ENTRY_IPAD,
    UI_PANE_LEFT_MIN, UI_PANE_RIGHT_MIN,
    _CHK_KW, _BTN_KW, _contrast_fg,
)


# ── App-level enumerations ────────────────────────────────────────────────────
EVENTS           = ["Kills", "Deaths", "Rounds"]
ENCODER_OPTIONS  = ["FFmpeg"]
RECSYS_OPTIONS   = ["HLAE", "CS"]
VIDEO_CONTAINERS = ["mp4", "avi", "mkv", "mov", "webm"]


# ── Donnees de reference statiques (registre de filtres, armes, codecs, …) ──
#  Extraites dans csdm/static_data.py (Phase 1.1). Importees ici pour que tout
#  le reste du fichier continue d'y acceder par les memes noms qu'avant.
from csdm.static_data import (
    FilterDef, KILL_FILTER_REGISTRY,
    KILL_FILTER_KEYS_ALL, KILL_FILTER_KEYS, KILL_FILTER_LABELS, KILL_FILTER_SQL_COLS,
    _FILTER_CONFIG_DEFAULTS, _NO_AUTO_EXCLUDE, _FILTER_BOOL_KEYS, _FILTER_PRESET_PLAYER_KEYS,
    PERSP_LABELS,
    VIDEO_CODECS_INFO, VIDEO_CODECS, CPU_VIDEO_CODECS, AUDIO_CODECS_INFO, AUDIO_CODECS,
    RESOLUTIONS, FRAMERATES, DEFINITIONS, ASPECT_RATIOS,
    TROIS_SHOT_THRESHOLDS, CSDM_TO_DP2_WEAPON, DP2_TICK_WINDOW,
    SPRAY_TRANSFER_WEAPONS, SPRAY_TRANSFER_WEAPONS_LOWER, SPRAY_MAX_GAP_TICKS,
    TAG_PRESET_COLORS, WEAPON_CATEGORIES, WEAPON_ICONS, _WEAPON_LOOKUP,
    _WEAPON_SUBSTR_FALLBACK, _weapon_category,
    MATCH_TYPE_DEFS, _MATCH_TYPE_KEY_TO_DB, _MATCH_TYPE_CFG_KEYS,
)


# ── Delayed-effect / suicide weapons — deplaces dans csdm/static_data.py ─────
from csdm.static_data import DELAYED_EFFECT_WEAPONS, SUICIDE_WEAPONS
from csdm.static_data import (
    CSDM_RUNTIME_CFG_NAME, CSDM_RUNTIME_BLOCK_START, CSDM_RUNTIME_BLOCK_END,
)
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin

# ── Configuration : defauts, presets, persistance (Phase 1.1) ──────────────
#  Extraits dans csdm/config.py. Importes ici pour conserver les memes noms.
from csdm.config import (
    CONFIG_FILE, PRESETS_FILE, PLAYERS_FILE, ASM_NAMES_FILE,
    DEFAULT_CONFIG, PRESET_CATEGORIES, PRESET_KEYS, _PRESET_TAB_GROUPS, _PRESET_ALL_CATS,
    _load_json, _save_json,
    load_presets, save_presets, load_saved_players, save_saved_players,
    load_asm_names, save_asm_names,
    _migrate_config, load_config, save_config,
)

# ── Helpers purs (Phase 1.1) — deplaces dans csdm/core_utils.py ─────────────
from csdm.core_utils import (
    iso_to_display, display_to_iso, ensure_csdm_dirs, check_ffmpeg_available,
    fmt_duration, safe_folder_name, build_camera_ticks,
    _generate_id_for_type, _count_kills, progress_bar,
)

# ── Calendrier, dialogues et champ de date (Phase 1.2) ──────────────────────
from csdm.widgets import CalendarPopup, ColorPickerDialog, TagImportMissingDialog, DateField
from csdm.widgets import PlayerSearchWidget

# ── Composants Tkinter reutilisables (Phase 1.2) ────────────────────────────
#  ScrollableFrame, WrapRow et leurs registres d'instances vivent dans
#  csdm/widgets.py. Importes ici sous les memes noms qu'avant. Les registres
#  sont les MEMES objets que ceux remplis par les widgets — les handlers de App
#  iterent dessus normalement.
from csdm.widgets import ScrollableFrame, WrapRow, BentoGrid, _SCROLL_FRAMES, _WRAP_ROWS
# ── Carte de section pliable + champ de chemin (Phase 1.2) ──────────────────
from csdm.widgets import Sec, PathField

# ── Assistants d'affichage + info-bulle (Phase 1.2) ─────────────────────────
#  Deplaces dans csdm/widgets.py. Importes ici sous les memes noms qu'avant.
from csdm.widgets import (
    sentry, scombo, mlabel, flabel, slabel,
    hchk, hradio, _bind_wraplength, _WRAP_LABELS,
    desc_label, _sep, _chk_tip, Tooltip, add_tip, dp2_badge,
)

# ═══════════════════════════════════════════════════════
#  App
# ═══════════════════════════════════════════════════════
class App(EngineStateMixin, EngineMixin, tk.Tk):
    def __init__(self):
        super().__init__()
        self.init_engine_state()
        self.cfg = load_config()
        # Polices nommees Tk : creees maintenant (root pret), AVANT tout widget.
        init_fonts(self, self.cfg.get("ui_font_family", "auto"))
        # Apply theme from config before building any widgets
        _apply_theme_globals(
            self.cfg.get("theme_bg", "dark"),
            self.cfg.get("theme_accent", "green")
        )
        self.title(f"CSDM Batch {APP_VERSION}")
        self.configure(bg=BG)
        _w = int(self.cfg.get("ui_window_w", 1600) or 1600)
        _h = int(self.cfg.get("ui_window_h", 900) or 900)
        _w = max(1000, min(3840, _w))
        _h = max(600, min(2160, _h))
        self.geometry(f"{_w}x{_h}")
        self.minsize(1000, 600)
        # Options TCombobox Listbox : centralisees dans apply_ttk_style (appele
        # au debut de _build_ui, avant l'ouverture de toute liste deroulante).

        self.presets = load_presets()
        self._db_match_types: list = []   # distinct game_mode_str values found in DB
        self._map_filter_vars: dict = {}  # {display_key: BooleanVar} — rebuilt by _refresh_map_filter_ui
        self._tag_search_results = {}
        self._warned_clutch_no_team_col: bool = False   # suppress repeated team-col warning
        self._warned_require_win_no_data: bool = False  # suppress repeated win-data warning

        self.v = {}
        str_keys = ["pg_host", "pg_port", "pg_user", "pg_pass", "pg_db", "csdm_exe", "output_dir",
                     "date_from", "date_to", "encoder", "recsys", "video_codec",
                     "audio_codec", "video_container", "ffmpeg_input_params", "ffmpeg_output_params",
                     "tag_on_export", "perspective", "hlae_extra_args", "clip_order",
                     "cs2_window_mode",
                     "output_dir_clips", "output_dir_concat", "output_dir_assembled",
                     "assemble_output", "video_preset", "teamkills_mode", "suicides_mode", "phys_ragdoll_scale",
                     "cs2_cfg_dir",
                     "kill_mod_logic_mods", "kill_mod_logic_dp2", "kill_mod_logic_db",
                     "headshots_mode",
                     "theme_bg", "theme_accent",
                     "clutch_mode",
                     "player_name_override"]
        int_keys = ["before", "after", "tickrate", "width", "height", "framerate", "crf", "audio_bitrate",
                     "death_notices_duration", "retry_count", "retry_delay", "delay_between_demos", "recording_timeout",
                     "hlae_fov", "hlae_slow_motion",
                     "phys_ragdoll_gravity", "phys_sv_gravity",
                     "ui_window_w", "ui_window_h", "ui_split_pct",
                     "victim_pre_s", "dp2_threads",
                     # Filter sub-option ints from extra_config (e.g. kill_mod_flick_deg)
                     *[k for f in KILL_FILTER_REGISTRY
                       if f.extra_config
                       for k, v in f.extra_config.items()
                       if isinstance(v, int) and not isinstance(v, bool)]]
        bool_keys = ["use_config_file_mode", "close_game_after", "show_only_death_notices",
                      "concatenate_sequences", "subfolder_per_demo", "true_view", "tag_enabled",
                      "hlae_afx_stream", "hlae_no_spectator_ui",
                      "hlae_fix_scope_fov",
                      "map_filter_enabled",
                      "show_xray",
                      # Filter bool keys auto-derived from KILL_FILTER_REGISTRY
                      *_FILTER_BOOL_KEYS,
                      # Filter sub-option bools from extra_config (e.g. kill_mod_hv_one_shot)
                      *[k for f in KILL_FILTER_REGISTRY
                        if f.extra_config
                        for k, v in f.extra_config.items()
                        if isinstance(v, bool)],
                      "assemble_after", "delete_after_assemble",
                      "phys_ragdoll_enable", "phys_blood", "phys_dynamic_lighting",
                      "cs2_send_to_back",
                     "ui_remember_layout",
                     "clutch_enabled", "clutch_wins_only",
                     "clutch_1v1", "clutch_1v2", "clutch_1v3", "clutch_1v4", "clutch_1v5",
                     # Match type filter
                     "match_type_filter_enabled",
                     *_MATCH_TYPE_CFG_KEYS,
]
        for k in str_keys:
            val = str(self.cfg.get(k, DEFAULT_CONFIG.get(k, "")))
            if k in ("date_from", "date_to"):
                val = iso_to_display(val)
            self.v[k] = tk.StringVar(value=val)
        for k in int_keys:
            self.v[k] = tk.IntVar(value=self.cfg.get(k, DEFAULT_CONFIG.get(k, 0)))
        for k in bool_keys:
            self.v[k] = tk.BooleanVar(value=self.cfg.get(k, DEFAULT_CONFIG.get(k, False)))
        self.v["resolution"] = tk.StringVar(value=f"{self.v['width'].get()}x{self.v['height'].get()}")

        # Structured resolution selectors (v60)
        # Infer definition from current height
        _h0 = self.v["height"].get()
        _def0 = next((lbl for lbl, h in DEFINITIONS if h == _h0), "1080p")
        self.v["res_definition"] = tk.StringVar(value=_def0)
        # Infer ratio from current width/height
        _w0 = self.v["width"].get()
        _ratio0 = "16:9"
        for _lbl, _rw, _rh in ASPECT_RATIOS:
            if _h0 > 0 and abs(_w0 / _h0 - _rw / _rh) < 0.01:
                _ratio0 = _lbl
                break
        self.v["res_aspect"] = tk.StringVar(value=_ratio0)
        # Custom mode: active if width/height do not match a known preset
        _known = any(
            abs(_w0 / _h0 - rw / rh) < 0.01
            for _, rw, rh in ASPECT_RATIOS
        ) and any(h == _h0 for _, h in DEFINITIONS)
        self.v["res_custom"] = tk.BooleanVar(value=not _known)
        self.db_status = tk.StringVar(value="[DB:OFFLINE]")
        self.sel_events = {e: tk.BooleanVar(value=(e in self.cfg.get("events", []))) for e in EVENTS}
        self.sel_weapons = {}
        for w in self.cfg.get("weapons", []):
            self.sel_weapons[w] = tk.BooleanVar(value=True)
        self._dp2_cache_order: list = []           # LRU insertion order for eviction
        self._pending_restore_sid  = None   # steam_id to restore once DB is ready
        self._pending_restore_tags = []     # tag names to restore once DB is ready
        self._speed_feedback = None
        self._game_speed_trace_busy = False
        self._log_badges_enabled = tk.BooleanVar(value=True)
        self._log_timestamps     = tk.BooleanVar(value=False)
        self._log_badges_btn = None
        self._log_ts_btn     = None
        self._log_err_lbl    = None   # live E:N counter label
        self._log_warn_lbl   = None   # live W:N counter label
        self._log_err_count  = 0
        self._log_warn_count = 0
        self._outer_paned = None
        self._layout_cfg_job = None

        self.v["hlae_slow_motion"].trace_add("write", self._on_game_speed_var)
        self._build_ui()

        # PlayerSearchWidget enables all accounts by default; override
        # with the exact saved list if it exists.
        saved_ids = self.cfg.get("steam_ids", [])
        if saved_ids:
            self.player_search._active_sids.clear()
            for sid in saved_ids:
                for p in self.player_search._saved_players:
                    if p["steam_id"] == sid:
                        self.player_search._active_sids.add(sid)
                        self.player_search._active_names[sid] = p["name"]
                        break
            self.player_search._refresh_saved_display()

        # Track width/height → auto-update the resolution combo
        def _sync_res(*_):
            try:
                self.v["resolution"].set(f"{self.v['width'].get()}x{self.v['height'].get()}")
            except Exception:
                pass
        self.v["width"].trace_add("write", _sync_res)
        self.v["height"].trace_add("write", _sync_res)

        # Init structured resolution selectors state (v60)
        self.after(50, self._on_res_custom_toggle)
        self.bind("<Configure>", self._on_window_configure, add="+")
        self.after(60, self._update_res_preview)

        self._sync_pg_params()

        self._auto_save()
        self.after(80, self._apply_dark_titlebar)
        self.after(200, self._preflight)
        if HAS_PG:
            self.after(500, self._connect_and_load)

    def _sync_pg_params(self):
        """Copy the five PostgreSQL identifier widgets into `self._pg_params`,
        the plain dict `_pg`/`_pg_fresh` (moved to `EngineMixin`) actually read.
        Called after the widgets exist, and again whenever the values may have
        changed before a connection is opened — never assume it stays fresh."""
        self._pg_params = {
            "pg_host": self.v["pg_host"].get(),
            "pg_port": self.v["pg_port"].get(),
            "pg_user": self.v["pg_user"].get(),
            "pg_pass": self.v["pg_pass"].get(),
            "pg_db":   self.v["pg_db"].get(),
        }

    def _on_player_change(self, name, sid):
        """Called when the DB search list selection changes.
        Delegate to the player widget's _update_active_lbl so the header
        always shows the same text as the active label in the Capture tab."""
        try:
            self.player_search._update_active_lbl()
        except tk.TclError:
            pass

    def _preflight(self):
        for d in ensure_csdm_dirs():
            self._log(f"[PRE] Created: {d}", "ok")
        ok, p = check_ffmpeg_available()
        self._log(f"[PRE] FFmpeg: {p}" if ok else "[PRE] FFmpeg NON TROUVE", "ok" if ok else "err")
        cli = self._resolve_cli(self.v["csdm_exe"].get())
        self._log(f"[PRE] CLI: {cli}" if os.path.isfile(cli) else f"[PRE] CLI not found: {cli}",
                  "ok" if os.path.isfile(cli) else "err")
        out = self.v["output_dir"].get().strip()
        if out:
            os.makedirs(out, exist_ok=True)
        self._log("[PRE] OK\n", "ok")

    def _collect_config(self):
        self._sync_pg_params()
        cfg = {}
        for k, var in self.v.items():
            if k == "resolution":
                continue
            try:
                val = var.get()
            except Exception:
                # IntVar/BooleanVar raises TclError if the entry field was cleared
                val = DEFAULT_CONFIG.get(k, 0)
            if k in ("date_from", "date_to"):
                val = display_to_iso(val)
            cfg[k] = val
        if cfg.get("encoder") not in ENCODER_OPTIONS:
            cfg["encoder"] = "FFmpeg"
        cfg["events"] = [e for e, v in self.sel_events.items() if v.get()]
        cfg["weapons"]     = [w for w, v in self.sel_weapons.items() if v.get()]
        cfg["map_filter"]  = [dk for dk, v in self._map_filter_vars.items() if v.get()]
        # Compat: output_dir mirrors output_dir_clips
        if cfg.get("output_dir_clips"):
            cfg["output_dir"] = cfg["output_dir_clips"]
        cfg["steam_ids"]   = self.player_search.get_steam_ids()
        cfg["steam_id"]    = self.player_search.get_steam_id()    # compat
        cfg["player_name"] = self.player_search.get_name()
        cfg["active_tags"] = self._get_active_tag_names()         # names of checked tags
        cfg["recsys"] = self._normalize_recsys(cfg.get("recsys", "HLAE"))
        cfg["kill_mod_logic_mods"] = "mixed"
        cfg["kill_mod_logic_dp2"] = "mixed"
        cfg["kill_mod_logic_db"] = "mixed"
        return cfg

    def _auto_save(self):
        save_config(self._collect_config())
        self.after(5000, self._auto_save)

    def _apply_config(self, cfg, keys=None):
        for k, val in cfg.items():
            if keys and k not in keys:
                continue
            # Backward compat: old bool headshots_only → headshots_mode
            if k == "headshots_only":
                if val and "headshots_mode" not in cfg:
                    if "headshots_mode" in self.v:
                        self.v["headshots_mode"].set("only")
                continue
            # Backward compat: old cs2_minimize → cs2_send_to_back
            if k == "cs2_minimize":
                if val and "cs2_send_to_back" not in cfg:
                    if "cs2_send_to_back" in self.v:
                        self.v["cs2_send_to_back"].set(True)
                continue
            # Backward compat: old include_suicides bool → suicides_mode string
            if k == "include_suicides":
                if "suicides_mode" not in cfg and "suicides_mode" in self.v:
                    self.v["suicides_mode"].set("include" if val else "exclude")
                continue
            if k in self.v:
                if k == "encoder" and val not in ENCODER_OPTIONS:
                    val = "FFmpeg"
                if k == "recsys":
                    val = self._normalize_recsys(val)
                self.v[k].set(iso_to_display(str(val)) if k in ("date_from", "date_to") else val)
            elif k == "events":
                for e in EVENTS:
                    self.sel_events[e].set(e in val)
            elif k == "weapons":
                for w, v in self.sel_weapons.items():
                    v.set(w in val)
            elif k == "map_filter" and isinstance(val, list):
                sel = set(val)
                for dk, v in self._map_filter_vars.items():
                    v.set(dk in sel)
            elif k == "steam_ids" and isinstance(val, list):
                self.player_search._active_sids.clear()
                for sid in val:
                    for p in self.player_search._saved_players:
                        if p["steam_id"] == sid:
                            self.player_search._active_sids.add(sid)
                            self.player_search._active_names[sid] = p["name"]
                            break
                self.player_search._refresh_saved_display()
            elif k == "steam_id" and val and not cfg.get("steam_ids"):
                # Compat legacy single-player config
                for p in self.player_search._saved_players:
                    if p["steam_id"] == val:
                        self.player_search._active_sids.add(val)
                        self.player_search._active_names[val] = p["name"]
                        self.player_search._refresh_saved_display()
                        break
                else:
                    self._pending_restore_sid = val
            elif k == "active_tags" and isinstance(val, list) and val:
                # Restore checked tags — deferred if DB not yet ready
                self._restore_active_tags(val)

    def _restore_active_tags(self, tag_names):
        """Restore the set of active (checked) tags from a list of names.
        If _tags_list is not yet populated (DB not connected), stores the names
        in _pending_restore_tags for deferred restoration on _on_load_success."""
        if self._tags_list:
            self._tags_active.clear()
            for tid, tn, _ in self._tags_list:
                if tn in tag_names:
                    self._tags_active.add(tid)
            try:
                self._refresh_tags_list_display()
            except Exception:
                pass
        else:
            self._pending_restore_tags = list(tag_names)


    # ── Map-column detection ────────────────────────────────────────────────────
    # CSDM stores map_name in the `demos` table (not `matches`).
    # If a future version moves it back to `matches`, the candidates list handles it.
    # Returns (col, alias, join_sql) where:
    #   col      — column name,  e.g. "map_name"
    #   alias    — SQL table alias to prefix the column ("m" for matches, "d" for demos)
    #   join_sql — extra JOIN clause to append to FROM, or "" if the col is in matches
    _MAP_COL_CANDIDATES = ("map_name", "game_map", "map", "level_name", "server_map")

    @staticmethod
    def _detect_map_col(schema):
        """Return (col, alias, join_sql) for the map-name column, or (None, "m", "")."""
        matches_cols = schema.get("matches", [])
        demos_cols   = schema.get("demos",   [])

        # 1. Try matches directly (col present in matches table)
        for c in App._MAP_COL_CANDIDATES:
            if c in matches_cols:
                return c, "m", ""
        fallback_m = next((c for c in matches_cols if "map" in c.lower()), None)
        if fallback_m:
            return fallback_m, "m", ""

        # 2. Try demos table joined on checksum
        if demos_cols:
            demos_ck   = next((c for c in demos_cols   if c.lower() == "checksum"), None)
            matches_ck = next((c for c in matches_cols if c.lower() == "checksum"), None)
            if demos_ck and matches_ck:
                join_sql = f'LEFT JOIN demos d ON d."{demos_ck}" = m."{matches_ck}"'
                for c in App._MAP_COL_CANDIDATES:
                    if c in demos_cols:
                        return c, "d", join_sql
                fallback_d = next((c for c in demos_cols if "map" in c.lower()), None)
                if fallback_d:
                    return fallback_d, "d", join_sql

        return None, "m", ""

    def _connect_and_load(self):
        self._sync_pg_params()
        self.db_status.set("[DB:...]")
        self.db_status_lbl.config(fg=YELLOW)

        def task():
            try:
                conn = self._pg_fresh()
                try:
                    with conn.cursor() as cur:
                        schema = {}
                        col_types = {}
                        for t in ["kills", "matches", "demos", "rounds", "players", "tags",
                                  "checksum_tags", "match_tags"]:
                            cur.execute(
                                "SELECT column_name, data_type FROM information_schema.columns "
                                "WHERE table_name=%s ORDER BY ordinal_position", (t,))
                            ri = cur.fetchall()
                            cols = [r[0] for r in ri]
                            types = {r[0]: r[1] for r in ri}
                            if cols:
                                schema[t] = cols
                                col_types[t] = types

                        # Fetch players with their last-seen match date for sorting
                        _m_cols_check = schema.get("matches", [])
                        _date_col_for_players = next(
                            (c for c in _m_cols_check
                             if col_types.get("matches", {}).get(c, "").lower()
                             in {"date","timestamp","timestamp with time zone",
                                 "timestamp without time zone","timestamptz","bigint","integer","int","int4","int8"}
                             and "analyze" not in c.lower()),
                            None)
                        _pmk_col = next(
                            (c for c in schema.get("players", [])
                             if c.lower() in ("match_checksum","match_id","checksum")),
                            None)
                        _mmk_col = next(
                            (c for c in schema.get("matches", [])
                             if c.lower() in ("checksum","id","match_id")),
                            None)
                        if _date_col_for_players and _pmk_col and _mmk_col:
                            try:
                                cur.execute(
                                    f'SELECT DISTINCT ON (p.steam_id) p.name, p.steam_id, '
                                    f'MAX(m."{_date_col_for_players}") as last_seen '
                                    f'FROM players p '
                                    f'LEFT JOIN matches m ON m."{_mmk_col}" = p."{_pmk_col}" '
                                    f'WHERE p.name IS NOT NULL AND p.steam_id IS NOT NULL '
                                    f"AND p.name!='' AND p.steam_id!='' "
                                    f'GROUP BY p.steam_id, p.name '
                                    f'ORDER BY p.steam_id, last_seen DESC NULLS LAST')
                                rows = [(r[0], r[1], r[2]) for r in cur.fetchall()]
                            except Exception:
                                cur.execute(
                                    "SELECT DISTINCT p.name, p.steam_id FROM players p "
                                    "WHERE p.name IS NOT NULL AND p.steam_id IS NOT NULL "
                                    "AND p.name!='' AND p.steam_id!='' ORDER BY p.name")
                                rows = [(r[0], r[1], None) for r in cur.fetchall()]
                        else:
                            cur.execute(
                                "SELECT DISTINCT p.name, p.steam_id FROM players p "
                                "WHERE p.name IS NOT NULL AND p.steam_id IS NOT NULL "
                                "AND p.name!='' AND p.steam_id!='' ORDER BY p.name")
                            rows = [(r[0], r[1], None) for r in cur.fetchall()]

                        _m_types = col_types.get("matches", {})
                        _m_cols  = schema.get("matches", [])
                        _DATE_TYPES = {
                            "date", "timestamp", "timestamp with time zone",
                            "timestamp without time zone", "timestamptz",
                        }
                        _INT_TYPES = {"bigint", "integer", "int", "int4", "int8",
                                      "smallint", "int2", "numeric"}

                        # Candidate columns: date/timestamp type, OR bigint with date-like name,
                        # OR text with 'date'/'time' in name
                        _candidates = []
                        for c in _m_cols:
                            t = _m_types.get(c, "").lower()
                            clow = c.lower()
                            if t in _DATE_TYPES:
                                _candidates.append(c)
                            elif any(it in t for it in _INT_TYPES) and (
                                    "date" in clow or "time" in clow or "played" in clow):
                                _candidates.append(c)
                            elif "text" in t and ("date" in clow or "time" in clow):
                                _candidates.append(c)

                        _SUSPECT = ("analyze", "created", "import", "added", "updated")
                        best_col, best_score = None, -1
                        for c in _candidates:
                            try:
                                cur.execute(
                                    f'SELECT COUNT(DISTINCT "{c}") FROM '
                                    f'(SELECT "{c}" FROM matches '
                                    f' WHERE "{c}" IS NOT NULL LIMIT 30) sub')
                                n_distinct = cur.fetchone()[0] or 0
                            except Exception:
                                n_distinct = 0
                            penalty = 5 if any(s in c.lower() for s in _SUSPECT) else 0
                            score = n_distinct - penalty
                            if score > best_score:
                                best_score = score
                                best_col = c

                        dc = best_col
                        dc_type = _m_types.get(dc, "").lower() if dc else ""

                        cur.execute(
                            "SELECT DISTINCT weapon_name FROM kills "
                            "WHERE weapon_name IS NOT NULL AND weapon_name!='' ORDER BY weapon_name")
                        weapons = [r[0] for r in cur.fetchall()]

                        # Detect distinct game_mode_str values for match type filter.
                        # game_mode_str is the authoritative column (text, e.g. "premier",
                        # "scrimcomp2v2"). game_mode (integer) is a numeric fallback.
                        # Never use "type" or "source" — those hold the match source
                        # ("Matchmaking", "Faceit"…), not the game mode.
                        match_types_found: list = []
                        _gm_col = next(
                            (c for c in schema.get("matches", [])
                             if c.lower() == "game_mode_str"),
                            None)
                        if not _gm_col:
                            # Numeric fallback — less readable but still filterable
                            _gm_col = next(
                                (c for c in schema.get("matches", [])
                                 if c.lower() == "game_mode"),
                                None)
                        if _gm_col:
                            try:
                                cur.execute(
                                    f'SELECT DISTINCT "{_gm_col}" FROM matches '
                                    f'WHERE "{_gm_col}" IS NOT NULL ORDER BY "{_gm_col}"')
                                match_types_found = [str(r[0]) for r in cur.fetchall() if r[0]]
                            except Exception:
                                match_types_found = []

                        # Detect map column (may be in matches or demos) and fetch distinct values.
                        _MAP_PREFIXES = ("de_", "cs_", "ar_", "gg_", "dz_", "tr_")
                        maps_found: list = []
                        _mc, _ma, _mj = App._detect_map_col(schema)
                        if _mc:
                            # Fetch from the owning table directly (no join needed for DISTINCT)
                            _map_src_table = "demos" if _ma == "d" else "matches"
                            try:
                                cur.execute(
                                    f'SELECT DISTINCT "{_mc}" FROM {_map_src_table} '
                                    f'WHERE "{_mc}" IS NOT NULL ORDER BY "{_mc}"')
                                _raw_maps = [str(r[0]).strip() for r in cur.fetchall() if r[0]]
                                # Deduplicate by display key (stripped prefix, lowercase)
                                _disp: dict = {}
                                for _rv in _raw_maps:
                                    _dk = _rv.lower()
                                    for _pfx in _MAP_PREFIXES:
                                        if _dk.startswith(_pfx):
                                            _dk = _dk[len(_pfx):]
                                            break
                                    _disp.setdefault(_dk, []).append(_rv)
                                maps_found = sorted(_disp.items())   # [(display_key, [raw_vals])]
                            except Exception:
                                maps_found = []

                        tags_data = []
                        tags_schema_info = {}
                        if "tags" in schema:
                            tc = schema["tags"]
                            tt = col_types.get("tags", {})
                            id_col = next((c for c in tc if c in ("id", "tag_id")), tc[0] if tc else None)
                            id_col_type = tt.get(id_col, "bigint")
                            name_col = next((c for c in tc if c in ("name", "tag_name")), None)
                            color_col = next((c for c in tc if c in ("color", "tag_color")), None)

                            jt = None
                            jt_tag_col = None
                            jt_match_col = None
                            jt_col_types = {}

                            for jtable in ("checksum_tags", "match_tags"):
                                if jtable in schema:
                                    jcols = schema[jtable]
                                    jtypes = col_types.get(jtable, {})
                                    candidate_tag = None
                                    candidate_match = None
                                    for c in jcols:
                                        cl = c.lower()
                                        if "tag" in cl and "checksum" not in cl and "match" not in cl:
                                            candidate_tag = c
                                        elif any(k in cl for k in ("checksum", "match", "demo")):
                                            candidate_match = c
                                    if candidate_tag and candidate_match:
                                        jt = jtable
                                        jt_tag_col = candidate_tag
                                        jt_match_col = candidate_match
                                        jt_col_types = jtypes
                                        break

                            if not jt:
                                for jtable in ("checksum_tags", "match_tags"):
                                    if jtable in schema:
                                        jcols = schema[jtable]
                                        if len(jcols) >= 2:
                                            jt = jtable
                                            jt_match_col = jcols[0]
                                            jt_tag_col = jcols[1]
                                            jt_col_types = col_types.get(jtable, {})
                                            break

                            tags_schema_info = {
                                "table": "tags",
                                "id_col": id_col,
                                "id_col_type": id_col_type,
                                "name_col": name_col,
                                "color_col": color_col,
                                "junction_table": jt,
                                "jt_tag_col": jt_tag_col,
                                "jt_match_col": jt_match_col,
                                "jt_col_types": jt_col_types,
                            }

                            if name_col and id_col:
                                sel = f'"{id_col}","{name_col}"'
                                if color_col:
                                    sel += f',"{color_col}"'
                                cur.execute(f'SELECT {sel} FROM tags ORDER BY "{name_col}"')
                                for r in cur.fetchall():
                                    tags_data.append(
                                        (r[0], r[1] if len(r) > 1 else str(r[0]),
                                         r[2] if len(r) > 2 and color_col else ""))
                finally:
                    conn.close()
                players = [(f"{n}  ({s})", s, n, d) for n, s, d in rows]
                names = {s: n for n, s, *_ in rows}
                self.after(0, lambda: self._on_load_ok(players, dc, dc_type, weapons, schema,
                                                        col_types, names, tags_data, tags_schema_info,
                                                        match_types_found, maps_found, _mc, _ma, _mj))
            except Exception as e:
                self.after(0, lambda err=e: self._on_load_fail(err))

        threading.Thread(target=task, daemon=True).start()

    def _on_load_ok(self, players, dc, dc_type, weapons, schema, col_types, names,
                    tags_data, tags_schema, match_types_found=None,
                    maps_found=None, map_col=None, map_alias="m", map_join=""):
        self._date_col      = dc
        self._date_col_type = dc_type   # actual SQL type: bigint, timestamp, date, text…
        self._db_schema     = schema
        self._db_col_types  = col_types
        self._player_names  = names
        self._tags_list     = tags_data
        self._tags_schema   = tags_schema
        self._demo_checksums = {}
        self._demo_dates     = {}
        self._demo_map_cache = {}
        self._ts_cache       = {}
        self._col_cache      = {}
        self._warned_missing_mods = set()  # reset so re-connect re-checks column presence
        self._warned_require_win_no_data = False
        self._db_match_types = match_types_found or []
        self._db_maps        = maps_found or []   # [(display_key, [raw_vals])] or []
        self._map_col        = map_col    # column name, e.g. "map_name"; None = unavailable
        self._map_alias      = map_alias  # SQL alias: "m" (matches) or "d" (demos)
        self._map_join       = map_join   # extra JOIN clause, e.g. "LEFT JOIN demos d ON ..."

        # Warn (log only) if the date column was not detected
        if not dc:
            self._async_log("⚠ Date column not detected in matches — date filter disabled", "warn")

        self.db_status.set(
            f"[DB:OK] {len(players)}P·{len(tags_data)}T"
            + ("" if dc else " ⚠date?"))
        self.db_status_lbl.config(fg=GREEN)

        # Deferred restoration (preset loaded before DB was ready)
        restore_sid = self._pending_restore_sid or ""
        self._pending_restore_sid = None
        self.player_search.set_players(players, restore_steam_id=restore_sid)

        self._build_weapons(weapons)
        self._refresh_match_type_ui()
        self._refresh_map_filter_ui()

        self._refresh_tags_list_display()

        # Deferred tag restoration (config loaded before DB was ready)
        if self._pending_restore_tags:
            self._restore_active_tags(self._pending_restore_tags)
            self._pending_restore_tags = []

    def _on_load_fail(self, err):
        self.db_status.set(f"[DB:ERR] {err}")
        self.db_status_lbl.config(fg=RED)

    # ═══════════════════════════════════════════════════
    #  Weapons grouped by category
    # ═══════════════════════════════════════════════════
    def _build_weapons(self, weapons):
        saved = self.cfg.get("weapons", [])

        # Grenades always present regardless of whether they have kills in DB
        _FORCED_GRENADES = [
            "HE Grenade", "Flashbang", "Smoke Grenade",
            "Incendiary Grenade", "Molotov", "Decoy Grenade",
        ]
        weapons = list(weapons)
        for g in _FORCED_GRENADES:
            if g not in weapons:
                weapons.append(g)

        for w in weapons:
            if w not in self.sel_weapons:
                self.sel_weapons[w] = tk.BooleanVar(value=(w in saved))

        if self._wg_frame:
            self._wg_frame.destroy()
        self._total_weapons = len(weapons)
        self._refresh_weapon_label()

        self._wg_frame = tk.Frame(self._sec_w, bg=BG2)
        self._wg_frame.pack(fill="x", pady=(4, 0))

        categorized = {}
        for w in weapons:
            cat = _weapon_category(w)
            categorized.setdefault(cat, []).append(w)

        self._cat_vars = {}

        for cat in sorted(categorized.keys(), key=lambda c: list(WEAPON_CATEGORIES.keys()).index(c)
                          if c in WEAPON_CATEGORIES else 999):
            if cat == "Other":
                continue  # unknown DB weapon names are silently dropped from the UI
            cat_weapons = categorized[cat]
            cat_frame = tk.Frame(self._wg_frame, bg=BG2)
            cat_frame.pack(fill="x", pady=(4, 0))

            cat_var = tk.BooleanVar(value=all(
                self.sel_weapons.get(w, tk.BooleanVar(value=False)).get() for w in cat_weapons))
            self._cat_vars[cat] = (cat_var, cat_weapons)

            hdr = tk.Frame(cat_frame, bg=BG2)
            hdr.pack(fill="x")
            _icon = WEAPON_ICONS.get(cat, "")
            _cat_cb = tk.Checkbutton(hdr, text=f"{_icon} {cat}  ({len(cat_weapons)})", variable=cat_var,
                           **{**_CHK_KW, "font": FONT_SM_B, "fg": ORANGE},
                           command=lambda c=cat: self._toggle_category(c))
            _cat_cb.pack(side="left")

            wf = tk.Frame(cat_frame, bg=BG2, padx=16)
            wf.pack(fill="x")
            for i, w in enumerate(cat_weapons):
                cb = hchk(wf, w, self.sel_weapons[w],
                          command=lambda c=cat: self._update_cat_var(c))
                cb.grid(row=i // 4, column=i % 4, sticky="w", padx=4, pady=1)

    def _weapons_select_all(self):
        for v in self.sel_weapons.values():
            v.set(True)
        for cat in self._cat_vars:
            self._cat_vars[cat][0].set(True)
        self._refresh_weapon_label()

    def _weapons_deselect_all(self):
        for v in self.sel_weapons.values():
            v.set(False)
        for cat in self._cat_vars:
            self._cat_vars[cat][0].set(False)
        self._refresh_weapon_label()

    def _refresh_weapon_label(self):
        total = getattr(self, "_total_weapons", len(self.sel_weapons))
        n_sel = sum(1 for v in self.sel_weapons.values() if v.get())
        if n_sel == 0 or n_sel == total:
            self._wg_lbl.config(text=f"weapons  (all / {total})", fg=MUTED)
        else:
            self._wg_lbl.config(text=f"weapons  ({n_sel} / {total} selected)", fg=ORANGE)

    def _toggle_category(self, cat):
        cat_var, weapons = self._cat_vars[cat]
        val = cat_var.get()
        for w in weapons:
            if w in self.sel_weapons:
                self.sel_weapons[w].set(val)
        self._refresh_weapon_label()

    def _update_cat_var(self, cat):
        cat_var, weapons = self._cat_vars[cat]
        all_on = all(self.sel_weapons.get(w, tk.BooleanVar(value=False)).get() for w in weapons)
        cat_var.set(all_on)
        self._refresh_weapon_label()

    # ═══════════════════════════════════════════════════
    #  Tags DB
    # ═══════════════════════════════════════════════════
    def _refresh_match_type_ui(self):
        """Rebuild the match type checkboxes.

        All 13 known types are always shown.  Types NOT found in the DB are
        greyed-out and disabled so the user can see what exists but cannot
        accidentally filter on phantom modes.  The section itself is always
        visible (never hidden) — it is built during _tab_capturer so it is
        always present.
        """
        try:
            frame = self._match_type_frame
        except AttributeError:
            return  # UI not built yet — called again from _on_load_ok after build

        for w in frame.winfo_children():
            w.destroy()

        found = set(self._db_match_types)

        # Enable toggle row
        toggle_row = tk.Frame(frame, bg=BG2)
        toggle_row.pack(fill="x")
        _en_cb = hchk(toggle_row, "Filter by type", self.v["match_type_filter_enabled"],
                      command=self._on_match_type_toggle)
        _en_cb.pack(side="left")
        add_tip(_en_cb,
                "When checked: only demos matching at least one selected type are included.\n"
                "When unchecked: all match types pass (no SQL overhead).\n"
                "Greyed-out types are not present in your database.")

        # Checkbox grid — all types, wrap to new row every 4
        cb_frame = tk.Frame(frame, bg=BG2)
        cb_frame.pack(fill="x", pady=(4, 0))
        self._mt_checkboxes: list = []   # [(widget, in_db)]

        for col_idx, (db_vals, cfg_k, lbl) in enumerate(MATCH_TYPE_DEFS):
            in_db = any(v in found for v in db_vals)
            _cb = hchk(cb_frame, lbl, self.v[cfg_k])
            _cb.grid(row=col_idx // 4, column=col_idx % 4, sticky="w", padx=(0, 12), pady=1)
            vals_str = ", ".join(f"'{v}'" for v in db_vals)
            tip = (f"game_mode_str IN ({vals_str})  —  found in your database."
                   if in_db else
                   f"game_mode_str IN ({vals_str})  —  not found in your database (greyed out).")
            add_tip(_cb, tip)
            self._mt_checkboxes.append((_cb, in_db))

        self._on_match_type_toggle()

    def _on_match_type_toggle(self, *_):
        """Apply enable/disable state to all type checkboxes.

        Rules:
          - master toggle OFF  → all checkboxes disabled (no filter active)
          - master toggle ON   → in-DB types enabled, out-of-DB types stay disabled
        """
        try:
            enabled = self.v["match_type_filter_enabled"].get()
            for cb, in_db in self._mt_checkboxes:
                cb.config(state=("normal" if (enabled and in_db) else "disabled"))
        except AttributeError:
            pass  # checkboxes not built yet

    def _refresh_map_filter_ui(self):
        """Rebuild map filter checkboxes from self._db_maps.

        Called from _on_load_ok (after DB connect) and at UI build time.
        If no map column found, shows a note and disables the filter.
        """
        try:
            frame = self._map_filter_frame
        except AttributeError:
            return  # UI not built yet

        for w in frame.winfo_children():
            w.destroy()

        # Enable toggle row
        toggle_row = tk.Frame(frame, bg=BG2)
        toggle_row.pack(fill="x")
        has_maps = bool(self._db_maps)
        _en_cb = hchk(toggle_row, "Filter by map", self.v["map_filter_enabled"],
                      command=self._on_map_filter_toggle)
        _en_cb.pack(side="left")
        _en_cb.config(state="normal" if has_maps else "disabled")
        add_tip(_en_cb,
                "When checked: only demos on the selected maps are included.\n"
                "When unchecked: all maps pass (no SQL overhead).\n"
                "Maps are loaded from your database on connect.")

        if not has_maps:
            tk.Label(toggle_row, text="  No map column found in DB",
                     font=FONT_DESC, fg=MUTED, bg=BG2).pack(side="left", padx=(8, 0))
            return

        # Checkbox grid — wrap every 4
        cb_frame = tk.Frame(frame, bg=BG2)
        cb_frame.pack(fill="x", pady=(4, 0))
        self._map_filter_vars = {}
        for col_idx, (dk, _raw_vals) in enumerate(self._db_maps):
            var = tk.BooleanVar(value=False)
            self._map_filter_vars[dk] = var
            lbl = dk.capitalize()
            _cb = hchk(cb_frame, lbl, var)
            _cb.grid(row=col_idx // 4, column=col_idx % 4, sticky="w", padx=(0, 12), pady=1)
            add_tip(_cb, f"DB value(s): {', '.join(_raw_vals)}")

        self._on_map_filter_toggle()

    def _on_map_filter_toggle(self, *_):
        """Enable/disable map checkboxes based on master toggle."""
        try:
            enabled = self.v["map_filter_enabled"].get()
            for cb in self._map_filter_frame.winfo_children():
                # Skip the toggle row itself; target only the cb_frame children
                pass
            # Walk all checkboxes inside the cb_frame (second child of frame)
            children = self._map_filter_frame.winfo_children()
            if len(children) >= 2:
                cb_frame = children[1]
                for w in cb_frame.winfo_children():
                    w.config(state="normal" if enabled else "disabled")
        except (AttributeError, tk.TclError):
            pass


    def _create_new_tag_dialog(self, from_combo=True):
        ts = self._tags_schema
        if not ts.get("name_col"):
            messagebox.showerror("Tags", "Tags schema not detected.")
            return None
        name = simpledialog.askstring("New tag", "Tag name:", parent=self)
        if not name or not name.strip():
            return None
        name = name.strip()
        color = "#f97316"
        if ts.get("color_col"):
            dlg = ColorPickerDialog(self, initial_color="#f97316")
            if dlg.result:
                color = dlg.result
            else:
                return None
        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                new_id = _generate_id_for_type(ts.get("id_col_type", "bigint"))
                cols_sql = f'"{ts["id_col"]}","{ts["name_col"]}"'
                vals = [new_id, name]
                if ts.get("color_col"):
                    cols_sql += f',"{ts["color_col"]}"'
                    vals.append(color)
                cur.execute(f'INSERT INTO tags ({cols_sql}) VALUES ({",".join(["%s"] * len(vals))})', vals)
                conn.commit()
            conn.close()
            self._tags_list.append((new_id, name, color))
    
            self._refresh_tags_list_display()
            self._log(f"Tag '{name}' created (id={new_id})", "ok")
            return name
        except Exception as e:
            messagebox.showerror("Tags", f"Error:\n{e}")
            return None

    def _delete_tag_from_db(self, tag_id, tag_name):
        ts = self._tags_schema
        if not ts.get("id_col"):
            return False, "Unknown schema"
        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                jt = ts.get("junction_table")
                jt_tag = ts.get("jt_tag_col")
                if jt and jt_tag:
                    cur.execute(f'DELETE FROM "{jt}" WHERE "{jt_tag}"=%s', (tag_id,))
                cur.execute(f'DELETE FROM tags WHERE "{ts["id_col"]}"=%s', (tag_id,))
                conn.commit()
            conn.close()
            self._tags_list = [t for t in self._tags_list if t[0] != tag_id]
            return True, ""
        except Exception as e:
            return False, str(e)

    def _untag_demo(self, demo_path, tag_name):
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        if not jt or not jt_tag or not jt_match:
            return False, "Junction table not found"

        tag_id = next((tid for tid, tn, _ in self._tags_list if tn == tag_name), None)
        if tag_id is None:
            return False, f"Tag '{tag_name}' not found"

        checksum = self._get_demo_checksum(demo_path)
        if not checksum:
            # Last resort: direct query bypassing cache
            dc = self._find_col("matches", ["demo_path", "demo_file_path", "demo_filepath",
                                             "share_code", "file_path", "path"])
            mkm = self._find_col("matches", ["checksum", "id", "match_id"])
            if dc and mkm:
                try:
                    conn = self._pg_fresh()
                    with conn.cursor() as cur:
                        name = os.path.basename(demo_path)
                        cur.execute(f'SELECT "{mkm}" FROM matches WHERE "{dc}" LIKE %s LIMIT 1',
                                    (f"%{name}",))
                        r = cur.fetchone()
                        if r:
                            checksum = r[0]
                            self._demo_checksums[demo_path] = checksum
                    conn.close()
                except Exception:
                    pass
        if not checksum:
            return False, f"Checksum not found for {os.path.basename(demo_path)}"

        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                cur.execute(
                    f'DELETE FROM "{jt}" WHERE "{jt_match}"=%s AND "{jt_tag}"=%s',
                    (checksum, tag_id))
                conn.commit()
            conn.close()
            return True, ""
        except Exception as e:
            return False, str(e)

    def _do_tag_demos(self, demos, tag_name):

        self._tag_log_line(f"=== Tag '{tag_name}' on {len(demos)} demo(s) ===")

        def task():
            ok = 0
            err_first = ""
            for dp in demos:
                self._tag_log_line(f"\n-> {os.path.basename(dp)}")
                cached = dp in self._demo_checksums
                self._tag_log_line(f"   checksum cache: {'OUI' if cached else 'NON'}")
                success, err = self._tag_demo(dp, tag_name)
                if success:
                    ok += 1
                else:
                    self._tag_log_line(f"   FAILED: {err}")
                    if not err_first:
                        err_first = err

            def finish():
                if ok == len(demos):
                    self._async_log(f"Tags ✓ '{tag_name}' assigned to {ok}/{len(demos)} demo(s).", "ok")
                    self._tag_search_status.config(text=f"✓ {ok}/{len(demos)}", fg=GREEN)
                elif ok > 0:
                    self._async_log(f"Tags ⚠ {ok}/{len(demos)} OK — {err_first}", "warn")
                    self._tag_search_status.config(text=f"⚠ {ok}/{len(demos)}", fg=YELLOW)
                else:
                    self._async_log(f"Tags ✗ failed: {err_first}", "err")
                    self._tag_search_status.config(text="✗ failed", fg=RED)

            self.after(0, finish)

        threading.Thread(target=task, daemon=True).start()

    # ═══════════════════════════════════════════════════
    #  UI
    # ═══════════════════════════════════════════════════
    def _build_ui(self):
        # Style ttk plat (clam) — source unique, avant tout widget ttk.
        apply_ttk_style(self)

        # ── Global MouseWheel dispatcher ──────────────────────────────────────
        # One handler for all tabs. Scrolls the ScrollableFrame under the cursor;
        # yields to Text/Listbox/Treeview which handle their own wheel events.
        _NATIVE_SCROLL = (tk.Text, tk.Listbox, tk.Scale)
        def _global_wheel(event):
            w = event.widget
            # Walk up the widget tree; if a native-scroll widget is in the path,
            # let the default binding handle it.
            node = w
            while node:
                if isinstance(node, _NATIVE_SCROLL):
                    return
                if hasattr(ttk, "Treeview") and isinstance(node, ttk.Treeview):
                    return
                node = getattr(node, "master", None)
            for sf in _SCROLL_FRAMES:
                if sf.contains_point(event.x_root, event.y_root):
                    sf.scroll(event.delta)
                    return "break"
        self.bind_all("<MouseWheel>", _global_wheel)

        # Flush all deferred layout on mouse release — covers sash drag and any
        # in-app resize. OS window-border resize falls back to the 400 ms
        # debounce (Tkinter never receives those ButtonRelease events).
        # 50 ms delay lets the PanedWindow geometry manager finish propagating
        # its new sash position as <Configure> events on all Canvas children
        # (setting _pending_width) before we call _apply_width.
        def _on_release(e):
            def _flush():
                for sf in _SCROLL_FRAMES:
                    sf._apply_width()
                for apply_fn, lbl in list(_WRAP_LABELS):
                    try:
                        if lbl.winfo_exists():
                            apply_fn()
                    except tk.TclError:
                        pass
                for wr in list(_WRAP_ROWS):
                    try:
                        if wr.winfo_exists():
                            wr._relayout()
                    except tk.TclError:
                        pass
            self.after(50, _flush)
        self.bind_all("<ButtonRelease-1>", _on_release)

        # ── Top header bar ────────────────────────────────────────────────────
        hdr = tk.Frame(self, bg=BG2)
        hdr.pack(fill="x")

        # Left accent stripe
        tk.Frame(hdr, width=4, bg=ORANGE).pack(side="left", fill="y")

        inner_hdr = tk.Frame(hdr, bg=BG2)
        inner_hdr.pack(side="left", fill="x", expand=True, padx=(10, 10), pady=7)

        tk.Label(inner_hdr, text="CSDM", font=FONT_TITLE_B,
                 bg=BG2, fg=TEXT).pack(side="left")
        tk.Label(inner_hdr, text=f" Batch {APP_VERSION}", font=FONT_TITLE_B,
                 bg=BG2, fg=ORANGE).pack(side="left")

        self._hdr_player_lbl = tk.Label(inner_hdr, text="", font=FONT_SM, bg=BG2, fg=MUTED)
        self._hdr_player_lbl.pack(side="left", padx=(14, 0))

        # Right side: DB status
        db_area = tk.Frame(inner_hdr, bg=BG2)
        db_area.pack(side="right")

        # Quick preset widget — left of DB area
        qp_area = tk.Frame(inner_hdr, bg=BG2)
        qp_area.pack(side="right", padx=(0, 16))
        tk.Label(qp_area, text="Preset:", font=FONT_DESC, bg=BG2, fg=MUTED).pack(side="left")
        self._quick_preset_var = tk.StringVar()
        self._quick_preset_combo = ttk.Combobox(
            qp_area, textvariable=self._quick_preset_var,
            width=18, state="readonly", font=FONT_SM)
        self._quick_preset_combo.pack(side="left", padx=(4, 0))
        self._quick_preset_combo.bind("<<ComboboxSelected>>",
                                      lambda _e: self._quick_preset_load())
        tk.Button(qp_area, text="💾", font=FONT_DESC, bg=BG2, fg=MUTED,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=ORANGE,
                  command=self._quick_preset_save).pack(side="left", padx=(4, 0))
        # Statut DB deja bracktee (ex: [DB:OK]) -> pas de prefixe "DB " redondant.
        self.db_status_lbl = tk.Label(db_area, textvariable=self.db_status,
                                      font=FONT_SM_B, bg=BG2, fg=YELLOW)
        self.db_status_lbl.pack(side="left")
        tk.Button(db_area, text=" ↺ ", font=FONT_DESC, bg=BG2, fg=MUTED,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=ORANGE,
                  command=self._connect_and_load).pack(side="left", padx=(4, 0))
        tk.Label(db_area, text=f"[{APP_VERSION}]", font=FONT_DESC, bg=BG2,
                 fg=MUTED).pack(side="left", padx=(8, 0))

        _sep(self, pady=0)

        # Gauche : notebook config (poids 5)
        # Right: run bar + vertical PanedWindow (notebook | log)
        outer = ttk.PanedWindow(self, orient="horizontal")
        outer.pack(fill="both", expand=True)
        self._outer_paned = outer

        left_frame = tk.Frame(outer, bg=BG)
        outer.add(left_frame, weight=3)

        nb = ttk.Notebook(left_frame)
        nb.pack(fill="both", expand=True)
        for title, builder in [("Capture", self._tab_capturer), ("Tags", self._tab_tags),
                                ("Video", self._tab_video), ("Settings", self._tab_outils)]:
            f = tk.Frame(nb, bg=BG)
            nb.add(f, text=f"  {title.upper()}  ")
            builder(f)

        def _on_tab_changed(_event=None):
            # Flush pending ScrollableFrame width jobs immediately so the newly
            # visible tab lays out at the correct width without the 400 ms delay.
            for sf in _SCROLL_FRAMES:
                sf._apply_width()
            for apply_fn, lbl in list(_WRAP_LABELS):
                try:
                    if lbl.winfo_exists():
                        apply_fn()
                except tk.TclError:
                    pass
            for wr in list(_WRAP_ROWS):
                try:
                    if wr.winfo_exists():
                        wr._relayout()
                except tk.TclError:
                    pass
        nb.bind("<<NotebookTabChanged>>", _on_tab_changed)

        right_frame = tk.Frame(outer, bg=BG)
        outer.add(right_frame, weight=2)
        right_frame.rowconfigure(1, weight=1)
        right_frame.columnconfigure(0, weight=1)

        # ── Run bar ───────────────────────────────────────────────────────────
        # Cadre 1px comme les cartes Sec (cellule de grille).
        run_bar = tk.Frame(right_frame, bg=BG2,
                           highlightthickness=1, highlightbackground=BORDER,
                           highlightcolor=BORDER)
        run_bar.grid(row=0, column=0, sticky="ew")

        # Top accent line on run bar
        tk.Frame(run_bar, height=1, bg=ORANGE).pack(fill="x")

        ctrl = tk.Frame(run_bar, bg=BG2)
        ctrl.pack(fill="x", padx=10, pady=(6, 4))

        # Primary action buttons — RUN gets accent colour, others are muted
        self.run_btn = tk.Button(
            ctrl, text="▶  RUN", font=FONT_MONO_B,
            bg=ORANGE, fg="white", relief="flat", cursor="hand2", bd=0,
            highlightthickness=0, activebackground=ORANGE2, activeforeground="white",
            command=self._run)
        self.run_btn.pack(side="left", ipady=6, ipadx=12)

        tk.Frame(ctrl, width=1, bg=BORDER).pack(side="left", fill="y", padx=6)

        tk.Button(
            ctrl, text="🔍 PREVIEW", font=FONT_SM_B, bg=BG3, fg=BLUE,
            relief="flat", cursor="hand2", bd=0, highlightthickness=0,
            activebackground=BORDER, activeforeground=BLUE,
            command=self._dry_run).pack(side="left", ipady=5, ipadx=8)

        tk.Frame(ctrl, width=1, bg=BORDER).pack(side="left", fill="y", padx=6)

        self.stop_btn = tk.Button(
            ctrl, text="⏸ STOP", font=FONT_SM_B,
            bg=BG3, fg=MUTED, relief="flat", cursor="hand2", bd=0,
            state="disabled", highlightthickness=0,
            activebackground=BORDER, activeforeground=RED,
            command=self._handle_stop)
        self.stop_btn.pack(side="left", ipady=5, ipadx=8)

        self.kill_btn = tk.Button(
            ctrl, text="⛔ KILL", font=FONT_SM_B,
            bg=BG3, fg=MUTED, relief="flat", cursor="hand2", bd=0,
            state="disabled", highlightthickness=0,
            activebackground=BORDER, activeforeground=RED,
            command=self._kill_now)
        self.kill_btn.pack(side="left", padx=(4, 0), ipady=5, ipadx=8)


        self.progress_lbl = tk.Label(ctrl, text="", font=FONT_SM, bg=BG2, fg=MUTED)
        self.progress_lbl.pack(side="right")

        # Summary line below buttons
        _sep(run_bar, pady=0)
        self._summary_lbl = tk.Label(
            run_bar, text="", font=FONT_SM, bg=BG2, fg=MUTED,
            anchor="w", padx=10, pady=4)
        self._summary_lbl.pack(fill="x")

        # Log
        log_frame = tk.Frame(right_frame, bg=BG)
        log_frame.grid(row=1, column=0, sticky="nsew")
        self._build_log_panel(log_frame)

        self.bind("<Control-b>", self._toggle_log_badges)
        self.bind("<Control-f>", lambda e: self._log_search_open())

        # Position the sash once the window is actually visible
        # Wait for <Map> event then force geometry
        def _set_sash(event=None):
            self.update_idletasks()
            w = self.winfo_width()
            if w > 100:
                try:
                    pct = self._clamp_layout_values(
                        self.v["ui_window_w"].get(),
                        self.v["ui_window_h"].get(),
                        self.v["ui_split_pct"].get(),
                    )[2]
                    pos = int(w * (pct / 100.0))
                    pos = max(UI_PANE_LEFT_MIN, min(w - UI_PANE_RIGHT_MIN, pos))
                    outer.sashpos(0, pos)
                except Exception:
                    pass
        self.bind("<Map>", _set_sash)
        outer.bind("<ButtonRelease-1>", self._on_splitter_release, add="+")

    def _build_log_panel(self, parent):
        parent.rowconfigure(2, weight=1)
        parent.columnconfigure(0, weight=1)

        # Header row
        top = tk.Frame(parent, bg=BG2)
        top.grid(row=0, column=0, sticky="ew")
        tk.Frame(top, width=3, bg=ORANGE).pack(side="left", fill="y")

        inner_top = tk.Frame(top, bg=BG2)
        inner_top.pack(side="left", fill="x", expand=True, padx=(8, 8), pady=4)

        tk.Label(inner_top, text="LOG", font=FONT_SM_B,
                 fg=ORANGE, bg=BG2).pack(side="left")

        self._log_filter = tk.StringVar(value="All")
        filter_frame = tk.Frame(inner_top, bg=BG2)
        filter_frame.pack(side="left", padx=(10, 0))
        for lvl, col in [("All", TEXT), ("OK", GREEN), ("Err", RED), ("Warn", YELLOW), ("Info", ORANGE)]:
            tk.Radiobutton(filter_frame, text=lvl, variable=self._log_filter, value=lvl,
                           **{**_CHK_KW, "font": FONT_DESC, "fg": col, "activeforeground": col},
                           command=self._apply_log_filter).pack(side="left", padx=(0, 2))

        # Live error / warn counters — hidden when zero
        self._log_err_lbl = tk.Label(filter_frame, text="", font=FONT_DESC,
                                     fg=RED, bg=BG2)
        self._log_err_lbl.pack(side="left", padx=(6, 0))
        self._log_warn_lbl = tk.Label(filter_frame, text="", font=FONT_DESC,
                                      fg=YELLOW, bg=BG2)
        self._log_warn_lbl.pack(side="left", padx=(4, 0))

        self._log_autoscroll = tk.BooleanVar(value=True)
        tk.Checkbutton(inner_top, text="↓", variable=self._log_autoscroll,
                       **{**_CHK_KW, "font": FONT_DESC}).pack(side="right")
        self._log_ts_btn = tk.Button(
            inner_top, text="TS", font=FONT_DESC, bg=BG3, fg=MUTED,
            relief="flat", bd=0, cursor="hand2",
            activebackground=BORDER, activeforeground=ORANGE,
            highlightthickness=0, command=self._toggle_log_timestamps)
        self._log_ts_btn.pack(side="right", padx=(0, 4), ipady=2, ipadx=4)
        add_tip(self._log_ts_btn, "Toggle HH:MM:SS timestamps on each log entry.")
        self._log_badges_btn = tk.Button(
            inner_top, text="Badges", font=FONT_DESC, bg=BG3, fg=GREEN,
            relief="flat", bd=0, cursor="hand2",
            activebackground=BORDER, activeforeground=ORANGE,
            highlightthickness=0, command=self._toggle_log_badges)
        self._log_badges_btn.pack(side="right", padx=(0, 4), ipady=2, ipadx=4)
        add_tip(self._log_badges_btn,
                "Toggle inline clip badges in log entries.\nKeyboard: Ctrl+B")

        # Toolbar row
        btn_bar = tk.Frame(parent, bg=BG3)
        btn_bar.grid(row=1, column=0, sticky="ew")

        def _btn(text, cmd, fg=MUTED):
            return tk.Button(btn_bar, text=text, font=FONT_DESC, bg=BG3, fg=fg,
                             relief="flat", bd=0, cursor="hand2",
                             activebackground=BORDER, activeforeground=ORANGE,
                             highlightthickness=0, command=cmd)

        _btn("📋 Copy all",      self._log_copy_all).pack(side="left", padx=(8, 4), pady=3, ipady=2)
        _btn("📋 Copy sel.",      self._log_copy_sel).pack(side="left", padx=(0, 4), pady=3, ipady=2)
        _btn("💾 Save",      self._log_save, fg=BLUE).pack(side="left", padx=(0, 4), pady=3, ipady=2)
        _btn("🔍 Search",         self._log_search_open).pack(side="left", padx=(0, 4), pady=3, ipady=2)
        _export_btn = _btn("📤 Export ▾", None, fg=GREEN)
        _export_btn.pack(side="left", padx=(0, 4), pady=3, ipady=2)
        def _show_export_menu(btn=_export_btn):
            m = tk.Menu(btn_bar, tearoff=0, bg=BG3, fg=TEXT,
                        activebackground=BORDER, activeforeground=ORANGE,
                        relief="flat", bd=1)
            m.add_command(label="HTML  (.html)", command=self._export_preview_html)
            m.add_command(label="Text  (.txt)",  command=self._export_preview_txt)
            m.add_command(label="JSON  (.json)", command=self._export_preview_json)
            m.tk_popup(btn.winfo_rootx(), btn.winfo_rooty() + btn.winfo_height())
        _export_btn.config(command=_show_export_menu)
        _btn("🗑 Clear",          self._clear_log, fg=RED).pack(side="right", padx=(0, 8), pady=3, ipady=2)

        # Cadre 1px autour de la console (coherence avec les cellules Sec).
        log_frame = tk.Frame(parent, bg=BG,
                             highlightthickness=1, highlightbackground=BORDER,
                             highlightcolor=BORDER)
        log_frame.grid(row=2, column=0, sticky="nsew")
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)

        self.log_widget = tk.Text(log_frame, font=FONT_SM, bg=_t("LOG_BG"), fg=TEXT,
                           relief="flat", bd=0, insertbackground=ORANGE,
                           highlightthickness=0, state="disabled", wrap="word",
                           selectbackground=ORANGE2, selectforeground="white")
        self.log_widget.grid(row=0, column=0, sticky="nsew")
        sb = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_widget.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.log_widget.configure(yscrollcommand=sb.set)

        for tag, c in [("ok", GREEN), ("err", RED), ("info", ORANGE), ("dim", MUTED),
                        ("warn", YELLOW), ("blue", BLUE)]:
            self.log_widget.tag_configure(tag, foreground=c)
        self.log_widget.tag_configure("ts", foreground=_t("MUTED"))

        self.log_widget.bind("<Button-3>", self._log_right_click)

        self._search_bar = tk.Frame(parent, bg=BG2)
        self._search_bar.grid(row=3, column=0, sticky="ew")
        parent.rowconfigure(3, weight=0)
        self._search_bar.grid_remove()

        tk.Label(self._search_bar, text="Search:", font=FONT_DESC,
                 fg=MUTED, bg=BG2).pack(side="left", padx=(8, 4), pady=4)
        self._search_var = tk.StringVar()
        self._search_entry = tk.Entry(self._search_bar, textvariable=self._search_var,
                                      font=FONT_MONO, bg=BG3, fg=TEXT, insertbackground=ORANGE,
                                      relief="flat", bd=0, highlightthickness=1,
                                      highlightbackground=BORDER, highlightcolor=ORANGE, width=20)
        self._search_entry.pack(side="left", ipady=3)
        self._search_entry.bind("<Return>",  lambda e: self._log_search_next())
        self._search_entry.bind("<Escape>",  lambda e: self._log_search_close())
        self._search_count = tk.Label(self._search_bar, text="", font=FONT_DESC, fg=MUTED, bg=BG2)
        self._search_count.pack(side="left", padx=(6, 0))
        tk.Button(self._search_bar, text="▲", font=FONT_DESC, bg=BG3, fg=TEXT, relief="flat",
                  bd=0, cursor="hand2", command=self._log_search_prev).pack(side="left", padx=(6, 0))
        tk.Button(self._search_bar, text="▼", font=FONT_DESC, bg=BG3, fg=TEXT, relief="flat",
                  bd=0, cursor="hand2", command=self._log_search_next).pack(side="left", padx=(2, 0))
        tk.Button(self._search_bar, text="✕", font=FONT_DESC, bg=BG3, fg=RED, relief="flat",
                  bd=0, cursor="hand2", command=self._log_search_close).pack(side="left", padx=(6, 0))
        self._search_var.trace_add("write", lambda *_: self._log_search_highlight())
        self._search_idx = 0
        self.log_widget.tag_configure("search_hi",  background=ORANGE2, foreground="white")
        self.log_widget.tag_configure("search_cur", background=ORANGE,  foreground="white")
        self.log_widget.tag_configure("badge_kill",   foreground=RED)
        self.log_widget.tag_configure("badge_warn",   foreground=YELLOW)
        self.log_widget.tag_configure("badge_safe",   foreground=GREEN)
        self.log_widget.tag_configure("badge_filter", foreground=BLUE)

    def _log_get_text(self):
        return self.log_widget.get("1.0", "end-1c")

    def _log_copy_all(self):
        txt = self._log_get_text()
        if txt:
            self.clipboard_clear()
            self.clipboard_append(txt)
            self._log_flash("  ✓ All copied to clipboard.")

    def _log_copy_sel(self):
        try:
            txt = self.log_widget.get(tk.SEL_FIRST, tk.SEL_LAST)
            if txt:
                self.clipboard_clear()
                self.clipboard_append(txt)
                self._log_flash("  ✓ Selection copied.")
        except tk.TclError:
            self._log_flash("  ⚠ No selection.", "warn")

    def _log_save(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text file", "*.txt"), ("All files", "*.*")],
            title="Save log")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self._log_get_text())
            self._log_flash(f"  ✓ Log saved: {path}")
        except Exception as e:
            self._log_flash(f"  ✗ Error: {e}", "err")

    def _log_flash(self, msg, tag="ok"):
        marker = f"__flash_{id(msg)}__"
        self._log(msg, tag)
        self.log_widget.configure(state="normal")
        self.log_widget.mark_set(marker, "end-1l linestart")
        self.log_widget.mark_gravity(marker, "left")
        self.log_widget.configure(state="disabled")
        def _remove():
            try:
                self.log_widget.configure(state="normal")
                self.log_widget.delete(marker, f"{marker} lineend +1c")
                self.log_widget.configure(state="disabled")
            except tk.TclError:
                pass
        self.after(3000, _remove)

    def _apply_log_filter(self):
        lvl = self._log_filter.get()
        tag_map = {"OK": "ok", "Err": "err", "Warn": "warn", "Info": "info"}
        # Remet tout visible
        self.log_widget.configure(state="normal")
        self.log_widget.tag_configure("hidden", elide=False)
        if lvl == "All":
            self.log_widget.configure(state="disabled")
            return
        # Filter by elision: hide lines that do not carry the target tag
        target = tag_map.get(lvl, "")
        # Strategy: elide lines that do NOT have the target tag
        # (Tk elide on tags: hide items carrying the "hidden" tag)
        self.log_widget.tag_remove("hidden", "1.0", "end")
        if target:
            all_ranges = set()
            # Lines carrying the target tag
            idx = "1.0"
            while True:
                r = self.log_widget.tag_nextrange(target, idx, "end")
                if not r:
                    break
                # Convert to line numbers
                l1 = int(self.log_widget.index(r[0]).split(".")[0])
                l2 = int(self.log_widget.index(r[1]).split(".")[0])
                for ln in range(l1, l2 + 1):
                    all_ranges.add(ln)
                idx = r[1]
            total = int(self.log_widget.index("end").split(".")[0])
            for ln in range(1, total):
                if ln not in all_ranges:
                    self.log_widget.tag_add("hidden", f"{ln}.0", f"{ln}.0 lineend +1c")
        self.log_widget.tag_configure("hidden", elide=True)
        self.log_widget.configure(state="disabled")

    def _log_search_open(self):
        self._search_bar.grid()
        self._search_entry.focus_set()

    def _log_search_close(self):
        self._search_bar.grid_remove()
        self.log_widget.tag_remove("search_hi",  "1.0", "end")
        self.log_widget.tag_remove("search_cur", "1.0", "end")
        self._search_count.config(text="")

    def _log_search_highlight(self):
        self.log_widget.tag_remove("search_hi",  "1.0", "end")
        self.log_widget.tag_remove("search_cur", "1.0", "end")
        q = self._search_var.get()
        if not q:
            self._search_count.config(text="")
            self._search_idx = 0
            return
        count = 0
        idx = "1.0"
        while True:
            pos = self.log_widget.search(q, idx, nocase=True, stopindex="end")
            if not pos:
                break
            end = f"{pos}+{len(q)}c"
            self.log_widget.tag_add("search_hi", pos, end)
            count += 1
            idx = end
        self._search_count.config(text=f"{count} result{'s' if count != 1 else ''}")
        self._search_idx = 0
        if count:
            self._log_search_goto(0)

    def _log_search_goto(self, n):
        q = self._search_var.get()
        if not q:
            return
        ranges = self.log_widget.tag_ranges("search_hi")
        # tag_ranges returns flat list of (start, end, start, end, ...)
        pairs = [(ranges[i], ranges[i+1]) for i in range(0, len(ranges), 2)]
        if not pairs:
            return
        n = n % len(pairs)
        self._search_idx = n
        self.log_widget.tag_remove("search_cur", "1.0", "end")
        s, e = pairs[n]
        self.log_widget.tag_add("search_cur", s, e)
        self.log_widget.see(s)

    def _log_search_next(self):
        self._log_search_goto(self._search_idx + 1)

    def _log_search_prev(self):
        self._log_search_goto(self._search_idx - 1)

    # ── TAB CAPTURE ──
    def _make_tab_scroll(self, parent):
        sf = ScrollableFrame(parent, bg=BG)
        sf.pack(fill="both", expand=True)
        p = sf.inner
        p.configure(padx=0, pady=UI_TAB_PAD)
        p.columnconfigure(0, weight=1)
        return p

    def _tab_capturer(self, parent):
        p = self._make_tab_scroll(parent)
        # must_widgets: {category: [hchk_widget, ...]} for MIXED mode show/hide
        self._must_widgets: dict = {"mods": [], "dp2": [], "db": []}

        sec = Sec(p, "PLAYER")
        sec.pack(fill="x")
        self.player_search = PlayerSearchWidget(sec, on_change=self._on_player_change)
        self.player_search.pack(fill="x")

        sec = Sec(p, "DEMO SELECTION")
        sec.pack(fill="x")

        # ── Date range rows ───────────────────────────────────────────────────
        # Row 1: From / To entries with calendar pickers
        dr1 = tk.Frame(sec, bg=BG2)
        dr1.pack(fill="x")
        mlabel(dr1, "From:").pack(side="left")
        tk.Entry(dr1, textvariable=self.v["date_from"], font=FONT_MONO, bg=BG3, fg=TEXT,
                 insertbackground=ORANGE, relief="flat", bd=0, highlightthickness=1,
                 highlightbackground=BORDER, highlightcolor=ORANGE, width=12
                 ).pack(side="left", padx=(4, 0), ipady=4, ipadx=4)
        _btn_from = tk.Button(dr1, text="📅", font=FONT_SM, bg=BG3, fg=ORANGE, relief="flat",
                  bd=0, cursor="hand2", highlightthickness=0,
                  activebackground=BORDER, activeforeground=ORANGE)
        _btn_from.configure(command=lambda b=_btn_from: self._open_cal(self.v["date_from"], b))
        _btn_from.pack(side="left", padx=(2, 0), ipady=4, ipadx=4)
        mlabel(dr1, "  To:").pack(side="left", padx=(10, 0))
        tk.Entry(dr1, textvariable=self.v["date_to"], font=FONT_MONO, bg=BG3, fg=TEXT,
                 insertbackground=ORANGE, relief="flat", bd=0, highlightthickness=1,
                 highlightbackground=BORDER, highlightcolor=ORANGE, width=12
                 ).pack(side="left", padx=(4, 0), ipady=4, ipadx=4)
        _btn_to = tk.Button(dr1, text="📅", font=FONT_SM, bg=BG3, fg=ORANGE, relief="flat",
                  bd=0, cursor="hand2", highlightthickness=0,
                  activebackground=BORDER, activeforeground=ORANGE)
        _btn_to.configure(command=lambda b=_btn_to: self._open_cal(self.v["date_to"], b))
        _btn_to.pack(side="left", padx=(2, 0), ipady=4, ipadx=4)
        # Row 2: shortcut buttons on their own line so they never get clipped
        dr2 = tk.Frame(sec, bg=BG2)
        dr2.pack(fill="x", pady=(2, 0))
        tk.Button(dr2, text="Today", font=FONT_DESC, bg=BG3, fg=GREEN,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activebackground=BORDER, activeforeground=GREEN,
                  command=lambda: self.v["date_to"].set(date.today().strftime("%d-%m-%Y"))
                  ).pack(side="left", ipady=4, ipadx=5)
        tk.Button(dr2, text="Clear all", font=FONT_DESC, bg=BG3, fg=MUTED,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activebackground=BORDER, activeforeground=MUTED,
                  command=lambda: [self.v["date_from"].set(""), self.v["date_to"].set(""),
                                   self._demo_picker_clear()]
                  ).pack(side="left", padx=(4, 0), ipady=4, ipadx=5)

        qr = tk.Frame(sec, bg=BG2)
        qr.pack(fill="x", pady=(4, 0))
        tk.Label(qr, text="Shortcuts:", font=FONT_DESC, fg=MUTED, bg=BG2).pack(side="left")
        for lbl, key in [("Yesterday","yesterday"),("7d",7),("30d",30),
                         ("This month","month"),("3m",90),("6m",180),("Year","year"),("All",0)]:
            tk.Button(qr, text=lbl, font=FONT_DESC, bg=BG3, fg=TEXT, relief="flat", bd=0,
                      cursor="hand2", activebackground=ORANGE, activeforeground="white",
                      highlightthickness=0,
                      command=lambda k=key: self._set_date_range(k)).pack(
                side="left", padx=(4, 0), ipady=2, ipadx=4)

        # ── Demo picker ───────────────────────────────────────────────────────
        picker_hdr = tk.Frame(sec, bg=BG2)
        picker_hdr.pack(fill="x", pady=(10, 0))
        mlabel(picker_hdr, "Demo selection:").pack(side="left")
        add_tip(picker_hdr.winfo_children()[-1],
                "After Preview, demos in the date range are shown here.\n"
                "Uncheck any demo to exclude it from the batch.\n"
                "Enable 'Manual mode' to see all demos from the DB\n"
                "and add/remove them individually.")
        self._picker_manual_var = tk.BooleanVar(value=False)
        _pm_cb = hchk(picker_hdr, "Manual mode", self._picker_manual_var,
                      command=self._on_picker_mode_change)
        _pm_cb.pack(side="left", padx=(12, 0))
        add_tip(_pm_cb,
                "Off: shows only demos found by the date range (after Preview).\n"
                "On: loads all demos from DB so you can pick or exclude individually.")
        self._picker_count_lbl = tk.Label(picker_hdr, text="", font=FONT_DESC,
                                          fg=MUTED, bg=BG2)
        self._picker_count_lbl.pack(side="right")

        # Treeview: columns = checkbox-state (not real col) + date + name
        tree_frame = tk.Frame(sec, bg=BG2)
        tree_frame.pack(fill="x", pady=(4, 0))
        # Style "DemoPicker.Treeview" defini dans apply_ttk_style (source unique).
        self._demo_tree = ttk.Treeview(
            tree_frame, style="DemoPicker.Treeview",
            columns=("sel", "date", "map", "name"), show="headings", height=7,
            selectmode="extended")
        self._demo_tree.heading("sel",  text="✓",      anchor="center")
        self._demo_tree.heading("date", text="Date",   anchor="w")
        self._demo_tree.heading("map",  text="Map",    anchor="w")
        self._demo_tree.heading("name", text="Demo",   anchor="w")
        self._demo_tree.column("sel",  width=24,  minwidth=24,  stretch=False, anchor="center")
        self._demo_tree.column("date", width=118, minwidth=90,  stretch=False)
        self._demo_tree.column("map",  width=80,  minwidth=60,  stretch=False)
        self._demo_tree.column("name", width=280, minwidth=160, stretch=True)
        _tree_sb = ttk.Scrollbar(tree_frame, orient="vertical",
                                 command=self._demo_tree.yview)
        self._demo_tree.configure(yscrollcommand=_tree_sb.set)
        self._demo_tree.pack(side="left", fill="x", expand=True)
        _tree_sb.pack(side="right", fill="y")
        self._demo_tree.bind("<Button-1>", self._on_demo_tree_click)
        self._demo_tree.bind("<MouseWheel>",
                             lambda e: self._demo_tree.yview_scroll(
                                 -1 * (e.delta // 120), "units"))
        # Show compat tooltip on hover for warned rows
        self._tree_tip_win = None

        def _tree_tip_hide():
            if self._tree_tip_win:
                try: self._tree_tip_win.destroy()
                except tk.TclError: pass
                self._tree_tip_win = None

        def _tree_motion(event):
            iid = self._demo_tree.identify_row(event.y)
            if not iid:
                _tree_tip_hide(); return
            tags = self._demo_tree.item(iid, "tags")
            if "warn_compat" not in tags:
                _tree_tip_hide(); return
            compat = self._check_demo_compat(iid)
            tip = compat.get("tip") or ""
            brk = compat.get("break") or ""
            if not tip:
                _tree_tip_hide(); return
            # Only recreate if not already showing this demo's tip
            if self._tree_tip_win and getattr(self._tree_tip_win, "_iid", None) == iid:
                return
            _tree_tip_hide()
            tw = tk.Toplevel(self._demo_tree)
            tw.wm_overrideredirect(True)
            tw.attributes("-topmost", True)
            tw.wm_geometry(f"+{event.x_root + 12}+{event.y_root + 12}")
            tk.Label(tw, text=f"⚠ {brk}\n{tip}",
                     font=FONT_DESC, fg=TEXT, bg="#2a2a2a",
                     relief="flat", bd=0, padx=8, pady=4,
                     justify="left").pack()
            tw._iid = iid
            self._tree_tip_win = tw

        self._demo_tree.bind("<Motion>", _tree_motion)
        self._demo_tree.bind("<Leave>",  lambda e: _tree_tip_hide())

        # Per-row toggle buttons row
        pick_btns = WrapRow(sec, bg=BG2)
        pick_btns.pack(fill="x", pady=(4, 0))
        pick_btns.add(tk.Button(pick_btns, text="✓ Check all", font=FONT_DESC, bg=BG3, fg=GREEN,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=GREEN, activebackground=BG3,
                  command=lambda: self._demo_picker_set_all(True)))
        pick_btns.add(tk.Button(pick_btns, text="✕ Uncheck all", font=FONT_DESC, bg=BG3, fg=RED,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=RED, activebackground=BG3,
                  command=lambda: self._demo_picker_set_all(False)))
        pick_btns.add(tk.Button(pick_btns, text="✓ Check selected", font=FONT_DESC, bg=BG3, fg=GREEN,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=GREEN, activebackground=BG3,
                  command=lambda: self._demo_picker_set_selected(True)))
        pick_btns.add(tk.Button(pick_btns, text="✕ Uncheck selected", font=FONT_DESC, bg=BG3, fg=RED,
                  relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                  activeforeground=RED, activebackground=BG3,
                  command=lambda: self._demo_picker_set_selected(False)))

        # Compatibility legend
        compat_row = tk.Frame(sec, bg=BG2)
        compat_row.pack(fill="x", pady=(4, 0))
        tk.Label(compat_row, text="● ", font=FONT_DESC, fg=YELLOW, bg=BG2).pack(side="left")
        _compat_tip = (
            "CS2 had hard breaking updates that made older demos unplayable:\n"
            "  • Jul 28 2025 — AnimGraph2: ALL demos before this date are broken.\n"
            "    Requires CS2 ≤ 1.40.8.8 (Steam beta) to replay them.\n"
            "  • Feb 6 2024 — Major format change: demos before this are also broken\n"
            "    on current CS2."
        )
        _warn_lbl = tk.Label(compat_row,
                 text="Demo recorded before a CS2 breaking update — likely unplayable.",
                 font=FONT_DESC, fg=MUTED, bg=BG2, cursor="hand2")
        _warn_lbl.pack(side="left")
        add_tip(_warn_lbl, _compat_tip)

        # Internal state: {demo_path: bool} — True = included
        self._demo_picker_state: dict = {}
        # Last preview result — used by HTML export
        self._last_preview_data: dict | None = None

        self._sec_w = Sec(p, "WEAPON FILTER  (empty = all)")
        self._sec_w.pack(fill="x")
        self._wg_lbl = tk.Label(self._sec_w, text="Waiting for DB…", font=FONT_DESC, fg=MUTED, bg=BG2)
        self._wg_lbl.pack(anchor="w")
        self._wg_frame = None
        br = tk.Frame(self._sec_w, bg=BG2)
        br.pack(fill="x", pady=(4, 0))
        tk.Button(br, text="Select all", font=FONT_DESC, bg=BG3, fg=GREEN, relief="flat",
                  cursor="hand2", bd=0, highlightthickness=0, activeforeground=GREEN,
                  command=self._weapons_select_all).pack(side="left", padx=(0, 6))
        tk.Button(br, text="Deselect all", font=FONT_DESC, bg=BG3, fg=RED, relief="flat",
                  cursor="hand2", bd=0, highlightthickness=0, activeforeground=RED,
                  command=self._weapons_deselect_all).pack(side="left")

        sec = Sec(p, "CAPTURE & TIMING")
        sec.pack(fill="x")

        ev_row = WrapRow(sec, bg=BG2)
        ev_row.pack(fill="x")
        ev_row.add(mlabel(ev_row, "Capture:"))

        def _make_event_toggle(parent, label, var, tip):
            """Styled toggle button for event types."""
            btn = tk.Button(parent, text=f"  {label}  ", font=FONT_SM_B,
                            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                            padx=6, pady=3)
            def _refresh(*_):
                on = var.get()
                btn.config(bg=ORANGE if on else BG3, fg="white" if on else MUTED,
                           activebackground=ORANGE2 if on else BORDER,
                           activeforeground="white")
            def _toggle():
                var.set(not var.get())
                _refresh()
            btn.config(command=_toggle)
            var.trace_add("write", _refresh)
            _refresh()
            add_tip(btn, tip)
            return btn

        ev_row.add(_make_event_toggle(ev_row, "KILLS",
                           self.sel_events["Kills"],
                           "Capture kills made by the player."))
        ev_row.add(_make_event_toggle(ev_row, "DEATHS BY",
                           self.sel_events["Deaths"],
                           "Capture deaths of the selected player(s).\n"
                           "Uses the same active weapon / kill-filter / situation-filter logic as KILLS;\n"
                           "the difference is that matching events are those where the selected player dies."))
        ev_row.add(_make_event_toggle(ev_row, "ROUNDS",
                           self.sel_events["Rounds"],
                           "One clip per round the player participated in, starting at round start tick.\n"
                           "Clips every round regardless of kills — useful for full-round montages.\n"
                           "Requires a 'rounds' table in the CSDM database."))


        # ── PERSPECTIVE ───────────────────────────────────────────────────────
        _sep(sec)
        persp_row = tk.Frame(sec, bg=BG2)
        persp_row.pack(fill="x")
        mlabel(persp_row, "Perspective:").pack(side="left")
        for lbl, val, tip in [
            ("POV Killer", "killer", "Camera on the killer throughout the clip"),
            ("POV Victim", "victim", "Camera on the victim throughout the clip"),
            ("Both",       "both",   "Starts on the killer, then switches to the victim before the kill"),
        ]:
            _rb = hradio(persp_row, lbl, self.v["perspective"], val,
                         command=self._on_perspective_change)
            _rb.pack(side="left", padx=(4, 0))
            add_tip(_rb, tip)

        # Switch delay slider — visible only in both mode
        self._victim_pre_row = tk.Frame(sec, bg=BG2)
        self._victim_pre_row.pack(fill="x", pady=(4, 0))
        _vp_lbl = mlabel(self._victim_pre_row, "Switch delay (s):")
        _vp_lbl.pack(side="left")
        add_tip(_vp_lbl,
                "Seconds before the kill tick at which the camera switches from killer → victim.\n"
                "Killer phase = BEFORE seconds.  Victim phase = this value.\n"
                "Total clip before kill = BEFORE + Switch delay.")
        _vp_val_lbl = tk.Label(self._victim_pre_row, text=f"{self.v['victim_pre_s'].get()}s",
                               font=FONT_SM, fg=ORANGE, bg=BG2)
        _vp_val_lbl.pack(side="right")

        # "Total before" hint — shows killer + victim seconds combined
        self._both_total_lbl = tk.Label(self._victim_pre_row, text="", font=FONT_SM,
                                        fg=_t("MUTED"), bg=BG2)
        self._both_total_lbl.pack(side="right", padx=(0, 6))

        def _update_both_total(*_):
            b  = int(float(self.v["before"].get()))
            vp = int(float(self.v["victim_pre_s"].get()))
            _vp_val_lbl.config(text=f"{vp}s")
            self._both_total_lbl.config(text=f"total before: {b + vp}s")

        tk.Scale(self._victim_pre_row, from_=0, to=10, variable=self.v["victim_pre_s"],
                 orient="horizontal", bg=BG2, fg=TEXT, troughcolor=BG3,
                 activebackground=ORANGE, highlightthickness=0, bd=0,
                 showvalue=False, cursor="hand2",
                 command=_update_both_total,
                 ).pack(side="left", fill="x", expand=True, pady=(2, 0))

        # Mate POV row — visible in Victim and Both modes only
        self._mate_pov_row = tk.Frame(sec, bg=BG2)
        self._mate_pov_row.pack(fill="x", pady=(4, 0))
        _mp_lbl = mlabel(self._mate_pov_row, "Mate POV:")
        _mp_lbl.pack(side="left")
        add_tip(_mp_lbl,
                "Record from the best-angle teammate of the victim instead of the victim.\n"
                "Requires: victim eye clearly in view (±20°), alive mate, same floor,\n"
                "elevation ≤30°, distance 80–550 u. No BSP — walls not detected.\n"
                "Only applies in Victim / Both perspective modes.")
        _mp_en = hchk(self._mate_pov_row, "Enable", self.v["kill_mod_mate_pov"])
        _mp_en.pack(side="left", padx=(4, 0))
        _mp_must = hchk(self._mate_pov_row, "★ Must", self.v["kill_mod_mate_pov_req"])
        _mp_must.pack(side="left", padx=(8, 0))
        add_tip(_mp_must,
                "Must: skip clips where no qualifying teammate is found.\n"
                "Without Must: fall back to normal victim camera when no mate qualifies.")
        self._wire_enable_must(self.v["kill_mod_mate_pov"],
                               self.v["kill_mod_mate_pov_req"])

        # ── Active player name override ───────────────────────────────────────
        _pno_row = tk.Frame(sec, bg=BG2)
        _pno_row.pack(fill="x", pady=(6, 0))
        _pno_lbl = mlabel(_pno_row, "Name override:")
        _pno_lbl.pack(side="left")
        add_tip(_pno_lbl,
                "Optional: force a specific name for the active player in deathnotices.\n"
                "Leave empty to use the name stored in the demo file.")
        sentry(_pno_row, self.v["player_name_override"], width=22).pack(
            side="left", padx=(6, 0), ipady=4)

        self.after(50, self._on_perspective_change)

        _sep(sec, pady=(8, 4))

        tg = tk.Frame(sec, bg=BG2)
        tg.pack(fill="x")
        tg.columnconfigure(0, weight=1)
        tg.columnconfigure(1, weight=1)
        _sb = self._slider(tg, "Seconds BEFORE", self.v["before"], 1, 15, 0, 0)
        add_tip(_sb, "Killer-phase duration in Both mode / total before in Killer|Victim mode.\n"
                     "In Both mode the full clip before kill = BEFORE + Switch delay.")
        # Update the "total before" hint whenever the BEFORE slider changes too.
        self.v["before"].trace_add("write", _update_both_total)
        _sa = self._slider(tg, "Seconds AFTER", self.v["after"],  1, 15, 0, 1)
        add_tip(_sa, "Seconds of footage recorded after the event tick.")

        rg = WrapRow(sec, bg=BG2, gap_x=16, gap_y=4)
        rg.pack(fill="x", pady=(6, 0))

        _g = tk.Frame(rg, bg=BG2)
        _ret_lbl = mlabel(_g, "Retries:")
        _ret_lbl.pack(side="left")
        add_tip(_ret_lbl, "Number of times to retry a demo if CSDM reports 'Game error'\n"
                          "or a crash. Each retry re-launches CS2 from scratch.\n"
                          "Recommended: 2.")
        sentry(_g, self.v["retry_count"], width=3).pack(side="left", padx=(4, 0), ipady=4)
        rg.add(_g)

        _g = tk.Frame(rg, bg=BG2)
        _del_lbl = mlabel(_g, "Delay (s):")
        _del_lbl.pack(side="left")
        add_tip(_del_lbl, "Seconds to wait between retries.\n"
                          "Give CS2 time to fully close before re-launching.\n"
                          "Recommended: 15.")
        sentry(_g, self.v["retry_delay"], width=3).pack(side="left", padx=(4, 0), ipady=4)
        rg.add(_g)

        _g = tk.Frame(rg, bg=BG2)
        _pause_lbl = mlabel(_g, "Demo pause (s):")
        _pause_lbl.pack(side="left")
        add_tip(_pause_lbl, "Seconds to wait between demos (successful or failed).\n"
                            "Helps CS2 fully release resources before the next launch.\n"
                            "Recommended: 3–5.")
        sentry(_g, self.v["delay_between_demos"], width=3).pack(side="left", padx=(4, 0), ipady=4)
        rg.add(_g)

        _g = tk.Frame(rg, bg=BG2)
        _to_lbl = mlabel(_g, "Timeout (min):")
        _to_lbl.pack(side="left")
        add_tip(_to_lbl, "Kill CS2 and retry if a demo recording takes longer than this many minutes.\n"
                         "0 = auto: timeout is calculated per demo from clip count and duration\n"
                         "    (content × 3 + 10s/seq + 3 min flat). Set a value to enforce a minimum.")
        sentry(_g, self.v["recording_timeout"], width=4).pack(side="left", padx=(4, 0), ipady=4)
        rg.add(_g)

        _g = tk.Frame(rg, bg=BG2)
        _ord_lbl = mlabel(_g, "Order:")
        _ord_lbl.pack(side="left")
        add_tip(_ord_lbl, "Chronological: demos processed oldest-to-newest.\n"
                          "Random: demos shuffled before the batch starts.")
        for lbl, val in [("Chrono","chrono"),("Random 🎲","random")]:
            hradio(_g, lbl, self.v["clip_order"], val).pack(side="left", padx=(4, 0))
        rg.add(_g)

        # ══════════════════════════════════════════════════════════════════════
        sec = Sec(p, "KILL FILTERS")
        sec.pack(fill="x")

        # ── SUICIDES / TK / HS ───────────────────────────────────────────────
        tk_row = WrapRow(sec, bg=BG2, gap_x=16, gap_y=4)
        tk_row.pack(fill="x")

        _g = tk.Frame(tk_row, bg=BG2)
        _sui_lbl = mlabel(_g, "Suicides:")
        _sui_lbl.pack(side="left")
        add_tip(_sui_lbl, "Include / Exclude / Only for world / fall / suicide deaths.")
        for _lbl, _val, _tip in [
            ("Include", "include", "Include suicide deaths in clips."),
            ("Exclude", "exclude", "Remove all suicide deaths from clips."),
            ("Only",    "only",    "Keep only suicide deaths (world / fall / etc)."),
        ]:
            _rb = hradio(_g, _lbl, self.v["suicides_mode"], _val)
            _rb.pack(side="left", padx=(4, 0))
            add_tip(_rb, _tip)
        tk_row.add(_g)

        _g = tk.Frame(tk_row, bg=BG2)
        mlabel(_g, "TK:").pack(side="left")
        for lbl, val, tip in [
            ("Include", "include", "All kills, including teamkills"),
            ("Exclude", "exclude", "Exclude teamkill frags"),
            ("Only",    "only",    "Only kills on teammates"),
        ]:
            _rb = hradio(_g, lbl, self.v["teamkills_mode"], val)
            _rb.pack(side="left", padx=(4, 0))
            add_tip(_rb, tip)
        tk_row.add(_g)

        # HS filter — its own row, independent of the Mods ANY/ALL logic
        hs_row = WrapRow(sec, bg=BG2, gap_x=4, gap_y=4)
        hs_row.pack(fill="x", pady=(4, 0))
        _g = tk.Frame(hs_row, bg=BG2)
        _hs_lbl = flabel(_g, "🎯 Headshots:")
        _hs_lbl.pack(side="left")
        add_tip(_hs_lbl,
                "All = include all kills regardless of headshot status.\n"
                "Only = keep headshot kills only (is_headshot column).\n"
                "Exclude = keep non-headshot kills only.\n"
                "⚠ HS is auto-forced only when active filter logic guarantees HS-only output.")
        for lbl, val in [("All", "all"), ("Only", "only"), ("Exclude", "exclude")]:
            _rb = hradio(_g, lbl, self.v["headshots_mode"], val)
            _rb.pack(side="left", padx=(8 if val == "all" else 4, 0))
        hs_row.add(_g)
        # Store the radio buttons container so ONE TAP / TROIS TAP can disable it
        self._hs_row = hs_row

        # ── KILL FILTERS — data-driven from KILL_FILTER_REGISTRY ──────────────
        _sep(sec)
        _kill_logic_hdr = tk.Frame(sec, bg=BG2)
        _kill_logic_hdr.pack(fill="x", pady=(0, 4))
        slabel(_kill_logic_hdr, "Kill filters (Mods + demoparser2):").pack(side="left")
        _logic_lbl = mlabel(_kill_logic_hdr, "  ★ Must = required, others = optional")
        _logic_lbl.pack(side="left", padx=(8, 0))
        add_tip(_logic_lbl,
                "Fixed logic:\n"
                "all ★ Must filters must match,\n"
                "plus at least one enabled non-★ filter must match globally.\n"
                "If no non-★ filter is enabled, only ★ Must filters are required.")
        _clear_kf_btn = tk.Button(
            _kill_logic_hdr, text="✕ Unselect all", command=self._clear_kill_filters,
            font=FONT_SM, bg=BG3, fg=RED, activebackground=BORDER, activeforeground=RED,
            relief="flat", bd=0, padx=8, pady=2, cursor="hand2", highlightthickness=0
        )
        _clear_kf_btn.pack(side="right")
        add_tip(_clear_kf_btn, "Disable all kill/situation modifiers and clear all ★ Must flags.")
        self._on_kill_logic_change()

        # ── Mods (SQL-backed) ─────────────────────────────────────────────────
        _sep(sec)
        _mods_hdr = tk.Frame(sec, bg=BG2)
        _mods_hdr.pack(fill="x", pady=(0, 4))
        slabel(_mods_hdr, "Mods — none checked = all kills:").pack(side="left")

        self._must_widgets["mods"] = []
        for _fdef in [f for f in KILL_FILTER_REGISTRY if f.category == "mods"]:
            self._build_filter_row(sec, _fdef, self._must_widgets["mods"])
        self.after(50, lambda: self._on_logic_mode_change("mods"))

        # ── demoparser2 modifiers ─────────────────────────────────────────────
        _sep(sec)
        _dp2_hdr = tk.Frame(sec, bg=BG2)
        _dp2_hdr.pack(fill="x", pady=(0, 4))
        slabel(_dp2_hdr, "demoparser2 modifiers:").pack(side="left")
        mlabel(_dp2_hdr, "  (uses shared kill logic above)").pack(side="left", padx=(8, 0))

        self._must_widgets["dp2"] = []
        for _fdef in [f for f in KILL_FILTER_REGISTRY
                      if f.category == "dp2" and not f.hide_ui]:
            if _fdef.special == "high_velocity":
                # FERRARI PEEK: expandable sub-panel
                _hv_row = tk.Frame(sec, bg=BG2)
                _hv_row.pack(fill="x", pady=(4, 0))
                flabel(_hv_row, _fdef.label).pack(side="left")
                add_tip(_hv_row.winfo_children()[-1], _fdef.tip)
                _hv_inner = tk.Frame(_hv_row, bg=BG2)
                def _on_hv_toggle(*_, _inner=_hv_inner):
                    if self.v["kill_mod_high_velocity"].get():
                        _inner.pack(side="left", fill="x")
                    else:
                        _inner.pack_forget()
                _hv_en = hchk(_hv_row, "Enable", self.v["kill_mod_high_velocity"],
                              command=_on_hv_toggle)
                _hv_en.pack(side="left", padx=(4, 0))
                _hv_must = hchk(_hv_row, "★ Must", self.v["kill_mod_high_velocity_req"])
                _hv_must.pack(side="left", padx=(8, 0))
                self._must_widgets["dp2"].append(_hv_must)
                add_tip(_hv_must, "Required filter (must match).")
                self._wire_enable_must(self.v["kill_mod_high_velocity"],
                                       self.v["kill_mod_high_velocity_req"])
                _os_cb = hchk(_hv_inner, "One-shot", self.v["kill_mod_hv_one_shot"])
                _os_cb.pack(side="left", padx=(8, 0))
                add_tip(_os_cb, "Require no prior fire within ~0.75s before the kill.\n"
                                "Uncheck to allow spray finishers.")
                mlabel(_hv_inner, "  Min approach:").pack(side="left", padx=(8, 0))
                sentry(_hv_inner, self.v["kill_mod_high_vel_thr"], width=5).pack(
                    side="left", padx=(4, 0), ipady=4)
                mlabel(_hv_inner, "u/s").pack(side="left", padx=(2, 0))
                dp2_badge(_hv_row).pack(side="right", padx=(0, 4))
                self.after(50, _on_hv_toggle)
            elif _fdef.key == "kill_mod_flick":
                # FLICK: degree entry field
                _fl_row = self._build_filter_row(sec, _fdef, self._must_widgets["dp2"])
                mlabel(_fl_row, "  Min angle:").pack(side="left", padx=(8, 0))
                sentry(_fl_row, self.v["kill_mod_flick_deg"], width=4).pack(
                    side="left", padx=(4, 0), ipady=4)
                mlabel(_fl_row, "°").pack(side="left", padx=(2, 0))
            elif _fdef.key == "kill_mod_one_tap":
                # ONE TAP: isolation window in seconds
                _ot_row = self._build_filter_row(sec, _fdef, self._must_widgets["dp2"])
                mlabel(_ot_row, "  Window:").pack(side="left", padx=(8, 0))
                sentry(_ot_row, self.v["kill_mod_one_tap_s"], width=3).pack(
                    side="left", padx=(4, 0), ipady=4)
                mlabel(_ot_row, "s").pack(side="left", padx=(2, 0))
            else:
                self._build_filter_row(sec, _fdef, self._must_widgets["dp2"])
        self.after(50, lambda: self._on_logic_mode_change("dp2"))

        # ── Situation (DB + Clutch) ───────────────────────────────────────────
        _sep(sec, pady=(8, 4))
        _sit_hdr = tk.Frame(sec, bg=BG2)
        _sit_hdr.pack(fill="x", pady=(0, 4))
        slabel(_sit_hdr, "Situation (DB):").pack(side="left")
        _sit_logic_lbl = mlabel(_sit_hdr, "  ★ Must = required, others = optional")
        _sit_logic_lbl.pack(side="left", padx=(8, 0))
        add_tip(_sit_logic_lbl,
                "Applied after kill filters.\n"
                "Fixed logic: all ★ Must situation filters must match,\n"
                "plus at least one enabled non-★ filter must match globally.")
        self._must_widgets["db"] = []
        for _fdef in [f for f in KILL_FILTER_REGISTRY if f.category == "db"]:
            if _fdef.key == "kill_mod_multi_kill":
                _mk_row = self._build_filter_row(sec, _fdef, self._must_widgets["db"])
                mlabel(_mk_row, "  Min kills:").pack(side="left", padx=(8, 0))
                scombo(_mk_row, self.v["kill_mod_multi_kill_n"], [2, 3, 4, 5], 3).pack(
                    side="left", padx=(4, 0))
                add_tip(_mk_row.winfo_children()[-1],
                        "2 = double, 3 = triple, 4 = quadra, 5 = ace")
                mlabel(_mk_row, "  within:").pack(side="left", padx=(8, 0))
                sentry(_mk_row, self.v["kill_mod_multi_kill_s"], width=3).pack(
                    side="left", padx=(4, 0), ipady=4)
                mlabel(_mk_row, "s").pack(side="left", padx=(2, 0))
            elif _fdef.key == "kill_mod_bully":
                _bo_row = self._build_filter_row(sec, _fdef, self._must_widgets["db"])
                mlabel(_bo_row, "  From kill #:").pack(side="left", padx=(8, 0))
                scombo(_bo_row, self.v["kill_mod_bully_n"], [2, 3, 4, 5], 3).pack(
                    side="left", padx=(4, 0))
                add_tip(_bo_row.winfo_children()[-1],
                        "2 = from 2nd kill of same victim, 3 = from 3rd, etc.")
            else:
                self._build_filter_row(sec, _fdef, self._must_widgets["db"])
        self.after(50, lambda: self._on_logic_mode_change("db"))

        # ── CLUTCH ────────────────────────────────────────────────────────────
        _sep(sec, pady=(8, 4))
        _clutch_hdr = tk.Frame(sec, bg=BG2)
        _clutch_hdr.pack(fill="x", pady=(0, 4))
        _clutch_cb = hchk(_clutch_hdr, "🎯 CLUTCH", self.v["clutch_enabled"])
        _clutch_cb.pack(side="left")
        add_tip(_clutch_cb,
                "Clutch mode: only capture rounds where the selected player\n"
                "was the last alive on his team.\n"
                "The clip begins from the moment he becomes last alive.\n"
                "Requires the 'kills' table to include team/side columns.")

        _clutch_opts = tk.Frame(sec, bg=BG2)
        _clutch_opts.pack(fill="x", pady=(0, 2))

        # Wins only
        _wins_cb = hchk(_clutch_opts, "Wins only", self.v["clutch_wins_only"])
        _wins_cb.pack(side="left", padx=(16, 0))
        add_tip(_wins_cb, "Only include rounds the player won (killed all remaining opponents).\n"
                          "Rounds where he died without finishing are excluded.")

        # Mode: kills_only / full_round
        mlabel(_clutch_opts, "  Mode:").pack(side="left", padx=(16, 0))
        for lbl, val, tip in [
            ("Kills only",   "kills_only",
             "One clip per kill during the clutch (standard window: before/after).\n"
             "Works like normal kills but restricted to the clutch phase."),
            ("Full clutch",  "full_clutch",
             "One clip from the moment the player is last alive\n"
             "until he dies or the round ends (win or loss).\n"
             "Ignores the BEFORE/AFTER sliders for this clip boundary."),
        ]:
            _rb = hradio(_clutch_opts, lbl, self.v["clutch_mode"], val)
            _rb.pack(side="left", padx=(4, 0))
            add_tip(_rb, tip)

        # 1vX size filters
        _clutch_size_row = tk.Frame(sec, bg=BG2)
        _clutch_size_row.pack(fill="x", pady=(2, 0))
        mlabel(_clutch_size_row, "  Size filter:").pack(side="left", padx=(16, 0))
        _size_hint = mlabel(_clutch_size_row, " (all off = all sizes)")
        _size_hint.pack(side="left")
        add_tip(_size_hint,
                "Restrict clutch clips to specific 1vX scenarios.\n"
                "Leave all unchecked to include every size.")
        for n in range(1, 6):
            _sz_cb = hchk(_clutch_size_row, f"1v{n}", self.v[f"clutch_1v{n}"])
            _sz_cb.pack(side="left", padx=(6, 0))
            add_tip(_sz_cb, f"Include rounds where the player faces exactly {n} opponent(s).")

        # Grey out sub-options when master toggle is off
        def _clutch_toggle_state(*_):
            st = "normal" if self.v["clutch_enabled"].get() else "disabled"
            for w in (_wins_cb,
                      *[c for c in _clutch_opts.winfo_children()],
                      *[c for c in _clutch_size_row.winfo_children()]):
                try:
                    w.config(state=st)
                except tk.TclError:
                    pass
        self.v["clutch_enabled"].trace_add("write", _clutch_toggle_state)
        _clutch_toggle_state()

        # ══════════════════════════════════════════════════════════════════════
        # Match type section — always visible; types absent from DB are greyed out
        self._match_type_sec = Sec(p, "MATCH TYPES")
        self._match_type_sec.pack(fill="x")
        desc_label(self._match_type_sec,
            "Filter demos by CS2 match type.\n"
            "Greyed-out types are not present in your database.\n"
            "When the filter toggle is off, all types pass (no SQL overhead)."
        ).pack(anchor="w", pady=(0, 4))
        self._match_type_frame = tk.Frame(self._match_type_sec, bg=BG2)
        self._match_type_frame.pack(fill="x")
        self._mt_checkboxes: list = []
        # Populated immediately below with all known types (greyed until DB connects)
        self._refresh_match_type_ui()

        # ── Map filter ────────────────────────────────────────────────────────
        self._map_filter_sec = Sec(p, "MAP FILTER")
        self._map_filter_sec.pack(fill="x")
        desc_label(self._map_filter_sec,
            "Filter demos to specific maps.\n"
            "Populated from your database on connect.\n"
            "When the filter toggle is off, all maps pass (no SQL overhead)."
        ).pack(anchor="w", pady=(0, 4))
        self._map_filter_frame = tk.Frame(self._map_filter_sec, bg=BG2)
        self._map_filter_frame.pack(fill="x")
        self._refresh_map_filter_ui()

        # Auto-tag managed from the Tags tab (active selection)

    def _open_cal(self, var, anchor=None):
        init = None
        s = var.get().strip()
        if s:
            try:
                init = datetime.strptime(s, "%d-%m-%Y").date()
            except ValueError:
                pass
        CalendarPopup(anchor if anchor else self,
                      lambda d: var.set("" if d is None else d.strftime("%d-%m-%Y")),
                      initial_date=init)

    def _set_date_range(self, key):
        today = date.today()
        today_str = today.strftime("%d-%m-%Y")
        if key == 0:
            # All: clear both fields
            self.v["date_from"].set("")
            self.v["date_to"].set("")
        elif key == "yesterday":
            yesterday = today - timedelta(days=1)
            self.v["date_from"].set(yesterday.strftime("%d-%m-%Y"))
            self.v["date_to"].set(yesterday.strftime("%d-%m-%Y"))
        elif key == "month":
            # From the 1st of the current month
            start = today.replace(day=1)
            self.v["date_from"].set(start.strftime("%d-%m-%Y"))
            self.v["date_to"].set(today_str)
        elif key == "year":
            # From January 1st
            start = today.replace(month=1, day=1)
            self.v["date_from"].set(start.strftime("%d-%m-%Y"))
            self.v["date_to"].set(today_str)
        elif isinstance(key, int) and key > 0:
            start = today - timedelta(days=key)
            self.v["date_from"].set(start.strftime("%d-%m-%Y"))
            self.v["date_to"].set(today_str)

    # ── Demo picker helpers ─────────────────────────────────────────────────
    # Known CS2 updates that hard-broke all older demos.
    # Each entry: (cutoff_datetime, label, description)
    # A demo recorded BEFORE a cutoff is incompatible with any CS2 version
    # released ON OR AFTER that cutoff.
    # Sorted newest-first so we match the most recent breaking update first.
    _CS2_DEMO_BREAKS = [
        (
            datetime(2025, 7, 28),
            "AnimGraph2",
            "Valve's AnimGraph2 engine update (Jul 28 2025) made all older demos\n"
            "incompatible. You need CS2 ≤ 1.40.8.8 (Steam beta depot) to replay them.",
        ),
        (
            datetime(2024, 2, 6),
            "Feb 2024 update",
            "The February 6 2024 major update changed the demo file format.\n"
            "Demos recorded before this date cannot be replayed on current CS2.",
        ),
    ]

    def _check_demo_compat(self, demo_path):
        """Check whether a CS2 demo may be incompatible with the current CS2 version.

        CS2 has had hard breaking updates that make demos recorded before them
        completely unplayable on the current game version. Detection is based on
        the demo's recorded timestamp vs. the known dates of those breaking updates.

        Returns a dict:
          {
            'status':  'ok' | 'warn' | 'missing',
            'break':   str | None,   # short name of the breaking update, e.g. 'AnimGraph2'
            'tip':     str | None,   # human-readable explanation
            'ts':      int | None,   # demo Unix timestamp
          }
        """
        result = {"status": "ok", "break": None, "tip": None, "ts": None}
        ts = self._get_demo_ts(demo_path)
        if ts is None:
            # No timestamp: file missing or unreadable
            from pathlib import Path as _Path
            if not _Path(demo_path).is_file():
                result["status"] = "missing"
            return result
        result["ts"] = ts
        demo_dt = datetime.fromtimestamp(ts)
        for cutoff, label, tip in self._CS2_DEMO_BREAKS:
            if demo_dt < cutoff:
                result["status"] = "warn"
                result["break"]  = label
                result["tip"]    = tip
                return result   # match the most recent (first) applicable break
        return result

    def _demo_picker_fmt_name(self, demo_path):
        """Shorten long demo filenames for display: keep last ~40 chars, prefix …"""
        name = Path(demo_path).name
        if len(name) > 44:
            return "…" + name[-43:]
        return name

    def _demo_picker_fmt_date(self, demo_path):
        """Return dd-mm-yyyy hh:mm for a demo path."""
        ts = self._get_demo_ts(demo_path)
        if ts is not None:
            try:
                return datetime.fromtimestamp(ts).strftime("%d-%m-%Y %H:%M")
            except Exception:
                pass
        raw = self._demo_dates.get(demo_path)
        if raw is None:
            return "??-??-???? ??:??"
        try:
            if hasattr(raw, "strftime"):
                return raw.strftime("%d-%m-%Y %H:%M")
            if isinstance(raw, (int, float)):
                t = int(raw)
                if t > 4_000_000_000:
                    t //= 1000
                return datetime.fromtimestamp(t).strftime("%d-%m-%Y %H:%M")
            s = str(raw).strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.strptime(s[:len(fmt)], fmt).strftime("%d-%m-%Y %H:%M")
                except ValueError:
                    continue
        except Exception:
            pass
        return "??-??-???? ??:??"

    def _demo_picker_fmt_map(self, demo_path):
        """Return the map name for a demo, shortened for display."""
        m = self._demo_map_cache.get(demo_path, "")
        if not m:
            return ""
        # Strip common CS2 prefixes for brevity in the narrow column
        for pfx in ("de_", "cs_", "ar_", "gg_", "dz_", "tr_"):
            if m.lower().startswith(pfx):
                return m[len(pfx):]
        return m

    def _demo_picker_populate(self, demo_paths, keep_existing=False):
        """Populate the demo picker treeview with the given paths.

        demo_paths: list of demo file paths to show.
        keep_existing: if True, preserve checked state for paths already present.
        After Preview, called with just the range-filtered demos.
        In Manual mode, called with all demos from DB.
        """
        # Preserve existing state for known paths if requested
        prev_state = dict(self._demo_picker_state) if keep_existing else {}

        self._demo_picker_state = {}
        try:
            self._demo_tree.delete(*self._demo_tree.get_children())
        except Exception:
            return

        sorted_paths = sorted(demo_paths, key=self._demo_sort_key)
        for dp in sorted_paths:
            checked = prev_state.get(dp, True)
            self._demo_picker_state[dp] = checked
            sym = "✓" if checked else "✕"
            date_str  = self._demo_picker_fmt_date(dp)
            map_str   = self._demo_picker_fmt_map(dp)
            name_str  = self._demo_picker_fmt_name(dp)
            compat    = self._check_demo_compat(dp)
            status    = compat["status"]
            # Tags: check-state + compat warning
            if not checked:
                tag = "off"
            elif status == "warn":
                tag = "warn_compat"
            elif status == "missing":
                tag = "warn_missing"
            else:
                tag = "ok"
            self._demo_tree.insert("", "end",
                values=(sym, date_str, map_str, name_str),
                tags=(tag,), iid=dp)

        self._demo_tree.tag_configure("ok",           foreground=TEXT)
        self._demo_tree.tag_configure("off",          foreground=MUTED)
        self._demo_tree.tag_configure("warn_compat",  foreground=YELLOW)
        self._demo_tree.tag_configure("warn_missing", foreground=MUTED)

        n_on  = sum(1 for v in self._demo_picker_state.values() if v)
        n_tot = len(self._demo_picker_state)
        try:
            self._picker_count_lbl.config(
                text=f"{n_on}/{n_tot} selected",
                fg=ORANGE if n_on < n_tot else MUTED)
        except tk.TclError:
            pass

    def _demo_picker_clear(self):
        """Clear the picker when dates are cleared."""
        self._demo_picker_state = {}
        try:
            self._demo_tree.delete(*self._demo_tree.get_children())
            self._picker_count_lbl.config(text="— all demos (run Preview to filter)", fg=MUTED)
        except tk.TclError:
            pass

    def _on_demo_tree_click(self, event):
        """Allow native treeview row selection without toggling the check state.
        Use the Check/Uncheck selected buttons to change check state on the selection."""
        region = self._demo_tree.identify_region(event.x, event.y)
        if region not in ("cell", "tree"):
            return "break"
        # Let native selection happen — don't return "break" so Tk handles highlight

    def _demo_picker_update_items(self, iids, value):
        """Update picker state and tree display for given item IDs."""
        sym = "✓" if value else "✕"
        tag = "ok" if value else "off"
        for iid in iids:
            self._demo_picker_state[iid] = value
            try:
                old_vals = self._demo_tree.item(iid, "values")
                self._demo_tree.item(iid, values=(sym, old_vals[1], old_vals[2], old_vals[3] if len(old_vals) > 3 else ""), tags=(tag,))
            except Exception:
                pass
        n_on  = sum(1 for v in self._demo_picker_state.values() if v)
        n_tot = len(self._demo_picker_state)
        try:
            self._picker_count_lbl.config(
                text=f"{n_on}/{n_tot} selected",
                fg=ORANGE if n_on < n_tot else MUTED)
        except tk.TclError:
            pass

    def _demo_picker_set_all(self, value):
        self._demo_picker_update_items(list(self._demo_picker_state.keys()), value)

    def _demo_picker_set_selected(self, value: bool):
        """Set the check state of all currently highlighted (native-selected) rows."""
        self._demo_picker_update_items(self._demo_tree.selection(), value)

    def _on_picker_mode_change(self, *_):
        """Switch between range-only and manual (all demos) mode."""
        manual = self._picker_manual_var.get()
        if not manual:
            # Back to range mode — preserve current list
            return
        # Manual mode: load all demos from DB
        def _bg():
            try:
                conn = self._pg_fresh()
                dc       = self._find_col("matches", ["demo_path", "demo_file_path",
                                                       "demo_filepath", "share_code"])
                mkm      = self._find_col("matches", ["checksum", "id", "match_id"])
                date_col = self._date_col
                map_col  = self._map_col
                map_join = self._map_join
                map_alias = self._map_alias
                if not dc:
                    return
                with conn.cursor() as cur:
                    map_sel_m = f',{map_alias}."{map_col}"' if map_col else ""
                    date_sel_m = f',m."{date_col}"' if date_col else ""
                    cur.execute(
                        f'SELECT m."{dc}",m."{mkm}"{date_sel_m}{map_sel_m} '
                        f'FROM matches m {map_join} '
                        + (f'ORDER BY m."{date_col}" DESC' if date_col else ''))
                    rows = cur.fetchall()
                conn.close()
                all_paths = []
                for row in rows:
                    dp = row[0]
                    if not dp:
                        continue
                    chk = row[1]
                    if chk and dp not in self._demo_checksums:
                        self._demo_checksums[dp] = chk
                    if date_col and len(row) > 2 and row[2] and dp not in self._demo_dates:
                        self._demo_dates[dp] = row[2]
                    if map_col and dp not in self._demo_map_cache:
                        map_idx = 2 + (1 if date_col else 0)
                        if map_idx < len(row) and row[map_idx]:
                            self._demo_map_cache[dp] = str(row[map_idx]).strip()
                    all_paths.append(dp)
                self.after(0, lambda: self._demo_picker_populate(all_paths, keep_existing=True))
            except Exception as e:
                self._async_log(f"  ⚠ Demo picker (manual mode): {e}", "warn")
        threading.Thread(target=_bg, daemon=True).start()

    # ── TAB VIDEO ──
    def _tab_video(self, parent):
        p = self._make_tab_scroll(parent)

        sec_asm = Sec(p, "FINAL ASSEMBLY")
        sec_asm.pack(fill="x")

        _chk_tip(sec_asm, "Assemble all clips at the end", self.v["assemble_after"],
                            "After batch, concatenate all clips into a single file.\n"
                            "Video copied without re-encoding (-c:v copy) — fast, lossless.\n"
                            "Audio re-encoded to AAC to fix drift.\n"
                            "Requires the same codec and resolution on all clips.",
                            pady=(4, 2))
        _chk_tip(sec_asm, "Delete source clips after assembly", self.v["delete_after_assemble"],
                            "Deletes source files (and their folders) after successful assembly.\n"
                            "⚠ Incompatible with Concatenate sequences — automatically disables that option.")
        _asm_cb3 = _chk_tip(sec_asm, "Concatenate sequences", self.v["concatenate_sequences"],
                            "Merge all sequences from the same demo into a single clip (CSDM side, before FFmpeg).\n"
                            "⚠ Useless if 'Assemble all clips' is active — final assembly already does this.\n"
                            "⛔ Automatically disabled if 'Delete source clips' is checked.")

        def _sync_concat_state(*_):
            del_active = self.v["delete_after_assemble"].get()
            if del_active:
                self.v["concatenate_sequences"].set(False)
                _asm_cb3.config(state="disabled")
            else:
                _asm_cb3.config(state="normal")
        self.v["delete_after_assemble"].trace_add("write", _sync_concat_state)
        _sync_concat_state()

        asm_row = tk.Frame(sec_asm, bg=BG2)
        asm_row.pack(fill="x", pady=(8, 0))
        mlabel(asm_row, "Output filename:").pack(side="left")
        asm_entry = sentry(asm_row, self.v["assemble_output"])
        asm_entry.pack(side="left", fill="x", expand=True, padx=(6, 0), ipady=4)
        desc_label(asm_row, "  (extension .mp4/.mkv… auto-added if missing)").pack(
            side="left", padx=(6, 0))

        saved_names_frame = tk.Frame(sec_asm, bg=BG2)
        saved_names_frame.pack(fill="x", pady=(10, 0))

        names_hdr = tk.Frame(saved_names_frame, bg=BG2)
        names_hdr.pack(fill="x")
        mlabel(names_hdr, "Saved names:").pack(side="left")
        tk.Button(names_hdr, text="+ Save current name", font=FONT_DESC,
                  bg=BG3, fg=GREEN, relief="flat", bd=0, cursor="hand2",
                  activeforeground=GREEN, activebackground=BG3,
                  command=self._asm_save_current_name).pack(side="left", padx=(10, 0))

        self._asm_names_frame = tk.Frame(saved_names_frame, bg=BG2)
        self._asm_names_frame.pack(fill="x", pady=(6, 0))
        self._asm_names = load_asm_names()
        self._refresh_asm_names()

        sec = Sec(p, "RESOLUTION, FRAMERATE & WINDOW")
        sec.pack(fill="x")

        # ── Row 1: Definition + Ratio + Custom ───────────────────────────────
        top_row = tk.Frame(sec, bg=BG2)
        top_row.pack(fill="x", pady=(4, 0))

        # -- Definition block --
        def_frm = tk.Frame(top_row, bg=BG2)
        def_frm.pack(side="left", padx=(0, 20))
        mlabel(def_frm, "Definition").pack(anchor="w")
        self._def_radios = []
        for lbl, _ in DEFINITIONS:
            rb = hradio(def_frm, lbl, self.v["res_definition"], lbl,
                        command=self._on_res_structured)
            rb.pack(anchor="w", pady=(2, 0))
            self._def_radios.append(rb)

        # -- Vertical separator --
        tk.Frame(top_row, bg=BORDER, width=1).pack(side="left", fill="y", padx=(0, 20))

        # -- Aspect Ratio block --
        ratio_frm = tk.Frame(top_row, bg=BG2)
        ratio_frm.pack(side="left", padx=(0, 20))
        mlabel(ratio_frm, "Aspect ratio").pack(anchor="w")
        self._ratio_radios = []
        for lbl, _, _ in ASPECT_RATIOS:
            rb = hradio(ratio_frm, lbl, self.v["res_aspect"], lbl,
                        command=self._on_res_structured)
            rb.pack(anchor="w", pady=(2, 0))
            self._ratio_radios.append(rb)

        # -- Vertical separator --
        tk.Frame(top_row, bg=BORDER, width=1).pack(side="left", fill="y", padx=(0, 20))

        # -- Custom block --
        custom_frm = tk.Frame(top_row, bg=BG2)
        custom_frm.pack(side="left", padx=(0, 20))
        mlabel(custom_frm, "Custom").pack(anchor="w")
        self._res_custom_chk = hchk(custom_frm, "Free dimensions", self.v["res_custom"],
                                    command=self._on_res_custom_toggle)
        self._res_custom_chk.pack(anchor="w", pady=(4, 0))
        # Width × height fields (active only in custom mode)
        wh_frm = tk.Frame(custom_frm, bg=BG2)
        wh_frm.pack(anchor="w", pady=(6, 0))
        self._res_w_entry = sentry(wh_frm, self.v["width"], width=6)
        self._res_w_entry.pack(side="left", ipady=4)
        mlabel(wh_frm, "×").pack(side="left", padx=4)
        self._res_h_entry = sentry(wh_frm, self.v["height"], width=6)
        self._res_h_entry.pack(side="left", ipady=4)
        desc_label(custom_frm, "Calculated resolution:").pack(anchor="w", pady=(4, 0))
        self._res_preview_lbl = tk.Label(custom_frm, text="", font=FONT_SM,
                                         fg=ORANGE, bg=BG2)
        self._res_preview_lbl.pack(anchor="w")

        # ── Row 2: FPS ───────────────────────────────────────────────────────
        bot_row = tk.Frame(sec, bg=BG2)
        bot_row.pack(fill="x", pady=(12, 0))

        fps_frm = tk.Frame(bot_row, bg=BG2)
        fps_frm.pack(side="left", padx=(0, 20))
        mlabel(fps_frm, "FPS").pack(anchor="w")
        scombo(fps_frm, self.v["framerate"], FRAMERATES, 6).pack(anchor="w", pady=(4, 0))

        # ── Window mode ──────────────────────────────────────────────────────
        _sep(sec)
        win_row = WrapRow(sec, bg=BG2, gap_x=16, gap_y=4)
        win_row.pack(fill="x", pady=(4, 0))

        _g = tk.Frame(win_row, bg=BG2)
        _wm_lbl = mlabel(_g, "Window mode:")
        _wm_lbl.pack(side="left")
        add_tip(_wm_lbl,
                "Launch flags: -fullscreen / -windowed / -noborder.\n"
                "Applied in HLAE mode via extraArgs.\n"
                "In CS mode, CSDM JSON has no launch-args field (warning shown in log).")
        for lbl, val in [("None", "none"), ("Fullscreen", "fullscreen"),
                         ("Windowed", "windowed"), ("Borderless", "noborder")]:
            hradio(_g, lbl, self.v["cs2_window_mode"], val).pack(side="left", padx=(4, 0))
        win_row.add(_g)

        _stb_cb = hchk(win_row, "Send to back on launch", self.v["cs2_send_to_back"])
        add_tip(_stb_cb,
                "When CS2 appears, sends it behind all other windows without minimizing.\n"
                "The game keeps running normally — it is simply placed at the bottom of\n"
                "the Z-order so your desktop stays on top.\n"
                "Requires pywin32 (pip install pywin32). Silently ignored otherwise.")
        win_row.add(_stb_cb)

        sec = Sec(p, "ENCODING")
        sec.pack(fill="x")
        vc = tk.Frame(sec, bg=BG2)
        vc.pack(fill="x", pady=(4, 0))
        mlabel(vc, "Codec:").pack(side="left")
        self._vcodec_cb = scombo(vc, self.v["video_codec"], VIDEO_CODECS, 16)
        self._vcodec_cb.pack(side="left", padx=(6, 0))
        self._vcodec_cb.bind("<<ComboboxSelected>>", self._on_vcodec)
        mlabel(vc, "CRF:").pack(side="left", padx=(16, 0))
        sentry(vc, self.v["crf"], width=4).pack(side="left", padx=(6, 0), ipady=4)
        desc_label(vc, "  0=lossless  18=very good  23=default").pack(side="left", padx=(6, 0))
        self._vcodec_desc = tk.Label(sec, text="", font=FONT_DESC, fg=BLUE, bg=BG2, anchor="w")
        _bind_wraplength(self._vcodec_desc)
        self._vcodec_desc.pack(fill="x", pady=(4, 0))
        self._on_vcodec()

        pr = tk.Frame(sec, bg=BG2)
        pr.pack(fill="x", pady=(8, 0))
        mlabel(pr, "Preset:").pack(side="left")
        PRESETS_CPU = ["ultrafast", "superfast", "veryfast", "faster", "fast",
                       "medium", "slow", "slower", "veryslow"]
        scombo(pr, self.v["video_preset"], PRESETS_CPU, 10).pack(side="left", padx=(6, 0))
        desc_label(pr, "  Slow = better compression at equal quality."
                       "  No effect on GPU codecs (NVENC/AMF).").pack(side="left", padx=(8, 0))

        ct = tk.Frame(sec, bg=BG2)
        ct.pack(fill="x", pady=(8, 0))
        mlabel(ct, "Container:").pack(side="left")
        scombo(ct, self.v["video_container"], VIDEO_CONTAINERS, 8).pack(side="left", padx=(6, 0))

        _sep(sec)
        slabel(sec, "Audio").pack(anchor="w", pady=(0, 4))
        ac = tk.Frame(sec, bg=BG2)
        ac.pack(fill="x")
        mlabel(ac, "Codec:").pack(side="left")
        self._acodec_cb = scombo(ac, self.v["audio_codec"], AUDIO_CODECS, 14)
        self._acodec_cb.pack(side="left", padx=(6, 0))
        self._acodec_cb.bind("<<ComboboxSelected>>", self._on_acodec)
        mlabel(ac, "Bitrate (kbps):").pack(side="left", padx=(16, 0))
        sentry(ac, self.v["audio_bitrate"], width=5).pack(side="left", padx=(6, 0), ipady=4)
        self._acodec_desc = tk.Label(sec, text="", font=FONT_DESC, fg=BLUE, bg=BG2, anchor="w")
        _bind_wraplength(self._acodec_desc)
        self._acodec_desc.pack(fill="x", pady=(4, 0))
        self._on_acodec()

        _sep(sec)
        slabel(sec, "Advanced FFmpeg").pack(anchor="w", pady=(0, 4))
        for lbl, key in [("Input :", "ffmpeg_input_params"), ("Output :", "ffmpeg_output_params")]:
            row = tk.Frame(sec, bg=BG2)
            row.pack(fill="x", pady=(4, 0))
            mlabel(row, lbl, anchor="w").pack(side="left")
            sentry(row, self.v[key]).pack(side="left", fill="x", expand=True, ipady=4)

        sec = Sec(p, "IN-GAME OPTIONS")
        sec.pack(fill="x")
        for txt, key, tip in [
            ("TrueView",            "true_view",               "Client perspective (recommended) — FPS render instead of spectator camera."),
            ("Death notices only", "show_only_death_notices", "Show only death notices on screen."),
            ("X-Ray",               "show_xray",               "Skeletons visible through walls (showXRay)."),
        ]:
            _chk_tip(sec, txt, self.v[key], tip)
        dr = tk.Frame(sec, bg=BG2)
        dr.pack(fill="x", pady=(6, 0))
        _dn_lbl = mlabel(dr, "Death notices (s):")
        _dn_lbl.pack(side="left")
        add_tip(_dn_lbl, "Duration death notices are shown on screen (seconds).")
        sentry(dr, self.v["death_notices_duration"], width=4).pack(side="left", padx=(6, 0), ipady=4)
        _sep(sec)
        _chk_tip(sec, "Close CS2 after each demo", self.v["close_game_after"],
                 "closeGameAfterRecording — closes CS2 after each recorded demo.\n"
                 "Recommended: ON. Leaving CS2 open between demos can cause\n"
                 "instability on long batches.")

        sec = Sec(p, "RECORDING SYSTEM")
        sec.pack(fill="x")
        rg = tk.Frame(sec, bg=BG2)
        rg.pack(fill="x")
        mlabel(rg, "System:").pack(anchor="w")
        for o in RECSYS_OPTIONS:
            hradio(rg, o, self.v["recsys"], o).pack(anchor="w")
        desc_label(rg,
            "HLAE = injects via HLAE into CS2 (recommended — full options).\n"
            "CS = native CSDM recording via CS2's startmovie command.\n\n"
            "⚠ HLAE-exclusive features not available in CS mode:\n"
            "  custom FOV (mirv_fov), AFX streams, No spectator UI,\n"
            "  Fix scope FOV, and other mirv_* commands.\n"
            "ℹ Vanilla CS2 effects (physics, gravity, blood) are injected in both modes:\n"
            "  HLAE via extraArgs, CS via autoexec + runtime cfg injection."
        ).pack(anchor="w", pady=(4, 0))

        self._hlae_sec = Sec(p, "⚡ HLAE OPTIONS  —  HLAE mode only")
        self._hlae_sec.pack(fill="x")
        desc_label(self._hlae_sec,
                   "Passed to HLAE via CSDM. Not available in CS recording mode.\n"
                   "ℹ Audio captured directly by HLAE (bypasses Windows mixer).\n"
                   "⚠ CS2 console may briefly appear during recording: this is normal.").pack(fill="x")

        # FOV
        fov_row = tk.Frame(self._hlae_sec, bg=BG2)
        fov_row.pack(fill="x", pady=(8, 0))
        mlabel(fov_row, "FOV:").pack(side="left")
        sentry(fov_row, self.v["hlae_fov"], width=5).pack(side="left", padx=(6, 0), ipady=4)
        desc_label(fov_row, "  90 = default  |  100–110 = cinematic wide  |  60 = zoomed").pack(
            side="left", padx=(8, 0))

        # Game speed
        sm_row = tk.Frame(self._hlae_sec, bg=BG2)
        sm_row.pack(fill="x", pady=(6, 0))
        _gs_lbl = mlabel(sm_row, "Game Speed (%):")
        _gs_lbl.pack(side="left")
        _gs_entry = sentry(sm_row, self.v["hlae_slow_motion"], width=7)
        _gs_entry.pack(side="left", padx=(6, 0), ipady=4)
        add_tip(_gs_lbl,
                "Simulation speed multiplier.\n"
                "100 = normal | 125 = 1.25x | 200 = 2x | max 1000.")
        add_tip(_gs_entry,
                "Direct numeric input.\n"
                "Allowed range: 1..1000 (%).")
        self._speed_feedback = tk.Label(sm_row, text="", font=FONT_SM, fg=ORANGE, bg=BG2)
        self._speed_feedback.pack(side="left", padx=(8, 0))
        for pv in ("50", "75", "100", "125", "150", "200", "500", "1000"):
            tk.Button(sm_row, text=pv, font=FONT_DESC, bg=BG3, fg=TEXT,
                      relief="flat", bd=0, cursor="hand2",
                      activebackground=BORDER, activeforeground=ORANGE,
                      command=lambda v=pv: self.v["hlae_slow_motion"].set(int(v))
                      ).pack(side="left", padx=(4, 0), ipady=2, ipadx=3)
        self._on_game_speed_var()

        # Bool options
        bool_opts = tk.Frame(self._hlae_sec, bg=BG2)
        bool_opts.pack(fill="x", pady=(8, 0))
        for txt, key, tip in [
            ("AFX Stream",      "hlae_afx_stream",
             "Records separate passes (color, depth, stencil) for compositing."),
            ("No spectator UI", "hlae_no_spectator_ui",
             "Hides spectator HUD — injects +cl_draw_only_deathnotices 1."),
            ("Fix scope FOV",   "hlae_fix_scope_fov",
             "Injects: mirv_fov handleZoom enabled 1\n"
             "Prevents mirv_fov from overriding the zoomed FOV on scoped weapons.\n"
             "Recommended: ON."),
        ]:
            _cb = hchk(bool_opts, txt, self.v[key])
            _cb.pack(side="left", padx=(0, 6))
            add_tip(_cb, tip)

        # Extra args
        _ea_lbl = tk.Label(self._hlae_sec, text="Additional HLAE args:",
                 font=FONT_SM, fg=MUTED, bg=BG2)
        _ea_lbl.pack(anchor="w", pady=(8, 0))
        add_tip(_ea_lbl,
                "Arguments passed directly to the HLAE session.")
        sentry(self._hlae_sec, self.v["hlae_extra_args"]).pack(fill="x", ipady=4, pady=(2, 0))

        # ── CS2 EFFECTS (available in both modes) ────────────────────────────
        self._cs2_sec = Sec(p, "🎮 CS2 EFFECTS  —  both HLAE and CS modes")
        self._cs2_sec.pack(fill="x")
        desc_label(self._cs2_sec,
                   "Vanilla CS2 commands shared by both recording modes.\n"
                   "HLAE: injected via extraArgs | CS: injected via autoexec + runtime cfg.").pack(fill="x")

        mlabel(self._cs2_sec, "Physics & visuals:").pack(anchor="w", pady=(4, 0))
        desc_label(self._cs2_sec,
                   "Non-default values are injected as CS2 console commands on startup.").pack(
            anchor="w")

        phys_grid = tk.Frame(self._cs2_sec, bg=BG2)
        phys_grid.pack(fill="x", pady=(6, 0))
        phys_grid.columnconfigure(0, weight=2)
        phys_grid.columnconfigure(1, weight=1)

        col_l = tk.Frame(phys_grid, bg=BG2)
        col_l.grid(row=0, column=0, sticky="new", padx=(0, 16))
        for lbl, key, tip, presets in [
            ("cl_ragdoll_gravity", "phys_ragdoll_gravity",
             "Ragdoll gravity.\nDefault 600 | 0 or negative = float | 5000 = slam hard.",
             ["600", "200", "0", "-200", "-500", "2000", "5000"]),
            ("ragdoll_gravity_scale", "phys_ragdoll_scale",
             "Ragdoll gravity scale.\nDefault 1.0 | 0.1 = slow | 3.0 = fast.",
             ["1.0", "0.5", "0.1", "0.0", "2.0", "3.0"]),
            ("sv_gravity", "phys_sv_gravity",
             "World gravity.\nDefault 800 | 200 = moon | 2000 = very heavy.",
             ["800", "400", "200", "100", "1200", "2000"]),
        ]:
            f = tk.Frame(col_l, bg=BG2)
            f.pack(fill="x", pady=(0, 6))
            _fl = mlabel(f, lbl)
            _fl.pack(anchor="w")
            add_tip(_fl, tip)
            row = tk.Frame(f, bg=BG2)
            row.pack(fill="x", pady=(2, 0))
            sentry(row, self.v[key], width=7).pack(side="left", ipady=4)
            for pv in presets:
                tk.Button(row, text=pv, font=FONT_DESC, bg=BG3, fg=TEXT,
                          relief="flat", bd=0, cursor="hand2",
                          activebackground=BORDER, activeforeground=ORANGE,
                          command=lambda v=pv, k=key: self.v[k].set(v)
                          ).pack(side="left", padx=(4, 0), ipady=2, ipadx=3)

        col_r = tk.Frame(phys_grid, bg=BG2)
        col_r.grid(row=0, column=1, sticky="new")
        for txt, key, tip in [
            ("Ragdoll physics",  "phys_ragdoll_enable",
             "cl_ragdoll_physics_enable\n\n"
             "ON  = corpses fall with physics (default).\n"
             "OFF = corpses freeze in place on death — cleaner montage look.\n\n"
             "⚠ If corpses appear to fall faster than normal during recording,\n"
             "  uncheck this to freeze them. The script already injects\n"
             "  demo_timescale 1 to lock playback speed, but residual\n"
             "  host_timescale or CS2 engine quirks can still affect physics."),
            ("Blood on walls",   "phys_blood",
             "violence_hblood — disable for a cleaner render."),
            ("Dynamic lighting", "phys_dynamic_lighting",
             "r_dynamic — disable to remove explosion flashes."),
        ]:
            f = tk.Frame(col_r, bg=BG2)
            f.pack(fill="x", pady=(0, 6))
            _cb = hchk(f, txt, self.v[key])
            _cb.pack(anchor="w")
            add_tip(_cb, tip)

        # Trace recsys to show/hide HLAE-exclusive section
        self.v["recsys"].trace_add("write", self._on_recsys_change)
        self._on_recsys_change()

    def _asm_save_current_name(self):
        name = self.v["assemble_output"].get().strip()
        if not name:
            messagebox.showinfo("Assembly names", "Name field is empty.")
            return
        if name in self._asm_names:
            messagebox.showinfo("Assembly names", f"'{name}' is already registered.")
            return
        self._asm_names.append(name)
        save_asm_names(self._asm_names)
        self._refresh_asm_names()

    def _asm_delete_name(self, name):
        if name in self._asm_names:
            self._asm_names.remove(name)
            save_asm_names(self._asm_names)
            self._refresh_asm_names()

    def _refresh_asm_names(self):
        for w in self._asm_names_frame.winfo_children():
            w.destroy()
        if not self._asm_names:
            tk.Label(self._asm_names_frame,
                     text="No saved names — enter a name above then '+ Save'.",
                     font=FONT_DESC, fg=MUTED, bg=BG2).pack(anchor="w")
            return
        for n in self._asm_names:
            row = tk.Frame(self._asm_names_frame, bg=BG2)
            row.pack(fill="x", pady=1)
            tk.Button(row, text=n, font=FONT_SM, bg=BG3, fg=TEXT,
                      relief="flat", bd=0, cursor="hand2", anchor="w",
                      activebackground=BORDER, activeforeground=ORANGE,
                      command=lambda v=n: self.v["assemble_output"].set(v)
                      ).pack(side="left", ipady=3, ipadx=8)
            tk.Button(row, text="✕", font=FONT_DESC, bg=BG2, fg=RED,
                      relief="flat", bd=0, cursor="hand2",
                      activebackground=BORDER, activeforeground=RED,
                      command=lambda v=n: self._asm_delete_name(v)
                      ).pack(side="left", padx=(4, 0))

    def _on_game_speed_var(self, *_):
        if self._game_speed_trace_busy:
            return
        self._game_speed_trace_busy = True
        try:
            val = self._cfg_int({"v": self.v["hlae_slow_motion"].get()}, "v", 100, 1, 1000)
            try:
                current = int(self.v["hlae_slow_motion"].get())
            except Exception:
                current = None
            if current != val:
                self.v["hlae_slow_motion"].set(val)
            if self._speed_feedback is not None and self._speed_feedback.winfo_exists():
                self._speed_feedback.config(text=f"{val}%  ({val / 100:.2f}x)")
        finally:
            self._game_speed_trace_busy = False

    def _clamp_layout_values(self, w, h, split):
        try:
            w = int(float(w))
        except Exception:
            w = 1600
        try:
            h = int(float(h))
        except Exception:
            h = 900
        try:
            split = int(float(split))
        except Exception:
            split = 60
        w = max(1000, min(3840, w))
        h = max(600, min(2160, h))
        # 38 % lower bound matches left_frame minsize=380 px at 1000 px window.
        # 80 % upper bound matches right_frame minsize=200 px at 1000 px window.
        split = max(38, min(80, split))
        return w, h, split

    def _apply_layout_vars(self):
        w, h, split = self._clamp_layout_values(
            self.v["ui_window_w"].get(),
            self.v["ui_window_h"].get(),
            self.v["ui_split_pct"].get(),
        )
        self.v["ui_window_w"].set(w)
        self.v["ui_window_h"].set(h)
        self.v["ui_split_pct"].set(split)
        self.geometry(f"{w}x{h}")
        self.update_idletasks()
        if self._outer_paned is not None:
            try:
                self._outer_paned.sashpos(0, int(self.winfo_width() * (split / 100.0)))
            except Exception:
                pass
        self._log_flash(f"  ✓ UI layout applied: {w}x{h} | split {split}%", "ok")

    def _auto_layout(self):
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        w = max(1000, min(3840, int(sw * 0.86)))
        h = max(600, min(2160, int(sh * 0.84)))
        self.v["ui_window_w"].set(w)
        self.v["ui_window_h"].set(h)
        self.v["ui_split_pct"].set(60)
        self._apply_layout_vars()

    def _reset_layout_defaults(self):
        self.v["ui_window_w"].set(1600)
        self.v["ui_window_h"].set(900)
        self.v["ui_split_pct"].set(60)
        self._apply_layout_vars()

    def _on_splitter_release(self, event=None):
        if self._outer_paned is None:
            return
        try:
            total = max(1, self.winfo_width())
            # Clamp in pixels first so neither panel can be squeezed below its
            # minimum, then store as a percentage for layout restore on startup.
            sash = self._outer_paned.sashpos(0)
            sash = max(UI_PANE_LEFT_MIN, min(total - UI_PANE_RIGHT_MIN, sash))
            self._outer_paned.sashpos(0, sash)
            split = int(round(sash * 100 / total))
            split = self._clamp_layout_values(1600, 900, split)[2]
            self.v["ui_split_pct"].set(split)
        except Exception:
            pass

    def _on_window_configure(self, event=None):
        if not self.v["ui_remember_layout"].get():
            return
        if self.wm_state() != "normal":
            return
        if self._layout_cfg_job is not None:
            try:
                self.after_cancel(self._layout_cfg_job)
            except Exception:
                pass
        self._layout_cfg_job = self.after(250, self._remember_layout_state)

    def _remember_layout_state(self):
        self._layout_cfg_job = None
        if not self.v["ui_remember_layout"].get():
            return
        if self.wm_state() != "normal":
            return
        try:
            w = self.winfo_width()
            h = self.winfo_height()
            w, h, _ = self._clamp_layout_values(w, h, self.v["ui_split_pct"].get())
            self.v["ui_window_w"].set(w)
            self.v["ui_window_h"].set(h)
            # Do NOT call _on_splitter_release() here — that sets sashpos() which
            # fires <Configure> on every pane → re-triggers all ScrollableFrame
            # reflows 400 ms later, producing the "momentum" drag feel.
            # Sash snapping happens only on actual sash-drag via the outer binding.
        except tk.TclError:
            pass

    def _on_recsys_change(self, *_):
        try:
            recsys = self._normalize_recsys(self.v["recsys"].get())
            if recsys != self.v["recsys"].get():
                self.v["recsys"].set(recsys)
                return
            is_hlae = recsys == "HLAE"
            if is_hlae:
                self._hlae_sec.pack(fill="x")
            else:
                self._hlae_sec.pack_forget()
            # CS2 EFFECTS section is always visible (both modes)
        except Exception:
            pass

    # ── v60: structured resolution selectors ─────────────────────────────────
    def _on_perspective_change(self, *_):
        """Show/hide the 'Switch delay' slider, total-before hint, and Mate POV row."""
        try:
            persp = self.v["perspective"].get()
            if persp == "both":
                self._victim_pre_row.pack(fill="x", pady=(4, 0))
                b  = int(float(self.v["before"].get()))
                vp = int(float(self.v["victim_pre_s"].get()))
                self._both_total_lbl.config(text=f"total before: {b + vp}s")
            else:
                self._victim_pre_row.pack_forget()
            # Mate POV is only meaningful in victim/both mode
            if persp in ("victim", "both"):
                self._mate_pov_row.pack(fill="x", pady=(4, 0))
            else:
                self._mate_pov_row.pack_forget()
                # Reset mate POV vars so they don't silently run in killer mode
                self.v["kill_mod_mate_pov"].set(False)
                self.v["kill_mod_mate_pov_req"].set(False)
        except Exception:
            pass

    def _on_res_structured(self, *_):
        """Compute width × height from (definition × ratio) and update vars."""
        if self.v["res_custom"].get():
            return
        def_lbl = self.v["res_definition"].get()
        ratio_lbl = self.v["res_aspect"].get()
        height = next((h for lbl, h in DEFINITIONS if lbl == def_lbl), 1080)
        rw, rh = next(((rw, rh) for lbl, rw, rh in ASPECT_RATIOS if lbl == ratio_lbl), (16, 9))
        # Round width to nearest multiple of 2 (required by most codecs)
        width = round(height * rw / rh / 2) * 2
        self.v["width"].set(width)
        self.v["height"].set(height)
        self._update_res_preview()

    def _on_res_custom_toggle(self, *_):
        """Enable/disable structured selectors and manual input fields."""
        custom = self.v["res_custom"].get()
        state_struct = "disabled" if custom else "normal"
        state_manual = "normal" if custom else "disabled"
        # Enable/disable definition and ratio radio buttons
        try:
            for w in self._def_radios:
                w.config(state=state_struct)
        except tk.TclError:
            pass
        try:
            for w in self._ratio_radios:
                w.config(state=state_struct)
        except tk.TclError:
            pass
        # Enable/disable manual input fields
        try:
            self._res_w_entry.config(state=state_manual)
            self._res_h_entry.config(state=state_manual)
        except tk.TclError:
            pass
        if not custom:
            # Recompute from selectors
            self._on_res_structured()
        self._update_res_preview()

    def _update_res_preview(self):
        """Refresh the computed resolution label."""
        try:
            w = self.v["width"].get()
            h = self.v["height"].get()
            self._res_preview_lbl.config(text=f"{w} × {h} px")
            self.v["resolution"].set(f"{w}x{h}")
        except tk.TclError:
            pass

    def _on_vcodec(self, e=None):
        self._vcodec_desc.config(text=VIDEO_CODECS_INFO.get(self.v["video_codec"].get(), ""))

    def _on_acodec(self, e=None):
        self._acodec_desc.config(text=AUDIO_CODECS_INFO.get(self.v["audio_codec"].get(), ""))

    # ── TROIS SHOT (v62) ──────────────────────────────────────────────────
    def _on_trois_shot_toggle(self, *_):
        """Toggle TROIS SHOT. Mutually exclusive with Exclude only.
        Independent of ONE TAP and TROIS TAP."""
        active = self.v["kill_mod_trois_shot"].get()
        if active and self.v["kill_mod_no_trois_shot"].get():
            self.v["kill_mod_no_trois_shot"].set(False)

    def _on_no_trois_shot_toggle(self, *_):
        """Toggle Exclude (inverse TROIS SHOT).
        Mutually exclusive with TROIS SHOT and TROIS TAP only."""
        active = self.v["kill_mod_no_trois_shot"].get()
        if active:
            if self.v["kill_mod_trois_shot"].get():
                self.v["kill_mod_trois_shot"].set(False)
            if self.v["kill_mod_trois_tap"].get():
                self.v["kill_mod_trois_tap"].set(False)


    def _on_logic_mode_change(self, category: str, *_):
        """Ensure ★ Must toggles are visible (fixed required+optional logic)."""
        for widget in self._must_widgets.get(category, []):
            try:
                widget.pack(side="left", padx=(8, 0))
            except Exception:
                pass
    def _build_filter_row(self, parent, fdef: "FilterDef",
                          must_list: list, pady: int = 2) -> None:
        """Build one standard kill-filter row from a FilterDef.

        Renders:  [flabel]  [Enable hchk]  [★ Must hchk]  [Exclude hchk]  [extras]  [dp2_badge]

        must_list  — category must_widgets list; the ★ Must checkbox is appended.
        """
        row = tk.Frame(parent, bg=BG2)
        row.pack(fill="x", pady=(pady, 0))

        lbl = flabel(row, fdef.label)
        lbl.pack(side="left")
        add_tip(lbl, fdef.tip)

        # Command for special filters
        cmd_map = {
            "trois_shot": self._on_trois_shot_toggle,
        }
        cmd = cmd_map.get(fdef.special)

        ex_key = f"{fdef.key}_exclude"
        has_exclude = (fdef.key not in _NO_AUTO_EXCLUDE
                       and not fdef.hide_ui
                       and ex_key in self.v)

        # Enable — clears Exclude when turned on
        def _make_enable_cmd(f_key=fdef.key, ex_k=ex_key, base_cmd=cmd):
            def _on():
                if self.v[f_key].get() and ex_k in self.v:
                    self.v[ex_k].set(False)
                if base_cmd:
                    base_cmd()
            return _on

        cb = hchk(row, "Enable", self.v[fdef.key],
                  command=_make_enable_cmd() if (has_exclude or cmd) else None)
        cb.pack(side="left", padx=(4, 0))
        add_tip(cb, fdef.tip)

        must_cb = hchk(row, "★ Must", self.v[f"{fdef.key}_req"])
        must_list.append(must_cb)
        add_tip(must_cb, "Required filter (must match).\nOthers without ★ are optional "
                         "(at least one optional must match).")
        self._wire_enable_must(self.v[fdef.key], self.v[f"{fdef.key}_req"])

        # Exclude checkbox — mutually exclusive with Enable + ★ Must
        if has_exclude:
            def _make_excl_cmd(f_key=fdef.key, ex_k=ex_key, req_k=f"{fdef.key}_req"):
                def _on():
                    if self.v[ex_k].get():
                        self.v[f_key].set(False)
                        self.v[req_k].set(False)
                return _on
            excl_cb = hchk(row, "Exclude", self.v[ex_key], command=_make_excl_cmd())
            excl_cb.pack(side="left", padx=(4, 0))
            add_tip(excl_cb,
                    f"Exclude: remove every kill matching {fdef.badge} from results.\n"
                    "Mutually exclusive with Enable and ★ Must.")
        elif fdef.special == "trois_shot":
            # TROIS SHOT uses the legacy no_trois_shot key for its Exclude
            nts_cb = hchk(row, "Exclude", self.v["kill_mod_no_trois_shot"],
                          command=self._on_no_trois_shot_toggle)
            nts_cb.pack(side="left", padx=(4, 0))
            add_tip(nts_cb, "Inverse of TROIS SHOT — removes lucky kills on these weapons.\n"
                            "When combined with other dp2 filters, acts as an exclusion gate first.")

        # dp2 badge always far right for dp2 category
        if fdef.category == "dp2":
            dp2_badge(row).pack(side="right", padx=(0, 4))

        return row


    def _on_kill_logic_change(self, *_):
        self.v["kill_mod_logic_mods"].set("mixed")
        self.v["kill_mod_logic_dp2"].set("mixed")
        self.v["kill_mod_logic_db"].set("mixed")
        self._on_logic_mode_change("mods")
        self._on_logic_mode_change("dp2")
        self._on_logic_mode_change("db")


    def _clear_kill_filters(self):
        keys = [k for k, *_ in self._FILTER_BADGE_DEFS]
        for k in keys:
            for suffix in ("", "_req", "_exclude"):
                v = self.v.get(f"{k}{suffix}")
                if v is not None:
                    v.set(False)

        self._log_flash("  ✓ All kill/situation filters unselected.", "ok")

    def _wire_enable_must(self, enable_var: tk.BooleanVar, req_var: tk.BooleanVar):
        """Couple an Enable checkbox with its ★ Must checkbox.

        Rules:
          - Checking ★ Must while Enable is off → auto-enables the filter.
          - Unchecking Enable while Must is on → auto-clears Must.

        This prevents the silent bug where Must=True + Enable=False causes the
        filter to never appear in the active list, making Must silently ignored.
        Stores the pair in self._must_couplings for reference.
        """
        if not hasattr(self, "_must_couplings"):
            self._must_couplings: list = []
        self._must_couplings.append((enable_var, req_var))

        def _on_req_change(*_):
            if req_var.get() and not enable_var.get():
                enable_var.set(True)

        def _on_enable_change(*_):
            if not enable_var.get() and req_var.get():
                req_var.set(False)

        req_var.trace_add("write", _on_req_change)
        enable_var.trace_add("write", _on_enable_change)

    def _retrigger_toggle_vars(self):
        """Nudge every BooleanVar and StringVar so hchk/hradio _update closures re-fire.

        Since those closures now call _t() for live colour lookups, re-triggering
        them applies the new theme to all checkboxes and radiobuttons immediately.
        """
        for key, var in self.v.items():
            try:
                if isinstance(var, (tk.BooleanVar, tk.StringVar)):
                    cur = var.get()
                    var.set(cur)
            except Exception:
                pass


    def _spray_transfer_filter(self, demo_path, events, cfg):
        """Keep only kills that are part of a spray transfer.

        A spray transfer = the player kills ≥2 opponents in a single continuous
        burst with an automatic weapon (no trigger release between kills).
        Detection: at each kill tick, look back in weapon_fire for a shot within
        SPRAY_MAX_GAP_TICKS. Then walk backward through shots to find the burst
        start. A burst that spans ≥2 victims qualifies.

        Only automatic weapons are eligible (SPRAY_TRANSFER_WEAPONS_LOWER).
        Snipers, auto-snipers, shotguns, non-CZ pistols are excluded.
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)

        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)

        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        fire_ticks = data.get("fire_ticks", {})

        # Group kills by (killer_sid, weapon_suffix) to check bursts
        kill_groups: dict = {}
        for evt in events:
            if evt.get("type") != "kill":
                continue
            weapon_raw = evt.get("weapon", "")
            if weapon_raw.lower().strip() not in SPRAY_TRANSFER_WEAPONS_LOWER:
                continue
            sid   = str(evt.get("killer_sid", ""))
            wpn_s = weapon_raw.lower().strip()
            kill_groups.setdefault((sid, wpn_s), []).append(int(evt.get("tick", 0)))

        spray_kill_sigs: set = set()

        for (sid, wpn_s), kill_ticks_list in kill_groups.items():
            if len(kill_ticks_list) < 2:
                continue
            shots = fire_ticks.get((sid, wpn_s), [])
            if not shots:
                continue

            kill_ticks_sorted = sorted(kill_ticks_list)

            # Walk shots once to segment into bursts, then classify kills per burst.
            # A burst ends when the gap between consecutive shots > SPRAY_MAX_GAP_TICKS.
            burst_ranges: list = []    # [(burst_start_tick, burst_end_tick), ...]
            b_start = shots[0]
            for j in range(1, len(shots)):
                if shots[j] - shots[j - 1] > SPRAY_MAX_GAP_TICKS:
                    burst_ranges.append((b_start, shots[j - 1]))
                    b_start = shots[j]
            burst_ranges.append((b_start, shots[-1]))

            # For each burst, find which kills fall inside it (±SPRAY_MAX_GAP_TICKS grace)
            ki = 0  # pointer into kill_ticks_sorted (both are sorted)
            for b_start, b_end in burst_ranges:
                window_end = b_end + SPRAY_MAX_GAP_TICKS
                burst_kills = []
                # Advance ki to first kill in this burst
                while ki < len(kill_ticks_sorted) and kill_ticks_sorted[ki] < b_start:
                    ki += 1
                j = ki
                while j < len(kill_ticks_sorted) and kill_ticks_sorted[j] <= window_end:
                    burst_kills.append(kill_ticks_sorted[j])
                    j += 1
                if len(burst_kills) >= 2:
                    for bkt in burst_kills:
                        spray_kill_sigs.add((bkt, sid))
                    if self._dp2_verbose:
                        self._async_log(
                            f"  🔫 SPRAY TRANSFER [{wpn_s}] sid={sid} "
                            f"burst={b_start}→{b_end} kills={len(burst_kills)}", "info")

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt)
                continue
            sig = (int(evt.get("tick", 0)), str(evt.get("killer_sid", "")))
            if sig in spray_kill_sigs:
                filtered.append(evt)

        return filtered


    # ── dp2 filters: High Velocity, Flick, Savior ───────────────────────

    def _high_velocity_filter(self, demo_path, events, cfg):
        """Ferrari Peek — kill faster than the opponent can react.

        The player peeks an angle at speed, fires once, and immediately retreats —
        the entire exposure window is shorter than human reaction time (~150-250ms).

        A kill qualifies if ALL conditions hold:

          1. ISOLATED SHOT (optional, kill_mod_hv_one_shot): no weapon_fire from
             the player in PRE_WINDOW ticks before the kill shot. Ensures this is
             the opening shot, not the last bullet of a spray.

          2. MOVING BEFORE: the player was moving at speed during the peek approach.
             Checked in two ways:
             - The kill shot itself was fired at velocity >= approach_thr (still
               running at shot time, or counter-strafe was very recent), OR
             - A weapon_fire in the APPROACH_WIN before the shot had velocity >=
               approach_thr (only relevant when one-shot is disabled, since condition
               1 eliminates prior shots otherwise).
             APPROACH_WIN is intentionally tight (1s) — a fast approach 3s ago
             followed by camping is not a ferrari peek.

          3. RESUMES AFTER: at least one weapon_fire within RESUME_WIN after the
             kill has velocity >= RESUME_THR — player immediately moves away.
             Skipped gracefully if no post-kill fire is found.

        kill_mod_high_vel_thr: minimum approach speed (u/s) to qualify.
        Default 100 u/s — above walking speed, catches any active peek.
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        fire_index = data.get("fire_detail", {})

        approach_thr     = max(1.0, float(cfg.get("kill_mod_high_vel_thr", 100)))
        require_one_shot = cfg.get("kill_mod_hv_one_shot", True)
        RESUME_THR    = 80.0   # u/s — minimum speed to count as "moving after"
        PRE_WINDOW    = 48     # ticks — no prior shot allowed before kill (~0.75s)
        APPROACH_WIN  = 64     # ticks — recent movement window (~1s, intentionally tight)
        RESUME_WIN    = 128    # ticks — window to detect post-kill movement (~2s)
        SHOT_WINDOW   = 24     # ticks — window around kill to match kill shot

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt)
                continue

            kill_tick  = int(evt.get("tick", 0))
            killer_sid = str(evt.get("killer_sid", ""))
            weapon_raw = str(evt.get("weapon", "")).lower().strip()
            # Normalise weapon suffix (same logic as _weapon_suffix_key)
            kill_wpn_s = CSDM_TO_DP2_WEAPON.get(weapon_raw)
            if kill_wpn_s:
                kill_wpn_s = kill_wpn_s[7:] if kill_wpn_s.startswith("weapon_") else kill_wpn_s
            elif weapon_raw.startswith("weapon_"):
                kill_wpn_s = weapon_raw[7:]
            else:
                kill_wpn_s = weapon_raw.replace(" ","").replace("-","").replace("_","")

            # Collect weapon_fire entries for this player.
            # Kill-weapon entries are kept separately so the shot-match step can
            # prefer them over entries from other weapons fired at a similar tick.
            kill_wpn_entries: list = []
            other_entries: list = []
            for (sid, wpn_s), entries in fire_index.items():
                if sid != killer_sid:
                    continue
                if wpn_s == kill_wpn_s:
                    kill_wpn_entries.extend(entries)
                else:
                    other_entries.extend(entries)
            all_entries: list = kill_wpn_entries + other_entries
            all_entries.sort(key=lambda r: r[0])

            if not all_entries:
                continue

            # ── Find the kill shot ──────────────────────────────────────────
            # Prefer entries from the kill weapon; fall back to any weapon if needed.
            shot_entry = None
            for candidate_list in (kill_wpn_entries, other_entries):
                if shot_entry is not None:
                    break
                for ftick, acc, scoped, vel in sorted(candidate_list, key=lambda r: r[0]):
                    if abs(kill_tick - ftick) <= SHOT_WINDOW:
                        if shot_entry is None or abs(kill_tick - ftick) < abs(kill_tick - shot_entry[0]):
                            shot_entry = (ftick, acc, scoped, vel)

            if shot_entry is None:
                continue

            shot_tick = shot_entry[0]
            shot_vel  = shot_entry[3]

            # ── Condition 1: isolated shot (one-shot kill) — optional ─────
            if require_one_shot:
                prior_shot = any(
                    (shot_tick - PRE_WINDOW) <= ftick < shot_tick
                    for ftick, *_ in all_entries
                )
                if prior_shot:
                    continue

            # ── Condition 2: was moving before (on the peek) ──────────────
            # Check velocity of shots fired in the APPROACH_WIN before the kill shot.
            # approach_end = shot_tick so we capture the full 1-second approach window.
            # The kill shot velocity is checked separately via shot_vel.
            # Note: PRE_WINDOW is only used by Condition 1 (no-shot isolation check);
            # it must NOT narrow the approach window here, which was a prior bug
            # that reduced the effective window to only APPROACH_WIN - PRE_WINDOW = 16 ticks.
            approach_start = shot_tick - APPROACH_WIN
            approach_shots = [
                vel for ftick, _acc, _sc, vel in all_entries
                if approach_start <= ftick < shot_tick
            ]
            was_moving_before = (
                (approach_shots and max(approach_shots) >= approach_thr)
                or shot_vel >= approach_thr  # shot while running / counter-strafe
            )
            if not was_moving_before:
                continue

            # ── Condition 3: resumes movement after kill ───────────────────
            resume_shots = [
                vel for ftick, _acc, _sc, vel in all_entries
                if kill_tick < ftick <= kill_tick + RESUME_WIN
            ]
            if resume_shots and max(resume_shots) < RESUME_THR:
                # Fired again but stationary — not resuming a peek
                continue
            # No post-kill fire → skip check (degrade gracefully)

            filtered.append(evt)

        return filtered

    def _flick_filter(self, demo_path, events, cfg):
        """Keep kills where the player made a large view-angle change relative to their prior kill.

        Uses the attacker's yaw angle recorded at each player_death event (via demoparser2).
        Compares the yaw at the current kill tick to the yaw at the most recent prior kill
        that happened at least LOOK_BACK (32) ticks earlier.

        Angle delta ≥ kill_mod_flick_deg qualifies (default 50°).

        Note: view_angles contains one angle sample per kill event (the attacker's yaw at
        kill time), not a continuous per-tick history. The 32-tick (LOOK_BACK) guard
        prevents using the immediately preceding sample if it is too close in time.
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        view_angles = data.get("view_angles", {})
        if not view_angles:
            return self._non_kill_only(events)

        min_deg = max(1.0, float(cfg.get("kill_mod_flick_deg", 50)))
        LOOK_BACK = 32  # ticks to look back for prior angle (~0.5s)

        def _angle_delta(a, b):
            """Smallest angle between two yaw values (handles 360→0 wrap)."""
            d = abs(a - b) % 360
            return d if d <= 180 else 360 - d

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt); continue
            kill_tick  = int(evt.get("tick", 0))
            killer_sid = str(evt.get("killer_sid", ""))
            angles = view_angles.get(killer_sid, [])
            if not angles:
                continue
            ticks = [a[0] for a in angles]
            # Find angle at/near kill tick
            pos = bisect.bisect_right(ticks, kill_tick) - 1
            if pos < 0:
                continue
            yaw_at_kill = angles[pos][1]
            # Find angle ~LOOK_BACK ticks before
            prior_tick = kill_tick - LOOK_BACK
            pos_prior  = bisect.bisect_right(ticks, prior_tick) - 1
            if pos_prior < 0 or pos_prior == pos:
                continue
            yaw_before = angles[pos_prior][1]
            delta = _angle_delta(yaw_at_kill, yaw_before)
            if delta >= min_deg:
                filtered.append(evt)
        return filtered

    def _savior_filter(self, demo_path, events, cfg):
        """Keep kills where the player killed an enemy who was hurting a teammate.

        A 'savior' kill: within SAVIOR_WINDOW ticks before the kill, the
        victim (the player's target) was attacking one of the tracked player SIDs.
        Requires hurt_index from player_hurt parse.

        The hurt_victim must be one of the tracked SIDs — without this check any
        kill where the victim recently hurt *anyone* (including enemies) would
        qualify, producing false positives in crossfire / damage-trade scenarios.
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        hurt_index = data.get("hurt_index", {})
        if not hurt_index:
            return self._non_kill_only(events)

        SAVIOR_WINDOW = 128  # ~2s — the enemy was shooting at a teammate recently

        # Build set of tracked player SIDs — only events where they were the hurt victim count
        sids_set = {str(e.get("killer_sid","")) for e in events if e.get("type") == "kill"}

        # Build a reverse index: attacker_sid → sorted list of ticks when they hurt a tracked player.
        # This turns the per-kill scan from O(all_hurt_entries) → O(log n) via bisect.
        # Only entries where hurt_victim ∈ sids_set are included (correctness filter).
        attacker_hurt_ticks: dict = {}   # {attacker_sid: [tick, ...]}  (sorted)
        for hurt_victim_sid, hurt_entries in hurt_index.items():
            if hurt_victim_sid not in sids_set:
                continue
            for (ht, hatk) in hurt_entries:
                attacker_hurt_ticks.setdefault(hatk, []).append(ht)
        for v in attacker_hurt_ticks.values():
            v.sort()

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt); continue
            kill_tick  = int(evt.get("tick", 0))
            victim_sid = str(evt.get("victim_sid", ""))
            ticks = attacker_hurt_ticks.get(victim_sid)
            if not ticks:
                continue
            # Binary-search for any tick in (kill_tick - WINDOW, kill_tick]
            lo = kill_tick - SAVIOR_WINDOW
            pos = bisect.bisect_left(ticks, lo)
            if pos < len(ticks) and ticks[pos] <= kill_tick:
                filtered.append(evt)
        return filtered

    # ── Mate POV camera modifier ───────────────────────────────────────────────
    # kill_mod_mate_pov: show the kill from the best-angle teammate's perspective.
    # Architecture:
    #   1. _mate_pov_filter stamps evt["_mate_pov_sid"] on each kill that has a
    #      qualifying teammate; optionally removes kills with no match (Must mode).
    #   2. _build_cams_victim / _build_cams_both read _mate_pov_sid via cfg flag.
    #   3. camera_fn="_mate_pov_camera_sid" lets _build_json look it up generically.
    # LOS is angle-based only (no BSP ray-cast available via demoparser2).

    _MATE_POV_EYE_HEIGHT     = 54           # eye-level offset above feet (CS2 standing)
    _MATE_POV_FOV_HALF_DEG   = 20.0         # half-angle: victim must be clearly in view
    _MATE_POV_MAX_DIST       = 550          # ignore mates beyond 550 u — walls very likely
    _MATE_POV_MIN_DIST       = 80           # ignore mates clipping into / directly on victim
    _MATE_POV_MAX_Z_DELTA    = 300          # reject if height diff > 300 u — different floors
    _MATE_POV_MAX_ELEVATION  = 30.0         # reject if elevation angle > 30° — through floor/ceil
    # demoparser2 stores SteamIDs with the lower 3 bits zeroed (CS2 entity handle
    # encoding).  float64 precision loss on 17-digit SteamID64 values can produce
    # a rounding error of up to 16 units at the magnitudes involved (~7.6×10^16).
    # Tolerance=16 covers all real-world cases with margin.
    _DP2_SID_TOLERANCE      = 16

    def _parse_mate_positions(self, demo_path, kill_ticks):
        """Lazily parse player positions + view-angles at the given ticks and cache them.

        Returns the positions dict: {tick: {steamid: {X, Y, Z, pitch, yaw, team}}}.
        Called just-in-time from _mate_pov_filter so pre-parse doesn't need tick list.
        """
        if not kill_ticks or not os.path.isfile(demo_path):
            return {}

        with self._dp2_cache_lock:
            existing = self._dp2_cache.get(demo_path, {})
            cached = dict(existing.get("mate_positions") or {})

        needed = [t for t in kill_ticks if t not in cached]
        if not needed:
            return cached

        try:
            from demoparser2 import DemoParser
            parser = DemoParser(demo_path)
            df = parser.parse_ticks(["X", "Y", "Z", "pitch", "yaw", "team_num", "health"], ticks=needed)
        except Exception as e:
            self._async_log(f"  ⚠ Mate POV parse_ticks error: {e}", "warn")
            return cached

        try:
            if df is None or len(df) == 0:
                self._async_log("  ⚠ Mate POV: parse_ticks returned empty DataFrame", "warn")
                return cached
            cols = list(df.columns)
            # steamid column varies across demoparser2 versions
            sid_col = next((c for c in cols
                            if c.lower() in ("steamid", "player_steamid", "user_steamid")), None)
            if not sid_col:
                self._async_log(f"  ⚠ Mate POV: no steamid column in {cols}", "warn")
                return cached

            def _fc(name):
                return next((c for c in cols if c.lower() == name.lower()), None)

            col_tick   = _fc("tick")
            col_x      = _fc("X")
            col_y      = _fc("Y")
            col_z      = _fc("Z")
            col_yaw    = _fc("yaw")
            col_pit    = _fc("pitch")
            col_team   = _fc("team_num")
            col_health = _fc("health")

            if not (col_tick and col_x and col_y and col_z):
                self._async_log(f"  ⚠ Mate POV: missing columns tick/X/Y/Z in {cols}", "warn")
                return cached

            # ── Extract SteamIDs at full int64 precision BEFORE to_numpy() ──
            # to_numpy() on a mixed int/float DataFrame upcasts everything to
            # float64, which only has 53 bits of mantissa — not enough for
            # 17-digit SteamID64 values.  int(float(76561198347183079)) gives
            # 76561198347183072 (off by 7).  By converting the SteamID column
            # to string while still in pandas (which preserves int64), we get
            # exact values that match the DB SteamID64s.
            sid_series = df[sid_col]
            try:
                sids_str = sid_series.astype("Int64").astype(str).to_numpy()
            except (TypeError, ValueError):
                sids_str = sid_series.astype(str).to_numpy()

            # Numeric columns → float64 numpy (fine for positions/angles)
            num_cols = [c for c in [col_tick, col_x, col_y, col_z,
                                    col_yaw, col_pit, col_team, col_health] if c]
            arr = df[num_cols].to_numpy()

            base = 4   # tick, X, Y, Z are always present → indices 0-3
            offset = 0
            yaw_i    = (base + offset) if col_yaw    else None; offset += (1 if col_yaw    else 0)
            pit_i    = (base + offset) if col_pit    else None; offset += (1 if col_pit    else 0)
            team_i   = (base + offset) if col_team   else None; offset += (1 if col_team   else 0)
            health_i = (base + offset) if col_health else None

            def _fv(v):
                if v is None: return 0.0
                try:
                    f = float(v)
                    return 0.0 if math.isnan(f) else f
                except Exception:
                    return 0.0

            for i, row in enumerate(arr):
                raw_t = row[0]
                if raw_t is None or (isinstance(raw_t, float) and math.isnan(raw_t)):
                    continue
                t = int(float(raw_t))

                sid = sids_str[i]
                if not t or not sid or sid in ("0", "<NA>", "nan", "None"):
                    continue

                cached.setdefault(t, {})[sid] = {
                    "X":      _fv(row[1]),
                    "Y":      _fv(row[2]),
                    "Z":      _fv(row[3]),
                    "yaw":    _fv(row[yaw_i])    if yaw_i    is not None else 0.0,
                    "pitch":  _fv(row[pit_i])    if pit_i    is not None else 0.0,
                    "team":   int(_fv(row[team_i]))   if team_i   is not None else 0,
                    "health": int(_fv(row[health_i])) if health_i is not None else -1,
                }
        except Exception as e:
            self._async_log(f"  ⚠ Mate POV: position parse failed: {e}", "warn")

        with self._dp2_cache_lock:
            merged = self._dp2_cache.get(demo_path, {})
            if not isinstance(merged, dict):
                merged = {}
            merged["mate_positions"] = cached
            self._dp2_cache_put_locked(demo_path, merged)

        return cached

    # ── SteamID fuzzy helpers ──────────────────────────────────────────────────

    def _find_sid_in_tick(self, tick_data, db_sid):
        """Return the dp2 SteamID key in tick_data that corresponds to db_sid.

        demoparser2 returns SteamIDs with their lower 3 bits zeroed (CS2 entity
        handle encoding).  The true SteamID64 stored in the CSDM DB differs by at
        most 7.  An exact string match is tried first; if that fails we fall back
        to the closest key within _DP2_SID_TOLERANCE.
        Returns the matching key string, or None.
        """
        if not tick_data:
            return None
        try:
            db_int = int(db_sid)
        except (TypeError, ValueError):
            return None

        # fast path: exact match
        exact = str(db_int)
        if exact in tick_data:
            return exact

        # fuzzy path: scan for closest key within tolerance
        best_key  = None
        best_diff = self._DP2_SID_TOLERANCE + 1
        for k in tick_data:
            try:
                diff = abs(int(k) - db_int)
                if diff < best_diff:
                    best_diff = diff
                    best_key  = k
            except (TypeError, ValueError):
                continue
        return best_key if best_diff <= self._DP2_SID_TOLERANCE else None

    def _fuzzy_sid_in_set(self, dp2_sid, db_sids_set):
        """Return True if dp2_sid is within ±_DP2_SID_TOLERANCE of any SID in db_sids_set.

        db_sids_set contains true SteamID64 strings (from the CSDM DB).
        dp2_sid may have minor numeric drift from float64 precision loss (up to 16 units
        for typical SteamID64 magnitudes).  We compare numerically within tolerance.
        """
        try:
            dp2_int = int(dp2_sid)
        except (TypeError, ValueError):
            return False
        for db_sid in db_sids_set:
            try:
                if abs(dp2_int - int(db_sid)) <= self._DP2_SID_TOLERANCE:
                    return True
            except (TypeError, ValueError):
                continue
        return False

    def _find_best_mate_sid(self, demo_path, victim_sid, kill_tick, sids_active):
        """Return (mate_dp2_sid, victim_dp2_sid) for the best-angle qualifying teammate.

        mate_dp2_sid   — dp2 key of the chosen teammate, or None if none qualifies.
        victim_dp2_sid — dp2 key of the victim (used by camera builder as fallback);
                         None if the victim cannot be resolved in tick_data at all.

        Key fixes vs previous version:
        - SteamID lookup uses _find_sid_in_tick (fuzzy ±8) to resolve DB SIDs → dp2 keys.
        - Active-player exclusion uses _fuzzy_sid_in_set for the same reason.
        - Both camera IDs returned so callers always have the correct dp2 SID to give CSDM.
        """
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        positions = data.get("mate_positions", {})

        # Try kill_tick first, then the tick just before (parse_ticks sometimes lags by 1)
        tick_data = positions.get(kill_tick) or positions.get(kill_tick - 1) or {}
        if not tick_data:
            return None, None

        # Resolve victim's dp2 SID key (handles lower-3-bits-zeroed encoding)
        victim_dp2_sid = self._find_sid_in_tick(tick_data, victim_sid)
        if not victim_dp2_sid:
            self._async_log(
                f"  ⚠ Mate POV: victim {victim_sid} not found in tick {kill_tick} "
                f"(dp2 keys: {list(tick_data.keys())[:8]})", "dim")
            return None, None

        victim_data = tick_data[victim_dp2_sid]
        vx, vy, vz  = victim_data["X"], victim_data["Y"], victim_data["Z"]
        victim_team = victim_data.get("team", 0)
        team_check  = victim_team != 0   # team==0 → team_num unavailable, skip check

        best_sid   = None
        best_score = float("inf")   # lower = better centred on victim

        for sid, pd in tick_data.items():
            if sid == victim_dp2_sid:
                continue                                  # skip victim themselves
            if team_check and pd.get("team", -1) != victim_team:
                continue                                  # must be on victim's team
            if self._fuzzy_sid_in_set(sid, sids_active):
                continue                                  # skip the active (our) player(s)

            # Dead player — health==-1 means column absent (unknown), allow those through
            hp = pd.get("health", -1)
            if hp != -1 and hp <= 0:
                continue

            dx   = vx - pd["X"]
            dy   = vy - pd["Y"]
            dz   = vz - pd["Z"]
            dist = math.sqrt(dx * dx + dy * dy)

            if dist < self._MATE_POV_MIN_DIST:
                continue                                  # clipping / on top of victim
            if dist > self._MATE_POV_MAX_DIST:
                continue                                  # too far — walls likely

            # Different-floor filter: large Z delta means ceiling/floor between them
            if abs(dz) > self._MATE_POV_MAX_Z_DELTA:
                continue

            # Elevation angle filter: steep look-up/down angle = different levels
            dist3d = math.sqrt(dist * dist + dz * dz)
            if dist3d < 1:
                continue
            elevation = math.degrees(math.asin(max(-1.0, min(1.0, dz / dist3d))))
            if abs(elevation) > self._MATE_POV_MAX_ELEVATION:
                continue

            # View direction from yaw / pitch
            yaw_r   = math.radians(pd.get("yaw",   0))
            pitch_r = math.radians(pd.get("pitch", 0))
            lx =  math.cos(pitch_r) * math.cos(yaw_r)
            ly =  math.cos(pitch_r) * math.sin(yaw_r)
            lz = -math.sin(pitch_r)

            # Single eye-point check — at ≤550 u the angular spread across the body
            # is <6°, so multi-point sampling adds no value over one centre check.
            bdx  = vx - pd["X"]
            bdy  = vy - pd["Y"]
            bdz  = (vz + self._MATE_POV_EYE_HEIGHT) - pd["Z"]
            blen = math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz)
            if blen < 1:
                continue
            dot = (lx * bdx + ly * bdy + lz * bdz) / blen
            score = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
            if score > self._MATE_POV_FOV_HALF_DEG:
                continue
            # score = angle to victim eye — lower = more centred
            if score < best_score:
                best_score = score
                best_sid   = sid

        # Sanity check: never return an active player as the mate
        if best_sid and (best_sid in sids_active or self._fuzzy_sid_in_set(best_sid, sids_active)):
            self._async_log(
                f"  ⚠ Mate POV: best_sid {best_sid} matched an active player — rejected.", "dim")
            best_sid = None

        return best_sid, victim_dp2_sid

    def _mate_pov_filter(self, demo_path, events, cfg):
        """Stamp evt['_mate_pov_sid'] on qualifying kills; optionally filter out the rest.

        Must mode (kill_mod_mate_pov_req=True): kills with no qualifying teammate are
        removed (clip skipped entirely if none remain).
        Optional mode: kill is kept and _mate_pov_sid is absent — camera falls back to
        the normal perspective for that kill.
        """
        # Mate POV only applies in victim/both perspective — no-op for killer mode
        if cfg.get("perspective", "killer") not in ("victim", "both"):
            return events
        kill_ticks = [int(e.get("tick", 0)) for e in events if e.get("type") == "kill"]
        if not kill_ticks:
            return events

        self._parse_mate_positions(demo_path, kill_ticks)

        sids_active = set(str(s) for s in self._get_sids(cfg))
        must_mode   = cfg.get("kill_mod_mate_pov_req", False)

        found = 0
        result = []
        for evt in events:
            if evt.get("type") != "kill":
                result.append(evt)
                continue
            victim_sid = str(evt.get("victim_sid", ""))
            kill_tick  = int(evt.get("tick", 0))
            mate_sid, victim_dp2_sid = self._find_best_mate_sid(
                demo_path, victim_sid, kill_tick, sids_active)

            if mate_sid:
                evt["_mate_pov_sid"] = mate_sid
                found += 1
                result.append(evt)
            elif must_mode:
                pass   # no qualifying mate → skip this kill in Must mode
            else:
                result.append(evt)   # keep kill, camera falls back normally

        return result

    def _mate_pov_camera_sid(self, demo_path, event, cfg):
        """camera_fn hook: return the stamped mate SID for this kill event, or None."""
        return event.get("_mate_pov_sid")

    # ── Death-flag filters (dp2 — from player_death event fields) ─────────────
    # A single generic filter reads death_flags[(tick, killer_sid)][flag_name].
    # All four "missing DB column" mods are implemented here.

    _TICK_MATCH_WINDOW = 2   # ticks — death event tick vs kill event tick tolerance

    def _death_flag_filter(self, demo_path, events, cfg,
                           flag_name: str, threshold=True):
        """Generic filter: keep kills whose player_death event has flag_name truthy.

        flag_name  — key in death_flags dict (e.g. 'attackerinair', 'attackerblind',
                     'penetrated', 'noscope', 'thrusmoke')
        threshold  — value to compare against:
                       True  → flag must be truthy (bool flags)
                       int>0 → flag must be >= threshold (penetrated count)

        If death_flags is empty (parse failed / old demo), passes all kills through
        (graceful degradation — same behaviour as other dp2 filters).
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        death_flags = data.get("death_flags", {})

        if not death_flags:
            return self._non_kill_only(events)

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt)
                continue
            entry = self._death_flags_for_kill(death_flags, evt)
            val = entry.get(flag_name) if entry else None
            if val is None:
                continue
            if isinstance(threshold, bool):
                if bool(val) == threshold:
                    filtered.append(evt)
            else:
                if int(val) >= threshold:
                    filtered.append(evt)
        return filtered

    def _death_flags_for_kill(self, death_flags, evt):
        kill_tick = int(evt.get("tick", 0))
        killer_sid = str(evt.get("killer_sid", ""))
        for dt in range(-self._TICK_MATCH_WINDOW, self._TICK_MATCH_WINDOW + 1):
            entry = death_flags.get((kill_tick + dt, killer_sid))
            if entry is not None:
                return entry
        return None

    def _penetrated_kills(self, demo_path, events):
        if not os.path.isfile(demo_path):
            return [], self._non_kill_only(events)
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path, {"death", "fire"})
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        if "fire" not in set(data.get("_sections", set())):
            self._dp2_parse_demo(demo_path, {"fire"})
            with self._dp2_cache_lock:
                data = self._dp2_cache.get(demo_path, {})
        death_flags = data.get("death_flags", {})
        if not death_flags:
            return [], self._non_kill_only(events)
        non_kill = [e for e in events if e.get("type") != "kill"]
        penetrated = []
        for evt in events:
            if evt.get("type") != "kill":
                continue
            entry = self._death_flags_for_kill(death_flags, evt)
            val = entry.get("penetrated") if entry else None
            if val is not None and int(val) >= 1:
                penetrated.append(evt)
        return penetrated, non_kill

    def _wall_bang_dp2_filter(self, demo_path, events, cfg):
        penetrated, non_kill = self._penetrated_kills(demo_path, events)
        if not penetrated:
            return non_kill
        groups = defaultdict(list)
        for evt in penetrated:
            key = (
                int(evt.get("tick", 0)),
                str(evt.get("killer_sid", "")),
                self._weapon_suffix_key(evt.get("weapon", "")),
            )
            groups[key].append(evt)
        collateral_evt_ids = {
            id(evt)
            for g in groups.values() if len(g) >= 2
            for evt in g
        }
        wallbang_kills = [evt for evt in penetrated if id(evt) not in collateral_evt_ids]
        return wallbang_kills + non_kill

    def _airborne_dp2_filter(self, demo_path, events, cfg):
        """Airborne killer via dp2 — attackerinair = True in player_death event."""
        return self._death_flag_filter(demo_path, events, cfg, "attackerinair", True)

    def _attacker_blind_dp2_filter(self, demo_path, events, cfg):
        """Blind fire via dp2 — attackerblind = True in player_death event."""
        return self._death_flag_filter(demo_path, events, cfg, "attackerblind", True)

    def _collateral_dp2_filter(self, demo_path, events, cfg):
        penetrated, non_kill = self._penetrated_kills(demo_path, events)
        if not penetrated:
            return non_kill
        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        fire_ticks = data.get("fire_ticks", {})
        groups = defaultdict(list)
        for evt in penetrated:
            key = (
                int(evt.get("tick", 0)),
                str(evt.get("killer_sid", "")),
                self._weapon_suffix_key(evt.get("weapon", "")),
            )
            groups[key].append(evt)
        collateral_kills = []
        for (tick, killer_sid, wpn_s), g in groups.items():
            if len(g) < 2:
                continue
            shots = fire_ticks.get((killer_sid, wpn_s), [])
            near_shots = sum(1 for t in shots if abs(int(t) - tick) <= self._TICK_MATCH_WINDOW)
            if near_shots != 1:
                continue
            collateral_kills.extend(g)
        return collateral_kills + non_kill


    @staticmethod
    def _weapon_suffix_key(weapon_raw: str) -> str:
        w = str(weapon_raw or "").lower().strip()
        mapped = CSDM_TO_DP2_WEAPON.get(w)
        if mapped:
            return mapped[7:] if mapped.startswith("weapon_") else mapped
        if w.startswith("weapon_"):
            w = w[7:]
        return w.replace(" ", "").replace("-", "").replace("_", "")

    def _tab_tags(self, parent):
        p = self._make_tab_scroll(parent)

        sec = Sec(p, "🏷 TAGS  —  click to select/deselect")
        sec.pack(fill="x")

        self._tags_active = set()   # IDs of currently selected tags

        self._tags_list_frame = tk.Frame(sec, bg=BG2)
        self._tags_list_frame.pack(fill="x", pady=(6, 0))

        btn_top = tk.Frame(sec, bg=BG2)
        btn_top.pack(fill="x", pady=(8, 0))
        tk.Button(btn_top, text="  + New tag  ", font=FONT_SM, bg=ORANGE, fg="white",
                  relief="flat", bd=0, cursor="hand2", activebackground=ORANGE2,
                  command=lambda: self._create_new_tag_dialog(from_combo=False)).pack(
            side="left", ipady=4, ipadx=6)
        tk.Button(btn_top, text="  Reload  ", font=FONT_SM, bg=BG3, fg=MUTED, relief="flat",
                  bd=0, cursor="hand2", command=self._connect_and_load).pack(
            side="left", padx=(8, 0), ipady=4, ipadx=6)
        tk.Button(btn_top, text="Deselect all", font=FONT_DESC, bg=BG3, fg=MUTED,
                  relief="flat", bd=0, cursor="hand2",
                  command=self._tags_deselect_all).pack(side="right")

        self._tag_sel_lbl = tk.Label(sec, text="No tag selected", font=FONT_DESC,
                                     fg=MUTED, bg=BG2, anchor="w")
        self._tag_sel_lbl.pack(fill="x", pady=(6, 0))

        # Auto-tag on export: uses the active selection (multi-tag supported)
        auto_row = tk.Frame(sec, bg=BG2)
        auto_row.pack(fill="x", pady=(4, 0))
        self._tag_auto_var = tk.BooleanVar(
            value=self.v["tag_enabled"].get())
        _auto_cb = hchk(auto_row, "Auto-tag on export", self._tag_auto_var)
        _auto_cb.pack(side="left")
        add_tip(_auto_cb,
                "If checked, each successfully exported demo is automatically "
                "the tags selected above.\n"
                "Supports multiple tags simultaneously.")
        self._tag_auto_lbl = tk.Label(auto_row, text="(no tag selected)",
                                      font=FONT_DESC, fg=MUTED, bg=BG2)
        self._tag_auto_lbl.pack(side="left", padx=(8, 0))

        def _on_tag_auto_toggle(*_):
            self.v["tag_enabled"].set(self._tag_auto_var.get())
            # tag_on_export = first active tag (batch compat) ; others are in _tags_active
            active_names = self._get_active_tag_names()
            self.v["tag_on_export"].set(active_names[0] if active_names else "")
        self._tag_auto_var.trace_add("write", _on_tag_auto_toggle)

        # ── TAG DATE RANGE ──────────────────────────────
        sec_plage = Sec(p, "📅 TAG RANGE")
        sec_plage.pack(fill="x")
        desc_label(sec_plage,
                   "Calculates the first and last demo with the selected tags, "
                   "and suggests applying these dates as a filter in Capture.").pack(fill="x")

        plage_btn_row = tk.Frame(sec_plage, bg=BG2)
        plage_btn_row.pack(fill="x", pady=(6, 0))
        tk.Button(plage_btn_row, text="📅 Calculate range",
                  font=FONT_SM, bg=BLUE, fg="#000000", relief="flat", bd=0,
                  cursor="hand2", activebackground="#7db8f0",
                  command=self._tag_calc_range).pack(side="left", ipady=4, ipadx=8)

        # Range result — displayed dynamically
        plage_result = tk.Frame(sec_plage, bg=BG2)
        plage_result.pack(fill="x", pady=(6, 0))

        self._plage_lbl = tk.Label(plage_result, text="", font=FONT_SM, fg=MUTED, bg=BG2, anchor="w")
        self._plage_lbl.pack(fill="x")

        plage_actions = WrapRow(sec_plage, bg=BG2)
        plage_actions.pack(fill="x", pady=(4, 0))

        self._plage_btn_start = tk.Button(plage_actions, text="→ Apply start",
                  font=FONT_DESC, bg=BG3, fg=TEXT, relief="flat", bd=0,
                  cursor="hand2", activebackground=BORDER, activeforeground=ORANGE,
                  state="disabled", command=self._tag_apply_range_start)
        plage_actions.add(self._plage_btn_start)
        add_tip(self._plage_btn_start, "Sets date_from to the date of the first tagged demo.")

        self._plage_btn_end = tk.Button(plage_actions, text="→ Apply end",
                  font=FONT_DESC, bg=BG3, fg=TEXT, relief="flat", bd=0,
                  cursor="hand2", activebackground=BORDER, activeforeground=ORANGE,
                  state="disabled", command=self._tag_apply_range_end)
        plage_actions.add(self._plage_btn_end)
        add_tip(self._plage_btn_end, "Sets date_to to the date of the last tagged demo.")

        self._plage_btn_full = tk.Button(plage_actions, text="→ Apply full range",
                  font=FONT_DESC, bg=BG3, fg=GREEN, relief="flat", bd=0,
                  cursor="hand2", activebackground=BORDER, activeforeground=GREEN,
                  state="disabled", command=self._tag_apply_range_full)
        plage_actions.add(self._plage_btn_full)
        add_tip(self._plage_btn_full, "Sets date_from and date_to to cover exactly the range of tagged demos.")

        self._plage_btn_after = tk.Button(plage_actions, text="→ After range",
                  font=FONT_DESC, bg=BG3, fg=BLUE, relief="flat", bd=0,
                  cursor="hand2", activebackground=BORDER, activeforeground=BLUE,
                  state="disabled", command=self._tag_apply_range_after)
        plage_actions.add(self._plage_btn_after)
        add_tip(self._plage_btn_after,
                "Sets date_from to the day after the last tagged demo and clears date_to.\n"
                "Use: run preview after to see remaining demos to tag.")

        # Store computed dates
        self._plage_date_start = ""   # DD-MM-YYYY
        self._plage_date_end   = ""   # DD-MM-YYYY

        # ── OPERATIONS ──────────────────────────────────
        sec2 = Sec(p, "OPERATIONS")
        sec2.pack(fill="x")

        row1 = tk.Frame(sec2, bg=BG2)
        row1.pack(fill="x", pady=(4, 0))
        mlabel(row1, "Search:").pack(side="left")
        tk.Button(row1, text="🔍 By tag",
                  font=FONT_SM, bg=ORANGE, fg="white", relief="flat", bd=0,
                  cursor="hand2", activebackground=ORANGE2,
                  command=self._tag_search_by_tag).pack(side="left", padx=(8, 0), ipady=4, ipadx=8)
        add_tip(row1.winfo_children()[-1], "All demos with the selected tags in DB, without config filter.")
        tk.Button(row1, text="🔍 By config",
                  font=FONT_SM, bg=BLUE, fg="#000000", relief="flat", bd=0,
                  cursor="hand2", activebackground="#7db8f0",
                  command=self._tag_search_demos).pack(side="left", padx=(6, 0), ipady=4, ipadx=8)
        add_tip(row1.winfo_children()[-1],
                "Demos matching the config (player+events+weapons+dates) AND already tagged.\n"
                "Useful to verify what is tagged in the current period.")

        row2 = tk.Frame(sec2, bg=BG2)
        row2.pack(fill="x", pady=(6, 0))
        mlabel(row2, "Actions :").pack(side="left")
        tk.Button(row2, text="🏷 Tag sel.", font=FONT_SM, bg=GREEN,
                  fg="#000000", relief="flat", bd=0, cursor="hand2", activebackground="#6ee7b7",
                  command=self._tag_apply_selected).pack(side="left", padx=(8, 0), ipady=4, ipadx=6)
        tk.Button(row2, text="Tag ALL", font=FONT_SM, bg=ORANGE2, fg="white",
                  relief="flat", bd=0, cursor="hand2", activebackground=ORANGE,
                  command=self._tag_apply_all).pack(side="left", padx=(6, 0), ipady=4, ipadx=6)
        tk.Button(row2, text="✕ Remove sel.", font=FONT_SM, bg=RED, fg="white",
                  relief="flat", bd=0, cursor="hand2", activebackground="#fca5a5",
                  command=self._tag_remove_selected).pack(side="left", padx=(6, 0), ipady=4, ipadx=6)

        row3 = tk.Frame(sec2, bg=BG2)
        row3.pack(fill="x", pady=(6, 0))
        mlabel(row3, "Transfer:").pack(side="left")
        _exp_btn = tk.Button(row3, text="📤 Export", font=FONT_SM, bg=BG3, fg=TEXT,
                             relief="flat", bd=0, cursor="hand2", activebackground=BORDER,
                             command=self._tags_export)
        _exp_btn.pack(side="left", padx=(8, 0), ipady=4, ipadx=8)
        add_tip(_exp_btn,
                "Export tag assignments to a JSON file.\n"
                "If tags are selected, only those tags are exported. "
                "Otherwise all tag assignments are exported.\n"
                "The file can be imported into any other CSDM database that contains the same demos.")
        _imp_btn = tk.Button(row3, text="📥 Import", font=FONT_SM, bg=BG3, fg=TEXT,
                             relief="flat", bd=0, cursor="hand2", activebackground=BORDER,
                             command=self._tags_import)
        _imp_btn.pack(side="left", padx=(6, 0), ipady=4, ipadx=8)
        add_tip(_imp_btn,
                "Import tag assignments from a JSON export file.\n"
                "Demos are matched by checksum — only demos present in this DB are tagged.\n"
                "Missing tags can be created automatically with their original name and colour.")

        # List of found demos
        lf = tk.Frame(sec2, bg=BG2)
        lf.pack(fill="x", pady=(6, 0))
        lf.rowconfigure(0, weight=1)
        lf.columnconfigure(0, weight=1)
        self._tag_demo_lb = tk.Listbox(lf, font=FONT_SM, bg=BG3, fg=TEXT,
                                        selectbackground=ORANGE, selectforeground="white",
                                        activestyle="none", relief="flat", bd=0,
                                        highlightthickness=1, highlightbackground=BORDER,
                                        height=7, exportselection=False, selectmode="extended")
        self._tag_demo_lb.grid(row=0, column=0, sticky="nsew")
        dsb = ttk.Scrollbar(lf, orient="vertical", command=self._tag_demo_lb.yview)
        dsb.grid(row=0, column=1, sticky="ns")
        self._tag_demo_lb.configure(yscrollcommand=dsb.set)
        self._tag_found_demos = []

        self._tag_search_status = tk.Label(sec2, text="", font=FONT_DESC, fg=MUTED, bg=BG2,
                                           anchor="w", wraplength=400)
        self._tag_search_status.pack(fill="x", pady=(4, 0))

    def _tags_deselect_all(self):
        self._tags_active.clear()
        self._refresh_tags_list_display()

    def _tag_toggle(self, tag_id):
        if tag_id in self._tags_active:
            self._tags_active.discard(tag_id)
        else:
            self._tags_active.add(tag_id)
        self._refresh_tags_list_display()

    def _tag_search_by_tag(self):
        active_ids = list(self._tags_active)
        if not active_ids:
            self._async_log("Tags: select at least one tag.", "err")
            return
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        dc = self._find_col("matches", ["demo_path", "demo_file_path", "demo_filepath",
                                         "share_code", "file_path", "path"])
        if not jt or not dc or not mkm:
            self._async_log("Tags: insufficient DB schema.", "err")
            return

        self._tag_demo_lb.delete(0, "end")
        self._tag_found_demos = []

        def task():
            try:
                conn = self._pg_fresh()
                with conn.cursor() as cur:
                    ph = ",".join(["%s"] * len(active_ids))
                    cur.execute(
                        f'SELECT DISTINCT m."{dc}", m."{mkm}" '
                        f'FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" '
                        f'WHERE ct."{jt_tag}" IN ({ph}) ORDER BY m."{dc}"',
                        active_ids)
                    rows = cur.fetchall()
                conn.close()
            except Exception as e:
                self.after(0, lambda err=e: (self._async_log(f"Tags error: {err}", "err"),
                                         self._tag_search_status.config(text="Error", fg=RED)))
                return

            found = [(str(r[0]), 0, 0) for r in rows]
            # Peupler le cache checksums
            for r in rows:
                dp, chk = str(r[0]), r[1]
                if chk and dp not in self._demo_checksums:
                    self._demo_checksums[dp] = chk

            def show():
                self._tag_found_demos = found
                self._tag_demo_lb.delete(0, "end")
                if not found:
                    self._async_log("Tags: no demo found.", "warn")
                    self._tag_search_status.config(text="No demos.", fg=YELLOW)
                    return
                for dp, _, _ in found:
                    self._tag_demo_lb.insert("end", Path(dp).name)
                tag_names = ", ".join(self._get_active_tag_names())
                self._async_log(f"[TAGS/tag] {len(found)} demo(s) — {tag_names}", "ok")
                self._tag_search_status.config(text=f"✓ {len(found)} demo(s)", fg=GREEN)
            self.after(0, show)

        threading.Thread(target=task, daemon=True).start()

    def _refresh_tags_list_display(self):
        for w in self._tags_list_frame.winfo_children():
            w.destroy()
        if not self._tags_list:
            tk.Label(self._tags_list_frame, text="No tags.", font=FONT_SM, fg=MUTED,
                     bg=BG2).pack(anchor="w")
        else:
            for tid, tname, tcolor in self._tags_list:
                active = tid in self._tags_active
                bg_c = tcolor if tcolor and re.match(r'^#[0-9a-fA-F]{6}$', tcolor) else "#555555"
                row = tk.Frame(self._tags_list_frame,
                               bg=bg_c if active else BG2,
                               highlightthickness=1,
                               highlightbackground=bg_c if active else BORDER)
                row.pack(fill="x", pady=2, ipadx=2, ipady=1)

                prefix = "✓  " if active else "○  "
                fg_c = _contrast_fg(bg_c) if active else TEXT

                # Colored square — filled when active, border-only when inactive
                swatch_frame = tk.Frame(row,
                                        bg=bg_c if active else BG2,
                                        width=14, height=14,
                                        highlightthickness=2,
                                        highlightbackground=bg_c)
                swatch_frame.pack(side="left", padx=(6, 2), pady=4)
                swatch_frame.pack_propagate(False)
                tk.Label(swatch_frame, bg=bg_c if active else BG2).pack(fill="both", expand=True)

                tk.Button(
                    row,
                    text=f"{prefix}{tname}",
                    font=FONT_SM_B if active else FONT_SM,
                    bg=bg_c if active else BG3,
                    fg=fg_c if active else TEXT,
                    relief="flat", cursor="hand2", bd=0, anchor="w",
                    activebackground=bg_c, activeforeground=_contrast_fg(bg_c),
                    command=lambda i=tid: self._tag_toggle(i)
                ).pack(side="left", fill="x", expand=True, ipady=4, ipadx=8)
                tk.Label(row, text=f"id:{tid}", font=FONT_DESC, fg=MUTED if not active else fg_c,
                         bg=bg_c if active else BG2).pack(side="left", padx=(4, 0))
                tk.Button(
                    row, text="✕", font=FONT_DESC,
                    bg=bg_c if active else BG3, fg=RED if not active else fg_c,
                    relief="flat", bd=0, cursor="hand2",
                    command=lambda i=tid, n=tname: self._delete_tag_ui(i, n)
                ).pack(side="right", padx=(4, 2))

        # Update the selection label and auto-tag
        active_names = self._get_active_tag_names()
        if hasattr(self, '_tag_sel_lbl'):
            if active_names:
                self._tag_sel_lbl.config(
                    text=f"Selected: {', '.join(active_names)}",
                    fg=ORANGE)
            else:
                self._tag_sel_lbl.config(text="No tag selected", fg=MUTED)
        # Sync auto tag : tag_on_export = first active tag, tag_enabled = checkbox
        if hasattr(self, '_tag_auto_lbl'):
            if active_names:
                self._tag_auto_lbl.config(
                    text=f"→ {', '.join(active_names)}", fg=ORANGE)
                # Update tag_on_export with the first active tag
                self.v["tag_on_export"].set(active_names[0])
            else:
                self._tag_auto_lbl.config(text="(no tag selected)", fg=MUTED)
                self.v["tag_on_export"].set("")

    def _tag_search_demos(self):
        """Find demos matching config (player+events+weapons+dates).
        If tags are selected, intersects with already-tagged demos.
        Uses the last preview cache to avoid re-querying when available."""
        active_ids   = list(self._tags_active)
        active_names = self._get_active_tag_names()
        if not self.player_search.get_steam_ids():
            self._async_log("[TAGS/config] Select at least one player account in Capture.", "err")
            return
        if not any(v.get() for v in self.sel_events.values()):
            self._async_log("[TAGS/config] Select at least one event.", "err")
            return

        ts      = self._tags_schema
        jt      = ts.get("junction_table")
        jt_tag  = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        if active_ids and (not jt or not jt_tag or not jt_match):
            self._async_log("[TAGS/config] Insufficient DB schema for tag filter.", "err")
            return

        self._tag_demo_lb.delete(0, "end")
        self._tag_found_demos = []
        self._demo_checksums  = {}
        cfg = self._build_run_cfg()

        # Reuse last preview cache if available — avoids a redundant re-query
        cached_evts = (self._last_preview_data or {}).get("evts")

        def task():
            # 1. Fetch tagged checksums (only when a tag filter is active)
            tagged_checksums = None
            if active_ids:
                try:
                    conn = self._pg_fresh()
                    with conn.cursor() as cur:
                        ph = ",".join(["%s"] * len(active_ids))
                        cur.execute(
                            f'SELECT DISTINCT "{jt_match}" FROM "{jt}"'
                            f' WHERE "{jt_tag}" IN ({ph})',
                            active_ids)
                        tagged_checksums = {r[0] for r in cur.fetchall()}
                    conn.close()
                except Exception as e:
                    self.after(0, lambda err=e: (
                        self._async_log(f"[TAGS/config] DB error: {err}", "err"),
                        self._tag_search_status.config(text="Error", fg=RED)))
                    return

            # 2. Config query — use preview cache when available
            evts = cached_evts
            if evts is None:
                try:
                    evts = self._query_events(cfg)
                except Exception as e:
                    self.after(0, lambda err=e: (
                        self._async_log(f"[TAGS/config] Config error: {err}", "err"),
                        self._tag_search_status.config(text="Error", fg=RED)))
                    return

            # 3. Build result — optionally filtered by tagged checksums
            found = []
            for dp in sorted(evts.keys(), key=self._demo_sort_key):
                if tagged_checksums is not None:
                    chk = self._demo_checksums.get(dp) or self._get_demo_checksum(dp)
                    if not chk or chk not in tagged_checksums:
                        continue
                ne   = len(evts[dp])
                seqs = self._build_sequences(evts[dp], cfg["tickrate"],
                                             cfg["before"], cfg["after"])
                found.append((dp, ne, len(seqs)))

            def show():
                self._tag_found_demos = found
                self._tag_demo_lb.delete(0, "end")
                _tag_str   = f" — tags: {', '.join(active_names)}" if active_names else ""
                _date_str  = f"{cfg.get('date_from','∞')} → {cfg.get('date_to','∞')}"
                _cache_str = " (cached)" if cached_evts is not None else ""
                if not found:
                    self._async_log(
                        f"[TAGS/config] No demo{_tag_str} — {_date_str}", "warn")
                    self._tag_search_status.config(text="No demos.", fg=YELLOW)
                    return
                total_evt = sum(ne for _, ne, _ in found)
                for dp, ne, ns in found:
                    self._tag_demo_lb.insert("end",
                        f"{Path(dp).name}  ({ne} events → {ns} seq)")
                self._async_log(
                    f"[TAGS/config] {len(found)} demo(s){_tag_str},"
                    f" {total_evt} events{_cache_str} — {_date_str}", "ok")
                self._tag_search_status.config(text=f"✓ {len(found)} demo(s)", fg=GREEN)
            self.after(0, show)

        threading.Thread(target=task, daemon=True).start()

    def _tag_calc_range(self):
        """Compute the date range of demos with selected tags (no config filter).
        Shows the range and enables the apply buttons."""
        active_ids = list(self._tags_active)
        active_names = self._get_active_tag_names()
        if not active_ids:
            self._async_log("[TAGS/range] Select at least one tag.", "err")
            return
        ts = self._tags_schema
        jt      = ts.get("junction_table")
        jt_tag  = ts.get("jt_tag_col")
        jt_match= ts.get("jt_match_col")
        mkm     = self._find_col("matches", ["checksum", "id", "match_id"])
        dc      = self._find_col("matches", ["demo_path", "demo_file_path", "demo_filepath",
                                              "share_code", "file_path", "path"])
        date_col = self._date_col
        if not jt or not jt_tag or not jt_match or not mkm or not dc:
            self._async_log("[TAGS/range] Insufficient DB schema.", "err")
            return

        self._plage_lbl.config(text="Computing…", fg=YELLOW)
        for btn in (self._plage_btn_start, self._plage_btn_end,
                    self._plage_btn_full, self._plage_btn_after):
            btn.config(state="disabled")

        def task():
            try:
                conn = self._pg_fresh()
                with conn.cursor() as cur:
                    ph = ",".join(["%s"] * len(active_ids))
                    date_sel = f', m."{date_col}"' if date_col else ""
                    cur.execute(
                        f'SELECT DISTINCT m."{dc}", m."{mkm}"{date_sel} '
                        f'FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" '
                        f'WHERE ct."{jt_tag}" IN ({ph})',
                        active_ids)
                    rows = cur.fetchall()
                conn.close()
            except Exception as e:
                self.after(0, lambda err=e: (
                    self._async_log(f"[TAGS/range] Error: {err}", "err"),
                    self._plage_lbl.config(text="DB error.", fg=RED)))
                return

            demos = [str(r[0]) for r in rows]
            for r in rows:
                dp_r, chk = str(r[0]), r[1]
                if chk and dp_r not in self._demo_checksums:
                    self._demo_checksums[dp_r] = chk
                # Populate _demo_dates so _demo_sort_key works when files are off-disk
                if date_col and len(r) > 2 and r[2] is not None:
                    self._demo_dates.setdefault(dp_r, r[2])

            if not demos:
                self.after(0, lambda: (
                    self._async_log("[TAGS/range] No demos with these tags.", "warn"),
                    self._plage_lbl.config(text="No tagged demos.", fg=YELLOW)))
                return

            sorted_demos = sorted(demos, key=self._demo_sort_key)
            first_demo = sorted_demos[0]
            last_demo  = sorted_demos[-1]

            def _demo_to_date_str(dp):
                ts = self._get_demo_ts(dp)
                if ts is None:
                    sk = self._demo_sort_key(dp)
                    ts = sk[1] if sk[0] == 0 else None
                if ts is None:
                    return None
                try:
                    return datetime.fromtimestamp(ts).strftime("%d-%m-%Y")
                except Exception:
                    return None

            date_start = _demo_to_date_str(first_demo)
            date_end   = _demo_to_date_str(last_demo)

            def _to_next_day(dstr):
                try:
                    return (datetime.strptime(dstr, "%d-%m-%Y") + timedelta(days=1)).strftime("%d-%m-%Y")
                except Exception:
                    return dstr

            date_after = _to_next_day(date_end) if date_end else None

            def show():
                _names_str = ", ".join(active_names)
                self._plage_date_start = date_start or ""
                self._plage_date_end   = date_end   or ""
                if date_start and date_end:
                    self._plage_lbl.config(
                        text=f"{len(demos)} demo(s) — \"{_names_str}\"  |  "
                             f"Start: {date_start}   End: {date_end}   After: {date_after}",
                        fg=GREEN)
                    for btn in (self._plage_btn_start, self._plage_btn_end,
                                self._plage_btn_full, self._plage_btn_after):
                        btn.config(state="normal")
                    self._async_log(
                        f"[TAGS/range] {len(demos)} demo(s) \"{_names_str}\" — "
                        f"start: {date_start}  end: {date_end}  after: {date_after}",
                        "ok")
                else:
                    self._plage_lbl.config(
                        text=f"{len(demos)} demo(s) — dates unavailable (.dem files missing?)",
                        fg=YELLOW)
                    self._async_log(f"[TAGS/range] {len(demos)} demo(s) — dates undetermined.", "warn")
            self.after(0, show)

        threading.Thread(target=task, daemon=True).start()

    def _tag_apply_range_start(self):
        if self._plage_date_start:
            self.v["date_from"].set(self._plage_date_start)
            self._async_log(f"[TAGS/range] date_from → {self._plage_date_start}", "ok")

    def _tag_apply_range_end(self):
        if self._plage_date_end:
            self.v["date_to"].set(self._plage_date_end)
            self._async_log(f"[TAGS/range] date_to → {self._plage_date_end}", "ok")

    def _tag_apply_range_full(self):
        if self._plage_date_start and self._plage_date_end:
            self.v["date_from"].set(self._plage_date_start)
            self.v["date_to"].set(self._plage_date_end)
            self._async_log(f"[TAGS/range] Full range: {self._plage_date_start} → {self._plage_date_end}", "ok")

    def _tag_apply_range_after(self):
        if self._plage_date_end:
            try:
                after = (datetime.strptime(self._plage_date_end, "%d-%m-%Y") + timedelta(days=1)).strftime("%d-%m-%Y")
            except Exception:
                after = self._plage_date_end
            self.v["date_from"].set(after)
            self.v["date_to"].set("")
            self._async_log(f"[TAGS/range] After range: date_from → {after}, date_to cleared", "ok")

    def _tag_apply_selected(self):
        names = self._get_active_tag_names()
        if not names:
            self._async_log("Tags: select at least one tag.", "err")
            return
        sel = self._tag_demo_lb.curselection()
        if not sel:
            self._async_log("Tags: select demos from the list.", "err")
            return
        demos = [self._tag_found_demos[i][0] for i in sel if i < len(self._tag_found_demos)]
        for name in names:
            self._do_tag_demos(demos, name)

    def _tag_apply_all(self):
        names = self._get_active_tag_names()
        if not names:
            self._async_log("Tags: select at least one tag.", "err")
            return
        if not self._tag_found_demos:
            self._async_log("Tags: run a search first.", "err")
            return
        demos = [dp for dp, _, _ in self._tag_found_demos]
        for name in names:
            self._do_tag_demos(demos, name)

    def _tag_remove_selected(self):
        names = self._get_active_tag_names()
        if not names:
            self._async_log("Tags: select at least one tag.", "err")
            return
        sel = self._tag_demo_lb.curselection()
        if not sel:
            self._async_log("Tags: select demos.", "err")
            return
        demos = [self._tag_found_demos[i][0] for i in sel if i < len(self._tag_found_demos)]
        if not demos:
            return


        def task():
            ok_count, err_first = 0, ""
            for dp in demos:
                for name in names:
                    success, err = self._untag_demo(dp, name)
                    if success:
                        ok_count += 1
                    elif not err_first:
                        err_first = err

            def finish():
                total = len(demos) * len(names)
                if ok_count == total:
                    self._async_log(f"Tags ✓ tag(s) removed from {len(demos)} demo(s).", "ok")
                    self._tag_search_status.config(text=f"✓ removed from {len(demos)}", fg=GREEN)
                elif ok_count > 0:
                    self._async_log(f"Tags ⚠ {ok_count}/{total} OK — {err_first}", "warn")
                    self._tag_search_status.config(text=f"⚠ {ok_count}/{total}", fg=YELLOW)
                else:
                    self._async_log(f"Tags ✗ failed: {err_first}", "err")
                    self._tag_search_status.config(text="✗ failed", fg=RED)
            self.after(0, finish)

        threading.Thread(target=task, daemon=True).start()

    # ── Tag import / export ────────────────────────────────────────────────

    def _tags_export(self):
        """Export tag assignments to a JSON file (all, or active-tag-filtered)."""
        ts = self._tags_schema
        if not ts.get("junction_table"):
            messagebox.showerror("Export tags", "Tags schema not detected — connect to DB first.")
            return
        path = filedialog.asksaveasfilename(
            parent=self, defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            title="Export tags")
        if not path:
            return
        threading.Thread(target=self._tags_export_worker, args=(path,), daemon=True).start()

    def _tags_export_worker(self, path):
        ts        = self._tags_schema
        jt        = ts["junction_table"]
        jt_tag    = ts["jt_tag_col"]
        jt_match  = ts["jt_match_col"]
        id_col    = ts["id_col"]
        name_col  = ts["name_col"]
        color_col = ts.get("color_col", "")
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        dc  = self._find_col("matches", [
            "demo_path", "demo_file_path", "demo_filepath", "file_path", "path"])

        # If tags are selected, limit export to those tag IDs
        active_ids = list(self._tags_active) if self._tags_active else None

        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                # Fetch tag definitions
                cols_sel = f'"{id_col}","{name_col}"' + (f',"{color_col}"' if color_col else "")
                cur.execute(f'SELECT {cols_sel} FROM tags ORDER BY "{name_col}"')
                tag_rows = cur.fetchall()
                if active_ids:
                    tag_rows = [r for r in tag_rows if r[0] in set(active_ids)]
                tag_map = {
                    r[0]: {"name": r[1], "color": (r[2] if len(r) > 2 and color_col else "") or ""}
                    for r in tag_rows
                }
                exported_ids = set(tag_map)

                # Fetch assignments
                ph_sql    = (f' WHERE jt."{jt_tag}" IN ({",".join(["%s"]*len(active_ids))})'
                             if active_ids else "")
                ph_params = tuple(active_ids) if active_ids else ()
                if dc and mkm:
                    cur.execute(
                        f'SELECT jt."{jt_match}", jt."{jt_tag}", m."{dc}"'
                        f' FROM "{jt}" AS jt'
                        f' LEFT JOIN matches AS m ON m."{mkm}"=jt."{jt_match}"'
                        f'{ph_sql}', ph_params)
                else:
                    cur.execute(
                        f'SELECT jt."{jt_match}", jt."{jt_tag}"'
                        f' FROM "{jt}" AS jt{ph_sql}', ph_params)
                rows = cur.fetchall()
            conn.close()
        except Exception as e:
            self.after(0, lambda err=e: messagebox.showerror("Export tags", f"Query error:\n{err}"))
            return

        by_chk = {}
        for row in rows:
            chk      = str(row[0])
            tag_id   = row[1]
            demo_nm  = os.path.basename(str(row[2])) if len(row) > 2 and row[2] else ""
            if tag_id not in exported_ids:
                continue
            if chk not in by_chk:
                by_chk[chk] = {"checksum": chk, "demo_name": demo_nm, "tags": []}
            tag_name = tag_map[tag_id]["name"]
            if tag_name not in by_chk[chk]["tags"]:
                by_chk[chk]["tags"].append(tag_name)

        out = {
            "version": 1,
            "exported_at": datetime.now().isoformat(timespec="seconds"),
            "tags": list(tag_map.values()),
            "assignments": list(by_chk.values()),
        }
        try:
            Path(path).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            self.after(0, lambda: self._async_log(
                f"  ✓ Tags exported: {len(tag_map)} tag(s), {len(by_chk)} demo(s) → {path}", "ok"))
        except Exception as e:
            self.after(0, lambda err=e: messagebox.showerror("Export tags", f"Write error:\n{err}"))

    def _tags_import(self):
        """Import tag assignments from a JSON export file."""
        ts = self._tags_schema
        if not ts.get("junction_table"):
            messagebox.showerror("Import tags", "Tags schema not detected — connect to DB first.")
            return
        path = filedialog.askopenfilename(
            parent=self,
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            title="Import tags")
        if not path:
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as e:
            messagebox.showerror("Import tags", f"Could not read file:\n{e}")
            return
        if not isinstance(data, dict) or "assignments" not in data:
            messagebox.showerror("Import tags", "Invalid tags export file.")
            return
        threading.Thread(target=self._tags_import_worker, args=(data,), daemon=True).start()

    def _tags_import_worker(self, data):
        # Collect all tag names referenced in assignments
        all_names    = {t for a in data.get("assignments", []) for t in a.get("tags", [])}
        exported_defs = {t["name"]: t for t in data.get("tags", []) if t.get("name")}
        existing_names = {tn for _, tn, _ in self._tags_list}
        missing = [n for n in all_names if n not in existing_names]

        if missing:
            done_ev   = threading.Event()
            result_box = [None]

            def show_dialog():
                dlg = TagImportMissingDialog(self, missing, exported_defs)
                result_box[0] = dlg.result
                done_ev.set()

            self.after(0, show_dialog)
            done_ev.wait()
            to_create = result_box[0]
            if to_create is None:   # user cancelled
                return
            for name in to_create:
                color = (exported_defs.get(name) or {}).get("color") or "#f97316"
                self._create_tag_programmatic(name, color)

        # Refresh display (newly created tags)
        self.after(0, self._refresh_tags_list_display)

        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        if not mkm:
            self.after(0, lambda: messagebox.showerror(
                "Import tags", "Cannot find checksum column in matches table."))
            return

        ok_n = skip_n = fail_n = 0
        for asgn in data.get("assignments", []):
            chk = str(asgn.get("checksum", "")).strip()
            if not chk or not self._checksum_in_db(chk, mkm):
                skip_n += 1
                continue
            for tag_name in asgn.get("tags", []):
                tag_id = next((tid for tid, tn, _ in self._tags_list if tn == tag_name), None)
                if tag_id is None:
                    fail_n += 1
                    continue
                ok, _ = self._tag_by_checksum(chk, tag_id)
                if ok:
                    ok_n += 1
                else:
                    fail_n += 1

        def finish():
            parts = [f"{ok_n} link(s) applied"]
            if skip_n:
                parts.append(f"{skip_n} demo(s) not in DB")
            if fail_n:
                parts.append(f"{fail_n} failed")
            tag = "ok" if not fail_n else "warn"
            sym = "✓" if not fail_n else "⚠"
            self._async_log(f"  {sym} Import: {', '.join(parts)}", tag)
            self._tag_search_status.config(
                text=f"✓ {ok_n} imported" if not fail_n else f"⚠ {ok_n} ok / {fail_n} failed",
                fg=GREEN if not fail_n else YELLOW)
        self.after(0, finish)

    def _create_tag_programmatic(self, name, color):
        """Create a tag in DB without interactive dialogs. Returns (ok, tag_id_or_err)."""
        ts = self._tags_schema
        if not ts.get("name_col"):
            return False, "Schema not detected"
        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                new_id = _generate_id_for_type(ts.get("id_col_type", "bigint"))
                cols   = f'"{ts["id_col"]}","{ts["name_col"]}"'
                vals   = [new_id, name]
                if ts.get("color_col"):
                    cols += f',"{ts["color_col"]}"'
                    vals.append(color or "#f97316")
                cur.execute(
                    f'INSERT INTO tags ({cols}) VALUES ({",".join(["%s"]*len(vals))})', vals)
                conn.commit()
            conn.close()
            self._tags_list.append((new_id, name, color or ""))
            return True, new_id
        except Exception as e:
            return False, str(e)

    def _tag_by_checksum(self, checksum, tag_id):
        """Apply a tag using a checksum directly (no demo_path → checksum lookup)."""
        ts = self._tags_schema
        jt       = ts.get("junction_table")
        jt_tag   = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        if not jt or not jt_tag or not jt_match:
            return False, "Junction table not found"
        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                cur.execute(
                    f'SELECT 1 FROM "{jt}" WHERE "{jt_match}"=%s AND "{jt_tag}"=%s LIMIT 1',
                    (checksum, tag_id))
                if not cur.fetchone():
                    cur.execute(
                        f'INSERT INTO "{jt}" ("{jt_match}","{jt_tag}") VALUES (%s,%s)',
                        (checksum, tag_id))
                conn.commit()
            conn.close()
            return True, ""
        except Exception as e:
            return False, str(e)

    def _checksum_in_db(self, checksum, mkm_col):
        """Return True if the given checksum exists in the matches table."""
        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                cur.execute(
                    f'SELECT 1 FROM matches WHERE "{mkm_col}"=%s LIMIT 1', (checksum,))
                exists = cur.fetchone() is not None
            conn.close()
            return exists
        except Exception:
            return False

    def _delete_tag_ui(self, tag_id, tag_name):
        if not messagebox.askyesno("Delete tag", f"Delete '{tag_name}' and all its links?"):
            return
        ok, err = self._delete_tag_from_db(tag_id, tag_name)
        if ok:
    
            self._refresh_tags_list_display()
            self._log(f"Tag '{tag_name}' supprime.", "ok")
        else:
            messagebox.showerror("Tags", f"Error: {err}")

    # ── TAB TOOLS ──
    # ── Theme application ──────────────────────────────────────────────────

    def _apply_dark_titlebar(self):
        """Barre de titre sombre sous Windows (best-effort). Suit le theme
        clair/sombre. Silencieux si l'API DWM est absente (autres OS / vieux
        Windows). Les attributs 20/19 sont des constantes de protocole DWM.
        """
        try:
            import ctypes
            self.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.winfo_id())
            dark = ctypes.c_int(0 if _THEME.get("_is_light") else 1)
            DWMWA_DARK_MODE, DWMWA_DARK_MODE_OLD = 20, 19
            for attr in (DWMWA_DARK_MODE, DWMWA_DARK_MODE_OLD):
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attr, ctypes.byref(dark), ctypes.sizeof(dark))
        except Exception:
            pass  # non-Windows / API absente -> barre standard

    def _change_theme(self, bg_name: str | None = None, accent: str | None = None):
        """Change theme at runtime. Pass None to keep the current value.

        Saves to config, updates globals, and re-paints every widget.
        """
        old = _THEME.copy()
        current_bg     = self.v["theme_bg"].get()
        current_accent = self.v["theme_accent"].get()
        new_bg     = bg_name if bg_name is not None else current_bg
        new_accent = accent  if accent  is not None else current_accent
        self.v["theme_bg"].set(new_bg)
        self.v["theme_accent"].set(new_accent)
        _apply_theme_globals(new_bg, new_accent)
        new = _THEME.copy()

        # Build the set of accent-button widget ids to exclude from the generic walker.
        # Each accent button has a fixed fg (its own colour) that must never be remapped.
        try:
            _ac_exclude = frozenset(id(btn) for btn, _ in self._ac_btn_refs)
        except Exception:
            _ac_exclude = frozenset()

        self._apply_theme_to_widgets(self, old, new, exclude_ids=_ac_exclude)
        self._reapply_ttk_styles()

        # Accent preset buttons: update only bg/activebackground, preserve fg
        try:
            for btn, fixed_fg in self._ac_btn_refs:
                btn.configure(bg=new["BG3"], activebackground=new["BORDER"])
        except Exception:
            pass

        # Retrigger hchk/hradio closures so they pick up the new _t() colours
        self._retrigger_toggle_vars()

        self._apply_dark_titlebar()   # suit le nouveau fond clair/sombre
        self._auto_save()

    def _reapply_ttk_styles(self):
        """Reapply ttk styles with current theme colours (source unique: ui_kit)."""
        apply_ttk_style(self)
        # Re-configure log tags
        try:
            for tag, c in [("ok", GREEN), ("err", RED), ("info", ORANGE),
                            ("dim", MUTED), ("warn", YELLOW), ("blue", BLUE)]:
                self.log_widget.tag_configure(tag, foreground=c)
            self.log_widget.tag_configure("search_hi",  background=ORANGE2, foreground="white")
            self.log_widget.tag_configure("search_cur", background=ORANGE,  foreground="white")
            self.log_widget.tag_configure("badge_kill",   foreground=RED)
            self.log_widget.tag_configure("badge_warn",   foreground=YELLOW)
            self.log_widget.tag_configure("badge_safe",   foreground=GREEN)
            self.log_widget.tag_configure("badge_filter", foreground=BLUE)
            self.log_widget.configure(bg=_THEME["LOG_BG"], fg=TEXT,
                               insertbackground=ORANGE, selectbackground=ORANGE2)
        except Exception:
            pass
        try:
            self._demo_tree.tag_configure("ok",           foreground=TEXT)
            self._demo_tree.tag_configure("off",          foreground=MUTED)
            self._demo_tree.tag_configure("warn_compat",  foreground=YELLOW)
            self._demo_tree.tag_configure("warn_missing", foreground=MUTED)
        except Exception:
            pass

    @staticmethod
    def _apply_theme_to_widgets(root, old: dict, new: dict,
                                exclude_ids: frozenset = frozenset()):
        """Recursively walk all tk widgets and swap old theme colours for new ones.

        Checks every configurable colour property against every value in old{} and
        replaces it with the corresponding new{} value.  Works for Label, Frame,
        Button, Checkbutton, Radiobutton, Entry, Text, Scale, Scrollbar, etc.

        exclude_ids — frozenset of id(widget) to skip entirely (e.g. accent preset
                      buttons whose fg must stay fixed at their own colour).

        The mapping is colour-value based (old hex → new hex) so it is fully
        DRY — no widget-type-specific code, no per-widget references needed.
        """
        # Build old_hex → new_hex map with collision detection.
        # If two theme keys share the same old hex but map to *different* new hex values,
        # the mapping is semantically ambiguous — exclude it from the generic walk so
        # we don't incorrectly remap widgets (apply_theme() on Sec/ScrollableFrame
        # handles the known semantic containers explicitly via _t()).
        _val_to_new: dict = {}   # old_hex → new_hex (first assignment)
        _conflicts:  set  = set()  # old hex values that are ambiguous

        for key in old:
            ov, nv = old[key].lower(), new[key].lower()
            if ov == nv:
                continue
            if ov in _val_to_new:
                if _val_to_new[ov] != nv:
                    _conflicts.add(ov)
            else:
                _val_to_new[ov] = nv

        colour_map: dict = {ov: nv for ov, nv in _val_to_new.items()
                            if ov not in _conflicts}

        if not colour_map and not _conflicts:
            return  # Theme didn't change

        # Widget config keys to check — listed once, used for every widget
        _COLOUR_PROPS = (
            "bg", "fg", "background", "foreground",
            "activebackground", "activeforeground",
            "selectcolor", "selectbackground", "selectforeground",
            "highlightbackground", "highlightcolor",
            "insertbackground", "disabledforeground",
            "troughcolor", "readonlybackground",
        )

        def _walk(widget):
            if id(widget) in exclude_ids:
                return  # skip — fixed-colour widget (e.g. accent preset buttons)
            # Sec and ScrollableFrame have apply_theme() that sets colours via _t()
            # directly — reliable even when colour_map has ambiguous entries.
            if isinstance(widget, (Sec, ScrollableFrame, BentoGrid)):
                try:
                    widget.apply_theme()
                except Exception:
                    pass
            try:
                # One configure() call returns all options; far cheaper than
                # 15 individual cget() round-trips through the Tcl interpreter.
                conf = widget.configure()
                updates = {}
                for prop in _COLOUR_PROPS:
                    spec = conf.get(prop)
                    if spec is None:
                        continue
                    cur = spec[-1]          # current value is last element of tuple
                    if not isinstance(cur, str):
                        continue
                    mapped = colour_map.get(cur.lower())
                    if mapped:
                        updates[prop] = mapped
                if updates:
                    widget.configure(**updates)
            except Exception:
                pass
            try:
                for child in widget.winfo_children():
                    _walk(child)
            except tk.TclError:
                pass

        _walk(root)

    def _tab_outils(self, parent):
        p = self._make_tab_scroll(parent)
        # Bento : sections independantes -> grille 2 colonnes quand la place le
        # permet (onglet le moins risque, aucun etat croise). Opt-in ici.
        bento = BentoGrid(p)
        bento.pack(fill="both", expand=True)

        sec = Sec(bento, "PATHS")
        bento.add(sec)
        PathField(sec, "CSDM Executable", "csdm.CMD or csdm.exe",
                  self.v["csdm_exe"], "file").pack(fill="x", pady=4)
        _pf_cfg = PathField(sec, "CS2 cfg folder",
                  r"Optional override (…\Counter-Strike Global Offensive\game\csgo\cfg)",
                  self.v["cs2_cfg_dir"], "dir")
        _pf_cfg.pack(fill="x", pady=4)
        add_tip(_pf_cfg, "Optional manual override for CS2 cfg directory.\n"
                         "Used by CS mode to inject csdm_batch_runtime.cfg and autoexec block.\n"
                         "Leave empty to use automatic Steam library detection.")
        _pf_clips = PathField(sec, "Raw clips folder",
                  "A subfolder per demo is created here",
                  self.v["output_dir_clips"], "dir")
        _pf_clips.pack(fill="x", pady=4)
        add_tip(_pf_clips, "Root folder where CSDM places raw clips.\n"
                           "A subfolder named after the demo is created there if the option is active.")
        _pf_concat = PathField(sec, "Concatenated clips folder",
                  "Empty = same folder as raw clips",
                  self.v["output_dir_concat"], "dir")
        _pf_concat.pack(fill="x", pady=4)
        add_tip(_pf_concat, "Folder where concatenated clips per demo are placed.\n"
                            "Leave empty to use the same folder as raw clips.")
        _pf_asm = PathField(sec, "Assembled file folder",
                  "Empty = same folder as raw clips",
                  self.v["output_dir_assembled"], "dir")
        _pf_asm.pack(fill="x", pady=4)
        add_tip(_pf_asm, "Folder where the final assembled file is placed.\n"
                         "Leave empty to use the same folder as raw clips.")
        _sub_cb = hchk(sec, "Subfolder per demo", self.v["subfolder_per_demo"])
        _sub_cb.pack(anchor="w", pady=(4, 0))
        add_tip(_sub_cb, "Creates a folder per demo in the raw clips folder.")

        sec = Sec(bento, "UI THEME")
        bento.add(sec)

        # ── Background row ────────────────────────────────────────────────────
        bg_row = tk.Frame(sec, bg=BG2)
        bg_row.pack(fill="x", pady=(4, 0))
        mlabel(bg_row, "Background:").pack(side="left")
        _BG_BTN_DEFS = [
            ("dark",     "Dark",      MUTED),
            ("amoled",   "AMOLED",    TEXT),
            ("deepblue", "Deep Blue", "#7a9fda"),
            ("white",    "White",     "#555555"),
            ("terminal", "Terminal",  "#6f8a78"),
        ]
        for _bg_key, _bg_lbl, _bg_fg in _BG_BTN_DEFS:
            def _make_bg_cmd(k=_bg_key):
                return lambda: self._change_theme(k, self.v["theme_accent"].get())
            tk.Button(bg_row, text=_bg_lbl, font=FONT_SM, bg=BG3, fg=_bg_fg,
                      relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                      activebackground=BORDER, activeforeground=ORANGE,
                      command=_make_bg_cmd()).pack(side="left", padx=(8, 0), ipady=4, ipadx=8)

        # ── Accent row ────────────────────────────────────────────────────────
        ac_row = tk.Frame(sec, bg=BG2)
        ac_row.pack(fill="x", pady=(8, 0))
        mlabel(ac_row, "Accent:    ").pack(side="left")
        _AC_BTN_DEFS = [
            ("green",  "Green",  "#22c55e"),
            ("blue",   "Blue",   "#3b82f6"),
            ("orange", "Orange", "#f97316"),
            ("purple", "Purple", "#a855f7"),
            ("red",    "Red",    "#ef4444"),
            ("cyan",   "Cyan",   "#06b6d4"),
            ("pink",   "Pink",   "#ec4899"),
            ("yellow", "Yellow", "#eab308"),
        ]
        # Keep refs so _apply_theme_to_widgets skips their fg (each btn keeps its own colour)
        # and so _change_theme can update only their bg/activebackground.
        self._ac_btn_refs: list = []   # [(widget, fixed_fg_hex), ...]
        for _ac_key, _ac_lbl, _ac_col in _AC_BTN_DEFS:
            def _make_ac_cmd(k=_ac_key):
                return lambda: self._change_theme(self.v["theme_bg"].get(), k)
            _btn = tk.Button(ac_row, text=_ac_lbl, font=FONT_SM, bg=BG3, fg=_ac_col,
                             relief="flat", bd=0, cursor="hand2", highlightthickness=0,
                             activebackground=BORDER, activeforeground=_ac_col,
                             command=_make_ac_cmd())
            _btn.pack(side="left", padx=(8 if _ac_key == "green" else 4, 0), ipady=4, ipadx=8)
            self._ac_btn_refs.append((_btn, _ac_col))

        # ── Custom colour picker ───────────────────────────────────────────────
        custom_row = tk.Frame(sec, bg=BG2)
        custom_row.pack(fill="x", pady=(8, 0))
        mlabel(custom_row, "Custom:    ").pack(side="left")

        def _pick_custom_accent():
            cur = self.v["theme_accent"].get()
            init = cur if cur.startswith("#") else _ACCENT_PRESETS.get(cur, {}).get("ACCENT", "#22c55e")
            result = colorchooser.askcolor(color=init, parent=self, title="Pick accent colour")
            if result and result[1]:
                self._change_theme(self.v["theme_bg"].get(), result[1])

        tk.Button(custom_row, text="🎨 Custom colour…", font=FONT_SM,
                  bg=BG3, fg=ORANGE, relief="flat", bd=0, cursor="hand2",
                  highlightthickness=0, activebackground=BORDER, activeforeground=ORANGE,
                  command=_pick_custom_accent).pack(side="left", padx=(8, 0), ipady=4, ipadx=8)

        mlabel(custom_row, "   Current:").pack(side="left", padx=(12, 0))
        self._theme_preview_lbl = tk.Label(custom_row, text="  ██  ", font=FONT_SM,
                                            fg=ORANGE, bg=BG3, relief="flat")
        self._theme_preview_lbl.pack(side="left", padx=(4, 0))
        add_tip(self._theme_preview_lbl, "Current accent colour preview.")

        sec = Sec(bento, "UI LAYOUT")
        bento.add(sec)
        row = tk.Frame(sec, bg=BG2)
        row.pack(fill="x", pady=(6, 0))
        mlabel(row, "Window").pack(side="left")
        sentry(row, self.v["ui_window_w"], width=7).pack(side="left", padx=(8, 4), ipady=4)
        tk.Label(row, text="x", font=FONT_SM, fg=MUTED, bg=BG2).pack(side="left")
        sentry(row, self.v["ui_window_h"], width=7).pack(side="left", padx=(4, 10), ipady=4)
        mlabel(row, "Split %").pack(side="left")
        sentry(row, self.v["ui_split_pct"], width=5).pack(side="left", padx=(8, 0), ipady=4)

        row2 = tk.Frame(sec, bg=BG2)
        row2.pack(fill="x", pady=(8, 0))
        tk.Button(row2, text="Apply", font=FONT_SM, bg=BG3, fg=TEXT,
                  relief="flat", bd=0, cursor="hand2",
                  activebackground=BORDER, activeforeground=ORANGE,
                  command=self._apply_layout_vars).pack(side="left", ipady=5, ipadx=8)
        tk.Button(row2, text="Auto", font=FONT_SM, bg=BG3, fg=BLUE,
                  relief="flat", bd=0, cursor="hand2",
                  activebackground=BORDER, activeforeground=ORANGE,
                  command=self._auto_layout).pack(side="left", padx=(6, 0), ipady=5, ipadx=8)
        tk.Button(row2, text="Reset default", font=FONT_SM, bg=BG3, fg=YELLOW,
                  relief="flat", bd=0, cursor="hand2",
                  activebackground=BORDER, activeforeground=ORANGE,
                  command=self._reset_layout_defaults).pack(side="left", padx=(6, 0), ipady=5, ipadx=8)
        _rem = hchk(row2, "Remember current layout", self.v["ui_remember_layout"])
        _rem.pack(side="left", padx=(12, 0))
        add_tip(_rem, "When enabled, manual window resize and splitter moves are saved automatically.")

        sec = Sec(bento, "POSTGRESQL CONNECTION")
        bento.add(sec)
        pg = tk.Frame(sec, bg=BG2)
        pg.pack(fill="x", pady=(6, 0))
        for i in range(5):
            pg.columnconfigure(i, weight=1)
        for col, (lbl, key, show) in enumerate([
            ("Host", "pg_host", ""), ("Port", "pg_port", ""), ("Base", "pg_db", ""),
            ("User", "pg_user", ""), ("Pass", "pg_pass", "*")
        ]):
            f = tk.Frame(pg, bg=BG2)
            f.grid(row=0, column=col, sticky="ew", padx=(0 if col == 0 else 6, 0))
            mlabel(f, lbl).pack(fill="x")
            kw = {"show": "*"} if show == "*" else {}
            sentry(f, self.v[key], **kw).pack(fill="x", ipady=5, ipadx=6, pady=(3, 0))
        br = tk.Frame(sec, bg=BG2)
        br.pack(fill="x", pady=(12, 0))
        tk.Button(br, text="  Test & Reload", font=FONT_SM, bg=ORANGE, fg="white",
                  relief="flat", cursor="hand2", bd=0, activebackground=ORANGE2,
                  command=self._connect_and_load).pack(side="left", ipady=6, ipadx=8)
        tk.Label(br, textvariable=self.db_status, font=FONT_SM_B, bg=BG2,
                 fg=YELLOW).pack(side="left", padx=(12, 0))

        sec_perf = Sec(bento, "PERFORMANCE")
        bento.add(sec_perf)

        dp2_row = tk.Frame(sec_perf, bg=BG2)
        dp2_row.pack(fill="x", pady=(6, 0))
        dp2_top = tk.Frame(dp2_row, bg=BG2)
        dp2_top.pack(fill="x")
        mlabel(dp2_top, "DP2 parse threads").pack(side="left")
        _dp2_val_lbl = tk.Label(dp2_top,
                                text=str(self.v["dp2_threads"].get()),
                                font=FONT_SM, fg=ORANGE, bg=BG2)
        _dp2_val_lbl.pack(side="right")
        tk.Scale(dp2_row, from_=1, to=8,
                 variable=self.v["dp2_threads"],
                 orient="horizontal", bg=BG2, fg=TEXT,
                 troughcolor=BG3, activebackground=ORANGE,
                 highlightthickness=0, bd=0, showvalue=False, cursor="hand2",
                 command=lambda v: _dp2_val_lbl.config(
                     text=str(int(float(v))))).pack(fill="x", pady=(2, 0))
        add_tip(dp2_row,
                "Number of parallel threads used to pre-parse demo files\n"
                "with demoparser2 (TROIS SHOT / ONE TAP / TROIS TAP filters).\n"
                "Default auto-scales to your CPU count (capped at 8).\n"
                "Higher = faster pre-parse on multi-core CPUs.  Set to 1 to disable.")

        sec_inj = Sec(bento, "INJECTION PREVIEW")
        bento.add(sec_inj)
        desc_label(sec_inj,
                   "Live preview of args injected into CS2 for the current config. "
                   "Updates automatically when settings change.").pack(
            fill="x", pady=(0, 6))
        self._inj_text = tk.Text(
            sec_inj, font=FONT_SM, bg=BG3, fg=TEXT, relief="flat", bd=0,
            highlightthickness=1, highlightbackground=BORDER,
            wrap="word", state="disabled", height=6,
            selectbackground=ORANGE2, selectforeground="white")
        self._inj_text.pack(fill="x")
        self._inj_text.tag_configure("key",  foreground=ORANGE)
        self._inj_text.tag_configure("val",  foreground=TEXT)
        self._inj_text.tag_configure("dim",  foreground=MUTED)
        tk.Button(sec_inj, text="⟳ Refresh", font=FONT_DESC, bg=BG3, fg=BLUE,
                  relief="flat", bd=0, cursor="hand2",
                  activebackground=BORDER, activeforeground=ORANGE,
                  command=self._refresh_injection_preview).pack(
            anchor="w", pady=(6, 0), ipady=3, ipadx=6)
        self.after(200, self._refresh_injection_preview)

        sec_pre = Sec(bento, "SAVE A PRESET")
        bento.add(sec_pre)

        self._preset_name_var = tk.StringVar()
        nr = tk.Frame(sec_pre, bg=BG2)
        nr.pack(fill="x", pady=(6, 0))
        mlabel(nr, "Name:").pack(side="left")
        sentry(nr, self._preset_name_var).pack(side="left", fill="x", expand=True,
                                                padx=(6, 0), ipady=4)

        mlabel(sec_pre, "Include:").pack(anchor="w", pady=(8, 2))
        self._preset_cats: dict[str, tk.BooleanVar] = {}

        # Init all vars before building UI so toggle callbacks can reference them
        for _k in _PRESET_ALL_CATS:
            self._preset_cats[_k] = tk.BooleanVar(value=(_k == "players"))
        self._preset_cats["full"] = tk.BooleanVar(value=False)

        def _on_full_toggle():
            if self._preset_cats["full"].get():
                for _k in _PRESET_ALL_CATS:
                    self._preset_cats[_k].set(False)

        def _on_partial_toggle():
            if any(self._preset_cats[_k].get() for _k in _PRESET_ALL_CATS):
                self._preset_cats["full"].set(False)

        # ── Mini-tab columns ──────────────────────────────────────────────────
        tab_row = tk.Frame(sec_pre, bg=BG2)
        tab_row.pack(fill="x", pady=(4, 0))

        for group_label, group_items in _PRESET_TAB_GROUPS:
            col = tk.Frame(tab_row, bg=BG2)
            col.pack(side="left", fill="y", padx=(0, 10))
            # Mini tab header
            hdr = tk.Frame(col, bg=BG3)
            hdr.pack(fill="x", pady=(0, 3))
            tk.Label(hdr, text=group_label, font=FONT_SM, fg=MUTED, bg=BG3,
                     padx=6, pady=2).pack(anchor="w")
            for key, label in group_items:
                hchk(col, label, self._preset_cats[key],
                     command=_on_partial_toggle).pack(anchor="w", padx=(2, 0), pady=1)

        # Full / All column
        full_col = tk.Frame(tab_row, bg=BG2)
        full_col.pack(side="left", fill="y")
        hdr_full = tk.Frame(full_col, bg=BG3)
        hdr_full.pack(fill="x", pady=(0, 3))
        tk.Label(hdr_full, text="ALL", font=FONT_SM, fg=MUTED, bg=BG3,
                 padx=6, pady=2).pack(anchor="w")
        hchk(full_col, "Full config", self._preset_cats["full"],
             command=_on_full_toggle).pack(anchor="w", padx=(2, 0), pady=1)

        tk.Button(sec_pre, text="  SAVE  ", font=FONT_SM, bg=ORANGE, fg="white",
                  relief="flat", cursor="hand2", bd=0, highlightthickness=0,
                  activebackground=ORANGE2, command=self._save_preset).pack(
            anchor="w", pady=(10, 0), ipady=6, ipadx=8)

        sec_load = Sec(bento, "LOAD / DELETE")
        bento.add(sec_load)
        self._preset_list_frame = tk.Frame(sec_load, bg=BG2)
        self._preset_list_frame.pack(fill="x", pady=(6, 0))
        self._refresh_preset_list()

    def _save_preset(self):
        name = self._preset_name_var.get().strip()
        if not name:
            messagebox.showerror("Preset", "Enter a name.")
            return
        cats_checked = [k for k, var in self._preset_cats.items() if var.get()]
        if not cats_checked:
            messagebox.showerror("Preset", "Select at least one category to include.")
            return
        cfg = self._collect_config()
        if "full" in cats_checked:
            data = dict(cfg)
            cats_checked = ["full"]
        else:
            merged_keys: list = []
            for cat in cats_checked:
                for k in (PRESET_KEYS.get(cat) or []):
                    if k not in merged_keys:
                        merged_keys.append(k)
            data = {k: cfg[k] for k in merged_keys if k in cfg}
        self.presets[name] = {"cats": cats_checked, "data": data}
        save_presets(self.presets)
        self._refresh_preset_list()
        messagebox.showinfo("Preset", f"'{name}' saved ({len(data)} keys).")

    def _load_preset(self, name):
        p = self.presets.get(name)
        if not p:
            return
        # Support both old {"type": "..."} and new {"cats": [...]} formats
        cats = p.get("cats") or [p.get("type", "full")]
        if "full" in cats:
            keys = None
        else:
            keys: list = []
            for cat in cats:
                for k in (PRESET_KEYS.get(cat) or []):
                    if k not in keys:
                        keys.append(k)
        self._apply_config(p["data"], keys=keys)
        self._post_apply_ui()
        self._log(f"Preset '{name}' loaded.", "ok")

    def _post_apply_ui(self):
        """Sync derived widgets after _apply_config (resolution, slow-motion…)."""
        try:
            w = self.v["width"].get()
            h = self.v["height"].get()
            self.v["resolution"].set(f"{w}x{h}")
            # Definition
            def_lbl = next((lbl for lbl, dh in DEFINITIONS if dh == h), None)
            # Ratio
            ratio_lbl = None
            for lbl, rw, rh in ASPECT_RATIOS:
                if h > 0 and abs(w / h - rw / rh) < 0.02:
                    ratio_lbl = lbl
                    break
            if def_lbl and ratio_lbl:
                self.v["res_definition"].set(def_lbl)
                self.v["res_aspect"].set(ratio_lbl)
                self.v["res_custom"].set(False)
            else:
                self.v["res_custom"].set(True)
            self._on_res_custom_toggle()
            self._update_res_preview()
        except Exception:
            pass
        self._on_game_speed_var()

    def _delete_preset(self, name):
        if messagebox.askyesno("Delete", f"Delete '{name}'?"):
            self.presets.pop(name, None)
            save_presets(self.presets)
            self._refresh_preset_list()

    def _quick_preset_load(self):
        name = self._quick_preset_var.get()
        if name:
            self._load_preset(name)

    def _quick_preset_save(self):
        name = self._quick_preset_var.get().strip()
        if not name:
            name = simpledialog.askstring("Quick Save", "Preset name:", parent=self)
            if not name:
                return
            name = name.strip()
        cfg = self._collect_config()
        self.presets[name] = {"cats": ["full"], "data": dict(cfg)}
        save_presets(self.presets)
        self._refresh_preset_list()
        self._quick_preset_var.set(name)
        self._log(f"Preset '{name}' quick-saved.", "ok")

    @staticmethod
    def _preset_tooltip(p):
        """Build a human-readable tooltip showing what categories a preset covers."""
        cats = p.get("cats") or [p.get("type", "full")]
        cat_names = {
            "full": "Full config",
            "player": "Player (legacy)", "video": "Video (legacy)", "timing": "Timing",
            "players": "Active players", "date": "Date range", "filters": "Filters",
            "mode": "Mode (HLAE/CS)", "output_name": "Output name",
            "encoding": "Encoding", "hlae_opts": "HLAE options", "physics": "Physics",
        }
        lines = [cat_names.get(c, c) for c in cats]
        return "\n".join(lines)

    def _refresh_preset_list(self):
        # Sync top-bar quick preset combo
        if hasattr(self, "_quick_preset_combo"):
            names = list(self.presets.keys())
            self._quick_preset_combo["values"] = names
            if self._quick_preset_var.get() not in names:
                self._quick_preset_var.set(names[0] if names else "")

        for w in self._preset_list_frame.winfo_children():
            w.destroy()
        if not self.presets:
            tk.Label(self._preset_list_frame, text="No presets.", font=FONT_SM, fg=MUTED,
                     bg=BG2).pack(anchor="w")
            return
        for name, p in self.presets.items():
            cats = p.get("cats") or [p.get("type", "full")]
            cat_names = {
                "full": "All", "player": "Player", "video": "Video", "timing": "Timing",
                "players": "Players", "date": "Date", "filters": "Filters",
                "mode": "Mode", "output_name": "Name", "encoding": "Encoding",
                "hlae_opts": "HLAE", "physics": "Physics",
            }
            cats_str = " + ".join(cat_names.get(c, c) for c in cats)
            row = tk.Frame(self._preset_list_frame, bg=BG2)
            row.pack(fill="x", pady=2)
            name_lbl = tk.Label(row, text=name, font=FONT_SM, fg=TEXT, bg=BG2)
            name_lbl.pack(side="left")
            cat_lbl = tk.Label(row, text=f"  [{cats_str}]", font=FONT_DESC, fg=MUTED, bg=BG2)
            cat_lbl.pack(side="left")
            tip = self._preset_tooltip(p)
            add_tip(name_lbl, tip)
            add_tip(cat_lbl, tip)
            tk.Button(row, text="Load", font=FONT_DESC, bg=BG3, fg=GREEN, relief="flat",
                      cursor="hand2", bd=0,
                      command=lambda n=name: self._load_preset(n)).pack(side="right", padx=(4, 0))
            tk.Button(row, text="Suppr", font=FONT_DESC, bg=BG3, fg=RED, relief="flat",
                      cursor="hand2", bd=0,
                      command=lambda n=name: self._delete_preset(n)).pack(side="right")

    def _chk(self, p, text, var, **kw):
        f = tk.Frame(p, bg=BG2)
        hchk(f, text, var, **kw).pack()
        return f

    def _slider(self, p, label, var, mn, mx, row, col):
        """Slider widget. row/col kept for backward-compat but layout is pack-based."""
        f = tk.Frame(p, bg=BG2)
        f.grid(row=row, column=col, sticky="ew",
               padx=(0, 10 if col == 0 else 0), pady=(2, 4))
        hdr = tk.Frame(f, bg=BG2)
        hdr.pack(fill="x")
        mlabel(hdr, label).pack(side="left")
        val_lbl = tk.Label(hdr, text=f"{var.get()}s",
                           font=FONT_SM_B, fg=ORANGE, bg=BG2,
                           width=3, anchor="e")
        val_lbl.pack(side="right")
        tk.Scale(f, from_=mn, to=mx, variable=var, orient="horizontal",
                 bg=BG2, fg=TEXT, troughcolor=BG3,
                 activebackground=ORANGE, highlightthickness=0, bd=0,
                 showvalue=False, cursor="hand2",
                 command=lambda v: val_lbl.config(text=f"{int(float(v))}s")
                 ).pack(fill="x", pady=(1, 0))
        return f

    def _log(self, msg, tag=""):
        self.log_widget.configure(state="normal")
        if self._log_timestamps.get() and msg.strip():
            self.log_widget.insert("end", f"[{time.strftime('%H:%M:%S')}] ", "ts")
        self.log_widget.insert("end", msg + "\n", tag)
        if tag == "err":
            self._log_err_count += 1
        elif tag == "warn":
            self._log_warn_count += 1
        if tag in ("err", "warn"):
            self._update_log_counts()
        if self._log_autoscroll.get():
            self.log_widget.see("end")
        self.log_widget.configure(state="disabled")

    def _log_parts(self, parts):
        self.log_widget.configure(state="normal")
        if self._log_timestamps.get():
            self.log_widget.insert("end", f"[{time.strftime('%H:%M:%S')}] ", "ts")
        for txt, tag in parts:
            self.log_widget.insert("end", txt, tag or "")
        self.log_widget.insert("end", "\n")
        if self._log_autoscroll.get():
            self.log_widget.see("end")
        self.log_widget.configure(state="disabled")

    def _async_log(self, msg, tag=""):
        """Thread-safe async log — schedules a direct _log call on the main thread."""
        self.after(0, lambda m=msg, t=tag: self._log(m, t))

    def _async_log_parts(self, parts):
        """Thread-safe async log for multi-part lines (badge rows)."""
        self.after(0, lambda p=parts: self._log_parts(p))

    # ═══════════════════════════════════════════════════
    #  Engine ports (D21) — Tkinter side
    # ═══════════════════════════════════════════════════
    def log(self, message, level=""):
        """Engine port: write one line to the console. Thread-safe, no pump."""
        self._async_log(message, level)

    def log_parts(self, parts):
        """Engine port: write one multicolor console line. Thread-safe, no pump."""
        self._async_log_parts(parts)

    def state(self, name, payload=None):
        """Engine port: report a typed state change. Rendered on the main thread."""
        self.after(0, lambda n=name, p=payload or {}: self._on_state_main(n, p))

    _SUMMARY_COLORS = {"ok": GREEN, "warn": YELLOW, "err": RED,
                       "muted": MUTED, "running": YELLOW}

    def _on_state_main(self, name, payload):
        """Route one state event to the widgets. Main thread only."""
        if name == "buttons_idle":
            self._reset_btns()
        elif name == "progress":
            self.progress_lbl.config(text=payload["text"])
        elif name == "summary":
            self._summary_lbl.config(text=payload["text"],
                                     fg=self._SUMMARY_COLORS[payload["level"]])
        elif name == "preview_ready":
            self._show_preview(payload["events"], payload["cfg"], payload.get("timings"))
        elif name == "stop_available":
            self.stop_btn.config(state="normal" if payload["enabled"] else "disabled",
                                 text="⏸ Stop")
        elif name == "demos_unchecked":
            self._uncheck_demos_in_picker(payload["paths"])
        elif name == "demo_entry":
            self._emit_demo_log_entry(**payload)
        elif name == "buttons":
            if "stop" in payload:
                self.stop_btn.config(state="normal" if payload["stop"] else "disabled")
            if "stop_label" in payload:
                self.stop_btn.config(text=payload["stop_label"])
            if "kill" in payload:
                self.kill_btn.config(state="normal" if payload["kill"] else "disabled")
        elif name in ("buttons_busy", "run_started", "preview_started",
                      "stop_requested", "kill_requested"):
            # The window already set its own buttons when the click happened;
            # these exist for a host that has no click to react to. Explicit
            # pass, so a new event can never fall through unnoticed.
            pass
        elif name == "process_exited":
            # Tkinter shows nothing on exit -- the Electron interface detonates
            # its charge here, and that is the whole point of the event.
            pass
        else:
            raise KeyError(f"unknown engine state event: {name!r}")

    def ask(self, kind, message, options):
        """Engine port: ask the user and BLOCK until the answer comes back.

        Called from a worker thread. The dialog must open on the main thread,
        so we post it and wait on an Event — same shape as the existing
        `_ask_user` closure in `_worker`.
        """
        result, done = [None], threading.Event()

        def _open():
            try:
                if kind == "error":
                    messagebox.showerror("", message)
                    result[0] = "ok"
                else:
                    res = messagebox.askyesnocancel(options[0], message, default="no")
                    # True -> options[1], False -> options[2], None -> cancel
                    result[0] = None if res is None else (options[1] if res else options[2])
            finally:
                done.set()

        self.after(0, _open)
        done.wait()
        return result[0]

    def _uncheck_demos_in_picker(self, paths):
        """Uncheck a set of demo paths in the picker. Main thread only."""
        for dp in paths:
            if dp in self._demo_picker_state:
                self._demo_picker_state[dp] = False
                try:
                    self._demo_tree.item(dp, values=("✕",
                        self._demo_picker_fmt_date(dp),
                        self._demo_picker_fmt_map(dp),
                        self._demo_picker_fmt_name(dp)),
                        tags=("off",))
                except Exception:
                    pass
        n_on  = sum(1 for v in self._demo_picker_state.values() if v)
        n_tot = len(self._demo_picker_state)
        try:
            self._picker_count_lbl.config(
                text=f"{n_on}/{n_tot} selected",
                fg=ORANGE if n_on < n_tot else MUTED)
        except tk.TclError:
            pass

    _LOG_MAX_LINES = 8000   # trim oldest lines when the Text widget exceeds this

    _DP2_CACHE_MAX = 150    # max demos kept in dp2 cache; oldest evicted beyond this

    def _dp2_cache_put_locked(self, demo_path: str, data: dict):
        """Write to _dp2_cache and evict the oldest entry if cache exceeds _DP2_CACHE_MAX.

        MUST be called while _dp2_cache_lock is already held.

        Each cached demo holds fire_detail, fire_ticks, view_angles, hurt_index, and
        death_flags — typically 0.5–2 MB of Python objects per demo. Without eviction,
        a long batch with many dp2 filters active can exhaust RAM and crash.

        LRU policy: _dp2_cache_order tracks insertion order (oldest = front).
        Re-writes of an existing entry retain their original slot (no re-promotion).
        """
        is_new = demo_path not in self._dp2_cache
        self._dp2_cache[demo_path] = data
        if is_new:
            self._dp2_cache_order.append(demo_path)
        while len(self._dp2_cache) > self._DP2_CACHE_MAX:
            if not self._dp2_cache_order:
                break
            oldest = self._dp2_cache_order.pop(0)
            self._dp2_cache.pop(oldest, None)

    def _clear_log(self):
        self.log_widget.configure(state="normal")
        self.log_widget.delete("1.0", "end")
        self.log_widget.configure(state="disabled")
        self._log_err_count = 0
        self._log_warn_count = 0
        self._update_log_counts()

    def _update_log_counts(self):
        """Refresh the E:/W: counter labels in the log header."""
        try:
            e, w = self._log_err_count, self._log_warn_count
            if self._log_err_lbl and self._log_err_lbl.winfo_exists():
                self._log_err_lbl.config(text=f"[E:{e}]" if e else "")
            if self._log_warn_lbl and self._log_warn_lbl.winfo_exists():
                self._log_warn_lbl.config(text=f"[W:{w}]" if w else "")
        except tk.TclError:
            pass

    def _toggle_log_timestamps(self, event=None):
        self._log_timestamps.set(not self._log_timestamps.get())
        on = self._log_timestamps.get()
        if self._log_ts_btn and self._log_ts_btn.winfo_exists():
            self._log_ts_btn.config(fg=GREEN if on else MUTED)
        self._log_flash(
            f"  {'✓' if on else 'ℹ'} Timestamps {'enabled' if on else 'disabled'}.",
            "ok" if on else "dim")
        return "break"

    def _log_right_click(self, event):
        menu = tk.Menu(self, tearoff=0, bg=BG3, fg=TEXT, font=FONT_DESC,
                       activebackground=ORANGE, activeforeground="white",
                       relief="flat", bd=1)
        menu.add_command(label="Copy line",
                         command=lambda: self._log_copy_line(event.x, event.y))
        menu.add_command(label="Copy selection", command=self._log_copy_sel)
        menu.add_separator()
        menu.add_command(label="Select all",
                         command=lambda: (self.log_widget.tag_add("sel", "1.0", "end-1c")))
        menu.add_command(label="Copy all", command=self._log_copy_all)
        menu.add_separator()
        menu.add_command(label="Search   Ctrl+F", command=self._log_search_open)
        menu.add_separator()
        menu.add_command(label="Clear", command=self._clear_log)
        menu.tk_popup(event.x_root, event.y_root)

    def _log_copy_line(self, x, y):
        try:
            idx = self.log_widget.index(f"@{x},{y}")
            line_n = idx.split(".")[0]
            txt = self.log_widget.get(f"{line_n}.0", f"{line_n}.end").strip()
            if txt:
                self.clipboard_clear()
                self.clipboard_append(txt)
                self._log_flash("  ✓ Line copied.")
        except Exception:
            pass

    def _toggle_log_badges(self, event=None):
        try:
            self._log_badges_enabled.set(not self._log_badges_enabled.get())
            on = self._log_badges_enabled.get()
            if self._log_badges_btn is not None and self._log_badges_btn.winfo_exists():
                self._log_badges_btn.config(
                    text=f"Badges: {'ON' if on else 'OFF'}",
                    fg=GREEN if on else MUTED
                )
            self._log_flash(
                f"  {'✓' if on else 'ℹ'} Clip badges {'enabled' if on else 'collapsed'}.",
                "ok" if on else "dim"
            )
        except Exception:
            pass
        return "break"

    def _build_filter_badges(self, cfg, events=None):
        """Return (text, tag) badge tuples for kill filters that matched this clip.

        When events are provided (clip-level), reads the union of _mf sets from
        all kill events — reflecting exactly which filter(s) each kill triggered.

        Falls back to all active filters from cfg when no event has _mf.
        Excluded filters are shown with a 🚫 prefix in muted colour.
        """
        # Collect matched filter keys from event _mf sets (if available)
        matched: set = set()
        if events is not None:
            for e in events:
                if e.get("type") == "kill":
                    matched |= (e.get("_mf") or set())

        # Build badges — from matched keys if any, else from active cfg flags
        badges = []
        for k, lbl, _cat in self._FILTER_BADGE_DEFS:
            if (matched and k in matched) or (not matched and cfg.get(k)):
                badges.append((f" [{lbl}]", "badge_filter"))
            if cfg.get(f"{k}_exclude", False):
                badges.append((f" [🚫{lbl}]", "badge_warn"))
        return badges

    def _build_filter_header_parts(self, cfg):
        """Return grouped filter strings for the preview header Filters: line.

        Groups active/excluded filters by category. Shows ★ for required,
        🚫 prefix for excluded. Returns [] when no filter is active or excluded.
        """
        _CAT_LABEL = {"mods": "Mods", "dp2": "dp2", "db": "Situation"}
        parts = []
        for cat in ("mods", "dp2", "db"):
            lbls = []
            for k, lbl, c in self._FILTER_BADGE_DEFS:
                if c != cat:
                    continue
                if cfg.get(k):
                    prefix = "★ " if cfg.get(f"{k}_req", False) else ""
                    lbls.append(f"{prefix}{lbl}")
                elif cfg.get(f"{k}_exclude", False):
                    lbls.append(f"🚫 {lbl}")
            if lbls:
                logic = cfg.get(f"kill_mod_logic_{cat}", "any").upper()
                parts.append(f"{_CAT_LABEL[cat]} [{logic}]: {' · '.join(lbls)}")
        return parts

    def _build_clip_badges(self, events, cfg):
        """Build inline badges that describe what a sequence *contains* followed by which
        kill filters it matched.

        Layout per demo line:
          [content badge]  [filter badge 1]  [filter badge 2]  …

        Content badge: derived from actual events (weapon, type, count).
        Filter badges: one per active kill filter (emojis only, blue).
        """
        badges = []
        # Single-pass partitioning by event type
        kill_events, death_events, round_events, clutch_events = [], [], [], []
        _type_buckets = {"kill": kill_events, "death": death_events,
                         "round": round_events, "clutch_round": clutch_events}
        for e in events:
            bucket = _type_buckets.get(e.get("type"))
            if bucket is not None:
                bucket.append(e)

        def _wpn_str(event_list):
            """Return a compact weapon string for a list of events."""
            raw = [str(e.get("weapon", "")).lower().strip() for e in event_list if e.get("weapon")]
            def _fmt(w):
                w = w.replace("weapon_", "")
                return w.upper() if len(w) <= 6 else w.title()
            seen = {}
            for w in raw:
                d = _fmt(w)
                seen[d] = seen.get(d, 0) + 1
            items = list(seen.items())
            if not items:       return "?"
            if len(items) == 1: return items[0][0]
            if len(items) == 2: return f"{items[0][0]} + {items[1][0]}"
            return f"{items[0][0]} +{len(items)-1}"

        # ── Clutch full-round content ──────────────────────────────────────────
        if clutch_events:
            for ce in clutch_events:
                n_opp  = ce.get("_clutch_opponents", "?")
                won    = ce.get("_clutch_won", False)
                result = "✓ WIN" if won else "✗ LOSS"
                sub_kills = ce.get("_clutch_kills", [])
                k_count   = len(sub_kills)
                k_str     = f" {k_count}K" if k_count else ""
                badge_txt = f" [🎯 1v{n_opp}{k_str} {result}]"
                badges.append((badge_txt, "badge_kill" if won else "badge_warn"))

        # ── Regular kill content ───────────────────────────────────────────────
        if kill_events:
            n = len(kill_events)
            wpn = _wpn_str(kill_events)
            # Add clutch annotation if any kill carries clutch metadata
            clutch_tag = ""
            if any(e.get("_clutch_opponents") for e in kill_events):
                opp = kill_events[0].get("_clutch_opponents", "?")
                won = kill_events[0].get("_clutch_won", False)
                clutch_tag = f" 🎯1v{opp}{'✓' if won else '✗'}"
            badge_txt = f" [{n}✕ {wpn}{clutch_tag}]" if n > 1 else f" [KILL {wpn}{clutch_tag}]"
            badges.append((badge_txt, "badge_kill"))

        # ── Death content ─────────────────────────────────────────────────────
        if death_events:
            n = len(death_events)
            wpn = _wpn_str(death_events)
            badge_txt = (f" [{n}✕ DEATH by {wpn}]" if n > 1 else f" [DEATH by {wpn}]")
            badges.append((badge_txt, "badge_warn"))

        # ── Round marker ──────────────────────────────────────────────────────
        # Guard uses `not (kill_events or death_events or clutch_events)` so that
        # removing the clutch block reduces to the original `not kill_events and
        # not death_events` without leaving a dangling name reference.
        if round_events and not (kill_events or death_events or clutch_events):
            badges.append((" [ROUND]", "badge_safe"))

        if not badges:
            badges.append((" [?]", "badge_safe"))

        # ── Active kill filter badges (appended after content) ─────────────
        badges.extend(self._build_filter_badges(cfg, events))

        return badges
    def _build_demo_log_base(self, date_str, demo_name, event_count, seq_count, idx=None, total=None, timing_str=""):
        if idx is not None and total is not None:
            return f"\n[{idx}/{total}]  {date_str}  {demo_name}  ({event_count} events → {seq_count} seq){timing_str}"
        return f"  {date_str}  {demo_name}  ({event_count} events → {seq_count} seq){timing_str}"

    def _emit_demo_log_entry(self, date_str, demo_name, events, seq_count, cfg, idx=None, total=None, timing_str="", async_emit=False):
        base = self._build_demo_log_base(
            date_str=date_str,
            demo_name=demo_name,
            event_count=len(events),
            seq_count=seq_count,
            idx=idx,
            total=total,
            timing_str=timing_str,
        )
        if self._log_badges_enabled.get():
            parts = [(base, "blue")]
            parts.extend(self._build_clip_badges(events, cfg))
            if async_emit:
                self._async_log_parts(parts)
            else:
                self._log_parts(parts)
            return
        if async_emit:
            self._async_log(base, "blue")
        else:
            self._log(base, "blue")

    # ═══════════════════════════════════════════════════════════════════════
    #  CLUTCH detection helpers
    # ═══════════════════════════════════════════════════════════════════════

    def _build_run_cfg(self):
        cfg = self._collect_config()
        cfg["events_kills"]  = self.sel_events["Kills"].get()
        cfg["events_deaths"] = self.sel_events["Deaths"].get()
        cfg["events_rounds"] = self.sel_events["Rounds"].get()
        return cfg

    def _refresh_injection_preview(self):
        """Rebuild the live INJECTION PREVIEW display from current config."""
        try:
            cfg = self._build_run_cfg()
        except Exception:
            return
        try:
            shared = self._common_cs2_injection(cfg)
            hlae_opts = self._inject_hlae_extra_args(cfg, shared)
            recsys = self._normalize_recsys(cfg.get("recsys", "HLAE"))

            lines = []
            if recsys == "HLAE":
                extra = hlae_opts.get("extraArgs", "")
                lines.append(("HLAE extraArgs:", "key"))
                if extra:
                    for tok in extra.split():
                        lines.append(("  " + tok, "val"))
                else:
                    lines.append(("  (none)", "dim"))
            else:
                la = shared.get("launch_args", [])
                lines.append(("Launch args:", "key"))
                lines.append(("  " + (" ".join(la) or "(none)"), "val" if la else "dim"))
                cmds = shared.get("console_cmds", [])
                lines.append(("Console cmds:", "key"))
                for c in cmds:
                    lines.append(("  " + c, "val"))

            txt = "\n".join(t for t, _ in lines)
            tags = []
            pos = 0
            for t, tag in lines:
                tags.append((pos, pos + len(t), tag))
                pos += len(t) + 1  # +1 for \n

            w = self._inj_text
            w.configure(state="normal")
            w.delete("1.0", "end")
            w.insert("1.0", txt)
            for s, e, tag in tags:
                w.tag_add(tag, f"1.0+{s}c", f"1.0+{e}c")
            # auto height: clamp 4–12 lines
            w.configure(height=min(12, max(4, len(lines))))
            w.configure(state="disabled")
        except Exception:
            pass

    # ── _build_json helpers (Phase 1.3) — camera builders are static and take
    #    explicit parameters so they can be unit-tested without an App instance.

    # ═══════════════════════════════════════════════════
    #  Exec
    # ═══════════════════════════════════════════════════
    RETRYABLE = ["game error", "game crashed", "process exited", "timed out"]
    FATAL = ["is not iterable", "ENOENT", "Cannot find", "not found", "TypeError",
             "ReferenceError", "SyntaxError", "FATAL", "Unhandled", "Cannot read properties"]
    # "error:" (with colon) avoids false positives on "no errors found",
    # "error-corrected", "errorless", etc.
    ALL_ERR = RETRYABLE + FATAL + ["error:", "Error:"]

    def _validate_run_inputs(self):
        """Check common preconditions for run/preview. Returns False if invalid."""
        if not self.player_search.get_steam_ids():
            self.ask("error", "Check at least one registered account.", [])
            return False
        if not any(v.get() for v in self.sel_events.values()):
            self.ask("error", "Select at least one event.", [])
            return False
        return True

    def _run(self):
        if not self._validate_run_inputs():
            return
        ensure_csdm_dirs()
        cfg = self._build_run_cfg()
        self._running = True
        self._stop_after_current = False
        self._kill_triggered = False
        self._tagged_this_batch = []   # [(demo_path, tag_name), ...] — for rollback
        self.run_btn.config(state="disabled", bg=BG3, fg=MUTED)
        self.stop_btn.config(state="normal", fg=RED)
        self.kill_btn.config(state="normal", fg=RED)
        self._log(f"\n{'═' * 60}", "dim")
        self._log(f"  ▶ LAUNCH  —  {datetime.now().strftime('%H:%M:%S')}", "info")
        self._log(f"{'═' * 60}", "dim")
        self._summary_lbl.config(text="  Querying DB…", fg=YELLOW)
        threading.Thread(target=self._worker, args=(cfg,), daemon=True).start()

    def _handle_stop(self):
        """Button hook: the decision lives in the engine, not in the window."""
        threading.Thread(target=self.request_stop, daemon=True).start()

    def _kill_now(self):
        """Button hook: hard kill runs on a thread -- it waits for cs2.exe to die."""
        threading.Thread(target=self.request_kill, daemon=True).start()

    def _reset_btns(self):
        self._running = False
        self._stop_after_current = False
        self.run_btn.config(state="normal", bg=ORANGE, fg="white")
        self.stop_btn.config(state="disabled")
        self.kill_btn.config(state="disabled")

    def _dry_run(self):
        if not self._validate_run_inputs():
            return
        cfg = self._build_run_cfg()
        self._log(f"\n{'─' * 60}", "dim")
        self._log(f"  🔍 PREVIEW  —  {datetime.now().strftime('%H:%M:%S')}", "info")
        self._log(f"{'─' * 60}", "dim")
        self._summary_lbl.config(text="  Computing…", fg=YELLOW)
        self._previewing = True
        self._preview_cancel.clear()
        self.stop_btn.config(state="normal", text="⏸ Stop Preview")
        threading.Thread(target=self._preview_worker, args=(cfg,), daemon=True).start()

    def _show_preview(self, evts, cfg, timings=None):
        """Display preview results. Must be called on the main thread."""
        try:
            self._show_preview_impl(evts, cfg, timings)
        except Exception as e:
            import traceback
            self._log(f"Preview display error: {e}\n{traceback.format_exc()}", "err")

    def _show_preview_impl(self, evts, cfg, timings=None):
        if not evts:
            self._log("No events.", "warn")
            self._summary_lbl.config(text="  No clips found.", fg=MUTED)
            return
        te = sum(len(e) for e in evts.values())

        # ── Header ─────────────────────────────────────────────────────────────
        self._log(f"Player:  {self._player_str(cfg)}", "info")

        _auto_tags = self._get_active_tag_names() if cfg.get("tag_enabled") else []
        if _auto_tags:
            self._log(f"Tag:     🏷 {', '.join(_auto_tags)}", "info")

        df = cfg.get("date_from", "")
        dt = cfg.get("date_to", "")
        if df or dt:
            self._log(f"Dates:   {df or '∞'}  →  {dt or '∞'}", "info")

        # Events row
        _ev_parts = []
        if cfg.get("events_kills"):   _ev_parts.append("Kills")
        if cfg.get("events_deaths"):  _ev_parts.append("Deaths")
        if cfg.get("events_rounds"):  _ev_parts.append("Rounds")
        self._log(f"Events:  {' + '.join(_ev_parts) if _ev_parts else '—'}", "info")

        # Weapons row
        _weapons = cfg.get("weapons", [])
        if _weapons:
            _cat_counts = {}
            for w in _weapons:
                c = _weapon_category(w)
                _cat_counts[c] = _cat_counts.get(c, 0) + 1
            _wstr = ", ".join(f"{WEAPON_ICONS.get(c,'')} {c}({n})" for c, n in sorted(_cat_counts.items()))
        else:
            _wstr = "all"
        self._log(f"Weapons: {_wstr}", "info")

        # Perspective / TrueView / order
        _persp = PERSP_LABELS.get(cfg.get("perspective","killer"), cfg.get("perspective","killer"))
        _tv    = "ON" if cfg.get("true_view") else "OFF"
        _order = "Chronological" if cfg.get("clip_order","chrono") == "chrono" else "Random 🎲"
        self._log(f"Rec:     {_persp}  |  TrueView: {_tv}  |  Order: {_order}", "info")

        # Active kill filters — grouped by category, derived from shared definition table
        _kf_parts = self._build_filter_header_parts(cfg)

        # TK / suicides / HS
        _tkm = cfg.get("teamkills_mode", "include")
        _misc = []
        if _tkm == "exclude":  _misc.append("🚫 TK")
        elif _tkm == "only":   _misc.append("⚔ TK only")
        _sm = cfg.get("suicides_mode", "include")
        if _sm == "exclude":  _misc.append("🚫 suicides")
        elif _sm == "only":   _misc.append("💀 suicides only")
        _hsm = cfg.get("headshots_mode", "all")
        if _hsm == "only":    _misc.append("🎯 HS only")
        elif _hsm == "exclude": _misc.append("🎯 no HS")
        if _misc: _kf_parts.append(" · ".join(_misc))

        if _kf_parts:
            self._log(f"Filters: {' | '.join(_kf_parts)}", "ok")

        # Clutch info
        if cfg.get("clutch_enabled"):
            _cmode = "Full clutch" if cfg.get("clutch_mode") == "full_clutch" else "Kills only"
            _csizes = [f"1v{n}" for n in range(1, 6) if cfg.get(f"clutch_1v{n}")]
            _csize_str = " " + " ".join(_csizes) if _csizes else " (all sizes)"
            _cwins = "  ·  Wins only" if cfg.get("clutch_wins_only") else ""
            self._log(f"Clutch:  {_cmode}{_csize_str}{_cwins}", "ok")

        # Result counts
        self._log(f"Found:   {len(evts)} demo(s)  ·  {te} event(s)", "ok")

        _out = (cfg.get("output_dir_clips") or cfg.get("output_dir") or "").strip()
        if _out:
            self._log(f"Output:  {_out}", "dim")
        self._log("Dates:   .info › mtime .dem › DB", "dim")
        # ── end header ─────────────────────────────────────────────────────────
        tickrate  = cfg["tickrate"]
        before_s  = self._effective_before(cfg)
        after_s   = cfg["after"]
        nb_clips  = 0
        total_ticks = 0
        sorted_demos = sorted(evts.keys(), key=self._demo_sort_key)
        # Populate demo picker with the range-filtered demo list
        self._demo_picker_populate(sorted_demos, keep_existing=False)
        demo_dates = {}
        t0_seqbuild = time.time()
        for dp in sorted_demos:
            seqs = self._build_sequences(evts[dp], tickrate, before_s, after_s)
            nb_clips += len(seqs)
            for s in seqs:
                total_ticks += s["end_tick"] - s["start_tick"]
            date_str = self._format_demo_date(dp)
            demo_dates[dp] = date_str
            self._emit_demo_log_entry(
                date_str=date_str,
                demo_name=Path(dp).name,
                events=evts[dp],
                seq_count=len(seqs),
                cfg=cfg,
            )
        known_dates = {d for d in demo_dates.values() if d != "??-??-????"}
        if len(known_dates) == 1 and len(sorted_demos) > 3:
            self._log(
                f"\n⚠  All dates are identical ({next(iter(known_dates))}).\n"
                f"   .info files are missing — the displayed date is the .dem mtime\n"
                f"   (download date), not the exact match date.",
                "warn")
        total_sec = total_ticks / tickrate if tickrate else 0
        avg_sec   = total_sec / nb_clips if nb_clips else 0
        nb_demos  = len(evts)
        t_seqbuild = time.time() - t0_seqbuild

        # ── Timing summary ─────────────────────────────────────────────────
        if timings is not None:
            timings["seqbuild"] = t_seqbuild
            _parts = [f"DB {timings['query']*1000:.0f}ms"]
            if timings["preparse"] > 0.05:
                _parts.append(f"dp2-parse {timings['preparse']:.2f}s")
            if timings["filters"] > 0.01:
                _parts.append(f"filters {timings['filters']*1000:.0f}ms")
            _parts.append(f"seq-build {t_seqbuild*1000:.0f}ms")
            _parts.append(f"total {timings['total'] + t_seqbuild:.2f}s")
            self._log(f"  ⏱ {' | '.join(_parts)}", "dim")

        # Build adaptive summary line
        h = self._hms
        summary_txt = self._fmt_summary(nb_demos, nb_clips, total_sec, avg_sec)
        self._log(f"\n{'─'*56}", "dim")
        avg_line = f"  ▶ {nb_clips} clips  |  total {h(total_sec)}  |  avg. {h(avg_sec)}/clip"
        self._log(avg_line, "ok")
        self._log(f"{'─'*56}", "dim")
        self._summary_lbl.config(text=summary_txt, fg=GREEN)
        self._last_preview_data = {
            "evts": evts, "cfg": cfg,
            "sorted_demos": sorted_demos, "demo_dates": demo_dates,
            "nb_clips": nb_clips, "total_sec": total_sec,
        }

    def _export_preview_html(self):
        """Export the last preview result as a standalone HTML file."""
        if not self._last_preview_data:
            self._log_flash("  ⚠ Run a preview first (F6).", "warn")
            return
        import html as _html

        d        = self._last_preview_data
        nb_clips = d["nb_clips"]
        total_sec= d["total_sec"]

        path = filedialog.asksaveasfilename(
            parent=self,
            defaultextension=".html",
            filetypes=[("HTML", "*.html"), ("All files", "*.*")],
            title="Export preview as HTML",
            initialfile="csdm_preview.html",
        )
        if not path:
            return

        rows_html = []
        for row in self._preview_clip_rows():
            filters_str = ", ".join(row["filters"]) or "—"
            rows_html.append(
                f"<tr>"
                f"<td>{_html.escape(row['date'])}</td>"
                f"<td class='mono'>{_html.escape(row['demo'])}</td>"
                f"<td>{row['clip_index']}/{row['clip_count']}</td>"
                f"<td>{_html.escape(row['weapon'])}</td>"
                f"<td>{_html.escape(filters_str)}</td>"
                f"<td>{row['tick']}</td>"
                f"<td class='mono cmd'>{_html.escape(row['command'])}</td>"
                f"</tr>"
            )

        h_total = self._hms(total_sec)
        generated = time.strftime("%Y-%m-%d %H:%M:%S")
        player_str = _html.escape(self._player_str(d["cfg"]))
        html_out = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8">
<title>CSDM Preview Export — {generated}</title>
<style>
  body{{font-family:Consolas,monospace;background:#0e0e0e;color:#e0e0e0;margin:2rem}}
  h1{{color:#22c55e;font-size:1.1rem;margin-bottom:.4rem}}
  .meta{{color:#888;font-size:.85rem;margin-bottom:1.2rem}}
  table{{border-collapse:collapse;width:100%;font-size:.85rem}}
  th{{background:#1a1a1a;color:#f97316;text-align:left;padding:6px 10px;border-bottom:1px solid #252525}}
  td{{padding:5px 10px;border-bottom:1px solid #181818;vertical-align:top}}
  tr:hover td{{background:#141414}}
  .mono{{font-family:Consolas,monospace}}
  .cmd{{color:#93c5fd;cursor:pointer;user-select:all}}
  .summary{{margin-top:1rem;color:#86efac;font-size:.9rem}}
</style>
</head>
<body>
<h1>CSDM Preview Export</h1>
<div class="meta">Generated: {generated} · Player: {player_str} · {nb_clips} clips · {h_total}</div>
<table>
<thead><tr>
  <th>Date</th><th>Demo</th><th>Clip</th><th>Weapon</th><th>Filters</th><th>Tick</th><th>Command</th>
</tr></thead>
<tbody>
{"".join(rows_html)}
</tbody>
</table>
<div class="summary">▶ {nb_clips} clips &nbsp;|&nbsp; total {h_total}</div>
</body></html>"""

        try:
            Path(path).write_text(html_out, encoding="utf-8")
            self._log_flash(f"  ✓ HTML exported → {path}", "ok")
        except Exception as e:
            self._log_flash(f"  ✗ Export failed: {e}", "err")

    def _preview_clip_rows(self):
        """Shared helper — yield dicts for every clip in the last preview result."""
        d = self._last_preview_data
        evts, cfg = d["evts"], d["cfg"]
        for dp in d["sorted_demos"]:
            date_str  = d["demo_dates"].get(dp, "??")
            demo_name = Path(dp).name
            seqs = self._build_sequences(
                evts.get(dp, []), cfg["tickrate"],
                self._effective_before(cfg), cfg["after"])
            for i, seq in enumerate(seqs, 1):
                kill_parts = [e for e in seq.get("events", []) if e.get("type") == "kill"]
                matched_keys: set = set()
                for e in kill_parts:
                    matched_keys |= (e.get("_mf") or set())
                if matched_keys:
                    filters = [f.badge for f in KILL_FILTER_REGISTRY if f.key in matched_keys]
                else:
                    filters = [f.badge for f in KILL_FILTER_REGISTRY
                               if cfg.get(f.key) and not f.hide_ui]
                weapon = kill_parts[0].get("weapon", "—") if kill_parts else "—"
                tick   = seq.get("start_tick", 0)
                yield {
                    "date":        date_str,
                    "demo":        demo_name,
                    "demo_path":   dp,
                    "clip_index":  i,
                    "clip_count":  len(seqs),
                    "weapon":      weapon,
                    "filters":     filters,
                    "tick":        tick,
                    "command":     f"playdemo {demo_name} {tick}",
                }

    def _export_preview_txt(self):
        """Export the last preview result as a plain-text file."""
        if not self._last_preview_data:
            self._log_flash("  ⚠ Run a preview first (F6).", "warn")
            return

        path = filedialog.asksaveasfilename(
            parent=self, defaultextension=".txt",
            filetypes=[("Text", "*.txt"), ("All files", "*.*")],
            title="Export preview as TXT", initialfile="csdm_preview.txt",
        )
        if not path:
            return

        d = self._last_preview_data
        generated  = time.strftime("%Y-%m-%d %H:%M:%S")
        player_str = self._player_str(d["cfg"])
        h_total    = self._hms(d["total_sec"])
        nb_clips   = d["nb_clips"]

        COL = (12, 36, 6, 18, 30, 8)  # Date, Demo, Clip, Weapon, Filters, Tick
        HDR = ("Date", "Demo", "Clip", "Weapon", "Filters found", "Tick")
        sep = "─" * (sum(COL) + len(COL) * 2)

        lines = [
            f"CSDM Preview Export — {generated}",
            f"Player: {player_str}   |   {nb_clips} clips   |   {h_total}",
            sep,
            "  ".join(h.ljust(w) for h, w in zip(HDR, COL)),
            sep,
        ]
        for row in self._preview_clip_rows():
            clip_lbl   = f"{row['clip_index']}/{row['clip_count']}"
            filter_lbl = ", ".join(row["filters"]) or "—"
            cells = (
                row["date"][:COL[0]].ljust(COL[0]),
                row["demo"][:COL[1]].ljust(COL[1]),
                clip_lbl[:COL[2]].ljust(COL[2]),
                row["weapon"][:COL[3]].ljust(COL[3]),
                filter_lbl[:COL[4]].ljust(COL[4]),
                str(row["tick"])[:COL[5]].ljust(COL[5]),
            )
            lines.append("  ".join(cells))
            lines.append(f"  {'':>{COL[0]+2}}cmd: {row['command']}")
        lines += [sep, f"▶ {nb_clips} clips  |  total {h_total}"]

        try:
            Path(path).write_text("\n".join(lines), encoding="utf-8")
            self._log_flash(f"  ✓ TXT exported → {path}", "ok")
        except Exception as e:
            self._log_flash(f"  ✗ Export failed: {e}", "err")

    def _export_preview_json(self):
        """Export the last preview result as JSON."""
        if not self._last_preview_data:
            self._log_flash("  ⚠ Run a preview first (F6).", "warn")
            return

        import json as _json
        path = filedialog.asksaveasfilename(
            parent=self, defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            title="Export preview as JSON", initialfile="csdm_preview.json",
        )
        if not path:
            return

        d = self._last_preview_data
        generated  = time.strftime("%Y-%m-%d %H:%M:%S")
        player_str = self._player_str(d["cfg"])
        clips      = list(self._preview_clip_rows())
        out = {
            "generated":      generated,
            "player":         player_str,
            "nb_clips":       d["nb_clips"],
            "total_duration": self._hms(d["total_sec"]),
            "clips": clips,
        }
        try:
            Path(path).write_text(_json.dumps(out, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
            self._log_flash(f"  ✓ JSON exported → {path}", "ok")
        except Exception as e:
            self._log_flash(f"  ✗ Export failed: {e}", "err")

if __name__ == "__main__":
    App().mainloop()
