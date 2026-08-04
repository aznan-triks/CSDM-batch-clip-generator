"""Engine: everything the app computes, with no Tkinter anywhere.

Moved out of csdm_batch_clips_generator.py by chantier 1 of the Electron
migration. The bodies are unchanged: this is a move, not a rewrite.

The mixin talks to the outside world through exactly three sockets, provided
by its host (see csdm/engine/ports.py):

    self.log(message, level)          write a console line
    self.state(name, payload)         report a typed state change
    self.ask(kind, message, options)  ask and block until answered

A guard test (tests/test_engine_isolation.py) fails the build if any Tkinter
import or widget access reappears here.
"""
import bisect
import concurrent.futures
import json
import math
import os
import random
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import datetime as _dt
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

try:
    import psycopg2
except ImportError:
    psycopg2 = None

from csdm.static_data import (
    SUICIDE_WEAPONS, DELAYED_EFFECT_WEAPONS, KILL_FILTER_REGISTRY,
    KILL_FILTER_SQL_COLS, CPU_VIDEO_CODECS,
    CSDM_RUNTIME_CFG_NAME, CSDM_RUNTIME_BLOCK_START, CSDM_RUNTIME_BLOCK_END,
    _NO_AUTO_EXCLUDE, PERSP_LABELS, _MATCH_TYPE_KEY_TO_DB, _MATCH_TYPE_CFG_KEYS,
    CSDM_TO_DP2_WEAPON, TROIS_SHOT_THRESHOLDS, DP2_TICK_WINDOW,
    SPRAY_TRANSFER_WEAPONS_LOWER, SPRAY_MAX_GAP_TICKS,
)
from csdm.config import DEFAULT_CONFIG
from csdm.core_utils import (
    build_camera_ticks, safe_folder_name, _count_kills, fmt_duration, progress_bar,
    process_is_running, ensure_csdm_dirs, _generate_id_for_type,
)

# Tables probed when reading the CSDM schema, in probe order.
DISCOVERY_TABLES = ("kills", "matches", "demos", "rounds", "players", "tags",
                    "checksum_tags", "match_tags")
# SQL types that can carry a match date.
DISCOVERY_DATE_TYPES = frozenset({
    "date", "timestamp", "timestamp with time zone", "timestamp without time zone",
    "timestamptz",
})
DISCOVERY_INT_TYPES = frozenset({
    "bigint", "integer", "int", "int4", "int8", "smallint", "int2", "numeric",
})
# Column names that look like a date but record bookkeeping, not play time.
DISCOVERY_SUSPECT_NAMES = ("analyze", "created", "import", "added", "updated")
DISCOVERY_SUSPECT_PENALTY = 5
# Map name prefixes stripped to build the display key.
MAP_NAME_PREFIXES = ("de_", "cs_", "ar_", "gg_", "dz_", "tr_")
# The five PostgreSQL identifiers `_pg`/`_pg_fresh` read out of `_pg_params`.
PG_PARAM_KEYS = ("pg_host", "pg_port", "pg_user", "pg_pass", "pg_db")

# Known CS2 updates that hard-broke all older demos. Each entry:
# (cutoff_datetime, label, description). A demo recorded BEFORE a cutoff is
# incompatible with any CS2 version released ON OR AFTER that cutoff. Sorted
# newest-first so the most recent breaking update matches first. Ported
# verbatim from `_CS2_DEMO_BREAKS` in csdm_batch_clips_generator.py -- pure
# data plus a datetime comparison, so it belongs here, not behind Tkinter.
_CS2_DEMO_BREAKS = [
    (
        datetime(2025, 7, 28),
        "AnimGraph2",
        "Valve's AnimGraph2 engine update (Jul 28 2025) made all older demos "
        "incompatible. You need CS2 <= 1.40.8.8 (Steam beta depot) to replay them.",
    ),
    (
        datetime(2024, 2, 6),
        "Feb 2024 update",
        "The February 6 2024 major update changed the demo file format. "
        "Demos recorded before this date cannot be replayed on current CS2.",
    ),
]


class EngineMixin:
    """The engine half of App. See module docstring for the three sockets."""

    # ── Map-column detection ────────────────────────────────────────────────────
    # CSDM stores map_name in the `demos` table (not `matches`).
    # If a future version moves it back to `matches`, the candidates list handles it.
    # Returns (col, alias, join_sql) where:
    #   col      — column name,  e.g. "map_name"
    #   alias    — SQL table alias to prefix the column ("m" for matches, "d" for demos)
    #   join_sql — extra JOIN clause to append to FROM, or "" if the col is in matches
    _MAP_COL_CANDIDATES = ("map_name", "game_map", "map", "level_name", "server_map")

    # Optional set of clips a batch run is restricted to, as {demo_path: [start_tick, ...]}.
    # None means "no restriction" (backward compatible). Set by start_run, read by _worker,
    # cleared when a run ends.
    _selected_clips = None

    @staticmethod
    def _detect_map_col(schema):
        """Return (col, alias, join_sql) for the map-name column, or (None, "m", "")."""
        matches_cols = schema.get("matches", [])
        demos_cols   = schema.get("demos",   [])

        # 1. Try matches directly (col present in matches table)
        for c in EngineMixin._MAP_COL_CANDIDATES:
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
                for c in EngineMixin._MAP_COL_CANDIDATES:
                    if c in demos_cols:
                        return c, "d", join_sql
                fallback_d = next((c for c in demos_cols if "map" in c.lower()), None)
                if fallback_d:
                    return fallback_d, "d", join_sql

        return None, "m", ""

    def discover_database(self):
        """Read the CSDM schema and everything the screens need to offer choices.

        Blocking and windowless: the caller owns the thread. Returns a plain dict;
        nothing here touches a widget, a port, or an event loop.
        """
        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                schema = {}
                col_types = {}
                for t in DISCOVERY_TABLES:
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

                # Candidate columns: date/timestamp type, OR bigint with date-like name,
                # OR text with 'date'/'time' in name
                _candidates = []
                for c in _m_cols:
                    t = _m_types.get(c, "").lower()
                    clow = c.lower()
                    if t in DISCOVERY_DATE_TYPES:
                        _candidates.append(c)
                    elif any(it in t for it in DISCOVERY_INT_TYPES) and (
                            "date" in clow or "time" in clow or "played" in clow):
                        _candidates.append(c)
                    elif "text" in t and ("date" in clow or "time" in clow):
                        _candidates.append(c)

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
                    penalty = DISCOVERY_SUSPECT_PENALTY if any(
                        s in c.lower() for s in DISCOVERY_SUSPECT_NAMES) else 0
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
                maps_found: list = []
                _mc, _ma, _mj = self._detect_map_col(schema)
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
                            for _pfx in MAP_NAME_PREFIXES:
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
        return {
            "players": players,
            "names": names,
            "date_col": dc,
            "date_col_type": dc_type,
            "weapons": weapons,
            "schema": schema,
            "col_types": col_types,
            "tags": tags_data,
            "tags_schema": tags_schema_info,
            "match_types": match_types_found,
            "maps": maps_found,
            "map_col": _mc,
            "map_alias": _ma,
            "map_join": _mj,
        }

    @staticmethod
    def _json_scalar(value):
        """Reduce one database scalar to something json.dumps accepts as-is."""
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (_dt.datetime, _dt.date)):
            return value.isoformat()
        return str(value)

    def discovery_to_json(self, data):
        """Return a discovery result the JSON pipe can carry unchanged.

        Only shapes and scalar types change. No key is added, removed or renamed:
        the renderer reads the same contract discover_database documents.
        """
        scalar = self._json_scalar
        return {
            **data,
            "players": [[label, sid, name, scalar(seen)]
                        for label, sid, name, seen in data["players"]],
            "tags": [[scalar(tag_id), name, color]
                     for tag_id, name, color in data["tags"]],
            "maps": [[display, list(raw)] for display, raw in data["maps"]],
            "tags_schema": {k: scalar(v) if not isinstance(v, (dict, list)) else v
                            for k, v in data["tags_schema"].items()},
        }

    def apply_discovery(self, data):
        """Adopt a discovery result as this host's live database state.

        Split from discover_database on purpose: a host may want the data
        without adopting it (a connection test), and adopting it must not
        require a server.
        """
        self._date_col       = data["date_col"]
        self._date_col_type  = data["date_col_type"]
        self._db_schema      = data["schema"]
        self._db_col_types   = data["col_types"]
        self._player_names   = data["names"]
        self._tags_list      = data["tags"]
        self._tags_schema    = data["tags_schema"]
        self._db_match_types = data["match_types"] or []
        self._db_maps        = data["maps"] or []
        self._map_col        = data["map_col"]
        self._map_alias      = data["map_alias"]
        self._map_join       = data["map_join"]

        # Every cache below is keyed by the connection we just replaced.
        self._demo_checksums = {}
        self._demo_dates     = {}
        self._demo_map_cache = {}
        self._ts_cache       = {}
        self._col_cache      = {}
        self._warned_missing_mods = set()
        self._warned_require_win_no_data = False

        if not data["date_col"]:
            self.log("Date column not detected in matches — the date filter is off", "warn")

    def _host_cfg(self, key):
        """Read one setting from the host's config, falling back to the default.

        Engine methods normally receive the run config as an argument. These
        settings belong to no run: they describe how the host watches the
        machine, so they are read from the host itself. A host that carries no
        config at all (the bridge, today) still gets the shipped default.
        """
        cfg = getattr(self, "cfg", None) or {}
        return cfg.get(key, DEFAULT_CONFIG[key])

    def _await_process_exit(self, name, probe=None):
        """Block until `name` is gone, then announce it. Returns False on timeout.

        The wait is OPEN, not a countdown: the interface stages a charge that
        keeps beeping while this returns nothing, and detonates only on the
        event below. A timer here would let the animation lie about the real
        state (D17, D18).

        `probe` is a seam for tests; production uses the real task list.
        """
        look = probe or process_is_running
        timeout = self._host_cfg("process_exit_timeout")
        interval = self._host_cfg("process_exit_poll_interval")
        deadline = time.time() + timeout
        while True:
            if not look(name):
                self.state("process_exited", {"name": name})
                return True
            if time.time() >= deadline:
                break
            time.sleep(interval)
        self.log(f"  ⚠ {name} did not exit within {int(timeout)}s", "warn")
        return False

    def set_pg_params(self, params):
        """Adopt the five PostgreSQL identifiers `_pg`/`_pg_fresh` read from `_pg_params`.

        Any host (bridge, Tkinter, tests) can call this instead of poking
        `_pg_params` directly. Validates all five keys are present *before*
        anything touches the network, so a caller gets one readable sentence
        instead of a bare `KeyError` surfacing from inside `psycopg2.connect`.
        `pg_pass` legitimately may be an empty string -- only an absent key
        counts as missing, never an empty value.
        """
        missing = [k for k in PG_PARAM_KEYS if k not in params]
        if missing:
            raise ValueError(
                "Missing database connection setting(s): " + ", ".join(missing) +
                ". Check pg_host, pg_port, pg_user, pg_pass and pg_db.")
        self._pg_params = {k: params[k] for k in PG_PARAM_KEYS}

    def _pg_connect(self):
        """Open one new psycopg2 connection from `_pg_params`, or raise a readable error.

        Two failure modes, both turned into one actionable English sentence
        instead of a raw KeyError repr or the full driver traceback:
        parameters missing/unusable, and the server refusing or timing out
        the connection (`psycopg2.OperationalError`).
        """
        missing = [k for k in PG_PARAM_KEYS if k not in self._pg_params]
        if missing:
            raise ValueError(
                "Missing database connection setting(s): " + ", ".join(missing) +
                ". Connect to the database (set pg_host, pg_port, pg_user, "
                "pg_pass, pg_db) before running a discovery.")
        p = self._pg_params
        try:
            port = int(p["pg_port"])
        except (TypeError, ValueError):
            raise ValueError(
                f"The database port {p['pg_port']!r} is not a number. "
                "Check pg_port in the configuration.") from None
        try:
            return psycopg2.connect(
                host=p["pg_host"], port=port, user=p["pg_user"],
                password=p["pg_pass"], dbname=p["pg_db"], connect_timeout=5)
        except psycopg2.OperationalError as exc:
            reason = next((ln for ln in str(exc).splitlines() if ln.strip()),
                          "connection refused")
            raise ConnectionError(
                f"Could not connect to PostgreSQL at {p['pg_host']}:{p['pg_port']} "
                f"(database '{p['pg_db']}'): {reason}") from exc

    def _pg(self):
        """Return a live psycopg2 connection, reusing the existing one when possible.
        Creates a new connection on first call or if the existing one is closed/broken.
        The _connect_and_load thread always opens its own connection (thread safety).
        """
        if self._db_conn is not None:
            try:
                # Quick liveness check — closed attribute is False when open
                if not self._db_conn.closed:
                    return self._db_conn
            except Exception:
                pass
        self._db_conn = self._pg_connect()
        return self._db_conn

    def _pg_fresh(self):
        """Always create a new connection (used by background threads that must
        not share the main-thread connection)."""
        return self._pg_connect()

    def _resolve_cli(self, p):
        if not p:
            return "csdm"
        p = os.path.abspath(p)
        b = os.path.basename(p).lower()
        d = os.path.dirname(p)
        if b in ("csdm.exe", "csdm.cmd") and os.path.isfile(p):
            return p
        for n in ("csdm.CMD", "csdm.cmd", "csdm.exe"):
            for sd in (d, os.path.join(d, "resources")):
                c = os.path.join(sd, n)
                if os.path.exists(c):
                    return c
        w = shutil.which("csdm")
        return w if w else p

    def _find_col(self, table, candidates):
        key = (table, tuple(candidates))
        if key in self._col_cache:
            return self._col_cache[key]
        cols = self._db_schema.get(table, [])
        result = None
        for c in candidates:
            if c in cols:
                result = c
                break
        self._col_cache[key] = result
        return result

    # ── _query_events helpers (Phase 1.3 — one clause builder per concern) ──

    @staticmethod
    def _qe_epoch_bounds(cfg):
        """Epoch bounds (ts_from, ts_to) for the post-query Python date filter."""
        ts_from = None
        ts_to   = None
        if cfg.get("date_from", ""):
            try:
                ts_from = int(datetime.strptime(cfg["date_from"], "%Y-%m-%d")
                              .replace(hour=0, minute=0, second=0).timestamp())
            except ValueError:
                pass
        if cfg.get("date_to", ""):
            try:
                ts_to = int((datetime.strptime(cfg["date_to"], "%Y-%m-%d")
                             .replace(hour=23, minute=59, second=59)).timestamp())
            except ValueError:
                pass
        return ts_from, ts_to

    def _qe_match_type_sql(self, cfg):
        """Match-type WHERE fragment: "" or (clause_str, [param values])."""
        if not cfg.get("match_type_filter_enabled"):
            return ""
        _gm_col = self._find_col("matches", ["game_mode_str", "game_mode"])
        if not _gm_col:
            self.log("⚠ Match type filter: game_mode_str column not found — filter ignored.", "warn")
            return ""
        selected_db_vals = [
            db_v
            for cfg_k in _MATCH_TYPE_CFG_KEYS
            if cfg.get(cfg_k)
            for db_v in _MATCH_TYPE_KEY_TO_DB[cfg_k]
        ]
        if not selected_db_vals:
            return ""  # none checked = no filter
        ph = ",".join(["%s"] * len(selected_db_vals))
        return (f' AND m."{_gm_col}" IN ({ph})', selected_db_vals)

    def _qe_headshot_sql(self, cfg):
        """Headshot WHERE fragment. Returns (hs_col, clause)."""
        _hsmode = cfg.get("headshots_mode", "all")
        headshots_only    = (_hsmode == "only")
        headshots_exclude = (_hsmode == "exclude")
        hc = self._find_col("kills", ["is_headshot", "headshot", "is_hs", "hs"])
        hsql = ""
        if (headshots_only or headshots_exclude) and not hc:
            self.log("⚠ Headshots filter: column not found in kills — filter ignored.", "warn")
        elif headshots_only and hc:
            hsql = f' AND k."{hc}" = TRUE'
        elif headshots_exclude and hc:
            hsql = f' AND k."{hc}" = FALSE'

        # One Tap kills are by definition headshots — force HS filter at SQL level
        if cfg.get("kill_mod_one_tap") and hc and not headshots_exclude and not headshots_only:
            hsql = f' AND k."{hc}" = TRUE'
        elif cfg.get("kill_mod_one_tap") and not hc:
            self.log("⚠ One Tap: headshot column not found — HS enforcement skipped.", "warn")
        return hc, hsql

    def _qe_teamkill_sql(self, cfg):
        """Teamkill include/exclude/only WHERE fragment.

        DEPRECATED (events-beyond-kill, Task 5): superseded by
        `_build_team_filter_sql`. The legacy `teamkills_mode` key is migrated
        to the 2-axis `event_ally` / `event_enemy` keys in `_migrate_config`,
        so this helper is no longer referenced by the query path. Kept for
        backward compatibility with old callers/tests until they are removed.
        """
        _tkmode = cfg.get("teamkills_mode", "include")
        include_teamkills = (_tkmode != "exclude")
        teamkills_only    = (_tkmode == "only")
        tkc_k = self._find_col("kills", ["killer_team_name", "killer_side", "killer_team"])
        tkc_v = self._find_col("kills", ["victim_team_name", "victim_side", "victim_team"])
        if teamkills_only:
            if tkc_k and tkc_v:
                return f' AND k."{tkc_k}" = k."{tkc_v}"'
            self.log("⚠ Teamkills only: team columns not found — filter ignored.", "warn")
        elif not include_teamkills:
            if tkc_k and tkc_v:
                return f' AND k."{tkc_k}" != k."{tkc_v}"'
            self.log("⚠ Exclude teamkills: team columns not found — filter ignored.", "warn")
        return ""

    def _build_team_filter_sql(self, cfg, table_alias, params_list, table="kills"):
        """Build SQL clause filtering by team relationship.

        Replaces the legacy `teamkills_mode` handling. Reads the 2-axis
        `_events_ally` / `_events_enemy` derived flags (falling back to the
        raw `event_ally` / `event_enemy` keys) and returns a WHERE fragment
        comparing the table's attacker/victim team-name columns.

        Returns (clause_sql, needs_team_cols):
          - clause_sql: "" when no filter applies, " AND 1=0" when both ally
            and enemy are excluded (match nothing), or " AND <alias>.<at> =
            <alias>.<vt>" / "!= " when exactly one side is enabled.
          - needs_team_cols: True only when the clause actually depends on the
            attacker/victim team columns (so a caller may warn on absence).

        `params_list` is accepted for signature parity with the other
        `_qe_*`/`_build_*` clause builders; team filtering compares two
        columns, so it appends no bound values.
        """
        ally = cfg.get("_events_ally", cfg.get("event_ally", False))
        enemy = cfg.get("_events_enemy", cfg.get("event_enemy", True))

        if ally and enemy:
            return "", False  # no filter — include all
        if not ally and not enemy:
            return " AND 1=0", False  # exclude all

        at_col = self._find_col(table, ["attacker_team_name", "attacker_team"])
        vt_col = self._find_col(table, ["victim_team_name", "victim_team"])
        if not at_col or not vt_col:
            return "", False  # can't filter without team columns

        if ally and not enemy:
            return f' AND {table_alias}."{at_col}" = {table_alias}."{vt_col}"', True
        else:  # enemy only
            return f' AND {table_alias}."{at_col}" != {table_alias}."{vt_col}"', True

    _SQL_MOD_KEYS = (
        "kill_mod_through_smoke",
        "kill_mod_no_scope",
        "kill_mod_assisted_flash",
    )

    def _mods_dp2_global_any_union_enabled(self, cfg):
        if cfg.get("kill_mod_logic_mods", "any") != "any":
            return False
        if cfg.get("kill_mod_logic_dp2", "any") != "any":
            return False
        if not any(cfg.get(k) for k in self._SQL_MOD_KEYS):
            return False
        if cfg.get("kill_mod_trois_tap"):
            return False
        return any(cfg.get(k) for k, *_ in self._DP2_FILTER_DEFS)

    @staticmethod
    def _qe_suicide_sql(cfg, weapon_col):
        """Suicide WHERE fragment (params = SUICIDE_WEAPONS appended by caller)."""
        _sm = cfg.get("suicides_mode", "include")
        if _sm == "include" or not weapon_col:
            return ""
        ph = ",".join(["%s"] * len(SUICIDE_WEAPONS))
        if _sm == "exclude":
            return f' AND k."{weapon_col}" NOT IN ({ph})'
        if _sm == "only":
            return f' AND k."{weapon_col}" IN ({ph})'
        return ""

    @staticmethod
    def _mod_sql_expr(mod_key, col, positive=True):
        """SQL expression for one mod column.
        penetrated_objects is an integer — use > 0 / = 0.
        All other mod columns are boolean — use = TRUE / IS NOT TRUE.
        """
        if mod_key == "kill_mod_wall_bang" and col == "penetrated_objects":
            if positive:
                return f'k."{col}" > 0'
            return f'(k."{col}" IS NULL OR k."{col}" = 0)'
        if positive:
            return f'k."{col}" = TRUE'
        return f'k."{col}" IS NOT TRUE'

    def _qe_mod_sql(self, cfg):
        """SQL-mod filter fragment.

        Returns (modsql, active_mods, return_empty) — return_empty is True when
        every checked modifier is absent from the DB and no dp2 OR-union can
        rescue the query (caller must return no results rather than all clips).
        """
        _MOD_COLS = KILL_FILTER_SQL_COLS  # derived from KILL_FILTER_REGISTRY
        active_mods   = [k for k in _MOD_COLS if cfg.get(k, False)]
        excluded_mods = [k for k in _MOD_COLS if cfg.get(f"{k}_exclude", False)]
        modsql = ""
        _mods_dp2_or_any = self._mods_dp2_global_any_union_enabled(cfg)

        # Build exclusion SQL first — these are always AND NOT
        excl_clauses = []
        for mod_key in excluded_mods:
            col = self._find_col("kills", _MOD_COLS[mod_key])
            if col:
                excl_clauses.append(self._mod_sql_expr(mod_key, col, positive=False))
        excl_sql = (" AND " + " AND ".join(excl_clauses)) if excl_clauses else ""

        if active_mods:
            mod_clauses = []
            missing_mods = []
            for mod_key in active_mods:
                col = self._find_col("kills", _MOD_COLS[mod_key])
                if col:
                    mod_clauses.append(self._mod_sql_expr(mod_key, col, positive=True))
                else:
                    missing_mods.append(mod_key)
            if missing_mods:
                missing_set = frozenset(missing_mods)
                if not mod_clauses:
                    # All checked modifiers absent from DB →
                    # cannot filter, return empty rather than all clips
                    if missing_set != self._warned_missing_mods:
                        missing_labels = ", ".join(
                            m.replace("kill_mod_", "").replace("_", " ")
                            for m in missing_mods)
                        self.log(
                            f"⛔ Modifiers not found in DB: {missing_labels}. "
                            f"No clips returned — uncheck these modifiers or check the schema.",
                            "err")
                        self._warned_missing_mods = missing_set
                    if not _mods_dp2_or_any:
                        return "", active_mods, True
                else:
                    # Some columns absent — warn once per unique missing set
                    if missing_set != self._warned_missing_mods:
                        missing_labels = ", ".join(
                            m.replace("kill_mod_", "").replace("_", " ")
                            for m in missing_mods)
                        self.log(
                            f"⚠ Modifiers not found in DB: {missing_labels} — ignored. "
                            f"Only the others are applied.",
                            "warn")
                        self._warned_missing_mods = missing_set
            if mod_clauses:
                if not _mods_dp2_or_any:
                    _mods_logic = cfg.get("kill_mod_logic_mods", "any")
                    if _mods_logic == "all":
                        modsql = " AND (" + " AND ".join(mod_clauses) + ")"
                    elif _mods_logic == "mixed":
                        _key_clause = []
                        _mi = 0
                        for mod_key in active_mods:
                            col = self._find_col("kills", _MOD_COLS[mod_key])
                            if col:
                                _key_clause.append((mod_key, mod_clauses[_mi]))
                                _mi += 1
                        req_clauses = [c for k, c in _key_clause if cfg.get(f"{k}_req", False)]
                        if req_clauses:
                            modsql = " AND (" + " AND ".join(req_clauses) + ")"
                    else:
                        modsql = " AND (" + " OR ".join(mod_clauses) + ")"

        modsql += excl_sql   # excluded mods are always AND NOT, appended last
        return modsql, active_mods, False

    def _qe_detect_date_col(self):
        """Return the matches date column, auto-detecting and caching it once."""
        date_col = self._date_col
        if date_col or not self._db_schema.get("matches"):
            return date_col
        _m_types = self._db_col_types.get("matches", {})
        _DATE_TYPES = {
            "date", "timestamp", "timestamp with time zone",
            "timestamp without time zone", "timestamptz",
        }
        date_col = next(
            (c for c, t in _m_types.items() if t.lower() in _DATE_TYPES), None)
        if not date_col:
            _HINTS = ("played_at","match_date","game_date","start_date",
                      "started_at","date","match_timestamp")
            date_col = next(
                (c for c in self._db_schema["matches"] if c.lower() in _HINTS), None)
        if not date_col:
            date_col = next(
                (c for c in self._db_schema["matches"]
                 if "date" in c.lower() and "analyze" not in c.lower()), None)
        if date_col:
            self._date_col      = date_col
            self._date_col_type = _m_types.get(date_col, "").lower()
        return date_col

    def _qe_map_filter_sql(self, cfg):
        """Map-filter WHERE fragment. Returns (clause, raw DB values as params)."""
        _mf_raw: list = []
        if cfg.get("map_filter_enabled") and self._map_col:
            _mf_sel = set(cfg.get("map_filter", []))
            if _mf_sel:
                _mf_raw = [rv for dk, rvs in self._db_maps for rv in rvs if dk in _mf_sel]
                if _mf_raw:
                    return (f' AND {self._map_alias}."{self._map_col}" IN '
                            f'({",".join(["%s"]*len(_mf_raw))})'), _mf_raw
        return "", _mf_raw

    def _query_events(self, cfg):
        sids = self._get_sids(cfg)
        if not sids:
            return {}

        ts_from, ts_to = self._qe_epoch_bounds(cfg)

        def _demo_passes_date_filter(demo_path):
            if ts_from is None and ts_to is None:
                return True
            ts = self._get_demo_ts(demo_path)
            if ts is None:
                return False  # unknown date + active filter → exclude
            if ts_from is not None and ts < ts_from:
                return False
            if ts_to is not None and ts > ts_to:
                return False
            return True

        conn = self._pg()
        results = {}
        try:
            with conn.cursor() as cur:
                tc = self._find_col("kills", ["tick", "killer_tick", "round_tick"])
                # Victim death tick — for grenades/molotov where the DB tick
                # is the throw but death occurs later
                dtc = self._find_col("kills", ["victim_death_tick", "death_tick",
                                                "killed_tick", "victim_tick"])
                dc = self._find_col("matches",
                                    ["demo_path", "demo_file_path", "demo_filepath", "share_code"])
                mkk = self._find_col("kills", ["match_checksum", "match_id", "checksum"])
                mkm = self._find_col("matches", ["checksum", "id", "match_id"])
                kc = self._find_col("kills", ["killer_steam_id", "attacker_steam_id"])
                vc = self._find_col("kills", ["victim_steam_id", "killed_steam_id"])
                wc = self._find_col("kills", ["weapon_name", "weapon", "weapon_type"])
                if not vc:
                    for c in self._db_schema.get("kills", []):
                        if "victim" in c.lower() and "steam" in c.lower():
                            vc = c
                            break
                if not dc:
                    raise Exception("Demo path column not found")
                if not mkk or not mkm:
                    raise Exception("kills<->matches join column not found")

                kills_on  = cfg.get("events_kills",  False)
                deaths_on = cfg.get("events_deaths", False)
                weapons   = cfg.get("weapons", [])

                # ── WHERE fragments, one named builder per concern (Phase 1.3) ─
                mtsql       = self._qe_match_type_sql(cfg)
                hc, hsql    = self._qe_headshot_sql(cfg)
                tksql       = self._build_team_filter_sql(cfg, "k", [], table="kills")[0]
                suicidesql  = self._qe_suicide_sql(cfg, wc)
                modsql, active_mods, _mods_empty = self._qe_mod_sql(cfg)
                if _mods_empty:
                    return {}
                headshots_only = (cfg.get("headshots_mode", "all") == "only")
                _MOD_COLS = KILL_FILTER_SQL_COLS

                date_col = self._qe_detect_date_col()

                # ── Build SELECT (map_sel uses _map_col detected at connect time) ──────
                _mf_sql, _mf_raw = self._qe_map_filter_sql(cfg)

                # Empty _build_dsql: date filter applied in Python post-query
                def _build_dsql(base_params):
                    return ""

                if (kills_on or deaths_on) and tc and kc:
                    # Build the player clause for N SIDs
                    sid_ph = ",".join(["%s"] * len(sids))
                    per_sid_conds = []
                    per_sid_params = []
                    if kills_on:
                        per_sid_conds.append(f'k."{kc}" IN ({sid_ph})')
                        per_sid_params.extend(sids)
                    if deaths_on and vc:
                        per_sid_conds.append(f'k."{vc}" IN ({sid_ph})')
                        per_sid_params.extend(sids)
                    psql = "(" + " OR ".join(per_sid_conds) + ")"

                    params = per_sid_params[:]
                    wsql = ""
                    if weapons and wc:
                        wsql = f' AND k."{wc}" IN ({",".join(["%s"] * len(weapons))})'
                        params.extend(weapons)
                    # Unpack match type filter: mtsql is either "" or (clause_str, [values])
                    _mt_clause = ""
                    if isinstance(mtsql, tuple):
                        _mt_clause, _mt_vals = mtsql
                        params.extend(_mt_vals)
                    dsql = _build_dsql(params)

                    extra, enames = "", []
                    if kc:
                        extra += f',k."{kc}"'
                        enames.append("k")
                    if vc:
                        extra += f',k."{vc}"'
                        enames.append("v")
                    if wc:
                        extra += f',k."{wc}"'
                        enames.append("w")
                    if dtc:
                        extra += f',k."{dtc}"'
                        enames.append("dt")

                    # Victim weapon — only needed for Eco-Frag detection.
                    # Fetched once here so _apply_db_postfilters can compare vs full-buy weapons.
                    _vwc = None
                    if cfg.get("kill_mod_eco_frag"):
                        _vwc = self._find_col("kills", ["victim_weapon_name", "victim_weapon",
                                                         "killed_with", "weapon_victim"])
                        if _vwc:
                            extra += f',k."{_vwc}"'
                            enames.append("vw")

                    # Fetch each resolved SQL-mod boolean column so we can tag
                    # _mf (matched filters) precisely per event row.
                    # _mod_extra: list of (cfg_key, col_name) for resolved active mods
                    _mod_extra: list = []
                    for mod_key in active_mods:
                        col = self._find_col("kills", _MOD_COLS[mod_key])
                        if col:
                            extra += f',k."{col}"'
                            enames.append(f"_mod_{mod_key}")
                            _mod_extra.append((mod_key, f"_mod_{mod_key}"))
                    # headshots_mode tag key — fetched if hc is available
                    if headshots_only and hc:
                        extra += f',k."{hc}"'
                        enames.append("_hs")

                    date_sel = f',m."{date_col}"' if date_col else ""
                    map_sel  = f',{self._map_alias}."{self._map_col}"' if self._map_col else ""
                    sql = (f'SELECT m."{dc}",k."{tc}",m."{mkm}"{date_sel}{map_sel}{extra} FROM kills k '
                           f'JOIN matches m ON m."{mkm}"=k."{mkk}" {self._map_join} '
                           f'WHERE {psql}{wsql}{hsql}{tksql}{suicidesql}{modsql}{_mt_clause}{_mf_sql}{dsql} ORDER BY m."{dc}",k."{tc}"')
                    if suicidesql:
                        params = params + list(SUICIDE_WEAPONS)
                    if _mf_raw:
                        params = params + _mf_raw
                    cur.execute(sql, params)
                    sids_set = set(sids)
                    for row in cur.fetchall():
                        dp, tick, chk = row[0], row[1], row[2]
                        if not dp or tick is None:
                            continue
                        if chk and dp not in self._demo_checksums:
                            self._demo_checksums[dp] = chk
                        if date_col and dp not in self._demo_dates:
                            raw_date = row[3] if len(row) > 3 else None
                            if raw_date is not None:
                                self._demo_dates[dp] = raw_date
                        if self._map_col and dp not in self._demo_map_cache:
                            map_row_idx = 3 + (1 if date_col else 0)
                            if map_row_idx < len(row) and row[map_row_idx]:
                                raw_map = str(row[map_row_idx]).strip()
                                # Strip common prefixes like "de_", "cs_", "ar_"
                                self._demo_map_cache[dp] = raw_map
                        extra_offset = 3 + (1 if date_col else 0) + (1 if self._map_col else 0)
                        ex = {}
                        for ci, cn in enumerate(enames):
                            if extra_offset + ci < len(row):
                                ex[cn] = row[extra_offset + ci]
                        killer_sid = ex.get("k", "")
                        victim_sid = ex.get("v", "")
                        weapon_raw = ex.get("w", "") or ""

                        death_tick = ex.get("dt")
                        if (death_tick is not None
                                and weapon_raw.lower() in DELAYED_EFFECT_WEAPONS):
                            event_tick = int(death_tick)
                        else:
                            event_tick = int(tick)

                        et = "kill" if killer_sid in sids_set else (
                             "death" if victim_sid in sids_set else "kill")
                        if et == "kill" and not kills_on:
                            continue
                        if et == "death" and not deaths_on:
                            continue

                        # Build _mf: set of cfg_key strings that matched for this row
                        _mf: set = set()
                        for mod_key, en in _mod_extra:
                            if ex.get(en):
                                _mf.add(mod_key)
                        if headshots_only and ex.get("_hs"):
                            _mf.add("headshots_mode")

                        evt = {"tick": event_tick, "type": et, "weapon": weapon_raw,
                               "killer_sid": killer_sid, "victim_sid": victim_sid}
                        if _vwc and ex.get("vw"):
                            evt["victim_weapon"] = str(ex["vw"]).lower().strip()
                        if _mf:
                            evt["_mf"] = _mf
                        results.setdefault(dp, []).append(evt)

                if cfg.get("events_rounds") and self._db_schema.get("rounds"):
                    rtc = self._find_col("rounds",
                                         ["start_tick", "freeze_time_end_tick", "tick", "end_tick"])
                    rmk = self._find_col("rounds", ["match_checksum", "match_id", "checksum"])
                    pmk = self._find_col("players", ["match_checksum", "match_id"])
                    if rtc and rmk and pmk:
                        sid_ph = ",".join(["%s"] * len(sids))
                        params = list(sids)
                        # Inject match type filter params for rounds query too
                        _mt_clause_r = ""
                        if isinstance(mtsql, tuple):
                            _mt_clause_r, _mt_vals_r = mtsql
                            params.extend(_mt_vals_r)
                        dsql = _build_dsql(params)
                        date_sel2 = f',m."{date_col}"' if date_col else ""
                        map_sel2  = f',{self._map_alias}."{self._map_col}"' if self._map_col else ""
                        if _mf_raw:
                            params.extend(_mf_raw)
                        sql = (f'SELECT m."{dc}",r."{rtc}",m."{mkm}"{date_sel2}{map_sel2} FROM rounds r '
                               f'JOIN matches m ON m."{mkm}"=r."{rmk}" {self._map_join} '
                               f'WHERE r."{rmk}" IN '
                               f'(SELECT p."{pmk}" FROM players p WHERE p.steam_id IN ({sid_ph}))'
                               f'{_mt_clause_r}{_mf_sql}{dsql} ORDER BY m."{dc}",r."{rtc}"')
                        try:
                            cur.execute(sql, params)
                            for row in cur.fetchall():
                                dp, tick = row[0], row[1]
                                chk = row[2] if len(row) > 2 else None
                                if dp and tick is not None:
                                    if chk and dp not in self._demo_checksums:
                                        self._demo_checksums[dp] = chk
                                    if date_col and dp not in self._demo_dates and len(row) > 3:
                                        if row[3] is not None:
                                            self._demo_dates[dp] = row[3]
                                    if self._map_col and dp not in self._demo_map_cache:
                                        map_idx = 3 + (1 if date_col else 0)
                                        if map_idx < len(row) and row[map_idx]:
                                            self._demo_map_cache[dp] = str(row[map_idx]).strip()
                                    results.setdefault(dp, []).append(
                                        {"tick": int(tick), "type": "round", "weapon": ""})
                        except Exception:
                            pass

            # ── Non-lethal damage events ──
            self._query_damages(cfg, sids, conn, results)

            # ── "Other" events (shots, jumps, etc.) ──
            self._query_shots(cfg, sids, conn, results)

            # ── Shared modifier layer: tag non-kill events with _mf ──
            # Evaluates active kill modifiers (headshot, no-scope, airborne, …)
            # on the just-produced damage / shot / round events. Uses the
            # lazily-loaded player_positions frames when a modifier needs them.
            self._apply_shared_modifiers(cfg, results)

        finally:
            pass  # persistent connection — kept open for reuse

        # Applied here rather than SQL because the DB column often contains
        # the import date and not the actual match date.
        if ts_from is not None or ts_to is not None:
            results = {
                dp: evts_val for dp, evts_val in results.items()
                if _demo_passes_date_filter(dp)
            }

        # ── DB post-query filters ──────────────────────────────────────────
        # These operate on the already-fetched results dict and require knowledge
        # of the full event context per demo (all rounds, all kills in match).
        results = self._apply_db_postfilters(cfg, results, sids)

        # ── Clutch filter ──────────────────────────────────────────────────
        if cfg.get("clutch_enabled") and results:
            demo_paths = set(results.keys())
            all_kills_by_demo = self._fetch_all_kills_for_demos(demo_paths)
            if all_kills_by_demo:
                results = self._apply_clutch_filter(results, sids, cfg, all_kills_by_demo)
            else:
                self.log(
                    "  ⚠ Clutch: could not fetch all-kills data — clutch filter skipped.",
                    "warn")

        return results

    def _query_damages(self, cfg, sids, conn, results):
        """Query the damages table for non-lethal damage events.

        Builds events of type 'damage_actor' (tracked player is the attacker)
        or 'damage_target' (tracked player is the victim) with attacker/victim
        SIDs, weapon, hitgroup, health_damage and armor_damage when the
        relevant columns exist. Applies the actor/target perspective and
        ally/enemy team filter like the kills query.
        """
        if not (cfg.get("_events_non_lethal") and self._db_schema.get("damages")):
            return

        dc = self._find_col("matches", ["demo_path", "demo_file_path", "share_code"])
        mkk = self._find_col("damages", ["match_checksum", "match_id"])
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        tc = self._find_col("damages", ["tick"])
        ak = self._find_col("damages", ["attacker_steam_id", "attacker_steamid"])
        vk = self._find_col("damages", ["victim_steam_id", "victim_steamid"])
        wc = self._find_col("damages", ["weapon_name", "weapon"])
        hg = self._find_col("damages", ["hitgroup"])
        hd = self._find_col("damages", ["health_damage", "hp_damage"])
        ad = self._find_col("damages", ["armor_damage"])

        if not all([dc, mkk, mkm, tc, ak, vk]):
            return

        sids_set = set(sids)
        actor_on = cfg.get("_events_actor", True)
        target_on = cfg.get("_events_target", False)

        with conn.cursor() as cur:
            extra = ""
            col_list = [f'm."{dc}"', f'd."{tc}"', f'd."{ak}"', f'd."{vk}"']
            if wc:
                extra += f',d."{wc}"'
                col_list.append(f'd."{wc}"')
            if hg:
                extra += f',d."{hg}"'
                col_list.append(f'd."{hg}"')
            if hd:
                extra += f',d."{hd}"'
                col_list.append(f'd."{hd}"')
            if ad:
                extra += f',d."{ad}"'
                col_list.append(f'd."{ad}"')

            sid_ph = ",".join(["%s"] * len(sids))
            conditions = []
            params = []

            # Actor perspective: attacker is a tracked player
            if actor_on:
                conditions.append(f'd."{ak}" IN ({sid_ph})')
                params.extend(sids)
            # Target perspective: victim is a tracked player
            if target_on:
                conditions.append(f'd."{vk}" IN ({sid_ph})')
                params.extend(sids)

            if not conditions:
                return

            # Ally/enemy team filter — shared helper, applied as an AND clause
            team_clause, _ = self._build_team_filter_sql(cfg, "d", params, table="damages")

            psql = "(" + " OR ".join(conditions) + ")"

            sql = (f'SELECT {",".join(col_list)}{extra} FROM damages d '
                   f'JOIN matches m ON m."{mkm}"=d."{mkk}" '
                   f'WHERE {psql}{team_clause} ORDER BY m."{dc}",d."{tc}"')
            cur.execute(sql, params)

            for row in cur.fetchall():
                dp, tick = row[0], row[1]
                if not dp or tick is None:
                    continue
                attacker_sid = str(row[2])
                victim_sid = str(row[3])

                et = "damage_actor" if attacker_sid in sids_set else "damage_target"
                evt = {"tick": int(tick), "type": et,
                       "attacker_sid": attacker_sid, "victim_sid": victim_sid}
                # Attach optional extra columns in the same order they were selected
                ci = 4
                if wc:
                    evt["weapon"] = str(row[ci] or "")
                    ci += 1
                if hg:
                    evt["hitgroup"] = row[ci]
                    ci += 1
                if hd:
                    evt["health_damage"] = row[ci]
                    ci += 1
                if ad:
                    evt["armor_damage"] = row[ci]
                    ci += 1

                results.setdefault(dp, []).append(evt)

    def _query_shots(self, cfg, sids, conn, results):
        """Query the shots table for "other" events (near-miss, void shots).

        Builds a 'shot' event per shot fired by a tracked player. A shot is
        inherently an actor action, so it only applies when the actor
        perspective is selected. Jump / knife-swing / grenade-miss refinement
        from player_positions is left to the shared modifier layer (Task 3);
        here we surface the raw shot stream with weapon when available.
        """
        if not (cfg.get("_events_other") and self._db_schema.get("shots")):
            return
        if not cfg.get("_events_actor", True):
            return

        dc = self._find_col("matches", ["demo_path", "demo_file_path",
                                        "demo_filepath", "share_code"])
        mkk = self._find_col("shots", ["match_checksum", "match_id", "checksum"])
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        tc = self._find_col("shots", ["tick"])
        pk = self._find_col("shots", ["player_steam_id", "attacker_steam_id",
                                      "shooter_steam_id", "steam_id"])
        wc = self._find_col("shots", ["weapon_name", "weapon", "weapon_type"])

        if not all([dc, mkk, mkm, tc, pk]):
            return

        sids_list = list(sids)
        with conn.cursor() as cur:
            sid_ph = ",".join(["%s"] * len(sids_list))
            extra = f',s."{wc}"' if wc else ""
            sql = (f'SELECT m."{dc}",s."{tc}",s."{pk}"{extra} FROM shots s '
                   f'JOIN matches m ON m."{mkm}"=s."{mkk}" '
                   f'WHERE s."{pk}" IN ({sid_ph}) ORDER BY m."{dc}",s."{tc}"')
            cur.execute(sql, sids_list)

            for row in cur.fetchall():
                dp, tick = row[0], row[1]
                if not dp or tick is None:
                    continue
                evt = {"tick": int(tick), "type": "shot", "attacker_sid": str(row[2])}
                if wc:
                    evt["weapon"] = str(row[3] or "")
                results.setdefault(dp, []).append(evt)

    # ── Shared modifier layer — evaluate kill modifiers on any event type ──

    @staticmethod
    def _event_category(etype):
        """Map an event type string to its category bucket.

        Categories match FilterDef.applicable_to:
          "kill"   → kill / death events
          "damage" → non-lethal damage events
          "shot"   → raw shot events
          "round"  → round events
        Anything unknown falls back to "kill" (safest — preserves old behaviour).
        """
        etype = etype or ""
        if etype.startswith("damage"):
            return "damage"
        if etype.startswith("shot"):
            return "shot"
        if etype.startswith("round"):
            return "round"
        return "kill"

    @staticmethod
    def _modifier_needs_positions(k):
        """True when a modifier key can only be evaluated from player_positions.

        Currently airborne (attacker in the air) and no-scope (unscoped sniper
        shot) derive their signal from per-tick player position data rather than
        a DB column on the event row.
        """
        return k in ("kill_mod_airborne", "kill_mod_no_scope")

    def _check_modifier(self, f, event, player_positions_df=None):
        """Evaluate a single FilterDef against one event dict.

        Returns True when the modifier's condition is met, False otherwise.
        Conservative: when the required data is missing the modifier does not
        match. Prefers DB columns carried on the event itself, and falls back to
        the optional player_positions frame for position-derived modifiers.
        """
        key = f.key

        # Position-derived modifiers — need the per-demo player_positions frame.
        if key == "kill_mod_airborne":
            return self._event_airborne(event, player_positions_df)
        if key == "kill_mod_no_scope":
            for col in (f.sql_cols or []):
                if event.get(col) is not None:
                    return bool(event.get(col))
            # No DB column carried on this non-kill event — no-scope can't be
            # proven from positions alone; treat as not matched.
            return False

        # SQL-column modifiers: honour candidate columns present on the event.
        for col in (f.sql_cols or []):
            if col in event and event[col]:
                return True
        return False

    def _event_airborne(self, event, positions_df):
        """True when the event's actor was airborne at the event tick.

        Reads the attacker's Z coordinate around the event tick from the
        per-demo player_positions frame. Airborne is inferred from a net
        vertical displacement across a short window (a grounded player keeps a
        roughly constant Z; a jumping player's Z changes).
        """
        tick = event.get("tick")
        sid = str(event.get("attacker_sid") or event.get("killer_sid") or "")
        if tick is None or not sid or positions_df is None or len(positions_df) == 0:
            return False

        cols = list(positions_df.columns)
        def _col(*names):
            low = {c: c.lower() for c in cols}
            for n in names:
                if n in cols:
                    return n
                if n in low:
                    return n
            return None

        col_sid = _col("player_steamid", "steamid", "player_steam_id")
        col_z = _col("z", "pos_z", "position_z")
        col_tick = _col("tick")
        if not col_sid or not col_z or not col_tick:
            return False

        try:
            sid_mask = positions_df[col_sid].astype(str) == sid
            sub = positions_df[sid_mask]
            if len(sub) == 0:
                return False
            idx = (sub[col_tick] - tick).abs().argsort()
            window = sub.iloc[idx[:5]].sort_values(col_tick)
            z = window[col_z].to_numpy(dtype=float)
            if len(z) >= 2:
                # Net vertical displacement across the window.
                if abs(float(z[-1]) - float(z[0])) > 8.0:
                    return True
        except Exception:
            return False
        return False

    def _evaluate_modifiers_for_event(self, cfg, event, player_positions_df=None):
        """Compute the _mf set of active modifiers that match a single event.

        Iterates KILL_FILTER_REGISTRY, skipping modifiers that are not active
        in cfg or whose applicable_to does not include this event's category.
        Returns a set of cfg_key strings (same _mf format used by kill events).
        """
        mf = set()
        category = self._event_category(event.get("type"))
        for f in KILL_FILTER_REGISTRY:
            if category not in f.applicable_to:
                continue
            key = f.key
            if not (cfg.get(key) or cfg.get(f"{key}_exclude")):
                continue
            if self._check_modifier(f, event, player_positions_df):
                mf.add(key)
        return mf

    def _apply_shared_modifiers(self, cfg, results):
        """Tag non-kill events with their _mf set using the shared modifier layer.

        Called after _query_damages / _query_shots have produced events. For
        each demo, the lazily-loaded player_positions frame is fetched from
        _player_positions_cache when any active modifier needs it. Kill events
        keep whatever _mf the main query already stamped on them.
        """
        active_needs_positions = any(
            self._modifier_needs_positions(f.key)
            for f in KILL_FILTER_REGISTRY
            if (cfg.get(f.key) or cfg.get(f"{f.key}_exclude"))
        )
        if not active_needs_positions:
            # No modifier needs positions — evaluate straight from event fields.
            for dp, events in results.items():
                for e in events:
                    if self._event_category(e.get("type")) == "kill":
                        continue
                    mf = self._evaluate_modifiers_for_event(cfg, e, None)
                    if mf:
                        e["_mf"] = (e.get("_mf") or set()) | mf
            return

        for dp, events in results.items():
            positions_df = self._player_positions_cache.get(dp)
            for e in events:
                if self._event_category(e.get("type")) == "kill":
                    continue
                mf = self._evaluate_modifiers_for_event(cfg, e, positions_df)
                if mf:
                    e["_mf"] = (e.get("_mf") or set()) | mf

    def _apply_db_postfilters(self, cfg, results, sids):
        """Apply DB-level post-query filters that require cross-round context.

        These cannot be expressed as simple SQL WHERE clauses on individual kill rows
        because they need information from the full round or match context:
        - Entry Frag: first kill of the round
        - Ace:        player kills all 5 opponents in one round
        - Multi-Kill: ≥N kills in one round within T seconds
        - BULLY:   same victim killed ≥N times across the match
        - Eco-Frag:   pistol vs full-buy (uses victim_weapon if available)

        Called after the main query and date filter — results is a dict
        {demo_path: [event_dict, ...]}. Returns a filtered copy.

        Logic mode (cfg["kill_mod_logic_db"]):
          "any" (default) — OR: a kill qualifies if it matches at least one active modifier.
          "all"           — AND: a kill must match every active modifier simultaneously.

        If none of the relevant modifiers are active, returns results unchanged.
        """
        do_entry   = cfg.get("kill_mod_entry_frag", False)
        do_ace     = cfg.get("kill_mod_ace", False)
        do_multi   = cfg.get("kill_mod_multi_kill", False)
        do_bul   = cfg.get("kill_mod_bully", False)
        do_eco     = cfg.get("kill_mod_eco_frag", False)

        # Exclude flags — these remove matching kills regardless of positive logic
        excl_entry = cfg.get("kill_mod_entry_frag_exclude", False)
        excl_ace   = cfg.get("kill_mod_ace_exclude",        False)
        excl_multi = cfg.get("kill_mod_multi_kill_exclude", False)
        excl_bul  = cfg.get("kill_mod_bully_exclude",   False)
        excl_eco   = cfg.get("kill_mod_eco_frag_exclude",   False)

        active_flags = [do_entry, do_ace, do_multi, do_bul, do_eco]
        excl_flags   = [excl_entry, excl_ace, excl_multi, excl_bul, excl_eco]
        if not any(active_flags) and not any(excl_flags):
            return results

        logic_and   = cfg.get("kill_mod_logic_db", "any") == "all"

        multi_n = max(2, int(cfg.get("kill_mod_multi_kill_n", 3)))
        multi_s = max(1, int(cfg.get("kill_mod_multi_kill_s", 12)))
        bul_n  = max(2, int(cfg.get("kill_mod_bully_n", 3)))

        # Pistols (lowercase suffixes) for Eco-Frag detection
        PISTOLS = {
            # deagle / r8
            "deagle","desert eagle","revolver","r8 revolver",
            # USP-S / P2000
            "usp_silencer","usp-s","hkp2000","p2000",
            # glock / p250 / fiveseven / tec9
            "glock","glock-18","p250","fiveseven","five-seven","tec9","tec-9",
            # cz75 / elite
            "cz75a","cz75-auto","elite","dual berettas","duals",
        }
        # Full-buy weapons (victim must have one of these for eco-frag to count)
        # Covers all CSDM weapon name variants: internal short name, display name, slug
        FULL_BUY = {
            # Rifles
            "ak47","ak-47",
            "m4a1","m4a1-s","m4a1_silencer",
            "m4a4",
            "galilar","galil ar","galil-ar",
            "famas",
            "sg556","sg 553","sg553",
            "aug",
            # Snipers
            "awp",
            "ssg08","ssg 08","ssg-08",
            "scar20","scar-20",
            "g3sg1",
            # LMGs
            "m249","negev",
        }

        # Weapon normalization cache (avoids repeated .lower().strip() in hot loops)
        _wpn_cache: dict = {}
        def _norm_wpn(w: str) -> str:
            r = _wpn_cache.get(w)
            if r is None:
                r = w.lower().strip()
                if r.startswith("weapon_"):
                    r = r[7:]
                _wpn_cache[w] = r
            return r

        sids_set = set(str(s) for s in sids)
        filtered = {}

        for dp, events in results.items():

            kill_events = [e for e in events if e.get("type") == "kill"]
            non_kill    = [e for e in events if e.get("type") != "kill"]

            if not kill_events:
                filtered[dp] = events
                continue

            # ── Group kills by (checksum, round_idx) for per-round analysis ─
            # round_idx is stored in the event dict as "round_idx" if available,
            # otherwise we use a tick-gap heuristic to approximate round boundaries.
            # Events come pre-sorted by tick from the SQL ORDER BY.
            def _round_key(e):
                ri = e.get("round_idx")
                if ri is not None:
                    return (e.get("_chk", ""), ri)
                # fallback: ~2-minute rounds ≈ 7680 ticks at 64tick
                return (e.get("_chk", ""), int(e["tick"]) // 7680)

            # Build per-round groups — only player's kills
            player_kills = [e for e in kill_events
                            if str(e.get("killer_sid", "")) in sids_set]

            # Precompute per-event killer_sid and signature tuple (avoids
            # rebuilding str(e.get("killer_sid","")) 5+ times per event)
            e_ksid: dict = {}  # id(e) → str(killer_sid)
            e_sig:  dict = {}  # id(e) → (tick, killer_sid_str)
            for e in kill_events:
                ks = str(e.get("killer_sid", ""))
                eid = id(e)
                e_ksid[eid] = ks
                e_sig[eid]  = (e["tick"], ks)

            round_groups: dict = {}
            for e in player_kills:
                rk = _round_key(e)
                round_groups.setdefault(rk, []).append(e)

            # All kills in demo (for BULLY: need all, not just player)
            all_kills_by_round: dict = {}
            for e in kill_events:
                rk = _round_key(e)
                all_kills_by_round.setdefault(rk, []).append(e)

            # ── Shared sig-set builders (DRY: used for both positive & exclusion) ─
            def _entry_sigs():
                s = set()
                for rk, r_kills in all_kills_by_round.items():
                    first_tick = min(e["tick"] for e in r_kills)
                    for e in r_kills:
                        if e["tick"] == first_tick and e_ksid[id(e)] in sids_set:
                            s.add(e_sig[id(e)])
                return s

            def _ace_sigs():
                s = set()
                for rk, r_kills in round_groups.items():
                    if len({str(e.get("victim_sid","")) for e in r_kills}) >= 5:
                        for e in r_kills:
                            s.add(e_sig[id(e)])
                return s

            _max_ticks = multi_s * int(cfg.get("tickrate", 64))
            def _multi_sigs():
                s = set()
                for rk, r_kills in round_groups.items():
                    if len(r_kills) < multi_n:
                        continue
                    r_sorted = sorted(r_kills, key=lambda e: e["tick"])
                    if r_sorted[-1]["tick"] - r_sorted[0]["tick"] <= _max_ticks:
                        for e in r_kills:
                            s.add(e_sig[id(e)])
                return s

            def _bully_sigs():
                pair_count = Counter()
                for e in kill_events:
                    ks = e_ksid[id(e)]
                    if ks in sids_set:
                        vs = str(e.get("victim_sid",""))
                        if vs:
                            pair_count[(ks, vs)] += 1
                pair_seen = Counter()
                s = set()
                for e in sorted(kill_events, key=lambda e: e["tick"]):
                    ks = e_ksid[id(e)]
                    if ks not in sids_set:
                        continue
                    vs = str(e.get("victim_sid",""))
                    pair_seen[(ks, vs)] += 1
                    if pair_count[(ks, vs)] >= bul_n and pair_seen[(ks, vs)] >= bul_n:
                        s.add((e["tick"], ks))
                return s

            def _eco_sigs():
                s = set()
                for e in player_kills:
                    kw = _norm_wpn(e.get("weapon") or "")
                    if kw not in PISTOLS:
                        continue
                    vw = _norm_wpn(e.get("victim_weapon") or "")
                    if not vw or vw in FULL_BUY:
                        s.add(e_sig[id(e)])
                return s

            _FILTER_BUILDERS = [
                ("kill_mod_entry_frag",  do_entry,  excl_entry, _entry_sigs),
                ("kill_mod_ace",         do_ace,    excl_ace,   _ace_sigs),
                ("kill_mod_multi_kill",  do_multi,  excl_multi, _multi_sigs),
                ("kill_mod_bully",       do_bul,    excl_bul,   _bully_sigs),
                ("kill_mod_eco_frag",    do_eco,    excl_eco,   _eco_sigs),
            ]

            # ── Positive modifier sigs ─────────────────────────────────────
            # Cache results so exclusion phase can reuse them
            _sig_cache: dict = {}
            per_mod_sigs: list = []
            for cfg_key, pos_flag, _exc, builder in _FILTER_BUILDERS:
                if pos_flag:
                    sigs = builder()
                    _sig_cache[cfg_key] = sigs
                    per_mod_sigs.append((cfg_key, sigs))

            # ── Combine per-modifier sets ──────────────────────────────────
            if not per_mod_sigs and not any(excl_flags):
                continue

            _all_kill_sigs = {e_sig[id(e)] for e in kill_events}

            if not per_mod_sigs:
                # Exclusion-only: start with all kill sigs, exclusions will strip below
                keep_sigs = set(_all_kill_sigs)
            else:
                logic_mode = cfg.get("kill_mod_logic_db", "any")
                if logic_mode == "mixed":
                    active_db_keys = [k for k, _ in per_mod_sigs]
                    req_keys, opt_keys = self._split_required_optional(cfg, active_db_keys)
                    req_sets = [s for k, s in per_mod_sigs if k in req_keys]
                    if req_sets:
                        req_sigs = req_sets[0].intersection(*req_sets[1:]) if len(req_sets) > 1 else set(req_sets[0])
                    else:
                        req_sigs = None
                    if req_sigs is not None:
                        keep_sigs = req_sigs
                    else:
                        keep_sigs = set(_all_kill_sigs)
                elif logic_and and len(per_mod_sigs) > 1:
                    sig_sets = [s for _, s in per_mod_sigs]
                    keep_sigs = sig_sets[0].intersection(*sig_sets[1:])
                else:
                    keep_sigs: set = set()
                    for _, s in per_mod_sigs:
                        keep_sigs |= s

            # ── Build exclusion sigs (reuse builders, always stripped) ──────
            exclude_sigs: set = set()
            for cfg_key, _pos, exc_flag, builder in _FILTER_BUILDERS:
                if exc_flag:
                    # Reuse cached result if positive already computed it
                    exclude_sigs |= _sig_cache.get(cfg_key) or builder()

            # Remove excluded kills from keep_sigs
            if exclude_sigs:
                keep_sigs -= exclude_sigs

            # Build sig → set_of_matched_cfg_keys for _mf tagging
            sig_to_keys: dict = {}
            for fkey, fset in per_mod_sigs:
                for sig in fset:
                    if sig in keep_sigs:
                        sig_to_keys.setdefault(sig, set()).add(fkey)

            kept_kills = []
            for e in kill_events:
                sig = e_sig[id(e)]
                if sig in keep_sigs:
                    matched = sig_to_keys.get(sig, set())
                    if matched:
                        existing = e.get("_mf") or set()
                        e["_mf"] = existing | matched
                    kept_kills.append(e)

            if kept_kills or non_kill:
                filtered[dp] = kept_kills + non_kill
            # If no kills survived AND no non-kill events, drop the demo

        return filtered

    def _fetch_all_kills_for_demos(self, demo_paths):
        """Return a dict {demo_path: [kill_row, ...]} with ALL kills (all players)
        for the given demo paths.  Used by the clutch filter to determine team
        alive-counts per round.

        Each kill_row is a dict with keys:
          tick, killer_sid, victim_sid, killer_team, victim_team, round_key
        where round_key = (demo_path, approx_round_idx).

        Returns {} on any DB error (clutch filter will be skipped gracefully).
        """
        if not demo_paths:
            return {}
        conn = self._pg()
        try:
            with conn.cursor() as cur:
                dc  = self._find_col("matches",
                                      ["demo_path", "demo_file_path", "demo_filepath",
                                       "share_code", "file_path", "path"])
                mkk = self._find_col("kills", ["match_checksum", "match_id", "checksum"])
                mkm = self._find_col("matches", ["checksum", "id", "match_id"])
                tc  = self._find_col("kills", ["tick", "killer_tick", "round_tick"])
                kc  = self._find_col("kills", ["killer_steam_id", "attacker_steam_id"])
                vc  = self._find_col("kills", ["victim_steam_id", "killed_steam_id"])
                tkk = self._find_col("kills", ["killer_team_name", "killer_side", "killer_team"])
                tvk = self._find_col("kills", ["victim_team_name", "victim_side", "victim_team"])
                rnc = self._find_col("kills", ["round_number", "round_num", "round"])

                if not all([dc, mkk, mkm, tc, kc, vc]):
                    return {}

                # Build a checksum→demo_path map for the requested demos
                chk_to_dp = {}
                for dp in demo_paths:
                    chk = self._demo_checksums.get(dp)
                    if chk:
                        chk_to_dp[chk] = dp

                if not chk_to_dp:
                    # Fallback: query by demo path directly
                    ph = ",".join(["%s"] * len(demo_paths))
                    sql = (f'SELECT m."{dc}", k."{tc}", k."{kc}", k."{vc}"'
                           + (f', k."{tkk}"' if tkk else "")
                           + (f', k."{tvk}"' if tvk else "")
                           + (f', k."{rnc}"' if rnc else "")
                           + f' FROM kills k JOIN matches m ON m."{mkm}"=k."{mkk}"'
                           + f' WHERE m."{dc}" IN ({ph}) ORDER BY m."{dc}", k."{tc}"')
                    cur.execute(sql, list(demo_paths))
                else:
                    ph = ",".join(["%s"] * len(chk_to_dp))
                    sql = (f'SELECT m."{dc}", k."{tc}", k."{kc}", k."{vc}"'
                           + (f', k."{tkk}"' if tkk else "")
                           + (f', k."{tvk}"' if tvk else "")
                           + (f', k."{rnc}"' if rnc else "")
                           + f' FROM kills k JOIN matches m ON m."{mkm}"=k."{mkk}"'
                           + f' WHERE m."{mkm}" IN ({ph}) ORDER BY m."{dc}", k."{tc}"')
                    cur.execute(sql, list(chk_to_dp.keys()))

                out = {}
                for row in cur.fetchall():
                    dp_val = str(row[0])
                    if dp_val not in demo_paths:
                        # may have arrived via checksum; map back
                        chk_hit = self._demo_checksums.get(dp_val)
                        dp_val = chk_to_dp.get(chk_hit, dp_val)
                    if dp_val not in demo_paths:
                        continue
                    tick_val = int(row[1]) if row[1] is not None else 0
                    ks = str(row[2]) if row[2] else ""
                    vs = str(row[3]) if row[3] else ""
                    idx = 4
                    kt = str(row[idx]).lower() if tkk and idx < len(row) and row[idx] else ""
                    if tkk:
                        idx += 1
                    vt = str(row[idx]).lower() if tvk and idx < len(row) and row[idx] else ""
                    if tvk:
                        idx += 1
                    rn_val = int(row[idx]) if rnc and idx < len(row) and row[idx] is not None else None
                    out.setdefault(dp_val, []).append({
                        "tick": tick_val,
                        "killer_sid": ks,
                        "victim_sid": vs,
                        "killer_team": kt,
                        "victim_team": vt,
                        "round_num": rn_val,
                    })
        except Exception as e:
            self.log(f"  ⚠ Clutch: DB fetch error — {e}", "warn")
            return {}

        # ── Fetch per-match team sizes from the players table ─────────────────
        # Used by _apply_clutch_filter to detect ghost players (e.g. Wingman 2v2).
        # {checksum: {team_name: player_count}}
        self._clutch_roster_sizes: dict = {}
        try:
            with conn.cursor() as cur2:
                _p_mk = self._find_col("players", ["match_checksum", "match_id", "checksum"])
                _p_team = self._find_col("players", ["team_name", "side", "team"])
                _p_sid = self._find_col("players", ["steam_id", "player_steam_id"])
                if _p_mk and _p_team and _p_sid and chk_to_dp:
                    ph2 = ",".join(["%s"] * len(chk_to_dp))
                    cur2.execute(
                        f'SELECT "{_p_mk}", "{_p_team}", COUNT(DISTINCT "{_p_sid}") '
                        f'FROM players '
                        f'WHERE "{_p_mk}" IN ({ph2}) '
                        f'GROUP BY "{_p_mk}", "{_p_team}"',
                        list(chk_to_dp.keys()))
                    for row2 in cur2.fetchall():
                        chk_v, team_v, cnt = row2
                        if chk_v and team_v:
                            self._clutch_roster_sizes.setdefault(chk_v, {})[
                                str(team_v).lower()] = int(cnt)
        except Exception:
            pass  # roster data is best-effort; clutch still works without it

        return out

    def _apply_clutch_filter(self, results, sids, cfg, all_kills_by_demo):
        """Filter results so that only events occurring during a clutch phase are kept.

        A "clutch" is defined as the period starting from the tick of the kill
        that makes the player the last alive on his team until the round ends
        (player death or last opponent death).

        cfg keys used:
          clutch_enabled   — master guard (caller already checked, but kept for safety)
          clutch_wins_only — only rounds where the player kills all remaining opponents
          clutch_mode      — "kills_only" | "full_clutch"
          clutch_1v1 … clutch_1v5 — size filters (all False = all sizes)

        Returns a filtered copy of results with the same structure.
        Events tagged with:
          "_clutch_start_tick"  — tick at which the clutch started
          "_clutch_opponents"   — number of opponents when the clutch began
          "_clutch_won"         — bool: player killed all opponents
          "type" == "clutch_round" (full_clutch mode only) — the synthetic full-round event
        """
        sids_set = set(str(s) for s in sids)
        tickrate  = int(cfg.get("tickrate", 64))
        wins_only = cfg.get("clutch_wins_only", False)
        mode      = cfg.get("clutch_mode", "kills_only")
        size_filter = {n for n in range(1, 6) if cfg.get(f"clutch_1v{n}", False)}
        # All False = include every size
        any_size_filter = bool(size_filter)

        def _round_key_from_kill(kill, dp):
            rn = kill.get("round_num")
            if rn is not None:
                return (dp, int(rn))
            return (dp, kill["tick"] // max(1, tickrate * 115))

        filtered = {}

        for dp, events in results.items():
            demo_kills = all_kills_by_demo.get(dp, [])
            if not demo_kills:
                # No all-kills data → cannot detect clutch → skip demo
                continue

            # ── Build per-round structures from ALL kills in this demo ────────
            # round → sorted list of all kills
            rounds_all: dict = {}
            for k in demo_kills:
                rk = _round_key_from_kill(k, dp)
                rounds_all.setdefault(rk, []).append(k)

            # Sort each round's kills by tick
            for rk in rounds_all:
                rounds_all[rk].sort(key=lambda x: x["tick"])

            # ── For each round, determine if a clutch occurred ────────────────
            # Clutch detection algorithm:
            #   1. Identify the teams of our player (from kills where he is killer/victim).
            #   2. Walk kills chronologically, tracking alive players per team.
            #   3. Detect the tick when player's team drops to 1 alive (= player alone).
            #   4. At that moment record how many opponents are alive = clutch size.
            #   5. Track whether the player kills all opponents = clutch won.

            # Collect clutch windows: {round_key: {start_tick, opponents, won, kill_ticks}}
            clutch_windows: dict = {}

            for rk, r_kills in rounds_all.items():
                # Collect all participants in this round
                all_sids_in_round: set = set()
                for k in r_kills:
                    if k["killer_sid"]:
                        all_sids_in_round.add(k["killer_sid"])
                    if k["victim_sid"]:
                        all_sids_in_round.add(k["victim_sid"])

                # Find our player(s) in this round
                our_sids_in_round = sids_set & all_sids_in_round
                if not our_sids_in_round:
                    continue  # player not in this round

                # Determine player's team from the kill rows
                # Use the team column of the FIRST kill involving our player
                our_team = ""
                for k in r_kills:
                    if k["killer_sid"] in our_sids_in_round and k.get("killer_team"):
                        our_team = k["killer_team"]
                        break
                    if k["victim_sid"] in our_sids_in_round and k.get("victim_team"):
                        our_team = k["victim_team"]
                        break

                # Build initial alive sets
                # All players that participated: alive at round start.
                # IMPORTANT: players who survive without killing or being killed are
                # NOT present in r_kills (Wingman teammates who haven't acted yet).
                # Strategy: seed alive_set from kills, then supplement with team-size
                # data from self._clutch_roster_sizes (populated by _fetch_all_kills_for_demos
                # via the players table). Fall back to the observed max-per-team heuristic.
                alive_set: dict = {}  # sid → team
                for k in r_kills:
                    if k["killer_sid"] and k["killer_sid"] not in alive_set:
                        alive_set[k["killer_sid"]] = k.get("killer_team", "")
                    if k["victim_sid"] and k["victim_sid"] not in alive_set:
                        alive_set[k["victim_sid"]] = k.get("victim_team", "")

                # If we have no team data at all, fall back to a heuristic:
                # assume CS standard 5v5 and treat teams as "our player's team"
                # vs "opponents".  We key the team by whether the sid is in sids_set.
                no_team_data = all(not v for v in alive_set.values())
                if no_team_data:
                    for sid in alive_set:
                        alive_set[sid] = "player_team" if sid in sids_set else "opp_team"
                    our_team = "player_team"

                if not our_team:
                    continue

                # ── Ghost-player correction ────────────────────────────────────
                # Players who never appear as killer or victim in this round are
                # absent from alive_set, causing premature clutch detection.
                # Use roster data (from players table, keyed by match checksum) when
                # available; otherwise infer the per-team count from max observed alive.
                chk = self._demo_checksums.get(dp)
                roster = getattr(self, "_clutch_roster_sizes", {}).get(chk, {})
                if roster:
                    # roster: {team_name: player_count} — e.g. {"ct": 5, "t": 5}
                    # Find our team name and opponent team names
                    _team_names = set(v for v in alive_set.values() if v)
                    for tname, count in roster.items():
                        tname_lo = tname.lower()
                        # Match to team label in alive_set (our_team or opponent)
                        matched_label = None
                        for label in _team_names:
                            if label and (tname_lo in label.lower() or label.lower() in tname_lo):
                                matched_label = label
                                break
                        if matched_label is None:
                            continue
                        observed = sum(1 for v in alive_set.values() if v == matched_label)
                        ghosts = count - observed
                        if ghosts > 0:
                            # Inject synthetic ghost players for this team
                            for i in range(ghosts):
                                ghost_sid = f"__ghost_{matched_label}_{i}__"
                                alive_set[ghost_sid] = matched_label
                else:
                    # Heuristic fallback: count initial team sizes from alive_set
                    _max_per_team: dict = {}
                    for label in set(alive_set.values()):
                        if not label:
                            continue
                        n = sum(1 for v in alive_set.values() if v == label)
                        _max_per_team[label] = n
                    # No ghosts needed via this path — the initial alive_set IS the observed
                    # max already. Ghost players only matter when the roster is known to be
                    # larger than what kills reveal. Without the players table, we cannot
                    # safely add ghost players (risk of over-counting in normal 5v5).
                    # This path is intentionally conservative — the players table path above
                    # handles Wingman correctly when roster data is available.

                # Walk kills, remove victim from alive each time
                alive = dict(alive_set)  # mutable copy
                clutch_start_tick = None
                clutch_opponents  = 0
                clutch_kill_ticks = []
                clutch_won        = False

                for k in r_kills:
                    vs = k["victim_sid"]
                    if vs and vs in alive:
                        del alive[vs]

                    # Count alive per team after this kill
                    our_alive  = [s for s, t in alive.items() if t == our_team]
                    opp_alive  = [s for s, t in alive.items() if t != our_team]

                    # Clutch start: exactly our player alive (1) on his team
                    if (clutch_start_tick is None
                            and len(our_alive) == 1
                            and our_alive[0] in sids_set
                            and len(opp_alive) >= 1):
                        clutch_start_tick = k["tick"]
                        clutch_opponents  = len(opp_alive)

                    # Once clutch started, track kills by our player
                    if clutch_start_tick is not None:
                        if k["killer_sid"] in sids_set and k.get("victim_team", "") != our_team:
                            clutch_kill_ticks.append(k["tick"])
                        # Clutch won: no opponents alive
                        if not opp_alive:
                            clutch_won = True
                            break
                        # Clutch lost: our player is dead
                        if not any(s in sids_set for s in alive):
                            break

                if clutch_start_tick is None:
                    continue  # no clutch in this round

                # Apply size filter
                if any_size_filter and clutch_opponents not in size_filter:
                    continue
                # Apply wins_only
                if wins_only and not clutch_won:
                    continue

                round_ticks = [k["tick"] for k in r_kills]
                clutch_windows[rk] = {
                    "start_tick":  clutch_start_tick,
                    "opponents":   clutch_opponents,
                    "won":         clutch_won,
                    "kill_ticks":  clutch_kill_ticks,
                    "round_tick_min": min(round_ticks) if round_ticks else clutch_start_tick,
                    "round_tick_max": max(round_ticks) if round_ticks else clutch_start_tick,
                }

            if not clutch_windows:
                continue

            # ── Filter / generate events from the clutch windows ─────────────
            kill_events   = [e for e in events if e.get("type") == "kill"]
            non_kill      = [e for e in events if e.get("type") not in ("kill", "death", "round")]

            if mode == "full_clutch":
                # One synthetic event per clutch window.
                # _seq_start_tick / _seq_end_tick respect the Before/After sliders:
                #   start = clutch_start_tick - before_ticks  (lead-in from when player is last alive)
                #   end   = last_kill_tick    + after_ticks   (tail after the final kill of the clutch)
                before_s = float(cfg.get("before", 3))
                after_s  = float(cfg.get("after",  5))
                bt = int(before_s * tickrate)
                at = int(after_s  * tickrate)
                new_events = []
                for rk, cw in sorted(clutch_windows.items(), key=lambda x: x[1]["start_tick"]):
                    # End boundary: last kill tick in this round from all_kills data
                    r_kills = rounds_all.get(rk, [])
                    last_round_tick = max((k["tick"] for k in r_kills), default=cw["start_tick"])
                    synthetic = {
                        "tick":              cw["start_tick"],
                        "type":              "clutch_round",
                        "weapon":            "",
                        "_clutch_start_tick":cw["start_tick"],
                        "_clutch_end_tick":  last_round_tick,
                        "_clutch_opponents": cw["opponents"],
                        "_clutch_won":       cw["won"],
                        # Apply Before/After padding around the clutch boundaries
                        "_seq_start_tick":   max(0, cw["start_tick"] - bt),
                        "_seq_end_tick":     last_round_tick + at,
                    }
                    # Add kills from this clutch as sub-events for badge display.
                    # Match by tick range: kill_tick in [clutch_start, round_end].
                    r_tick_min = cw["round_tick_min"]
                    r_tick_max = cw["round_tick_max"]
                    clutch_kills = [e for e in kill_events
                                    if e["tick"] >= cw["start_tick"]
                                    and r_tick_min <= e["tick"] <= r_tick_max]
                    if clutch_kills:
                        synthetic["_clutch_kills"] = clutch_kills
                    new_events.append(synthetic)
                if new_events or non_kill:
                    filtered[dp] = new_events + non_kill

            else:  # kills_only
                # Keep only kill events that fall within a clutch window for this round.
                # Build a sorted list of (tick_min, tick_max, cw) for tick-based fallback
                # in case the round_key method differs between all_kills and query_events rows.
                _cw_by_key   = clutch_windows                        # primary: key lookup
                _cw_by_ticks = sorted(                               # fallback: tick range
                    [(cw["round_tick_min"], cw["round_tick_max"], cw)
                     for cw in clutch_windows.values()],
                    key=lambda x: x[0])

                def _find_cw(e_tick, e_rk):
                    cw = _cw_by_key.get(e_rk)
                    if cw is not None:
                        return cw
                    # Fallback: find the window whose round tick-range contains e_tick
                    for tmin, tmax, cw_fb in _cw_by_ticks:
                        if tmin <= e_tick <= tmax:
                            return cw_fb
                    return None

                kept_kills = []
                for e in kill_events:
                    if str(e.get("killer_sid", "")) not in sids_set:
                        continue
                    e_tick = e["tick"]
                    e_rk = _round_key_from_kill(
                        {"tick": e_tick, "round_num": e.get("round_num")}, dp)
                    cw = _find_cw(e_tick, e_rk)
                    if cw is None:
                        continue
                    if e_tick < cw["start_tick"]:
                        continue
                    # Tag the event with clutch metadata
                    e = dict(e)
                    e["_clutch_start_tick"] = cw["start_tick"]
                    e["_clutch_opponents"]  = cw["opponents"]
                    e["_clutch_won"]        = cw["won"]
                    kept_kills.append(e)
                if kept_kills or non_kill:
                    filtered[dp] = kept_kills + non_kill

        return filtered

    def _effective_before(self, cfg):
        """Return the effective BEFORE duration in seconds.
        In 'both' mode, victim_pre_s is added so the killer phase is fully
        included in the recorded sequence.
        Any other perspective — killer, victim — uses before as-is.
        """
        before = cfg.get("before", 3)
        if cfg.get("perspective") == "both":
            before = before + max(0, cfg.get("victim_pre_s", 0))
        return before

    def _build_sequences(self, events, tickrate, before_s, after_s):
        """Build merged clip sequences from a list of events.

        Works for any event carrying a `tick` — kill/death, but also non-lethal
        damage (damage_actor / damage_target) and raw shot events. Non-kill events
        carry the same {start_tick, end_tick, events, event_type} sequence structure
        as kills, so the downstream camera/JSON builders can treat them uniformly.

        Sorting: events are re-sorted by tick (stable) here so that kill, damage and
        shot rows — appended per-query in _query_events — are interleaved in true
        tick order. Individual SQL ORDER BYs guarantee order within each query but
        not across the concatenated lists.

        If an event carries _seq_start_tick / _seq_end_tick (set by clutch full_clutch
        mode), those values are used directly as clip boundaries — before/after padding
        has already been baked in by _apply_clutch_filter using the cfg Before/After values.

        Merge rule: two adjacent sequences are joined into one if the gap between them
        is ≤ before_ticks.  This mirrors native CSDM behaviour: a second kill that
        occurs "just a few seconds" after the first clip ends extends the clip rather
        than starting a separate one.  Overlapping sequences (gap ≤ 0) are always
        merged as before.
        """
        if not events:
            return []
        events = sorted(events, key=lambda e: e.get("tick", 0))
        bt, at = int(before_s * tickrate), int(after_s * tickrate)
        raw = []
        for e in events:
            if "_seq_start_tick" in e and "_seq_end_tick" in e:
                s_tick = max(0, int(e["_seq_start_tick"]))
                e_tick = max(s_tick + 1, int(e["_seq_end_tick"]))
            else:
                s_tick = max(0, e["tick"] - bt)
                e_tick = e["tick"] + at
            raw.append({"start_tick": s_tick, "end_tick": e_tick,
                        "events": [e], "event_type": e.get("type", "kill")})
        merged = [raw[0]]
        for s in raw[1:]:
            p = merged[-1]
            # Merge when overlap OR gap is within one "before" window
            if s["start_tick"] - p["end_tick"] <= bt:
                p["end_tick"] = max(p["end_tick"], s["end_tick"])
                p["events"].extend(s["events"])
                # Primary event type stays the first event's; mark any secondary types
                p["event_types"] = sorted({p["event_type"], s["event_type"]})
            else:
                merged.append(s)
        return merged

    def _get_sids(self, cfg):
        return cfg.get("steam_ids") or ([cfg["steam_id"]] if cfg.get("steam_id") else [])

    def _player_str(self, cfg):
        sids = self._get_sids(cfg)
        if not sids:
            return "—"
        if len(sids) == 1:
            pn = cfg.get("player_name", "") or self._player_names.get(sids[0], sids[0])
            return f"{pn} ({sids[0]})"
        return "  +  ".join(self._player_names.get(s, s) for s in sids)

    def _cfg_num(self, cfg, key, default, lo=None, hi=None, as_int=True):
        raw = cfg.get(key, default)
        cast = (lambda x: int(float(x))) if as_int else float
        try:
            val = cast(str(raw).strip())
        except Exception:
            self.log(f"  ⚠ cfg '{key}' invalid ({raw}) — fallback {default}", "warn")
            val = cast(default)
        if lo is not None:
            val = max(lo, val)
        if hi is not None:
            val = min(hi, val)
        return val

    def _cfg_int(self, cfg, key, default, lo=None, hi=None):
        return self._cfg_num(cfg, key, default, lo, hi, as_int=True)

    def _cfg_float(self, cfg, key, default, lo=None, hi=None):
        return self._cfg_num(cfg, key, default, lo, hi, as_int=False)

    def _cfg_bool(self, cfg, key, default):
        raw = cfg.get(key, default)
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        if isinstance(raw, str):
            s = raw.strip().lower()
            if s in {"1", "true", "yes", "on"}:
                return True
            if s in {"0", "false", "no", "off"}:
                return False
        self.log(f"  ⚠ cfg '{key}' invalid ({raw}) — fallback {default}", "warn")
        return bool(default)

    def _common_cs2_injection(self, cfg):
        launch_args = []
        wm = cfg.get("cs2_window_mode", "none")
        wm_map = {
            "fullscreen": "-fullscreen",
            "windowed": "-windowed",
            "noborder": "-windowed -noborder",
        }
        if wm in wm_map:
            launch_args.extend(wm_map[wm].split())

        cmds = [
            # Lock demo playback speed to 1× — prevents residual host_timescale from
            # a previous session making ragdolls/physics run faster than real-time.
            "demo_timescale 1",
            f"cl_ragdoll_gravity {self._cfg_int(cfg, 'phys_ragdoll_gravity', 600, -5000, 5000)}",
            f"ragdoll_gravity_scale {self._cfg_float(cfg, 'phys_ragdoll_scale', 1.0, -10.0, 10.0)}",
            f"sv_gravity {self._cfg_int(cfg, 'phys_sv_gravity', 800, -5000, 5000)}",
            f"cl_ragdoll_physics_enable {1 if self._cfg_bool(cfg, 'phys_ragdoll_enable', True) else 0}",
            f"violence_hblood {1 if self._cfg_bool(cfg, 'phys_blood', True) else 0}",
            f"r_dynamic {1 if self._cfg_bool(cfg, 'phys_dynamic_lighting', True) else 0}",
        ]
        return {"launch_args": launch_args, "console_cmds": cmds}

    def _resolve_cs2_cfg_dir(self, cfg):
        hint = (cfg.get("cs2_cfg_dir") or "").strip()
        candidates = [hint] if hint else []

        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        steam_roots = [os.path.join(pf86, "Steam")]
        steam_roots.extend([
            r"C:\Steam",
            r"D:\Steam",
            r"E:\Steam",
            r"F:\Steam",
        ])

        seen = set()
        for root in steam_roots:
            if not root or root in seen:
                continue
            seen.add(root)
            candidates.append(
                os.path.join(root, "steamapps", "common",
                             "Counter-Strike Global Offensive", "game", "csgo", "cfg")
            )
            lib_vdf = os.path.join(root, "steamapps", "libraryfolders.vdf")
            if os.path.isfile(lib_vdf):
                try:
                    txt = Path(lib_vdf).read_text(encoding="utf-8", errors="ignore")
                    for p in re.findall(r'"path"\s*"([^"]+)"', txt):
                        p = p.replace("\\\\", "\\")
                        candidates.append(
                            os.path.join(p, "steamapps", "common",
                                         "Counter-Strike Global Offensive", "game", "csgo", "cfg")
                        )
                except Exception:
                    pass

        for c in candidates:
            if c and os.path.isdir(c):
                return c
        return ""

    def _inject_cs_runtime_cfg(self, cfg, shared):
        cfg_dir = self._resolve_cs2_cfg_dir(cfg)
        if not cfg_dir:
            self.log("  ⚠ CS injection: CS2 cfg folder not found. "
                       "Set cs2_cfg_dir in csdm_config.json.", "warn")
            return False

        runtime_cmds = list(shared.get("console_cmds", []))
        sm = self._cfg_int(cfg, "hlae_slow_motion", 100, 1, 1000)
        if sm != 100:
            runtime_cmds.append(f"host_timescale {round(sm / 100.0, 4)}")
        if self._cfg_bool(cfg, "hlae_no_spectator_ui", True):
            runtime_cmds.append("cl_draw_only_deathnotices 1")

        if not runtime_cmds:
            return True

        runtime_cfg_path = os.path.join(cfg_dir, CSDM_RUNTIME_CFG_NAME)
        try:
            Path(runtime_cfg_path).write_text("\n".join(runtime_cmds) + "\n",
                                              encoding="utf-8")
        except Exception as e:
            self.log(f"  ⚠ CS injection: failed to write runtime cfg: {e}", "warn")
            return False

        autoexec_path = os.path.join(cfg_dir, "autoexec.cfg")
        try:
            if os.path.isfile(autoexec_path):
                current = Path(autoexec_path).read_text(encoding="utf-8", errors="ignore")
            else:
                current = ""
            block = f"{CSDM_RUNTIME_BLOCK_START}\nexec {Path(CSDM_RUNTIME_CFG_NAME).stem}\n{CSDM_RUNTIME_BLOCK_END}\n"
            pattern = re.compile(
                rf"{re.escape(CSDM_RUNTIME_BLOCK_START)}.*?{re.escape(CSDM_RUNTIME_BLOCK_END)}\n?",
                re.S
            )
            if pattern.search(current):
                updated = pattern.sub(block, current)
            else:
                sep = "" if (not current or current.endswith("\n")) else "\n"
                updated = f"{current}{sep}{block}"
            Path(autoexec_path).write_text(updated, encoding="utf-8")
        except Exception as e:
            self.log(f"  ⚠ CS injection: failed to update autoexec.cfg: {e}", "warn")
            return False

        self.log(f"  🎮 CS injection ready: {runtime_cfg_path}", "dim")
        if shared.get("launch_args"):
            self.log(
                f"  ⚠ CS launch options not injectable via CSDM JSON: {' '.join(shared['launch_args'])}",
                "warn")
        return True

    def _inject_hlae_extra_args(self, cfg, shared):
        hlae_options = {}
        fov = self._cfg_int(cfg, "hlae_fov", 90, 1, 179)
        if fov and int(fov) != 90:
            hlae_options["mirv_fov"] = int(fov)
        slow_mo = self._cfg_int(cfg, "hlae_slow_motion", 100, 1, 1000)
        if slow_mo and int(slow_mo) != 100:
            hlae_options["host_timescale"] = round(int(slow_mo) / 100.0, 4)
        if self._cfg_bool(cfg, "hlae_afx_stream", False):
            hlae_options["afxStream"] = True
        if self._cfg_bool(cfg, "hlae_no_spectator_ui", True):
            hlae_options["hideSpectatorUi"] = True

        tokens = []
        tokens.extend(shared.get("launch_args", []))
        tokens.extend(f"+{c}" for c in shared.get("console_cmds", []))
        if hlae_options.get("hideSpectatorUi"):
            tokens.append("+cl_draw_only_deathnotices 1")
        if self._cfg_bool(cfg, "hlae_fix_scope_fov", True):
            tokens.append("+mirv_fov handleZoom enabled 1")
        extra_raw = cfg.get("hlae_extra_args", "").strip()
        if extra_raw:
            try:
                tokens.extend(shlex.split(extra_raw, posix=False))
            except Exception:
                tokens.extend(extra_raw.split())

        if tokens:
            hlae_options["extraArgs"] = " ".join(tokens)
        return hlae_options

    @staticmethod
    def _seq_actor_sid(e):
        """Actor-role SID for an event: killer for kills/deaths, attacker for
        damage (damage_actor / damage_target) and shot events."""
        return e.get("killer_sid") or e.get("attacker_sid")

    @staticmethod
    def _seq_anchor_sid(seq, sids_active, primary_sid):
        """First active actor (killer/attacker) in the sequence, else first active
        victim, else primary. Handles non-kill events via attacker_sid."""
        sorted_evts = sorted(seq["events"], key=lambda e: e["tick"])
        for e in sorted_evts:
            ks = str(EngineMixin._seq_actor_sid(e) or "")
            if ks in sids_active:
                return ks
        for e in sorted_evts:
            vs = str(e.get("victim_sid") or "")
            if vs in sids_active:
                return vs
        return primary_sid

    @staticmethod
    def _build_cams_killer(seq, sids_active, primary_sid):
        """Killer mode: follow each active actor (killer or attacker). One entry
        per actor change. damage_actor / shot events follow the attacker; damage_target
        events fall back to the anchor (the tracked target)."""
        act_evts = sorted(
            [e for e in seq["events"] if EngineMixin._seq_actor_sid(e) in sids_active],
            key=lambda e: e["tick"]
        )
        if not act_evts:
            anchor = (primary_sid if primary_sid in sids_active
                      else EngineMixin._seq_anchor_sid(seq, sids_active, primary_sid))
            return [{"tick": seq["start_tick"], "playerSteamId": anchor,
                     "playerName": ""}]
        # Start at sequence start pointing to the first actor
        first_ks = EngineMixin._seq_actor_sid(act_evts[0])
        cams = [{"tick": seq["start_tick"], "playerSteamId": first_ks,
                 "playerName": ""}]
        # Add a switch entry each time the actor changes
        prev_ks = first_ks
        for ev in act_evts[1:]:
            ks = EngineMixin._seq_actor_sid(ev)
            if ks != prev_ks:
                cams.append({"tick": ev["tick"], "playerSteamId": ks,
                             "playerName": ""})
                prev_ks = ks
        return cams

    @staticmethod
    def _build_cams_victim(seq, sids_active, primary_sid, cfg):
        """Victim mode: camera fixed on the victim of the first kill by our player.
        If the event is our player's death, the camera follows our player.
        If kill_mod_mate_pov is on and a mate SID was stamped, use that instead.
        No camera switch during the whole sequence."""
        sorted_evts = sorted(
            [e for e in seq["events"] if EngineMixin._seq_actor_sid(e) in sids_active
             or e.get("victim_sid") in sids_active],
            key=lambda e: e["tick"]
        )

        # Determine the single camera target for the whole sequence
        target_sid = EngineMixin._seq_anchor_sid(seq, sids_active, primary_sid)
        if sorted_evts:
            first_ev = sorted_evts[0]
            if first_ev.get("type") == "death" and first_ev.get("victim_sid") in sids_active:
                # Our player dies: follow them
                target_sid = first_ev["victim_sid"]
            elif first_ev.get("victim_sid"):
                # Our player acts (kill / damage_actor / shot): follow the target
                # (or their best-angle teammate). For damage_target the victim is
                # our player and is handled above by the anchor fallback.
                mate_sid   = first_ev.get("_mate_pov_sid") if cfg.get("kill_mod_mate_pov") else None
                target_sid = mate_sid or first_ev["victim_sid"]

        # A single camera point at start_tick is enough — CSDM holds the target
        return [{"tick": seq["start_tick"], "playerSteamId": target_sid,
                 "playerName": ""}]

    @staticmethod
    def _build_cams_both(seq, sids_active, primary_sid, cfg, tickrate, victim_pre_ticks):
        """Both mode: camera on the killer from the start of the sequence,
        switches to victim victim_pre_ticks before the kill.
        Sequence already extended by victim_pre_s via _effective_before,
        so the switch is guaranteed inside the clip."""
        sorted_evts = sorted(
            [e for e in seq["events"] if EngineMixin._seq_actor_sid(e) in sids_active
             or e.get("victim_sid") in sids_active],
            key=lambda e: e["tick"]
        )
        if not sorted_evts:
            return [{"tick": seq["start_tick"], "playerSteamId": primary_sid,
                     "playerName": ""}]

        # initial_sid = first relevant active player — used as camera default
        # for any tick before the first timeline entry.  Do NOT put this into
        # the timeline itself: doing so (and dedup-overwriting with later kills)
        # was the root cause of the wrong-POV bug in multi-kill sequences.
        initial_sid = EngineMixin._seq_anchor_sid(seq, sids_active, primary_sid)

        # timeline maps tick → target_sid for SWITCH events only.
        # First-write wins at any given tick (don't overwrite with later events
        # that happen to share the same tick).
        timeline: dict = {}

        for i, ev in enumerate(sorted_evts):
            ev_tick = ev["tick"]

            if ev.get("type") == "death" and ev.get("victim_sid") in sids_active:
                # Our player dies — follow them from the very start.
                initial_sid = ev["victim_sid"]
                timeline.clear()
                break

            ksid = EngineMixin._seq_actor_sid(ev) or primary_sid
            # In mate_pov mode, switch to the best-angle teammate instead of victim.
            mate_sid   = ev.get("_mate_pov_sid") if cfg.get("kill_mod_mate_pov") else None
            victim_cam = ev.get("victim_sid") or primary_sid
            vsid = mate_sid or victim_cam

            # If there was a previous kill, return to this kill's killer right
            # after that kill so the viewer sees the correct attacker.
            if i > 0:
                prev_ev = sorted_evts[i - 1]
                if prev_ev.get("victim_sid") not in sids_active:
                    back_tick = prev_ev["tick"] + 1
                    if back_tick not in timeline:
                        timeline[back_tick] = ksid

            # Switch to victim (or mate) victim_pre_ticks before this kill.
            switch_tick = max(seq["start_tick"], ev_tick - victim_pre_ticks)
            timeline[switch_tick] = vsid

        sorted_timeline = sorted(timeline.items())

        cam_ticks = build_camera_ticks(seq, tickrate)
        cams = []
        for t in cam_ticks:
            target = initial_sid
            for tl_tick, tl_sid in sorted_timeline:
                if tl_tick <= t:
                    target = tl_sid
                else:
                    break
            cams.append({"tick": t, "playerSteamId": target,
                         "playerName": ""})
        return cams

    @staticmethod
    def _bj_players_options(seq, cams, perspective, sids_active, sids_active_list,
                            name_for, name_override):
        """Per-sequence playersOptions list (who is shown/highlighted in deathnotices)."""
        cam_sids = {c["playerSteamId"] for c in cams if c.get("playerSteamId")}
        if perspective in ("victim", "both"):
            for ev in seq["events"]:
                vsid = ev.get("victim_sid")
                if vsid:
                    cam_sids.add(vsid)

        # Collect killers and victims for the sequence (non-kill damage/shot events
        # carry attacker_sid instead of killer_sid — include both).
        seq_killer_sids = {ev.get("killer_sid") for ev in seq["events"] if ev.get("killer_sid")}
        seq_killer_sids |= {ev.get("attacker_sid") for ev in seq["events"] if ev.get("attacker_sid")}
        seq_victim_sids  = {ev.get("victim_sid")  for ev in seq["events"] if ev.get("victim_sid")}
        all_seq_sids = (cam_sids | seq_killer_sids | seq_victim_sids) - {None, ""}

        players_opts = []
        seen_opts = set()
        # Active players first, then other SIDs in the sequence
        ordered = list(sids_active_list) + sorted(all_seq_sids - sids_active)
        # In victim mode, camera-target SIDs must have showKill:true
        # otherwise CSDM ignores the camera switch
        cam_target_sids = {c["playerSteamId"] for c in cams if c.get("playerSteamId")}

        for psid in ordered:
            if not psid or psid in seen_opts:
                continue
            seen_opts.add(psid)
            is_our    = psid in sids_active
            pname = (name_override if is_our and name_override else name_for(psid))
            is_killer = psid in seq_killer_sids
            is_cam_target = psid in cam_target_sids

            if perspective in ("killer", "victim"):
                show = is_our or is_killer or is_cam_target
                hi   = is_cam_target or (is_our and not cam_target_sids)
            else:  # both
                show = True
                hi   = is_cam_target or is_our

            players_opts.append({"steamId": psid, "playerName": pname,
                                 "showKill": show, "highlightKill": hi,
                                 "isVoiceEnabled": True})
        return players_opts

    @staticmethod
    def _bj_output_dir(demo_path, cfg):
        """Resolve (and create) the clip output folder for this demo."""
        _clips_dir = (cfg.get("output_dir_clips") or cfg.get("output_dir") or "").strip()
        od = os.path.abspath(_clips_dir) if _clips_dir else ""
        if cfg.get("subfolder_per_demo", True) and od:
            od = os.path.join(od, safe_folder_name(Path(demo_path).name))
            os.makedirs(od, exist_ok=True)
        return od

    @staticmethod
    def _bj_output_params(cfg):
        """FFmpeg output parameters, with -preset injected for CPU codecs only.
        GPU codecs (NVENC/AMF) ignore -preset from libx264/libx265."""
        video_codec = cfg.get("video_codec", "libx264")
        video_preset = cfg.get("video_preset", "medium").strip()
        user_out_params = cfg.get("ffmpeg_output_params", "").strip()
        # Only inject preset if: CPU codec + non-empty preset + not already in params
        if (video_codec in CPU_VIDEO_CODECS and video_preset
                and "-preset" not in user_out_params):
            return (f"-preset {video_preset} " + user_out_params).strip()
        return user_out_params

    def _build_json(self, demo_path, sequences, cfg):
        # In multi-player, sid = first SID (JSON compat), but we determine
        # the "owner" of each event dynamically from killer_sid/victim_sid.

        # Prefer names extracted from the demo itself (username at record time)
        # and fall back to the DB player table.
        with self._dp2_cache_lock:
            _demo_names = dict(self._dp2_cache.get(demo_path, {}).get("demo_names") or {})

        _name_override = (cfg.get("player_name_override") or "").strip()

        def _name(psid):
            psid = str(psid or "")
            return _demo_names.get(psid) or self._player_names.get(psid, "")

        sids_active_list = []
        for _sid in self._get_sids(cfg):
            _sid = str(_sid or "")
            if _sid and _sid not in sids_active_list:
                sids_active_list.append(_sid)
        sids_active = set(sids_active_list)
        primary_sid = str(cfg.get("steam_id") or "")
        if primary_sid not in sids_active:
            primary_sid = sids_active_list[0] if sids_active_list else primary_sid
        tickrate = cfg.get("tickrate", 64)
        perspective = cfg.get("perspective", "killer")
        recsys = self._normalize_recsys(cfg.get("recsys", "HLAE"))

        victim_pre_s = cfg.get("victim_pre_s", 2)
        victim_pre_ticks = max(0, int(victim_pre_s) * tickrate)

        seqs = []
        for idx, seq in enumerate(sequences, 1):
            if perspective == "both":
                cams = self._build_cams_both(seq, sids_active, primary_sid, cfg,
                                             tickrate, victim_pre_ticks)
            elif perspective == "victim":
                cams = self._build_cams_victim(seq, sids_active, primary_sid, cfg)
            else:
                cams = self._build_cams_killer(seq, sids_active, primary_sid)

            players_opts = self._bj_players_options(
                seq, cams, perspective, sids_active, sids_active_list,
                _name, _name_override)

            seqs.append({
                "number": idx,
                "startTick": seq["start_tick"],
                "endTick": seq["end_tick"],
                "showOnlyDeathNotices": cfg.get("show_only_death_notices", True),
                "deathNoticesDuration": cfg.get("death_notices_duration", 5),
                "showXRay": cfg.get("show_xray", True),
                "showAssists": False,
                "recordAudio": True,
                "playerVoicesEnabled": True,
                "playerCameras": cams,
                "cameras": [],
                "playersOptions": players_opts,
            })

        od = self._bj_output_dir(demo_path, cfg)

        shared_injection = self._common_cs2_injection(cfg)
        hlae_options = self._inject_hlae_extra_args(cfg, shared_injection) if recsys == "HLAE" else {}

        out_params = self._bj_output_params(cfg)
        video_codec = cfg.get("video_codec", "libx264")

        out = {
            "demoPath": os.path.abspath(demo_path),
            "outputFolderPath": od,
            "encoderSoftware": cfg.get("encoder", "FFmpeg"),
            "recordingSystem": recsys,
            "recordingOutput": "video",
            "framerate": cfg.get("framerate", 60),
            "width": cfg.get("width", 1920),
            "height": cfg.get("height", 1080),
            "closeGameAfterRecording": cfg.get("close_game_after", True),
            "concatenateSequences": cfg.get("concatenate_sequences", False),
            "showOnlyDeathNotices": cfg.get("show_only_death_notices", True),
            "deathNoticesDuration": cfg.get("death_notices_duration", 5),
            "trueView": cfg.get("true_view", True),
            "ffmpegSettings": {
                "audioBitrate": cfg.get("audio_bitrate", 256),
                "constantRateFactor": cfg.get("crf", 18),
                "customLocationEnabled": False,
                "customExecutableLocation": "",
                "videoContainer": cfg.get("video_container", "mp4"),
                "videoCodec": video_codec,
                "audioCodec": cfg.get("audio_codec", "libmp3lame"),
                "inputParameters": cfg.get("ffmpeg_input_params", ""),
                "outputParameters": out_params,
            },
            "sequences": seqs,
        }
        if recsys == "HLAE":
            out["hlaeOptions"] = hlae_options
        return out

    def _start_cs2_send_to_back_watcher(self):
        """Start a thread that keeps CS2 behind all other windows for the entire recording.

        Strategy:
          1. Wait up to 120 s for cs2.exe to appear.
          2. Once found, push every CS2 window to HWND_BOTTOM every 500 ms until the
             CSDM subprocess exits.

        Window discovery — two layers (first match wins):
          • Process name: enumerate all visible top-level windows; keep those whose
            owning process executable contains "cs2" — works regardless of window title.
          • Title fallback: if win32process is unavailable, match window title against
            known CS2 strings.

        SetWindowPos(HWND_BOTTOM) places the window at the bottom of the Z-order
        without minimizing. CS2 keeps running normally; the desktop stays on top.
        Requires pywin32; returns silently without it.
        """
        _ref_proc = self._proc   # snapshot before thread starts

        def _watch():
            try:
                import win32gui
                import win32con
                import win32process as _w32p
                _have_w32p = True
            except ImportError:
                try:
                    import win32gui
                    import win32con
                    _have_w32p = False
                except ImportError:
                    self.log("  ℹ cs2_send_to_back: pywin32 not installed — option ignored.", "dim")
                    return

            # ── Helper: get executable path for a window (needs win32process) ──
            def _exe_of(hwnd):
                if not _have_w32p:
                    return ""
                try:
                    _, pid = _w32p.GetWindowThreadProcessId(hwnd)
                    # QueryFullProcessImageNameW via ctypes — no extra dependency
                    import ctypes, ctypes.wintypes
                    PROCESS_QUERY_LIMITED = 0x1000
                    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED, False, pid)
                    if not h:
                        return ""
                    buf  = ctypes.create_unicode_buffer(512)
                    size = ctypes.wintypes.DWORD(512)
                    ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
                    ctypes.windll.kernel32.CloseHandle(h)
                    return buf.value.lower()
                except Exception:
                    return ""

            _CS2_TITLES = ("counter-strike 2", "cs2")

            def _is_cs2(hwnd):
                if not win32gui.IsWindowVisible(hwnd):
                    return False
                # Primary: process-name check
                exe = _exe_of(hwnd)
                if exe:
                    return "cs2" in exe.replace("\\", "/").split("/")[-1]
                # Fallback: window title
                title = win32gui.GetWindowText(hwnd).lower()
                return any(k in title for k in _CS2_TITLES)

            def _find_cs2():
                found = []
                try:
                    win32gui.EnumWindows(lambda h, _: found.append(h) if _is_cs2(h) else None, None)
                except Exception:
                    pass
                return found

            def _push_to_back(hwnds):
                for hwnd in hwnds:
                    try:
                        win32gui.SetWindowPos(
                            hwnd,
                            win32con.HWND_BOTTOM,
                            0, 0, 0, 0,
                            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE
                        )
                    except Exception:
                        pass

            # ── Phase 1: wait for CS2 to appear (up to 120 s) ──────────────────
            deadline = time.time() + 120
            hwnds = []
            while time.time() < deadline:
                if _ref_proc and _ref_proc.poll() is not None:
                    return  # CSDM already finished
                hwnds = _find_cs2()
                if hwnds:
                    self.log("  🔙 CS2 found — keeping behind other windows.", "dim")
                    break
                time.sleep(0.5)

            if not hwnds:
                self.log("  ⚠ cs2_send_to_back: CS2 window not found within 120 s.", "warn")
                return

            # ── Phase 2: keep pushing to back every 500 ms while CSDM runs ────
            while True:
                if _ref_proc and _ref_proc.poll() is not None:
                    break
                current = _find_cs2()
                if current:
                    _push_to_back(current)
                time.sleep(0.5)

        threading.Thread(target=_watch, daemon=True).start()

    def _exec(self, cmd, cfg, timeout_s=0):
        errs, has_err, retryable = [], False, False
        self._last_raw_not_found = False
        _timed_out = [False]
        _done_event = threading.Event()
        try:
            self._proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                          text=True, encoding="utf-8", errors="replace", bufsize=1)
            # Start CS2 send-to-back watcher if the option is enabled
            if cfg.get("cs2_send_to_back"):
                self._start_cs2_send_to_back_watcher()

            # Timeout watchdog — kills CS2 + CSDM if recording takes too long.
            # taskkill uses subprocess.run (blocking) so we wait until cs2.exe is
            # actually dead before returning — otherwise cs2 keeps its inherited
            # handle on the stdout pipe open and readline() never unblocks.
            if timeout_s > 0:
                def _watchdog():
                    if _done_event.wait(timeout=timeout_s):
                        return  # finished normally
                    _timed_out[0] = True
                    self.log(
                        f"  ⏱ Recording timeout ({int(timeout_s // 60)}m{int(timeout_s % 60):02d}s)"
                        " — killing CS2 and retrying…", "warn")
                    try:
                        if self._proc and self._proc.poll() is None:
                            self._proc.kill()
                    except Exception:
                        pass
                    try:
                        subprocess.run(
                            ["taskkill", "/F", "/IM", "cs2.exe"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=15, creationflags=0x08000000)
                    except Exception:
                        pass
                threading.Thread(target=_watchdog, daemon=True).start()

            for line in iter(self._proc.stdout.readline, ""):
                line = line.rstrip("\n\r")
                if not line:
                    continue
                ll = line.lower()
                is_e = any(k.lower() in ll for k in self.ALL_ERR)
                if "raw files not found" in ll:
                    is_e = True
                    self._last_raw_not_found = True
                if is_e:
                    has_err = True
                    errs.append(line)
                    if any(k in ll for k in self.RETRYABLE):
                        retryable = True
                    self.log(f"  > {line}", "err")
                else:
                    self.log(f"  > {line}", "dim")
            self._proc.stdout.close()
            rc = self._proc.wait()
        except Exception as e:
            _done_event.set()
            return False, -1, [str(e)], False
        finally:
            _done_event.set()
        # A timeout is always retryable
        return (rc == 0) and not has_err, rc, errs, retryable or _timed_out[0]

    def _preparse_dp2(self, cfg, demo_paths):
        """Pre-parse demo files with demoparser2 in parallel threads.

        Calls _dp2_parse_demo for each demo NOT yet in cache.
        Already-cached demos are skipped — the cache is never flushed.
        This means a Preview followed immediately by a Batch run with the same
        demo set will skip the pre-parse entirely on the second call.

        Partial cache hits are handled naturally: if 100 demos were cached
        from a previous run and 5 new demos appear, only the 5 are parsed.

        Thread-safe via _dp2_cache_lock (inside _dp2_parse_demo).
        """
        required_sections = self._dp2_required_sections(cfg)
        if not required_sections:
            return

        paths = [dp for dp in demo_paths if os.path.isfile(dp)]
        if not paths:
            return

        # Determine which demos are not yet cached for the required sections
        with self._dp2_cache_lock:
            missing = []
            for dp in paths:
                entry = self._dp2_cache.get(dp, {})
                have = set(entry.get("_sections", set())) if isinstance(entry, dict) else set()
                if not required_sections.issubset(have):
                    missing.append(dp)

        n_cached = len(paths) - len(missing)

        if not missing:
            self.log(
                f"  ⚡ Pre-parse: all {len(paths)} demo(s) already cached — skipping",
                "dim")
            return

        n_threads = max(1, min(8, int(cfg.get("dp2_threads", 2))))
        if n_cached:
            self.log(
                f"  ⚡ Pre-parsing {len(missing)} demo(s) "
                f"({n_cached} already cached) with {n_threads} thread(s)…",
                "info")
        else:
            self.log(
                f"  ⚡ Pre-parsing {len(missing)} demo(s) with {n_threads} thread(s)…",
                "info")

        done = 0
        total = len(missing)
        with concurrent.futures.ThreadPoolExecutor(max_workers=n_threads) as ex:
            futs = {ex.submit(self._dp2_parse_demo, dp, required_sections): dp for dp in missing}
            for fut in concurrent.futures.as_completed(futs):
                done += 1
                try:
                    fut.result()
                except Exception as e:
                    self.log(
                        f"  ⚠ Pre-parse error ({Path(futs[fut]).name}): {e}",
                        "warn")
                # Report progress — batched: only every 5 completions or on the
                # last one, to avoid flooding the state channel.
                if done == total or done % 5 == 0:
                    self.state("progress", {"text": f"PRE-PARSE {progress_bar(done, total)}"})

        cached_total = n_cached + done
        self.log(
            f"  ✓ Pre-parse done ({done} parsed, {cached_total}/{len(paths)} total in cache)",
            "ok")

    @staticmethod
    def _dp2_required_sections(cfg):
        sections = set()
        fire_keys = {
            "kill_mod_trois_tap",
            "kill_mod_trois_shot",
            "kill_mod_one_tap",
            "kill_mod_spray_transfer",
            "kill_mod_high_velocity",
        }
        death_keys = {
            # kill_mod_wall_bang → now "mods" (DB column penetrated_objects / has_penetrated)
            # kill_mod_attacker_blind → now "mods" (DB column attacker_blinded)
            "kill_mod_airborne",    # no DB equivalent — attackerinair from demo only
            "kill_mod_collateral",  # penetrated + shot grouping — requires dp2
            "kill_mod_flick",
        }
        # Also pre-parse when only the exclusion flag is active (no positive filter).
        # Without this, exclusion-only scenarios skip the pre-parse and each demo
        # gets parsed on-demand inside the exclusion loop — very slow.
        if any(cfg.get(k) or cfg.get(f"{k}_exclude") for k in fire_keys):
            sections.add("fire")
        if any(cfg.get(k) or cfg.get(f"{k}_exclude") for k in death_keys):
            sections.add("death")
        if cfg.get("kill_mod_savior") or cfg.get("kill_mod_savior_exclude"):
            sections.add("hurt")
        # Lazy player_positions for the shared modifier layer: needed only when
        # non-lethal / "other" events are enabled AND a position-derived modifier
        # (airborne, no-scope) is active. Keeps the DP2 pre-parse lean otherwise.
        if (cfg.get("_events_non_lethal") or cfg.get("_events_other")):
            for f in KILL_FILTER_REGISTRY:
                if self._modifier_needs_positions(f.key) and (
                    cfg.get(f.key) or cfg.get(f"{f.key}_exclude")):
                    sections.add("positions")
                    break
        # Collect in-demo player names only when dp2 is already running for something else.
        # When no filter needs dp2, DB names serve as fallback — no extra parse triggered.
        if sections:
            sections.add("names")
        return sections

    def _assemble_clips(self, cfg, produced_dirs):
        container = cfg.get("video_container", "mp4")

        # Container -> FFmpeg format name (-f). FFmpeg calls mkv "matroska".
        _FMT_MAP = {
            "mkv": "matroska",
            "mp4": "mp4",
            "avi": "avi",
            "mov": "mov",
            "webm": "webm",
        }
        ffmpeg_fmt = _FMT_MAP.get(container, container)

        # Chercher FFmpeg
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            p = Path.home() / ".csdm" / "ffmpeg" / "ffmpeg.exe"
            ffmpeg = str(p) if p.exists() else None
        if not ffmpeg:
            self.log("  Assembly: FFmpeg not found.", "err")
            return

        # Collect all video files from produced directories
        _asm_base = (cfg.get("output_dir_assembled") or
                    cfg.get("output_dir_clips") or
                    cfg.get("output_dir") or "").strip()
        out_root = os.path.abspath(_asm_base) if _asm_base else ""
        clips = []
        search_dirs = [d for d in produced_dirs if d] or ([out_root] if out_root else [])
        for d in search_dirs:
            if os.path.isdir(d):
                for ext in (f".{container}", ".mp4", ".avi", ".mkv", ".mov"):
                    clips.extend(sorted(Path(d).glob(f"*{ext}")))
        # Deduplicate preserving order
        seen = set()
        clips = [c for c in clips if not (str(c) in seen or seen.add(str(c)))]

        if not clips:
            self.log("  Assembly: no clip found.", "warn")
            return

        self.log(f"  {len(clips)} clip(s) to assemble…", "info")

        # Resolve the output path
        out_name = (cfg.get("assemble_output", "assembled.mp4") or "assembled.mp4").strip()
        if not os.path.isabs(out_name):
            out_name = os.path.join(out_root, out_name)
        if not Path(out_name).suffix:
            out_name = out_name + f".{container}"
        os.makedirs(os.path.dirname(out_name) or ".", exist_ok=True)

        # Write the FFmpeg concat list
        # Use Windows paths with backslashes — FFmpeg concat handles them better
        # No apostrophes or quotes in concat format: use double quotes
        # and escape special chars (# would be interpreted as a sequence otherwise)
        try:
            lst = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", prefix="csdm_concat_",
                                              delete=False, encoding="utf-8")
            for c in clips:
                safe = str(c).replace("\\", "/").replace("'", "\\'")
                lst.write(f"file '{safe}'\n")
            lst.close()
            lst_path = lst.name
        except Exception as e:
            self.log(f"  Assembly: list error — {e}", "err")
            return

        # The # in out_name causes issues with FFmpeg on the command line.
        # Use a temp output file without special chars, then rename.
        special_chars = set('#%?*')
        needs_rename = any(c in special_chars for c in os.path.basename(out_name))
        if needs_rename:
            tmp_out = os.path.join(os.path.dirname(out_name),
                                   f"_csdm_tmp_{uuid.uuid4().hex[:8]}{Path(out_name).suffix}")
        else:
            tmp_out = out_name

        # movflags+faststart only for mp4/mov (not supported by matroska/avi)
        fast_start = ["-movflags", "+faststart"] if container in ("mp4", "mov") else []

        cmd = [ffmpeg, "-y",
               "-fflags", "+genpts",           # recompute missing/negative PTS
               "-f", "concat", "-safe", "0",
               "-i", lst_path,
               "-c:v", "copy",                 # copy video stream (no re-encode)
               "-c:a", "aac",                  # re-encode audio to fix drift
               "-b:a", f"{cfg.get('audio_bitrate', 256)}k",
               "-af", "aresample=async=1000",  # resync audio to video timeline
               ] + fast_start + [
               "-f", ffmpeg_fmt, tmp_out]

        success, rc, errs, _ = self._exec(cmd, cfg)
        try:
            os.unlink(lst_path)
        except Exception:
            pass

        if success:
            # Rename to final name if a temp file was used
            if needs_rename and tmp_out != out_name:
                try:
                    if os.path.exists(out_name):
                        os.remove(out_name)
                    os.rename(tmp_out, out_name)
                except Exception as e:
                    self.log(f"  ⚠ Assembled but rename failed: {e}\n  File: {tmp_out}", "warn")
                    out_name = tmp_out
            self.log(f"  ✓ Assembled: {out_name}", "ok")
            if cfg.get("delete_after_assemble"):
                deleted = 0
                dirs_to_check: set = set()
                for c in clips:
                    try:
                        dirs_to_check.add(c.parent)
                        c.unlink()
                        deleted += 1
                    except Exception:
                        pass

                # Determine the true root output folder — never delete at or above it.
                # output_dir_clips is the authoritative raw-clips root; fall back to
                # output_dir for backward compat with older configs.
                _clips_root_raw = (cfg.get("output_dir_clips") or cfg.get("output_dir") or "")
                out_root = Path(os.path.abspath(_clips_root_raw)).resolve() if _clips_root_raw else None

                # Walk upward from each affected dir, removing empty dirs until we
                # hit the root or a non-empty dir. This handles nested subfolder layouts
                # like <root>/<demo_name>/<session_id>/ cleanly.
                removed_dirs = 0
                visited: set = set()

                def _try_remove_dir(d: Path):
                    nonlocal removed_dirs
                    d = d.resolve()
                    if d in visited:
                        return
                    visited.add(d)
                    # Never touch the root output dir itself
                    if out_root and d == out_root:
                        return
                    # Never go above the root (resolve() handles symlinks)
                    if out_root:
                        try:
                            d.relative_to(out_root)
                        except ValueError:
                            return  # outside the output tree — bail
                    try:
                        # rmtree even if dir has residual temp/JSON files from CSDM
                        shutil.rmtree(d, ignore_errors=True)
                        if not d.exists():
                            removed_dirs += 1
                            # Recurse upward: parent may now also be empty
                            _try_remove_dir(d.parent)
                    except Exception:
                        pass

                for d in dirs_to_check:
                    _try_remove_dir(d)

                msg = f"  🗑 {deleted} clip(s) deleted"
                if removed_dirs:
                    msg += f", {removed_dirs} folder(s) removed"
                self.log(msg + ".", "dim")
        else:
            if needs_rename and os.path.exists(tmp_out):
                try:
                    os.remove(tmp_out)
                except Exception:
                    pass
            err_msg = errs[0] if errs else f"code {rc}"
            self.log(f"  ✗ Assembly failed: {err_msg}", "err")

    # ── dp2 filter definition table ────────────────────────────────────────
    # Single source of truth for every demoparser2 kill modifier.
    # Each row: (cfg_key, filter_fn_attr, apply_fn_attr, log_label, result_label, skip_label)
    #
    # filter_fn_attr  — per-demo filter method name (used by _apply_dp2_modifiers worker path)
    # apply_fn_attr   — dict-level apply method name (used by _apply_dp2_filters_to_events preview path)
    #
    # TROIS TAP is NOT listed here — it is always exclusive and handled separately.
    @staticmethod
    def _get_dp2_filter_defs():
        """Derive dp2 filter defs from KILL_FILTER_REGISTRY — replaces _DP2_FILTER_DEFS.
        Returns [(key, filter_fn, apply_fn, log, result, skip), ...]
        for filters with dp2_filter set (excludes trois_tap which is always exclusive)."""
        return [
            (f.key, f.dp2_filter, f.dp2_apply, f.dp2_log, f.dp2_result, f.dp2_skip)
            for f in KILL_FILTER_REGISTRY
            if f.dp2_filter is not None
        ]

    @property
    def _DP2_FILTER_DEFS(self):
        try:
            return self.__dp2_filter_defs_cache
        except AttributeError:
            self.__dp2_filter_defs_cache = self._get_dp2_filter_defs()
            return self.__dp2_filter_defs_cache

    def _apply_dp2_modifiers(self, dp, events, cfg):
        """Apply active demoparser2 kill modifiers for one demo (batch worker path).

        Logic mode (cfg["kill_mod_logic_dp2"]):
          "any"   (OR):    a kill passes if it satisfies at least one active filter.
          "all"   (AND):   a kill must pass every active filter.
          "mixed":         required filters must ALL match AND at least one optional matches.
        TROIS TAP always exclusive. Derived from _DP2_FILTER_DEFS.
        Returns filtered events or None if no kills remain.
        """

        if cfg.get("kill_mod_trois_tap"):
            n_before = _count_kills(events)
            events   = self._trois_tap_filter(dp, events, cfg)
            n_after  = _count_kills(events)
            self.log(f"  🎯🎲 TROIS TAP : {n_before} kills → {n_after} TROIS TAP", "info")
            if not events:
                self.log("  ⏭ SKIP: 0 TROIS TAP in this demo", "dim")
                return None
            self._stamp_mf(events, "kill_mod_trois_tap")
            return events

        # ── dp2 exclusions — strip matching kills BEFORE any positive filter ─
        excl_dp2 = [(k, getattr(self, fn), ll)
                    for k, fn, _afn, ll, _rl, _sl in self._DP2_FILTER_DEFS
                    if cfg.get(f"{k}_exclude")
                    and k not in _NO_AUTO_EXCLUDE]
        if excl_dp2:
            excluded_sigs: set = set()
            for ex_key, ex_fn, ex_label in excl_dp2:
                matched = ex_fn(dp, events, cfg)
                for e in matched:
                    if e.get("type") == "kill":
                        excluded_sigs.add((e["tick"], str(e.get("killer_sid", ""))))
                self.log(f"  🚫{ex_label} exclude : {len(excluded_sigs)} kills removed", "dim")
            events = [e for e in events
                      if e.get("type") != "kill"
                      or (e["tick"], str(e.get("killer_sid", ""))) not in excluded_sigs]
            if not _count_kills(events):
                self.log("  ⏭ SKIP: all kills excluded", "dim")
                return None

        active = [(k, getattr(self, fn), ll, rl, sl)
                  for k, fn, _afn, ll, rl, sl in self._DP2_FILTER_DEFS
                  if cfg.get(k)]
        if not active:
            # when no dp2 modifier is active (the most common case).
            return events

        logic = cfg.get("kill_mod_logic_dp2", "any")

        if logic == "all":
            for cfg_key, filter_fn, log_label, result_label, skip_label in active:
                n_before = _count_kills(events)
                events   = filter_fn(dp, events, cfg)
                n_after  = _count_kills(events)
                self.log(f"  {log_label} : {n_before} kills → {n_after} {result_label}", "info")
                if not events:
                    self.log(f"  ⏭ SKIP: {skip_label} in this demo", "dim")
                    return None
                self._stamp_mf(events, cfg_key)
            return events

        def _run_or(filters):
            """Run filters independently on original events, return sig→keys union."""
            non_kill = [e for e in events if e.get("type") != "kill"]
            s2k: dict = {}
            for cfg_key, filter_fn, log_label, result_label, _ in filters:
                n_before = _count_kills(events)
                passed   = filter_fn(dp, events, cfg)
                n_after  = _count_kills(passed)
                self.log(f"  {log_label} : {n_before} kills → {n_after} {result_label}", "info")
                for e in passed:
                    if e.get("type") == "kill":
                        sig = (e["tick"], str(e.get("killer_sid", "")))
                        s2k.setdefault(sig, set()).add(cfg_key)
            return s2k, non_kill

        def _run_and(filters):
            """Chain filters, return surviving event list."""
            evts = list(events)
            for cfg_key, filter_fn, log_label, result_label, skip_label in filters:
                n_before = _count_kills(evts)
                evts = filter_fn(dp, evts, cfg)
                n_after = _count_kills(evts)
                self.log(f"  {log_label} : {n_before} kills → {n_after} {result_label}", "info")
                if not evts:
                    self.log(f"  ⏭ SKIP: {skip_label} in this demo", "dim")
                    return None
                self._stamp_mf(evts, cfg_key)
            return evts

        if logic == "mixed":
            active_keys = [k for k, *_ in active]
            req_keys, opt_keys = self._split_required_optional(cfg, active_keys)
            req_active = [(k, fn, ll, rl, sl) for k, fn, ll, rl, sl in active if k in req_keys]
            opt_active = [(k, fn, ll, rl, sl) for k, fn, ll, rl, sl in active if k in opt_keys]

            # Required: all must pass → AND chain
            if req_active:
                req_events = _run_and(req_active)
                if req_events is None:
                    return None
                req_sigs = frozenset((e["tick"], str(e.get("killer_sid", "")))
                                     for e in req_events if e.get("type") == "kill")
            else:
                req_sigs = None

            # Optional: collect matches for global OR gate; do not narrow here
            if opt_active:
                opt_s2k, non_kill = _run_or(opt_active)
            else:
                opt_s2k, non_kill = {}, [e for e in events if e.get("type") != "kill"]
            if req_sigs is not None:
                keep_sigs = req_sigs
            else:
                keep_sigs = frozenset(
                    (e["tick"], str(e.get("killer_sid", "")))
                    for e in events if e.get("type") == "kill"
                )

            # Build merged _mf: stamp req keys + optional matched keys
            kept_kills = []
            for e in events:
                if e.get("type") != "kill":
                    continue
                sig = (e["tick"], str(e.get("killer_sid", "")))
                if sig in keep_sigs:
                    all_matched = set(req_keys)
                    all_matched |= opt_s2k.get(sig, set())
                    mf = e.get("_mf")
                    e["_mf"] = (mf | all_matched) if mf else set(all_matched)
                    kept_kills.append(e)
            result = kept_kills + non_kill
            if not result:
                self.log("  ⏭ SKIP: 0 kills after dp2 required filters in this demo", "dim")
                return None
            return result

        else:  # "any" — OR
            s2k, non_kill = _run_or(active)
            include_mod_or = self._mods_dp2_global_any_union_enabled(cfg)
            mod_sig_to_keys = {}
            if include_mod_or:
                mod_keys = set(self._SQL_MOD_KEYS)
                for e in events:
                    if e.get("type") != "kill":
                        continue
                    matched_mods = (e.get("_mf") or set()) & mod_keys
                    if not matched_mods:
                        continue
                    sig = (e["tick"], str(e.get("killer_sid", "")))
                    ex = mod_sig_to_keys.get(sig)
                    mod_sig_to_keys[sig] = (ex | matched_mods) if ex else set(matched_mods)
            kill_sigs_union = set(s2k.keys())
            if mod_sig_to_keys:
                kill_sigs_union |= set(mod_sig_to_keys.keys())
            kept_kills = []
            for e in events:
                if e.get("type") != "kill":
                    continue
                sig = (e["tick"], str(e.get("killer_sid", "")))
                if sig in kill_sigs_union:
                    matched = set(s2k.get(sig, set()))
                    if mod_sig_to_keys:
                        matched |= mod_sig_to_keys.get(sig, set())
                    if matched:
                        mf = e.get("_mf")
                        e["_mf"] = (mf | matched) if mf else set(matched)
                    kept_kills.append(e)
            result = kept_kills + non_kill
            if not result:
                self.log("  ⏭ SKIP: 0 kills after dp2 OR filters in this demo", "dim")
                return None
            return result

    def _apply_dp2_filters_to_events(self, evts, cfg):
        """Apply active dp2 modifiers to a full {demo_path: events} dict (preview/redo path).

        Logic mode (cfg["kill_mod_logic_dp2"]): "any" | "all" | "mixed".
        TROIS TAP always exclusive. Derived from _DP2_FILTER_DEFS.
        _mf stamped on all surviving kill events via _apply_filter_to_events.
        Returns a new dict with empty-demo entries removed.
        """
        if cfg.get("kill_mod_trois_tap"):
            self.log("  🎯🎲 TROIS TAP — analyzing demos…", "info")
            return self._apply_filter_to_events(
                evts, cfg, "kill_mod_trois_tap",
                self._trois_tap_filter, "🎯🎲 TROIS TAP → TROIS TAP")

        # ── dp2 exclusions — strip matching kills BEFORE any positive filter ─
        excl_dp2 = [(k, getattr(self, fn))
                    for k, fn, _afn, _ll, _rl, _sl in self._DP2_FILTER_DEFS
                    if cfg.get(f"{k}_exclude") and k not in _NO_AUTO_EXCLUDE]
        if excl_dp2:
            excl_result: dict = {}
            for dp, events in evts.items():
                excluded_sigs: set = set()
                for ex_key, ex_fn in excl_dp2:
                    for e in ex_fn(dp, events, cfg):
                        if e.get("type") == "kill":
                            excluded_sigs.add((e["tick"], str(e.get("killer_sid", ""))))
                surviving = [e for e in events
                             if e.get("type") != "kill"
                             or (e["tick"], str(e.get("killer_sid", ""))) not in excluded_sigs]
                if surviving:
                    excl_result[dp] = surviving
            evts = excl_result
            if not evts:
                return {}

        active = [(k, lambda evts, cfg, _k=k, _fn=fn, _ll=ll:
                      self._apply_filter_to_events(evts, cfg, _k, getattr(self, _fn), _ll),
                   ll)
                  for k, fn, _afn, ll, _rl, _sl in self._DP2_FILTER_DEFS
                  if cfg.get(k)]
        if not active:
            return evts

        logic = cfg.get("kill_mod_logic_dp2", "any")
        include_mod_or = self._mods_dp2_global_any_union_enabled(cfg)

        def _chain(filters, src):
            """AND-chain: each apply_fn narrows the dict further."""
            result = src
            for cfg_key, apply_fn, log_label in filters:
                self.log(f"  {log_label} — analyzing demos…", "info")
                result = apply_fn(result, cfg)
            return result

        def _union(filters, src):
            """OR-union: run each independently, merge _mf per sig."""
            per = []
            for cfg_key, apply_fn, log_label in filters:
                self.log(f"  {log_label} — analyzing demos…", "info")
                per.append((cfg_key, apply_fn(src, cfg)))

            all_demos: set = set()
            for _, r in per:
                all_demos |= set(r.keys())
            if include_mod_or:
                all_demos |= set(src.keys())

            merged = {}
            for dp in all_demos:
                sig_to_mf: dict = {}
                if include_mod_or:
                    mod_keys = set(self._SQL_MOD_KEYS)
                    for e in src.get(dp, []):
                        if e.get("type") != "kill":
                            continue
                        matched_mods = (e.get("_mf") or set()) & mod_keys
                        if not matched_mods:
                            continue
                        sig = (e["tick"], str(e.get("killer_sid", "")))
                        ex = sig_to_mf.get(sig)
                        sig_to_mf[sig] = (ex | matched_mods) if ex else set(matched_mods)
                for _, r in per:
                    for e in r.get(dp, []):
                        if e.get("type") == "kill":
                            sig = (e["tick"], str(e.get("killer_sid", "")))
                            ex = sig_to_mf.get(sig)
                            sig_to_mf[sig] = (ex | e["_mf"]) if ex else set(e.get("_mf") or set())
                kill_sigs = set(sig_to_mf.keys())
                original = src.get(dp, [])
                non_kill = [e for e in original if e.get("type") != "kill"]
                kept = []
                for e in original:
                    if e.get("type") != "kill":
                        continue
                    sig = (e["tick"], str(e.get("killer_sid", "")))
                    if sig in kill_sigs:
                        mf = sig_to_mf.get(sig)
                        if mf:
                            e["_mf"] = (e["_mf"] | mf) if e.get("_mf") else set(mf)
                        kept.append(e)
                if kept or non_kill:
                    merged[dp] = kept + non_kill
            return merged

        if logic == "all":
            return _chain(active, evts)

        if logic == "mixed":
            active_keys = [k for k, *_ in active]
            req_keys, opt_keys = self._split_required_optional(cfg, active_keys)
            req_active = [(k, fn, ll) for k, fn, ll in active if k in req_keys]
            opt_active = [(k, fn, ll) for k, fn, ll in active if k in opt_keys]

            req_result = _chain(req_active, evts) if req_active else None
            opt_result = _union(opt_active, evts) if opt_active else None

            if req_result is None and opt_result is None:
                return evts
            base = req_result if req_result is not None else evts
            if opt_result is None:
                return base
            merged = {}
            for dp, original in base.items():
                non_kill = [e for e in original if e.get("type") != "kill"]
                kept = []
                opt_sig_mf = {
                    (e["tick"], str(e.get("killer_sid", ""))): e.get("_mf") or set()
                    for e in opt_result.get(dp, []) if e.get("type") == "kill"
                }
                for e in original:
                    if e.get("type") != "kill":
                        continue
                    sig = (e["tick"], str(e.get("killer_sid", "")))
                    combined_mf = set(req_keys)
                    combined_mf |= opt_sig_mf.get(sig, set())
                    if combined_mf:
                        e["_mf"] = (e["_mf"] | combined_mf) if e.get("_mf") else combined_mf
                    kept.append(e)
                if kept or non_kill:
                    merged[dp] = kept + non_kill
            return merged

        # "any" — OR
        return _union(active, evts)

    def _preview_worker(self, cfg):
        """Compute a preview and hand the result over the state channel.

        Runs on its own thread; the host starts it. Cancellation is checked
        between stages so a cancelled preview shows nothing at all.
        """
        self.state("preview_started")
        self.state("buttons_busy")
        t0_total = time.time()
        try:
            t0 = time.time()
            evts = self._query_events(cfg)
            t_query = time.time() - t0
            if self._preview_cancel.is_set():
                return
            # ── Signature-based DP2 pre-parse (cache preserved if same demo set) ──
            t0 = time.time()
            self._preparse_dp2(cfg, list(evts.keys()))
            t_preparse = time.time() - t0
            if self._preview_cancel.is_set():
                return
            # Apply demoparser2 modifiers before preview.
            t0 = time.time()
            evts = self._apply_dp2_filters_to_events(evts, cfg)
            evts = self._apply_global_filter_gate_dict(evts, cfg)
            t_filters = time.time() - t0
            t0 = time.time()
            seqs = {}
            for dp, events in evts.items():
                if events:
                    seqs[dp] = self._build_sequences(
                        events, cfg["tickrate"],
                        self._effective_before(cfg), cfg["after"])
            t_seq = time.time() - t0
            timings = {
                "query":    t_query,
                "preparse": t_preparse,
                "filters":  t_filters,
                "seqs":     t_seq,
                "total":    time.time() - t0_total,
            }
            self.state("preview_ready", {
                "events": evts,
                "sequences": seqs,
                "cfg": cfg,
                "timings": timings,
            })
        except Exception as e:
            import traceback
            self.log(f"Preview error: {e}\n{traceback.format_exc()}", "err")
        finally:
            self._previewing = False
            self.state("buttons", {"stop": False, "stop_label": "⏸ Stop"})

    @staticmethod
    def derive_event_flags_v2(cfg):
        """Turn the 2-axis event model into query booleans.

        Reads the new `event_actor` / `event_target` / `event_ally` /
        `event_enemy` keys and produces both the new derived booleans and the
        legacy `events_kills` / `events_deaths` / `events_rounds` ones so the
        current `_query_events` keeps working (a later task rewires it onto
        events_lethal / events_non_lethal / events_other).
        """
        actor = cfg.get("event_actor", True)
        target = cfg.get("event_target", False)
        ally = cfg.get("event_ally", False)
        enemy = cfg.get("event_enemy", True)

        return {
            # Action-type booleans (what to query)
            "_events_lethal": cfg.get("event_lethal", True) and (actor or target),
            "_events_non_lethal": cfg.get("event_non_lethal", False),  # Separate toggle
            "_events_other": cfg.get("event_other", False),           # Separate toggle
            # Perspective booleans (prefixed _events_ to avoid collision with config keys)
            "_events_actor": actor,
            "_events_target": target,
            # Team filter booleans
            "_events_ally": ally,
            "_events_enemy": enemy,
            # Rounds stays independent
            "_events_rounds": "Rounds" in (cfg.get("events") or []),
            # Legacy booleans (backward-compat; _query_events still reads these)
            "events_kills": actor,
            "events_deaths": target,
        }

    @staticmethod
    def derive_event_flags(cfg):
        """Backward-compat wrapper: old flat `events` list → legacy booleans.

        Kept so legacy callers and tests that still pass an `events` list keep
        working. New code should use `derive_event_flags_v2`.
        """
        events = cfg.get("events") or []
        return {
            "events_kills":  "Kills" in events,
            "events_deaths": "Deaths" in events,
            "events_rounds": "Rounds" in events,
        }

    def build_run_cfg(self, cfg):
        """Return `cfg` plus the derived event flags, ready for run or preview.

        A copy, never the caller's dict: the window reuses the one it
        collected, and a run must not leave marks on it.
        """
        return {**cfg, **self.derive_event_flags_v2(cfg)}

    def validate_run_inputs(self, cfg):
        """Check the preconditions run and preview share. False stops the caller."""
        if not cfg.get("steam_ids"):
            self.ask("error", "Check at least one registered account.", [])
            return False
        if not (cfg.get("event_actor") or cfg.get("event_target")):
            # Rounds is independent of the perspective axis;
            # allow a config with only Rounds enabled.
            if not (cfg.get("events") or []):
                self.ask("error", "Select at least one perspective (Actor / Target) or enable Rounds.", [])
                return False
        return True

    def start_run(self, cfg, selected_clips=None):
        """Launch a batch run on its own thread. False when the inputs are unusable.

        The header lines and the flag reset are lifted from the window's own
        `_run`, character for character: a run must read the same in the
        console whichever host started it. `_worker` raises `run_started` and
        `buttons_busy` itself -- do not raise them twice.

        selected_clips: optional list of {demo_path, start_tick} dicts restricting
        the run to those clips; None (default) runs every clip.
        """
        if not self.validate_run_inputs(cfg):
            return False
        ensure_csdm_dirs()
        self._running = True
        self._stop_after_current = False
        self._kill_triggered = False
        self._selected_clips = selected_clips
        self._tagged_this_batch = []   # [(demo_path, tag_name), ...] -- for rollback
        self.state("buttons", {"run": False, "stop": True, "kill": True})
        self.log(f"\n{'═' * 60}", "dim")
        self.log(f"  ▶ LAUNCH  —  {datetime.now().strftime('%H:%M:%S')}", "info")
        self.log(f"{'═' * 60}", "dim")
        self.state("summary", {"text": "  Querying DB…", "level": "running"})
        threading.Thread(target=self._worker, args=(cfg,), daemon=True).start()
        return True

    def start_preview(self, cfg):
        """Compute a preview on its own thread. False when the inputs are unusable."""
        if not self.validate_run_inputs(cfg):
            return False
        self.log(f"\n{'─' * 60}", "dim")
        self.log(f"  🔍 PREVIEW  —  {datetime.now().strftime('%H:%M:%S')}", "info")
        self.log(f"{'─' * 60}", "dim")
        self.state("summary", {"text": "  Computing…", "level": "running"})
        self._previewing = True
        self._preview_cancel.clear()
        self.state("buttons", {"stop": True, "stop_label": "⏸ Stop Preview"})
        threading.Thread(target=self._preview_worker, args=(cfg,), daemon=True).start()
        return True

    def request_stop(self):
        """Dispatch stop to the right handler based on current state."""
        if self._previewing:
            self.cancel_preview()
        elif self._running:
            self._stop_graceful()

    def cancel_preview(self):
        """Cancel a running preview computation."""
        self._preview_cancel.set()
        self._previewing = False
        self.log("\n⏸ Preview cancelled.", "warn")
        self.state("buttons", {"stop": False, "stop_label": "⏸ Stop"})

    def _stop_graceful(self):
        """Stop after current demo: kill the running CSDM process immediately,
        mark current demo as failed, then do not start the next one."""
        self._stop_after_current = True
        self._running = False
        # Announced before the work, not after: an interface stages a waiting
        # charge on this event and must not stage it from its own click (D18).
        self.state("stop_requested")
        _demo = self._current_demo or "current demo"
        self.log(
            f"\n⏸ STOP — {datetime.now().strftime('%H:%M:%S')}\n"
            f"  Killing CSDM for: {_demo}\n"
            f"  Remaining demos will be skipped.",
            "warn")
        self.state("buttons", {"stop": False})
        if self._proc:
            try:
                self._proc.kill()
            except Exception:
                pass

    def request_kill(self, probe=None):
        """Hard kill: stop everything immediately, kill CS2 process, skip assembly,
        and revert tags applied during this batch.

        `taskkill` is run and WAITED ON, then the task list is watched until the
        process is really gone. The old code fired a `Popen` and moved on, so the
        moment of death was never known -- and an interface cannot honestly
        report an exit it never observed (D17, D18).
        """
        self._kill_triggered = True
        self._running = False
        self._stop_after_current = True
        self.state("kill_requested")
        _demo = self._current_demo or "current demo"
        self.log(
            f"\n⛔ KILL — {datetime.now().strftime('%H:%M:%S')}\n"
            f"  Hard-killing CSDM process and cs2.exe.\n"
            f"  Aborted on: {_demo}\n"
            f"  Assembly and remaining demos cancelled.\n"
            f"  Any tags applied this batch will be reverted.",
            "err")
        if self._proc:
            try:
                self._proc.kill()
            except Exception:
                pass
        name = self._host_cfg("cs2_process_name")
        # Kill CS2 process (Windows only — silent no-op on others)
        try:
            subprocess.run(
                ["taskkill", "/F", "/IM", name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=15, creationflags=0x08000000  # CREATE_NO_WINDOW
            )
        except Exception:
            pass
        self._await_process_exit(name, probe=probe)
        self.state("buttons_idle")

    def _worker(self, cfg):
        self.state("run_started")
        self.state("buttons_busy")
        cli = self._resolve_cli(cfg["csdm_exe"])
        self.log(f"CLI: {cli}", "dim")
        if not os.path.isfile(cli):
            w = shutil.which(cli)
            if w:
                cli = w
            else:
                self.log(f"CLI not found: {cli}", "err")
                self.state("buttons_idle")
                return
        player_str = self._player_str(cfg)
        tv = cfg.get("true_view", True)
        tag_name = cfg.get("tag_on_export", "")
        tag_enabled = cfg.get("tag_enabled", False) and bool(tag_name)
        perspective = cfg.get("perspective", "killer")
        self.log(f"Player(s): {player_str}", "info")
        self.log(f"Video: {cfg['width']}x{cfg['height']}@{cfg['framerate']}fps CRF={cfg['crf']} {cfg['video_codec']} {cfg['video_container']}", "info")
        tag_str = f" | Tag: \U0001f3f7 {tag_name}" if tag_enabled else ""
        recsys = self._normalize_recsys(cfg.get("recsys", "HLAE"))
        cfg["recsys"] = recsys
        hlae_info = ""
        if recsys == "HLAE":
            fov = cfg.get("hlae_fov", 90)
            sm = cfg.get("hlae_slow_motion", 100)
            hlae_info = f" | FOV:{fov}"
            if int(sm) != 100:
                hlae_info += f" Slow:{sm}%"
            if cfg.get("hlae_fix_scope_fov", True):
                hlae_info += " | ScopeFOV:fix"
            # Non-default physics
            phys_parts = []
            rg = cfg.get("phys_ragdoll_gravity", 600)
            if int(rg) != 600:   phys_parts.append(f"RagGrav:{rg}")
            sg = cfg.get("phys_sv_gravity", 800)
            if int(sg) != 800:   phys_parts.append(f"Grav:{sg}")
            rs = cfg.get("phys_ragdoll_scale", "1.0")
            if float(rs) != 1.0: phys_parts.append(f"RagScale:{rs}")
            if not cfg.get("phys_ragdoll_enable", True): phys_parts.append("NoRagdoll")
            if not cfg.get("phys_blood", True):          phys_parts.append("NoBlood")
            if not cfg.get("phys_dynamic_lighting", True): phys_parts.append("NoDynLight")
            if phys_parts:
                hlae_info += f" | Phys: {' '.join(phys_parts)}"
        self.log(f"Encoder: {cfg['encoder']} | RecSys: {recsys}{hlae_info} | TrueView: {'ON' if tv else 'OFF'} | Perspective: {PERSP_LABELS.get(perspective, perspective)}{tag_str}", "info")
        if recsys == "CS":
            _shared = self._common_cs2_injection(cfg)
            self._inject_cs_runtime_cfg(cfg, _shared)
            self.log(
                "  ⚠ RecSys CS: CS2 replays the demo from tick 0 to reach the target tick.\n"
                "  Each clip will take as long as the full demo before the event.\n"
                "  HLAE is strongly recommended for batch recording.", "warn")
        _hsm = cfg.get("headshots_mode", "all")
        if _hsm == "only":
            self.log("🎯 Headshots only", "info")
        elif _hsm == "exclude":
            self.log("🎯 Headshots excluded", "info")
        _sm = cfg.get("suicides_mode", "include")
        if _sm == "exclude":
            self.log("🚫 Suicides excluded", "info")
        elif _sm == "only":
            self.log("💀 Suicides only", "info")
        _tkm = cfg.get("teamkills_mode", "include")
        if _tkm == "exclude":
            self.log("🚫 Teamkills excluded", "info")
        elif _tkm == "only":
            self.log("⚔ Teamkills only", "info")
        if cfg.get("clutch_enabled"):
            _cmode = "Full clutch" if cfg.get("clutch_mode") == "full_clutch" else "Kills only"
            _csizes = [f"1v{n}" for n in range(1, 6) if cfg.get(f"clutch_1v{n}")]
            _csize_str = " " + " ".join(_csizes) if _csizes else " (all sizes)"
            _cwins = " · Wins only" if cfg.get("clutch_wins_only") else ""
            self.log(f"🎯 Clutch: {_cmode}{_csize_str}{_cwins}", "info")
        batch_start = time.time()
        _df = cfg.get("date_from", "")
        _dt = cfg.get("date_to", "")
        if _df or _dt:
            self.log(f"Date filter: {_df or '∞'}  →  {_dt or '∞'}", "info" if self._date_col else "warn")
        self.log("Querying DB...", "info")
        t0_query = time.time()
        try:
            all_events = self._query_events(cfg)
        except Exception as e:
            self.log(f"Error: {e}", "err")
            self.state("buttons_idle")
            return
        t_query = time.time() - t0_query
        if not all_events:
            self.log("No events.", "warn")
            self.state("summary", {"text": "  No clips found.", "level": "muted"})
            self.state("buttons_idle")
            return
        te = sum(len(e) for e in all_events.values())
        # Compute summary once (reused at the end)
        _nd, _nc, _ts, _as = self._calc_summary(all_events, cfg)
        _stxt = self._fmt_summary(_nd, _nc, _ts, _as)
        self.state("summary", {"text": _stxt + "  [running…]", "level": "running",
                               **self._summary_counts(_nd, _nc, _ts, _as)})
        self.log(f"OK: {len(all_events)} demo(s), {te} events  ⏱ DB {t_query*1000:.0f}ms", "ok")
        self.log("-" * 56, "dim")

        order = cfg.get("clip_order", "chrono")
        # Apply demo picker filter — only keep demos checked in the picker
        _picker_active = self._demo_picker_get_active()
        if _picker_active is not None:
            _picker_set = set(_picker_active)
            _before = len(all_events)
            all_events = {dp: evts for dp, evts in all_events.items()
                          if dp in _picker_set}
            _removed = _before - len(all_events)
            if _removed:
                self.log(f"  ⚙ Demo picker: {_removed} demo(s) excluded by manual selection", "dim")
        if order == "random":
            items = list(all_events.items())
            random.shuffle(items)
            demo_list = items
            self.log("Order: Random 🎲", "info")
        else:
            demo_list = sorted(all_events.items(), key=lambda kv: self._demo_sort_key(kv[0]))
            self.log("Order: Chronological", "info")

        ok = fail = skip = retried = tagged = 0
        summary = []
        produced_dirs = []   # output dirs of successful demos (for assembly)

        # ── Signature-based DP2 pre-parse (cache preserved if same demo set) ──
        self._preparse_dp2(cfg, [dp for dp, _ in demo_list])
        # ─────────────────────────────────────────────────────────────────────

        skip_already_tagged = False   # True = skip already-tagged demos
        _already_tagged_paths = set() # paths of already-tagged demos
        if tag_enabled:
            ts = self._tags_schema
            jt       = ts.get("junction_table")
            jt_tag   = ts.get("jt_tag_col")
            jt_match = ts.get("jt_match_col")
            tag_id   = next((tid for tid, tn, _ in self._tags_list if tn == tag_name), None)
            mkm      = self._find_col("matches", ["checksum", "id", "match_id"])
            dc       = self._find_col("matches", ["demo_path", "demo_file_path",
                                                   "demo_filepath", "share_code",
                                                   "file_path", "path"])
            if jt and jt_tag and jt_match and tag_id and mkm and dc:
                try:
                    conn = self._pg_fresh()
                    with conn.cursor() as cur:
                        # Fetch all checksums already associated with this tag
                        cur.execute(
                            f'SELECT "{jt_match}" FROM "{jt}" WHERE "{jt_tag}"=%s',
                            (tag_id,))
                        tagged_checksums = {r[0] for r in cur.fetchall()}
                    conn.close()
                    # Map demo paths to their checksums
                    for dp, _ in demo_list:
                        chk = self._get_demo_checksum(dp)
                        if chk and chk in tagged_checksums:
                            _already_tagged_paths.add(dp)
                except Exception:
                    pass

            if _already_tagged_paths:
                n_already = len(_already_tagged_paths)
                # Ask the user — blocks until answered (self.ask waits on an Event)
                # include = keep them anyway, ignore = skip them, None = cancel and redo preview
                demo_names = [Path(dp).name for dp, _ in demo_list
                              if dp in _already_tagged_paths]
                lines = "\n".join(f"  • {nm}" for nm in demo_names[:5])
                ellipsis = "\n  …" if n_already > 5 else ""
                msg = (
                    f"{n_already}/{len(demo_list)} demo(s) already have tag \"{tag_name}\":\n"
                    f"{lines}{ellipsis}\n\n"
                    f"[Yes] Include anyway\n"
                    f"[No] Ignore\n"
                    f"[Cancel] Stop and redo preview without them"
                )
                answer = self.ask("confirm", msg,
                                  ["Already tagged demos", "include", "ignore"])

                if answer is None:
                    # Cancel → uncheck already-tagged in picker, redo preview without them.
                    self.state("demos_unchecked", {"paths": list(_already_tagged_paths)})
                    filtered_events = {dp: ev for dp, ev in all_events.items()
                                       if dp not in _already_tagged_paths}
                    self.log(f"  ⏭ Cancelled — preview restarted without {n_already} already-tagged demo(s)", "info")
                    self.log(f"\n{'─' * 60}", "dim")
                    self.log(f"  PREVIEW (without already tagged)  —  "
                             f"{datetime.now().strftime('%H:%M:%S')}", "info")
                    self.log(f"{'─' * 60}", "dim")
                    self.state("summary", {"text": "  Computing…", "level": "running"})
                    _fe = filtered_events

                    def _bg():
                        nonlocal _fe
                        self._preparse_dp2(cfg, list(_fe.keys()))
                        _fe = self._apply_dp2_filters_to_events(_fe, cfg)
                        _fe = self._apply_global_filter_gate_dict(_fe, cfg)
                        self.state("preview_ready", {"events": _fe, "cfg": cfg,
                                                     "timings": None})

                    threading.Thread(target=_bg, daemon=True).start()
                    self.state("buttons_idle")
                    return
                elif answer == "include":
                    skip_already_tagged = False
                    self.log(f"  ▶ {n_already} already-tagged demo(s) → included anyway", "info")
                else:
                    skip_already_tagged = True
                    # ignore → skip during this run AND uncheck in picker for future runs.
                    self.state("demos_unchecked", {"paths": list(_already_tagged_paths)})
                    self.log(f"  ⏭ {n_already} already-tagged demo(s) → ignored", "info")

        for i, (dp, events) in enumerate(demo_list, 1):
            if self._stop_after_current or not self._running:
                for j in range(i - 1, len(demo_list)):
                    summary.append((Path(demo_list[j][0]).name, "SKIP", 0, 0, "Stop"))
                    skip += 1
                break

            # Skip already-tagged demos if the user chose to ignore them
            if skip_already_tagged and dp in _already_tagged_paths:
                dn_skip = Path(dp).name
                self.log(f"  ⏭ SKIP (already tagged): {dn_skip}", "dim")
                summary.append((Path(dp).name, "SKIP", 0, 0, "Already tagged"))
                skip += 1
                continue

            # ── demoparser2 kill modifiers ─────────────────────────────────────
            t0_dp2 = time.time()
            events = self._apply_dp2_modifiers(dp, events, cfg)
            # Use 'is not None' — _apply_dp2_modifiers signals "skip this demo"
            # with an explicit None return; an empty list is a valid (though unusual)
            # result and must not be conflated with the skip sentinel.
            events = self._apply_global_filter_gate_events(events, cfg) if events is not None else None
            t_dp2 = time.time() - t0_dp2
            if events is None:
                summary.append((Path(dp).name, "SKIP", 0, 0, "0 kills after filter"))
                skip += 1
                continue

            t0_seq = time.time()
            seqs = self._build_sequences(
                events, cfg["tickrate"],
                self._effective_before(cfg), cfg["after"])
            t_seq = time.time() - t0_seq
            if self._selected_clips is not None:
                selected = {(s["demo_path"], s["start_tick"])
                            for s in self._selected_clips}
                seqs = [s for s in seqs
                        if (dp, s["start_tick"]) in selected]
                if not seqs:
                    continue
            if not seqs:
                continue
            dn = Path(dp).name
            ad = os.path.abspath(dp)
            self._current_demo = dn
            date_str = self._format_demo_date(dp)
            self.state("progress", {"text": progress_bar(i, len(demo_list))})
            _timing_str = ""
            if t_dp2 > 0.01 or t_seq > 0.001:
                _parts = []
                if t_dp2 > 0.01:
                    _parts.append(f"dp2 {t_dp2*1000:.0f}ms")
                if t_seq > 0.001:
                    _parts.append(f"seq {t_seq*1000:.1f}ms")
                _timing_str = f"  ⏱ {' '.join(_parts)}"
            self.state("demo_entry", {
                "date_str": date_str,
                "demo_name": dn,
                "events": events,
                "seq_count": len(seqs),
                "cfg": cfg,
                "idx": i,
                "total": len(demo_list),
                "timing_str": _timing_str,
            })
            if not os.path.isfile(ad):
                self.log(f"  SKIP: {ad}", "warn")
                summary.append((dn, "SKIP", 0, 0, "Not found"))
                skip += 1
                continue

            cj = self._build_json(dp, seqs, cfg)

            # ── Extended logging ───────────────────────────────────────────────
            tickrate = cfg.get("tickrate", 64)
            for si, seq in enumerate(seqs, 1):
                dur_ticks = seq["end_tick"] - seq["start_tick"]
                dur_s = dur_ticks / tickrate if tickrate else 0
                _cams = (cj.get("sequences", [{}])[si - 1].get("playerCameras", [])
                         if si - 1 < len(cj.get("sequences", [])) else [])
                _cam0 = _cams[0] if _cams else {}
                _sid0 = _cam0.get("playerSteamId", "")
                self.log(
                    f"  seq {si}/{len(seqs)}  tick {seq['start_tick']}→{seq['end_tick']}"
                    f"  ({dur_s:.1f}s)  cam:{_sid0 or '-'}", "dim")
            self.log(
                f"  RecSys: {cfg.get('recsys','HLAE')} | "
                f"TrueView: {'ON' if cfg.get('true_view') else 'OFF'} | "
                f"Concat: {'ON' if cfg.get('concatenate_sequences') else 'OFF'}",
                "dim")
            if cj.get("hlaeOptions"):
                ho = cj["hlaeOptions"]
                parts = []
                if "mirv_fov" in ho:         parts.append(f"FOV={ho['mirv_fov']}")
                if "host_timescale" in ho:   parts.append(f"Slow={ho['host_timescale']}")
                if ho.get("afxStream"):      parts.append("AFX")
                if ho.get("hideSpectatorUi"):parts.append("NoUI")
                if ho.get("extraArgs"):      parts.append(f"args={ho['extraArgs'][:60]}")
                if parts:
                    self.log(f"  HLAE: {' | '.join(parts)}", "dim")
            # ──────────────────────────────────────────────────────────────────

            try:
                tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", prefix="csdm_",
                                                   delete=False, encoding="utf-8")
                json.dump(cj, tmp, indent=2, ensure_ascii=False)
                tmp.close()
                tp = tmp.name
            except Exception as e:
                summary.append((dn, "FAIL", 0, 0, str(e)))
                fail += 1
                continue

            self.log(f"  JSON: {tp}", "dim")
            cmd = [cli, "video", "--config-file", tp]
            self.log(f"  CMD: {' '.join(cmd)}", "dim")

            mx = 1 + cfg.get("retry_count", 2)

            # ── Per-demo smart timeout ─────────────────────────────────────────
            # Formula: max(content × 3, 60s minimum)
            #   • ×3 safety on content  (seek + render overhead per demo)
            #   • 60s minimum           (floor for very short content)
            _user_timeout_s = max(0, int(cfg.get("recording_timeout", 0))) * 60
            _tr = cfg.get("tickrate", 64) or 64
            _timescale = max(0.05,
                             (cfg.get("hlae_slow_motion", 100) or 100) / 100.0)
            _sum_clip_s = sum(
                (s["end_tick"] - s["start_tick"]) / _tr for s in seqs)
            _auto_timeout_s = max(int((_sum_clip_s / _timescale) * 3), 60)
            if _user_timeout_s > 0:
                _rec_timeout_s = max(_user_timeout_s, _auto_timeout_s)
            else:
                _rec_timeout_s = _auto_timeout_s
            _to_min = _rec_timeout_s // 60
            _to_sec = _rec_timeout_s % 60
            _slow_part = f", slow {int(_timescale*100)}%" if _timescale < 0.99 else ""
            self.log_parts([
                ("  ⏱ Timeout: ", "dim"),
                (f"{_to_min}m{_to_sec:02d}s", "info"),
                ("  (content ", "dim"),
                (f"{_sum_clip_s:.0f}s", "ok"),
                (", ", "dim"),
                (f"{len(seqs)} seq", "blue"),
                (f"{_slow_part})", "dim"),
            ])

            att = 0
            d_ok = False
            d_err = ""
            t0 = time.time()
            while att < mx:
                if self._stop_after_current and att > 0:
                    break
                att += 1
                if att > 1:
                    retried += 1
                    delay = cfg.get("retry_delay", 15)
                    self.log(f"  ↻ Retry {att - 1} — {delay}s...", "warn")
                    for _ in range(delay):
                        if not self._running:
                            break
                        time.sleep(1)
                    if not self._running:
                        break
                success, rc, errs, retryable = self._exec(cmd, cfg, timeout_s=_rec_timeout_s)
                if success:
                    d_ok = True
                    break
                d_err = errs[0] if errs else f"code {rc}"
                if retryable and att < mx:
                    continue
                break

            # ── TrueView fallback: retry with TrueView OFF if CSDM can't find raw files
            if not d_ok and tv and getattr(self, "_last_raw_not_found", False):
                self.log(
                    "  ⚠ TrueView: raw files not found (old demo?) — retrying with TrueView OFF…",
                    "warn")
                try:
                    with open(tp, "r", encoding="utf-8") as _f:
                        _jdata = json.load(_f)
                    _jdata["trueView"] = False
                    with open(tp, "w", encoding="utf-8") as _f:
                        json.dump(_jdata, _f, indent=2)
                    success, rc, errs_tv, _ = self._exec(cmd, cfg)
                    if success:
                        d_ok = True
                        d_err = ""
                        self.log("  ✓ TrueView-OFF retry succeeded", "ok")
                    else:
                        d_err = errs_tv[0] if errs_tv else d_err
                except Exception as _tv_e:
                    self.log(f"  ⚠ TrueView-OFF retry error: {_tv_e}", "warn")

            dur = time.time() - t0
            threading.Thread(
                target=lambda p=tp: (time.sleep(10), os.unlink(p) if os.path.exists(p) else None),
                daemon=True).start()

            if d_ok:
                ds = fmt_duration(dur)
                ri = f" x{att}" if att > 1 else ""
                tag_msg = ""
                if tag_enabled:
                    _auto_names = self._get_active_tag_names() if self._get_active_tag_names() else ([tag_name] if tag_name else [])
                    _tag_ok_names, _tag_fail = [], ""
                    for _tn in _auto_names:
                        _tok, _terr = self._tag_demo(dp, _tn)
                        if _tok:
                            _tag_ok_names.append(_tn)
                            self._tagged_this_batch.append((dp, _tn))
                        elif not _tag_fail:
                            _tag_fail = _terr
                    if _tag_ok_names:
                        tagged += 1
                        tag_msg = f" \U0001f3f7 {', '.join(_tag_ok_names)}"
                    if _tag_fail:
                        tag_msg += f" \U0001f3f7 FAILED: {_tag_fail}"
                self.log(f"  ✓ OK [{ds}]{ri}{tag_msg}", "ok")
                summary.append((dn, "OK", dur, att, ""))
                produced_dirs.append(cj.get("outputFolderPath", ""))
                ok += 1
            else:
                ds = fmt_duration(dur)
                self.log(f"  ✗ FAILED [{ds}] {d_err}", "err")
                summary.append((dn, "FAIL", dur, att, d_err))
                fail += 1

            if i < len(demo_list) and not self._stop_after_current:
                delay = cfg.get("delay_between_demos", 3)
                if delay > 0:
                    self.log(f"  Pause {delay}s...", "dim")
                    for _ in range(delay):
                        if self._stop_after_current:
                            break
                        time.sleep(1)

        bd = time.time() - batch_start
        self.log("\n" + "═" * 60, "dim")
        self.log("  SUMMARY", "info")
        self.log("═" * 60, "dim")
        for n, st, d, a, e in summary:
            ds = fmt_duration(d) if d > 0 else "-"
            rs = f" x{a}" if a > 1 else ""
            if st == "OK":
                self.log(f"  ✓ {n} [{ds}]{rs}", "ok")
            elif st == "SKIP":
                self.log(f"  ⏭ {n} {e}", "warn")
            else:
                self.log(f"  ✗ {n} [{ds}]{rs} {e}", "err")
        self.log("─" * 60, "dim")
        tag_summary = f" Tagged:{tagged}" if tag_enabled else ""
        self.log(f"  OK:{ok} Failed:{fail} Skip:{skip} Retries:{retried}{tag_summary} Duration:{fmt_duration(bd)}", "info")
        self.log("═" * 60, "dim")
        self.state("progress", {"text": f"{ok}/{len(demo_list)} OK ({fmt_duration(bd)})"})
        # Final summary — reuse the summary computed before the loop
        _level = "ok" if fail == 0 else ("warn" if ok > 0 else "err")
        _status = f"  ✓ {ok}/{len(demo_list)} demos OK" if fail == 0 else f"  ⚠ {ok} OK / {fail} failed"
        _stxt_final = self._fmt_summary(_nd, _nc, _ts, _as) + f"  —  {fmt_duration(bd)}{_status}"
        self.state("summary", {"text": _stxt_final, "level": _level,
                               **self._summary_counts(_nd, _nc, _ts, _as)})

        if ok > 0 and cfg.get("assemble_after") and not self._kill_triggered:
            self.log("\n⚙  Final assembly in progress...", "info")
            try:
                self._assemble_clips(cfg, produced_dirs)
            except Exception as e:
                self.log(f"  Assembly error: {e}", "err")
        elif self._kill_triggered and cfg.get("assemble_after"):
            self.log("\n⏭ Assembly skipped (batch killed).", "warn")

        # ── Tag rollback on premature stop ────────────────────────────────────
        _was_interrupted = self._kill_triggered or (self._stop_after_current and ok < len(demo_list))
        if _was_interrupted and self._tagged_this_batch and tag_enabled:
            self.log(f"\n↩ Rolling back {len(self._tagged_this_batch)} tag(s)…", "warn")
            _rolled_back, _rb_fail = 0, 0
            for _dp, _tn in self._tagged_this_batch:
                try:
                    conn = self._pg()
                    chk = self._demo_checksums.get(_dp)
                    if not chk:
                        _rb_fail += 1
                        continue
                    with conn.cursor() as cur:
                        # Find tag id by name
                        cur.execute("SELECT id FROM tags WHERE name = %s LIMIT 1", (_tn,))
                        row = cur.fetchone()
                        if not row:
                            _rb_fail += 1
                            continue
                        tag_id = row[0]
                        cur.execute(
                            "DELETE FROM checksum_tags WHERE checksum = %s AND tag_id = %s",
                            (chk, tag_id))
                        conn.commit()
                        _rolled_back += 1
                except Exception:
                    _rb_fail += 1
            msg = f"  ↩ Rolled back {_rolled_back} tag(s)"
            if _rb_fail:
                msg += f" ({_rb_fail} failed)"
            self.log(msg, "warn")
        self._tagged_this_batch = []
        self._selected_clips = None

        self.state("buttons_idle")

    # ── kill filters: gates, cascades, dp2 parser ───────────────────────────

    @staticmethod
    def _non_kill_only(events):
        return [e for e in events if e.get("type") != "kill"]

    @staticmethod
    def _stamp_mf(events, cfg_key):
        """Add cfg_key to the _mf (matched-filters) set on every kill event.

        """
        for e in events:
            if e.get("type") == "kill":
                mf = e.get("_mf")
                if mf is None:
                    e["_mf"] = {cfg_key}
                else:
                    mf.add(cfg_key)

    @staticmethod
    def _split_required_optional(cfg, keys: list) -> tuple:
        """Split active filter cfg_keys into (required, optional) from ★ Must flags."""
        required = [k for k in keys if cfg.get(f"{k}_req", False)]
        optional = [k for k in keys if not cfg.get(f"{k}_req", False)]
        return required, optional

    # Ordered list of (cfg_key, emoji_label, category) for every kill filter that has a badge.
    # category: "mods" | "dp2" | "db"
    # Used by _build_filter_badges (per-clip) and _build_filter_header_parts (preview header).
    @staticmethod
    def _get_filter_badge_defs():
        """Derive badge defs from KILL_FILTER_REGISTRY — replaces _FILTER_BADGE_DEFS.
        Returns [(key, badge, category), ...] for all registered filters."""
        return [(f.key, f.badge, f.category) for f in KILL_FILTER_REGISTRY]

    # Cached class-level property — derived once from registry
    @property
    def _FILTER_BADGE_DEFS(self):
        try:
            return self.__filter_badge_defs_cache
        except AttributeError:
            self.__filter_badge_defs_cache = self._get_filter_badge_defs()
            return self.__filter_badge_defs_cache

    def _dp2_parse_demo(self, demo_path, required_sections=None):
        if required_sections is None:
            required_sections = {"fire", "death", "hurt", "names"}
        required_sections = set(required_sections)
        with self._dp2_cache_lock:
            existing = self._dp2_cache.get(demo_path)
            if not isinstance(existing, dict):
                existing = {}
            existing_sections = set(existing.get("_sections", set()))
        needed = required_sections - existing_sections
        if not needed:
            return True
        if not os.path.isfile(demo_path):
            with self._dp2_cache_lock:
                cur = self._dp2_cache.get(demo_path, {})
                if not isinstance(cur, dict):
                    cur = {}
                cur.setdefault("fire_detail", {})
                cur.setdefault("fire_ticks", {})
                cur.setdefault("view_angles", {})
                cur.setdefault("hurt_index", {})
                cur.setdefault("death_flags", {})
                cur["_sections"] = set(cur.get("_sections", set())) | required_sections
                self._dp2_cache_put_locked(demo_path, cur)
            return False
        try:
            from demoparser2 import DemoParser
        except ImportError:
            self.log(
                "  ⚠ demoparser2 not installed — install with: pip install demoparser2",
                "warn")
            return False
        try:
            parser = DemoParser(demo_path)
        except Exception as e:
            self.log(f"  ⚠ dp2 parse error ({Path(demo_path).name}): {e}", "warn")
            return False

        fire_detail = dict(existing.get("fire_detail") or {})
        fire_ticks = dict(existing.get("fire_ticks") or {})
        view_angles = dict(existing.get("view_angles") or {})
        hurt_index = dict(existing.get("hurt_index") or {})
        death_flags = dict(existing.get("death_flags") or {})
        demo_names = dict(existing.get("demo_names") or {})

        if "fire" in needed:
            try:
                fire_df = parser.parse_event(
                    "weapon_fire",
                    player=["is_scoped", "velocity_X", "velocity_Y",
                            "accuracy_penalty", "player_steamid"],
                    other=[],
                )
                if fire_df is None or len(fire_df) == 0:
                    fire_detail = {}
                    fire_ticks = {}
                else:
                    cols = list(fire_df.columns)
                    def _col(name):
                        if name in cols:
                            return name
                        if f"user_{name}" in cols:
                            return f"user_{name}"
                        return None
                    col_sid = _col("player_steamid") or _col("steamid")
                    col_acc = _col("accuracy_penalty")
                    col_scope = _col("is_scoped")
                    col_vx = _col("velocity_X")
                    col_vy = _col("velocity_Y")
                    if not col_sid or not col_acc:
                        self.log(
                            f"  ⚠ dp2: steamid/accuracy columns missing in weapon_fire "
                            f"({Path(demo_path).name})", "warn")
                        fire_detail = {}
                        fire_ticks = {}
                    else:
                        # Vectorized: pandas ops release the GIL → less UI blocking
                        import numpy as _np
                        wdf = fire_df[["tick", "weapon", col_sid, col_acc]].copy()
                        wdf.columns = ["tick", "weapon", "sid", "acc"]
                        wdf["tick"] = wdf["tick"].fillna(0).astype(int)
                        wdf["weapon"] = (wdf["weapon"].fillna("").str.lower()
                                         .str.replace(r"^weapon_", "", regex=True))
                        wdf["sid"] = wdf["sid"].fillna("").astype(str)
                        wdf["acc"] = wdf["acc"].fillna(0).astype(float)
                        wdf["scoped"] = (fire_df[col_scope].fillna(False).astype(bool)
                                         if col_scope else False)
                        if col_vx and col_vy:
                            _vx = fire_df[col_vx].fillna(0).astype(float)
                            _vy = fire_df[col_vy].fillna(0).astype(float)
                            wdf["vel"] = _np.sqrt(_vx * _vx + _vy * _vy)
                        else:
                            wdf["vel"] = 0.0
                        wdf.sort_values("tick", inplace=True)
                        fire_detail = {}
                        fire_ticks = {}
                        for (sid, wpn), grp in wdf.groupby(["sid", "weapon"], sort=False):
                            key = (sid, wpn)
                            t = grp["tick"].tolist()
                            fire_detail[key] = list(zip(
                                t, grp["acc"].tolist(),
                                grp["scoped"].tolist(), grp["vel"].tolist()))
                            fire_ticks[key] = t
            except Exception as e:
                self.log(f"  ⚠ dp2 parse error ({Path(demo_path).name}): {e}", "warn")
                fire_detail = {}
                fire_ticks = {}

        if "death" in needed:
            view_angles = {}
            death_flags = {}
            try:
                death_df = parser.parse_event(
                    "player_death",
                    player=["pitch", "yaw"],
                    other=["attacker_steamid",
                           "noscope", "thrusmoke", "attackerblind",
                           "penetrated", "attackerinair"],
                )
                if death_df is not None and len(death_df) > 0:
                    dcols = list(death_df.columns)
                    def _dc(name):
                        if name in dcols:
                            return name
                        if f"attacker_{name}" in dcols:
                            return f"attacker_{name}"
                        if f"user_{name}" in dcols:
                            return f"user_{name}"
                        return None
                    # Precompute lowered column names (avoid repeated .lower() per column)
                    _dcols_low = {c: c.lower() for c in dcols}
                    col_atk = _dc("attacker_steamid") or next(
                        (c for c, cl in _dcols_low.items() if "attacker" in cl and "steam" in cl), None)
                    col_yaw = next((c for c, cl in _dcols_low.items() if "yaw" in cl), None)
                    col_pitch = next((c for c, cl in _dcols_low.items() if "pitch" in cl), None)
                    flag_cols = {
                        "noscope": next((c for c, cl in _dcols_low.items() if "noscope" in cl), None),
                        "thrusmoke": next((c for c, cl in _dcols_low.items() if "thrusmoke" in cl), None),
                        "attackerblind": next((c for c, cl in _dcols_low.items() if "attackerblind" in cl), None),
                        "penetrated": next((c for c, cl in _dcols_low.items() if "penetrated" in cl), None),
                        "attackerinair": next((c for c, cl in _dcols_low.items() if "attackerinair" in cl), None),
                    }
                    if col_atk:
                        fetch_cols = ["tick", col_atk]
                        if col_yaw:
                            fetch_cols.append(col_yaw)
                        if col_pitch:
                            fetch_cols.append(col_pitch)
                        for fc in flag_cols.values():
                            if fc and fc not in fetch_cols:
                                fetch_cols.append(fc)
                        arr_d = death_df[fetch_cols].to_numpy()
                        yaw_i = fetch_cols.index(col_yaw) if col_yaw else None
                        pitch_i = fetch_cols.index(col_pitch) if col_pitch else None
                        flag_indices = {fname: fetch_cols.index(fc) for fname, fc in flag_cols.items() if fc}
                        for row in arr_d:
                            t = int(row[0] or 0)
                            sid = str(row[1] or "")
                            if not sid:
                                continue
                            yaw = float(row[yaw_i] or 0) if yaw_i is not None else 0.0
                            pit = float(row[pitch_i] or 0) if pitch_i is not None else 0.0
                            if yaw_i is not None or pitch_i is not None:
                                view_angles.setdefault(sid, []).append((t, yaw, pit))
                            flags = {}
                            for fname, fi in flag_indices.items():
                                val = row[fi]
                                if val is not None:
                                    flags[fname] = int(val) if fname == "penetrated" else bool(val)
                            if flags:
                                death_flags[(t, sid)] = flags
                for k in view_angles:
                    view_angles[k].sort(key=lambda r: r[0])
            except Exception:
                pass

        if "hurt" in needed:
            hurt_index = {}
            try:
                hurt_df = parser.parse_event(
                    "player_hurt",
                    player=[],
                    other=["attacker_steamid", "userid_steamid"],
                )
                if hurt_df is not None and len(hurt_df) > 0:
                    hcols = list(hurt_df.columns)
                    col_hatk = next((c for c in hcols if "attacker" in c.lower() and "steam" in c.lower()), None)
                    col_hvic = next((c for c in hcols if ("user" in c.lower() or "victim" in c.lower())
                                     and "steam" in c.lower() and "attacker" not in c.lower()), None)
                    if col_hatk and col_hvic:
                        hdf = hurt_df[["tick", col_hatk, col_hvic]].copy()
                        hdf.columns = ["tick", "atk", "vic"]
                        hdf["tick"] = hdf["tick"].fillna(0).astype(int)
                        hdf["atk"] = hdf["atk"].fillna("").astype(str)
                        hdf["vic"] = hdf["vic"].fillna("").astype(str)
                        hdf = hdf[(hdf["atk"] != "") & (hdf["vic"] != "")]
                        hdf.sort_values("tick", inplace=True)
                        for vic, grp in hdf.groupby("vic", sort=False):
                            hurt_index[vic] = list(zip(
                                grp["tick"].tolist(), grp["atk"].tolist()))
            except Exception:
                pass

        if "names" in needed:
            try:
                info_df = parser.parse_player_info()
                if info_df is not None and len(info_df) > 0:
                    icols = list(info_df.columns)
                    sid_col  = next((c for c in icols if "steamid" in c.lower()
                                     or "steam_id" in c.lower()), None)
                    name_col = next((c for c in icols if c.lower() == "name"), None)
                    if sid_col and name_col:
                        for sid, nm in zip(
                            info_df[sid_col].fillna("").astype(str),
                            info_df[name_col].fillna("").astype(str),
                        ):
                            if sid and nm:
                                demo_names[sid] = nm
            except Exception:
                pass

        if "positions" in needed:
            # Lazy player_positions for the shared modifier layer. Parsed once per
            # demo and cached so airborne / no-scope checks on non-kill events do
            # not re-parse on every event. Stored separately from _dp2_cache (the
            # per-demo frame can be large and the LRU eviction is tuned for the
            # fire/death structures).
            try:
                pos_df = parser.parse_event(
                    "player_positions",
                    player=["x", "y", "z"],
                    other=[],
                )
                if pos_df is not None and len(pos_df) > 0:
                    with self._dp2_cache_lock:
                        self._player_positions_cache[demo_path] = pos_df
            except Exception:
                pass

        with self._dp2_cache_lock:
            merged = self._dp2_cache.get(demo_path, {})
            if not isinstance(merged, dict):
                merged = {}
            merged["fire_detail"] = fire_detail
            merged["fire_ticks"] = fire_ticks
            merged["view_angles"] = view_angles
            merged["hurt_index"] = hurt_index
            merged["death_flags"] = death_flags
            merged["demo_names"]  = demo_names
            merged["_sections"] = set(merged.get("_sections", set())) | required_sections
            self._dp2_cache_put_locked(demo_path, merged)
        return True

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
                        self.log(
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
            self.log(f"  ⚠ Mate POV parse_ticks error: {e}", "warn")
            return cached

        try:
            if df is None or len(df) == 0:
                self.log("  ⚠ Mate POV: parse_ticks returned empty DataFrame", "warn")
                return cached
            cols = list(df.columns)
            # steamid column varies across demoparser2 versions
            sid_col = next((c for c in cols
                            if c.lower() in ("steamid", "player_steamid", "user_steamid")), None)
            if not sid_col:
                self.log(f"  ⚠ Mate POV: no steamid column in {cols}", "warn")
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
                self.log(f"  ⚠ Mate POV: missing columns tick/X/Y/Z in {cols}", "warn")
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
            self.log(f"  ⚠ Mate POV: position parse failed: {e}", "warn")

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
            self.log(
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
            self.log(
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

    def _trois_shot_filter(self, demo_path, events, cfg):
        """Keep only lucky kills (TROIS SHOT filter).

        Reads weapon_fire data from _dp2_cache (populated by _dp2_parse_demo).
        Works on any weapon that has a threshold defined in TROIS_SHOT_THRESHOLDS
        (via CSDM_TO_DP2_WEAPON). Kills with weapons that have no threshold are
        passed through unchanged (no weapon restriction enforced in UI anymore).
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)

        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)

        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        fire_index = data.get("fire_detail", {})

        def _is_lucky(kill_tick, killer_sid, weapon_raw):
            w_key = CSDM_TO_DP2_WEAPON.get(weapon_raw.lower().strip())
            if w_key is None:
                return False  # no threshold for this weapon — never lucky
            thresholds = TROIS_SHOT_THRESHOLDS[w_key]
            wp_suffix  = w_key[7:] if w_key.startswith("weapon_") else w_key

            entries = fire_index.get((killer_sid, wp_suffix))
            if not entries:
                return False

            ticks_only = [e[0] for e in entries]
            pos = bisect.bisect_right(ticks_only, kill_tick) - 1
            best = None
            best_dist = DP2_TICK_WINDOW + 1
            i = pos
            while i >= 0:
                ftick, acc, scoped, vel = entries[i]
                dist = kill_tick - ftick
                if dist < 0:
                    i -= 1; continue
                if dist >= DP2_TICK_WINDOW:
                    break
                if dist < best_dist:
                    best_dist = dist
                    best = (acc, scoped, vel)
                i -= 1

            if best is None:
                return False

            acc, scoped, vel = best
            if thresholds["scope"] and thresholds["vel"]:
                result = (not scoped) or (acc > thresholds["acc"]) or (vel > 100)
            elif thresholds["scope"]:
                result = (not scoped) or (acc > thresholds["acc"])
            else:
                result = acc > thresholds["acc"]

            if self._dp2_verbose:
                self.log(
                    f"  🎲 [{weapon_raw}] acc={acc:.4f}(threshold={thresholds['acc']}) "
                    f"scoped={scoped} vel={vel:.0f} → {'✓ TROIS SHOT' if result else '✗ precise'}",
                    "info" if result else "dim")
            return result

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt)
                continue
            weapon_raw = evt.get("weapon", "")
            killer_sid = str(evt.get("killer_sid", ""))
            kill_tick  = int(evt.get("tick", 0))
            # Weapons with no threshold are skipped (not included)
            if CSDM_TO_DP2_WEAPON.get(weapon_raw.lower().strip()) is None:
                continue
            if _is_lucky(kill_tick, killer_sid, weapon_raw):
                filtered.append(evt)

        return filtered

    def _one_tap_filter(self, demo_path, events, cfg):
        """Keep only isolated single-shot kills.

        A kill is kept if the killer fired exactly one shot with that weapon
        in [kill_tick − WINDOW, kill_tick + WINDOW] where WINDOW is derived
        from cfg["kill_mod_one_tap_s"] (seconds) × tickrate (default: 2s).
        Reads fire_ticks from _dp2_cache (populated by _dp2_parse_demo).
        If the demo is not yet cached, triggers a synchronous parse as fallback.
        (Headshot is pre-guaranteed by the DB query when kill_mod_one_tap is enabled.)
        """
        if not os.path.isfile(demo_path):
            return self._non_kill_only(events)

        # Ensure parsed — no-op if already cached
        if demo_path not in self._dp2_cache:
            self._dp2_parse_demo(demo_path)

        with self._dp2_cache_lock:
            data = self._dp2_cache.get(demo_path, {})
        shots_index = data.get("fire_ticks", {})

        _one_tap_s = max(0.5, float(cfg.get("kill_mod_one_tap_s", 2)))
        _tickrate   = int(cfg.get("tickrate", 64))
        WINDOW = int(_one_tap_s * _tickrate)  # convert user-seconds → ticks

        def _is_isolated(kill_tick, killer_sid, weapon_raw):
            """True iff exactly 1 shot with this weapon was fired in [kill_tick-WINDOW, kill_tick+WINDOW]."""
            # Resolve weapon suffix the same way as _trois_shot_filter
            w_key = CSDM_TO_DP2_WEAPON.get(weapon_raw.lower().strip())
            if w_key:
                wpn_s = w_key[7:] if w_key.startswith("weapon_") else w_key
            else:
                wpn_s = weapon_raw.lower().strip()
                if wpn_s.startswith("weapon_"):
                    wpn_s = wpn_s[7:]
            ticks = shots_index.get((str(killer_sid), wpn_s), [])
            if not ticks:
                return False
            lo, hi = kill_tick - WINDOW, kill_tick + WINDOW
            pos = bisect.bisect_left(ticks, lo)
            count = 0
            for i in range(pos, len(ticks)):
                if ticks[i] > hi:
                    break
                count += 1
                if count > 1:
                    return False  # more than one shot with this weapon in the window
            return count == 1

        filtered = []
        for evt in events:
            if evt.get("type") != "kill":
                filtered.append(evt)
                continue
            killer_sid  = str(evt.get("killer_sid", ""))
            kill_tick   = int(evt.get("tick", 0))
            weapon_raw  = evt.get("weapon", "")
            isolated = _is_isolated(kill_tick, killer_sid, weapon_raw)
            if self._dp2_verbose:
                self.log(
                    f"  🎯 [{weapon_raw}] [tick={kill_tick}] sid={killer_sid} → "
                    f"{'✓ isolated' if isolated else '✗ not isolated'}",
                    "info" if isolated else "dim")
            if isolated:
                filtered.append(evt)

        return filtered

    def _no_trois_shot_filter(self, demo_path, events, cfg):
        """Keep only precise kills — inverse of TROIS SHOT.
        Kills on weapons with no threshold are passed through (can't be lucky).
        """
        lucky_evts = self._trois_shot_filter(demo_path, events, cfg)
        lucky_sig = {
            (e.get("tick"), str(e.get("killer_sid")))
            for e in lucky_evts if e.get("type") == "kill"
        }
        filtered = []
        for e in events:
            if e.get("type") != "kill":
                filtered.append(e)
                continue
            sig = (e.get("tick"), str(e.get("killer_sid")))
            if sig not in lucky_sig:
                filtered.append(e)
        return filtered

    def _trois_tap_filter(self, demo_path, events, cfg):
        """TROIS TAP = TROIS SHOT AND ONE TAP combined.
        Keeps only lucky kills that are also isolated single shots.
        """
        lucky_events = self._trois_shot_filter(demo_path, events, cfg)
        return self._one_tap_filter(demo_path, lucky_events, cfg)

    def _apply_global_filter_gate_events(self, events, cfg):
        active_keys = [k for k, *_ in self._FILTER_BADGE_DEFS if cfg.get(k)]
        if not active_keys:
            return events
        req_keys, opt_keys = self._split_required_optional(cfg, active_keys)
        req_set = set(req_keys)
        opt_set = set(opt_keys)
        non_kill = [e for e in events if e.get("type") != "kill"]
        kept = []
        for e in events:
            if e.get("type") != "kill":
                continue
            matched = set(e.get("_mf") or set())
            if req_set and not req_set.issubset(matched):
                continue
            if opt_set and not (matched & opt_set):
                continue
            kept.append(e)
        result = kept + non_kill
        return result or None

    def _apply_global_filter_gate_dict(self, evts, cfg):
        out = {}
        for dp, events in evts.items():
            gated = self._apply_global_filter_gate_events(events, cfg)
            if gated is not None:
                out[dp] = gated
        return out

    def _apply_filter_to_events(self, evts, cfg, cfg_key, filter_fn, label):
        """Apply a per-demo filter function to all demos in evts.

        Skips if cfg_key is falsy. Returns a new {demo_path: events} dict
        with empty-demo paths removed.

        Surviving kill events are tagged with cfg_key in their _mf (matched filters)
        set so that clip badges can show exactly which filter each clip triggered.
        """
        if not cfg.get(cfg_key):
            return evts
        result = {}
        for dp, events in evts.items():
            n_before = _count_kills(events)
            filtered = filter_fn(dp, events, cfg)
            combined = filtered or []
            n_after  = _count_kills(combined)
            # Mate POV is a camera modifier: kills aren't removed in optional mode,
            # so n_before == n_after gives no useful info.  Show stamped/total instead.
            if cfg_key == "kill_mod_mate_pov":
                n_with_mate = sum(1 for e in combined if e.get("_mate_pov_sid"))
                self.log(
                    f"  {label} [{Path(dp).name}] : {n_with_mate}/{n_before} with qualifying mate",
                    "info" if n_with_mate else "dim")
            else:
                self.log(
                    f"  {label} [{Path(dp).name}] : {n_before} kills → {n_after}",
                    "info" if n_after else "dim")
            if combined:
                self._stamp_mf(combined, cfg_key)
                result[dp] = combined
        return result

    # ── chantier 1.5, task 5 — demo, tag and summary helpers ─────────────────

    def _hms(self, s):
        s = int(s)
        if s < 60:   return f"{s}s"
        if s < 3600: return f"{s//60}m{s%60:02d}s"
        return f"{s//3600}h{(s%3600)//60:02d}m{s%60:02d}s"

    @staticmethod
    def _read_demo_date_from_info(demo_path):
        """
        Read the .info file next to the .dem and extract the Unix timestamp
        of the actual match date.

        The .info file is a binary protobuf. The date field is a varint
        (field 5, type 0) encoding a Unix timestamp in seconds.

        CDataGCCStrike15_v2_MatchInfo format:
          field 1 = matchid (uint64)
          field 2 = matchtime (uint32) ← match timestamp
          ...
        Minimal parsing with no protobuf dependency.
        """
        info_path = Path(demo_path).with_suffix(".info")
        if not info_path.exists():
            # Also try demo_path + ".info" (some versions append to the name)
            info_path2 = Path(str(demo_path) + ".info")
            if info_path2.exists():
                info_path = info_path2
            else:
                return None
        try:
            data = info_path.read_bytes()
            i = 0
            while i < len(data):
                # Read tag varint
                tag = 0
                shift = 0
                while i < len(data):
                    b = data[i]; i += 1
                    tag |= (b & 0x7F) << shift
                    shift += 7
                    if not (b & 0x80):
                        break
                field_num = tag >> 3
                wire_type = tag & 0x07
                if wire_type == 0:   # varint
                    val = 0; shift = 0
                    while i < len(data):
                        b = data[i]; i += 1
                        val |= (b & 0x7F) << shift
                        shift += 7
                        if not (b & 0x80):
                            break
                    if field_num == 2 and val > 1_000_000_000:
                        # matchtime: Unix timestamp post-2001 → valid match date
                        return val
                elif wire_type == 2: # length-delimited
                    length = 0; shift = 0
                    while i < len(data):
                        b = data[i]; i += 1
                        length |= (b & 0x7F) << shift
                        shift += 7
                        if not (b & 0x80):
                            break
                    i += length
                elif wire_type in (1, 5):
                    i += 8 if wire_type == 1 else 4
                else:
                    break   # unknown wire type, stop
        except Exception:
            pass
        return None

    @staticmethod
    def _ts_from_demo_path(demo_path):
        """Return the .dem file mtime as a Unix timestamp, or None if not found.
        Best fallback when .info is absent — typically close to the download date."""
        try:
            p = Path(demo_path)
            if p.is_file():
                return int(p.stat().st_mtime)
        except Exception:
            pass
        return None

    @staticmethod
    def _normalize_recsys(value):
        v = str(value or "").strip().upper()
        return "CS" if v == "CS" else "HLAE"

    def _get_demo_ts(self, demo_path):
        """Return the canonical demo timestamp. Cached after the first call.
        Priority: 1) .info file  2) .dem mtime  (None if unavailable)."""
        if demo_path in self._ts_cache:
            return self._ts_cache[demo_path]
        ts = self._read_demo_date_from_info(demo_path)
        if ts is None:
            ts = self._ts_from_demo_path(demo_path)
        self._ts_cache[demo_path] = ts
        return ts

    def _format_demo_date(self, demo_path):
        ts = self._get_demo_ts(demo_path)
        if ts is not None:
            try:
                return datetime.fromtimestamp(ts).strftime("%d %m %Y")
            except Exception:
                pass
        # Fallback DB (often = import date)
        raw = self._demo_dates.get(demo_path)
        if raw is None:
            return "??-??-????"
        try:
            if hasattr(raw, "strftime"):
                return raw.strftime("%d %m %Y")
            if isinstance(raw, (int, float)):
                t = int(raw)
                if t > 4_000_000_000:
                    t //= 1000
                return datetime.fromtimestamp(t).strftime("%d %m %Y")
            s = str(raw).strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                        "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
                try:
                    return datetime.strptime(s[:len(fmt)], fmt).strftime("%d %m %Y")
                except ValueError:
                    continue
        except Exception:
            pass
        return "??-??-????"

    def _demo_sort_key(self, demo_path):
        """Cached sort key — avoids repeated strptime on the same raw date value."""
        # _ts_cache covers _get_demo_ts (covers .info and mtime).
        # For DB raw dates, normalise once and store back as int in _demo_dates.
        ts = self._get_demo_ts(demo_path)
        if ts is not None:
            return (0, ts)
        raw = self._demo_dates.get(demo_path)
        if raw is None:
            return (1, 0)
        # Already normalised on a previous call?
        if isinstance(raw, (int, float)):
            t = int(raw)
            t = t // 1000 if t > 4_000_000_000 else t
            return (0, t)
        try:
            if hasattr(raw, "timestamp"):
                t = int(raw.timestamp())
                self._demo_dates[demo_path] = t  # normalise in-place
                return (0, t)
            s = str(raw).strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    t = int(datetime.strptime(s[:len(fmt)], fmt).timestamp())
                    self._demo_dates[demo_path] = t  # normalise in-place
                    return (0, t)
                except ValueError:
                    continue
        except Exception:
            pass
        return (1, 0)

    def _check_demo_compat(self, demo_path):
        """Check whether a CS2 demo may be incompatible with the current CS2 version.

        Ported verbatim from `_check_demo_compat` in csdm_batch_clips_generator.py.
        Detection is based on the demo's recorded timestamp (`_get_demo_ts`,
        already engine-side) vs. `_CS2_DEMO_BREAKS`, never on the DB's own date
        column: the DB date is often the import date, not the match date.

        Returns a dict:
          {
            'status':  'ok' | 'warn' | 'missing',
            'break':   str | None,   # short name of the breaking update
            'tip':     str | None,   # human-readable explanation
            'ts':      int | None,   # demo Unix timestamp
          }
        """
        result = {"status": "ok", "break": None, "tip": None, "ts": None}
        ts = self._get_demo_ts(demo_path)
        if ts is None:
            if not Path(demo_path).is_file():
                result["status"] = "missing"
            return result
        result["ts"] = ts
        demo_dt = datetime.fromtimestamp(ts)
        for cutoff, label, tip in _CS2_DEMO_BREAKS:
            if demo_dt < cutoff:
                result["status"] = "warn"
                result["break"] = label
                result["tip"] = tip
                return result  # match the most recent (first) applicable break
        return result

    @staticmethod
    def _demo_picker_fmt_name(demo_path):
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
        for pfx in MAP_NAME_PREFIXES:
            if m.lower().startswith(pfx):
                return m[len(pfx):]
        return m

    def _describe_demo(self, demo_path):
        """One demo's picker row: path, display name/date/map, compat status."""
        compat = self._check_demo_compat(demo_path)
        return {
            "path": demo_path,
            "name": self._demo_picker_fmt_name(demo_path),
            "date": self._demo_picker_fmt_date(demo_path),
            "map": self._demo_picker_fmt_map(demo_path),
            "compat": {"status": compat["status"], "break": compat["break"], "tip": compat["tip"]},
        }

    def list_all_demos(self):
        """Return every demo any match row points to, formatted for the picker.

        Ported from `_on_picker_mode_change` (csdm_batch_clips_generator.py) --
        the window's own "Manual mode" query (load ALL demos from the DB, not
        just the ones a Preview found), adapted to run headless and to return
        data instead of populating a Treeview.

        Requires a discovery to have already run: `_db_schema`, `_date_col`,
        `_map_col`/`_map_join`/`_map_alias` are all populated by
        `apply_discovery`, and nothing here connects on its own -- same
        precondition as `_find_col` everywhere else in this class.
        """
        if not self._db_schema:
            raise ValueError("Connect to the database before loading the demo list.")
        dc = self._find_col("matches", ["demo_path", "demo_file_path",
                                        "demo_filepath", "share_code"])
        if not dc:
            return []
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        date_col = self._date_col
        map_col = self._map_col
        map_join = self._map_join or ""
        map_alias = self._map_alias

        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                mkm_sel = f',m."{mkm}"' if mkm else ""
                date_sel = f',m."{date_col}"' if date_col else ""
                map_sel = f',{map_alias}."{map_col}"' if map_col else ""
                cur.execute(
                    f'SELECT m."{dc}"{mkm_sel}{date_sel}{map_sel} '
                    f'FROM matches m {map_join} '
                    + (f'ORDER BY m."{date_col}" DESC' if date_col else ''))
                rows = cur.fetchall()
        finally:
            conn.close()

        paths = []
        seen = set()
        for row in rows:
            dp = row[0]
            if not dp or dp in seen:
                continue
            seen.add(dp)
            idx = 1
            if mkm:
                chk = row[idx] if len(row) > idx else None
                if chk and dp not in self._demo_checksums:
                    self._demo_checksums[dp] = chk
                idx += 1
            if date_col:
                if len(row) > idx and row[idx] and dp not in self._demo_dates:
                    self._demo_dates[dp] = row[idx]
                idx += 1
            if map_col and len(row) > idx and row[idx] and dp not in self._demo_map_cache:
                self._demo_map_cache[dp] = str(row[idx]).strip()
            paths.append(dp)

        paths.sort(key=self._demo_sort_key)
        return [self._describe_demo(dp) for dp in paths]

    def _demo_picker_get_active(self):
        """Return list of demo paths that are checked in the picker.
        If picker is empty (no preview run yet), returns None (= no filter)."""
        if not self._demo_picker_state:
            return None
        return [dp for dp, ok in self._demo_picker_state.items() if ok]

    def _get_active_tag_names(self):
        return [tn for tid, tn, _ in self._tags_list if tid in self._tags_active]

    def _tag_log_line(self, msg):
        self.log(msg, "dim")

    def _get_demo_checksum(self, demo_path):
        """Return the matches checksum for a demo path.

        v19: Priority: cache populated by _query_events (no re-query).
        Fallback: direct query with extended candidates.
        """
        # 1. Cache populated by _query_events — primary path
        if demo_path in self._demo_checksums:
            return self._demo_checksums[demo_path]

        # 2. Fallback: direct query
        dc = self._find_col("matches", [
            "demo_path", "demo_file_path", "demo_filepath",
            "share_code", "file_path", "path",
        ])
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])

        if not dc or not mkm:
            self._tag_log_line(
                f"[CHK] ERREUR: colonnes non trouvees (dc={dc}, mkm={mkm})\n"
                f"      Colonnes matches: {self._db_schema.get('matches', [])}")
            return None

        candidates = [demo_path]
        abs_path = os.path.abspath(demo_path)
        candidates.append(abs_path)
        candidates.append(abs_path.replace("\\", "/"))
        candidates.append(abs_path.replace("/", "\\"))
        basename = os.path.basename(demo_path)

        try:
            conn = self._pg_fresh()
            with conn.cursor() as cur:
                for sp in candidates:
                    cur.execute(
                        f'SELECT "{mkm}" FROM matches WHERE "{dc}"=%s LIMIT 1', (sp,))
                    r = cur.fetchone()
                    if r:
                        self._demo_checksums[demo_path] = r[0]
                        conn.close()
                        return r[0]

                # LIKE on the filename
                cur.execute(
                    f'SELECT "{mkm}" FROM matches WHERE "{dc}" LIKE %s LIMIT 1',
                    (f"%{basename}",))
                r = cur.fetchone()
                if r:
                    self._demo_checksums[demo_path] = r[0]
                    conn.close()
                    return r[0]

                # Debug: show what is in the table
                cur.execute(f'SELECT "{dc}","{mkm}" FROM matches LIMIT 5')
                samples = cur.fetchall()
                self._tag_log_line(
                    f"[CHK] Not found: {demo_path!r}\n"
                    f"      col_demo={dc!r}, col_chk={mkm!r}")
                for s in samples:
                    self._tag_log_line(f"      sample DB: demo={s[0]!r}  chk={s[1]!r}")
            conn.close()
        except Exception as e:
            self._tag_log_line(f"[CHK] Exception: {e}")
        return None

    def _tag_demo(self, demo_path, tag_name):
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        if not jt or not jt_tag or not jt_match:
            return False, f"Junction table not found (jt={jt}, tag={jt_tag}, match={jt_match})"

        tag_id = next((tid for tid, tn, _ in self._tags_list if tn == tag_name), None)
        if tag_id is None:
            return False, f"Tag '{tag_name}' not found in self._tags_list"

        checksum = self._get_demo_checksum(demo_path)
        if not checksum:
            return False, f"Checksum not found for {os.path.basename(demo_path)}"

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
                    self._tag_log_line(
                        f"   INSERT {jt}({jt_match}={checksum!r}, {jt_tag}={tag_id}) OK")
                else:
                    conn.commit()
                    self._tag_log_line(
                        f"   Relation deja existante: {jt_match}={checksum!r}, {jt_tag}={tag_id}")
            conn.close()
            return True, ""
        except Exception as e:
            return False, str(e)

    def _untag_demo(self, demo_path, tag_name):
        """Remove one tag from one demo. Pure DB logic, ported from
        `_untag_demo` in csdm_batch_clips_generator.py unchanged (it already
        touched no Tkinter)."""
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

    def _tag_by_checksum(self, checksum, tag_id):
        """Apply a tag using a checksum directly (no demo_path -> checksum
        lookup). Ported from `_tag_by_checksum` unchanged -- used by
        `apply_tag_import`, where the export file only carries checksums."""
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
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
        """Return True if the given checksum exists in the matches table.
        Ported from `_checksum_in_db` unchanged."""
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

    def _tags_dc_mkm(self):
        """Return (demo-path column, match-key column) of `matches`, or (None, None)."""
        dc = self._find_col("matches", ["demo_path", "demo_file_path", "demo_filepath",
                                        "share_code", "file_path", "path"])
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        return dc, mkm

    def search_tagged_demos(self, tag_ids, cfg=None):
        """Find demos carrying the given tags, optionally filtered by a run config.

        Ported from `_tag_search_by_tag` (no `cfg` -- a plain tag lookup) and
        `_tag_search_demos` (`cfg`-filtered, intersected with `tag_ids` when
        given) in csdm_batch_clips_generator.py. Tkinter chrome (`self.after`,
        the Listbox/Label updates, the background thread) is stripped: this
        runs synchronously on the bridge's own command thread and returns data
        instead of pushing it into a widget.

        `cfg` used to come from `player_search.get_steam_ids()` and a dict of
        Tk `BooleanVar`s for the selected events. Headless, it is the same cfg
        dict `start_run`/`start_preview` already take, read through the same
        keys (`steam_ids`, `events`) `validate_run_inputs` checks.

        The last-preview-cache reuse the original method had (skip
        `_query_events` if a Preview already computed the same thing) is not
        reproduced: that cache lived on the Tkinter window and headless has no
        equivalent state to reuse it from.
        """
        tag_ids = list(tag_ids or [])
        tag_names = [tn for tid, tn, _ in self._tags_list if tid in set(tag_ids)]

        if cfg is None:
            if not tag_ids:
                raise ValueError("Select at least one tag.")
            ts = self._tags_schema
            jt = ts.get("junction_table")
            jt_tag = ts.get("jt_tag_col")
            jt_match = ts.get("jt_match_col")
            dc, mkm = self._tags_dc_mkm()
            if not jt or not dc or not mkm:
                raise ValueError("Insufficient DB schema for tags.")

            conn = self._pg_fresh()
            try:
                with conn.cursor() as cur:
                    ph = ",".join(["%s"] * len(tag_ids))
                    cur.execute(
                        f'SELECT DISTINCT m."{dc}", m."{mkm}" '
                        f'FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" '
                        f'WHERE ct."{jt_tag}" IN ({ph}) ORDER BY m."{dc}"',
                        tag_ids)
                    rows = cur.fetchall()
            finally:
                conn.close()

            demos = []
            for r in rows:
                dp, chk = str(r[0]), r[1]
                if chk and dp not in self._demo_checksums:
                    self._demo_checksums[dp] = chk
                demos.append({"path": dp, "name": Path(dp).name, "n_events": 0, "n_seq": 0})
            return {"demos": demos, "tag_names": tag_names}

        # cfg supplied: config-filtered search, optionally intersected with tag_ids.
        if not cfg.get("steam_ids"):
            raise ValueError("Select at least one player account.")
        if not (cfg.get("events") or []):
            raise ValueError("Select at least one event.")

        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        if tag_ids and (not jt or not jt_tag or not jt_match):
            raise ValueError("Insufficient DB schema for tag filter.")

        self._demo_checksums = {}

        tagged_checksums = None
        if tag_ids:
            conn = self._pg_fresh()
            try:
                with conn.cursor() as cur:
                    ph = ",".join(["%s"] * len(tag_ids))
                    cur.execute(
                        f'SELECT DISTINCT "{jt_match}" FROM "{jt}" WHERE "{jt_tag}" IN ({ph})',
                        tag_ids)
                    tagged_checksums = {r[0] for r in cur.fetchall()}
            finally:
                conn.close()

        evts = self._query_events(cfg)

        demos = []
        for dp in sorted(evts.keys(), key=self._demo_sort_key):
            if tagged_checksums is not None:
                chk = self._demo_checksums.get(dp) or self._get_demo_checksum(dp)
                if not chk or chk not in tagged_checksums:
                    continue
            ne = len(evts[dp])
            seqs = self._build_sequences(evts[dp], cfg["tickrate"], cfg["before"], cfg["after"])
            demos.append({"path": dp, "name": Path(dp).name, "n_events": ne, "n_seq": len(seqs)})

        return {"demos": demos, "tag_names": tag_names}

    def calc_tag_date_range(self, tag_ids):
        """Compute the date range spanned by demos carrying every given tag.

        Ported from `_tag_calc_range`, Tkinter chrome stripped (`self.after`,
        label/button updates, background thread). Runs synchronously and
        returns the computed values instead of mutating window state.

        Per the plan's design decision, the result is returned directly in the
        response and not cached as engine state (no `_plage_date_start` /
        `_plage_date_end` in ENGINE_STATE_DEFAULTS) -- the caller keeps it.
        """
        tag_ids = list(tag_ids or [])
        if not tag_ids:
            raise ValueError("Select at least one tag.")
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        dc, mkm = self._tags_dc_mkm()
        date_col = self._date_col
        if not jt or not jt_tag or not jt_match or not mkm or not dc:
            raise ValueError("Insufficient DB schema for tags.")

        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                ph = ",".join(["%s"] * len(tag_ids))
                date_sel = f', m."{date_col}"' if date_col else ""
                cur.execute(
                    f'SELECT DISTINCT m."{dc}", m."{mkm}"{date_sel} '
                    f'FROM "{jt}" ct JOIN matches m ON m."{mkm}"=ct."{jt_match}" '
                    f'WHERE ct."{jt_tag}" IN ({ph})',
                    tag_ids)
                rows = cur.fetchall()
        finally:
            conn.close()

        demos = [str(r[0]) for r in rows]
        for r in rows:
            dp_r, chk = str(r[0]), r[1]
            if chk and dp_r not in self._demo_checksums:
                self._demo_checksums[dp_r] = chk
            if date_col and len(r) > 2 and r[2] is not None:
                self._demo_dates.setdefault(dp_r, r[2])

        if not demos:
            return {"date_start": None, "date_end": None, "date_after": None, "demo_count": 0}

        sorted_demos = sorted(demos, key=self._demo_sort_key)
        first_demo = sorted_demos[0]
        last_demo = sorted_demos[-1]

        def _demo_to_date_str(dp):
            demo_ts = self._get_demo_ts(dp)
            if demo_ts is None:
                sk = self._demo_sort_key(dp)
                demo_ts = sk[1] if sk[0] == 0 else None
            if demo_ts is None:
                return None
            try:
                return datetime.fromtimestamp(demo_ts).strftime("%d-%m-%Y")
            except Exception:
                return None

        date_start = _demo_to_date_str(first_demo)
        date_end = _demo_to_date_str(last_demo)

        date_after = None
        if date_end:
            try:
                date_after = (datetime.strptime(date_end, "%d-%m-%Y")
                              + _dt.timedelta(days=1)).strftime("%d-%m-%Y")
            except Exception:
                date_after = date_end

        return {
            "date_start": date_start,
            "date_end": date_end,
            "date_after": date_after,
            "demo_count": len(demos),
        }

    def set_active_tags(self, tag_ids):
        """Replace the active-tag selection wholesale. An empty list deselects all.

        Collapses `_tag_toggle` (single-id flip), `_tags_deselect_all` (clear)
        and `_restore_active_tags` (bulk-set from a list of names) into one
        operation: those three existed because `_tags_active` was a Tk-window-
        local set the UI mutated one click at a time. Headless, `_tags_active`
        is plain engine state (`csdm/engine/state.py`) and the renderer simply
        tells the engine what the new selection is.
        """
        self._tags_active = set(tag_ids or [])
        return {"active_tag_ids": sorted(self._tags_active),
                "active_tag_names": self._get_active_tag_names()}

    def apply_tags(self, demo_paths, tag_names):
        """Apply every tag in `tag_names` to every demo in `demo_paths`.

        Ported from `_do_tag_demos`, itself called once per tag name by the
        two Tkinter callers `_tag_apply_selected` (listbox selection) and
        `_tag_apply_all` (every found demo). That "selected vs all" split was
        UI-side (which rows are highlighted) -- headless, the caller already
        holds the exact path list and passes it directly, so both callers
        collapse into this one method plus the outer per-tag-name loop
        `_do_tag_demos`'s callers used to do.

        `threading.Thread`/`self.after` chrome is stripped: this runs
        synchronously and returns counts instead of pushing a finish message
        into a status label.
        """
        demo_paths = list(demo_paths or [])
        tag_names = list(tag_names or [])
        if not demo_paths:
            raise ValueError("Select at least one demo.")
        if not tag_names:
            raise ValueError("Select at least one tag.")

        ok_count = 0
        first_error = ""
        for tag_name in tag_names:
            self._tag_log_line(f"=== Tag '{tag_name}' on {len(demo_paths)} demo(s) ===")
            for dp in demo_paths:
                self._tag_log_line(f"\n-> {os.path.basename(dp)}")
                cached = dp in self._demo_checksums
                self._tag_log_line(f"   checksum cache: {'yes' if cached else 'no'}")
                success, err = self._tag_demo(dp, tag_name)
                if success:
                    ok_count += 1
                else:
                    self._tag_log_line(f"   FAILED: {err}")
                    if not first_error:
                        first_error = err

        return {"ok_count": ok_count, "total": len(demo_paths) * len(tag_names),
                "first_error": first_error}

    def remove_tags(self, demo_paths, tag_names):
        """Remove every tag in `tag_names` from every demo in `demo_paths`.

        Ported from `_tag_remove_selected`, `threading.Thread`/`self.after`
        chrome stripped -- runs synchronously and returns counts.
        """
        demo_paths = list(demo_paths or [])
        tag_names = list(tag_names or [])
        if not demo_paths:
            raise ValueError("Select at least one demo.")
        if not tag_names:
            raise ValueError("Select at least one tag.")

        ok_count = 0
        first_error = ""
        for dp in demo_paths:
            for tag_name in tag_names:
                success, err = self._untag_demo(dp, tag_name)
                if success:
                    ok_count += 1
                elif not first_error:
                    first_error = err

        return {"ok_count": ok_count, "total": len(demo_paths) * len(tag_names),
                "first_error": first_error}

    def create_tag(self, name, color):
        """Create a tag row. Ported from `_create_tag_programmatic`.

        The original returned `(ok, tag_id_or_err)` and swallowed the
        exception into the error string; here the failure path raises
        instead, matching every other engine method in this file (the bridge
        already turns any exception into `{"ok": false, "error": ...}`).
        """
        name = (name or "").strip()
        if not name:
            raise ValueError("A tag needs a name.")
        ts = self._tags_schema
        if not ts.get("name_col"):
            raise ValueError("Tag schema not detected.")

        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                new_id = _generate_id_for_type(ts.get("id_col_type", "bigint"))
                cols = f'"{ts["id_col"]}","{ts["name_col"]}"'
                vals = [new_id, name]
                if ts.get("color_col"):
                    cols += f',"{ts["color_col"]}"'
                    vals.append(color or "#f97316")
                cur.execute(
                    f'INSERT INTO tags ({cols}) VALUES ({",".join(["%s"] * len(vals))})', vals)
                conn.commit()
        finally:
            conn.close()

        self._tags_list.append((new_id, name, color or ""))
        return {"tag_id": new_id, "tag_name": name}

    def delete_tag(self, tag_id):
        """Delete a tag row and its assignments. Ported from
        `_delete_tag_from_db`.

        The original also took a `tag_name` parameter that its body never
        read (deletion is keyed by `tag_id` alone) -- dropped here rather
        than carried along unused.
        """
        if tag_id is None:
            raise ValueError("A tag id is required.")
        ts = self._tags_schema
        if not ts.get("id_col"):
            raise ValueError("Tag schema not detected.")

        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                jt = ts.get("junction_table")
                jt_tag = ts.get("jt_tag_col")
                if jt and jt_tag:
                    cur.execute(f'DELETE FROM "{jt}" WHERE "{jt_tag}"=%s', (tag_id,))
                cur.execute(f'DELETE FROM tags WHERE "{ts["id_col"]}"=%s', (tag_id,))
                conn.commit()
        finally:
            conn.close()

        self._tags_list = [t for t in self._tags_list if t[0] != tag_id]
        return {"ok": True}

    def export_tags(self, path, tag_ids=None):
        """Write every tag (or only `tag_ids`, when given) and its demo
        assignments to a JSON file at `path`.

        Ported from `_tags_export_worker`: the Tkinter error dialog and
        `self.after`-posted success line are stripped -- failures raise, like
        every other engine method, and the caller reads the return value for
        the success summary instead of a log line pushed to a status label.
        `tag_ids=None` exports every tag, matching the original's behaviour
        when no tags were selected in the Tkinter listbox
        (`self._tags_active` there, an explicit argument here).
        """
        ts = self._tags_schema
        jt = ts.get("junction_table")
        jt_tag = ts.get("jt_tag_col")
        jt_match = ts.get("jt_match_col")
        id_col = ts.get("id_col")
        name_col = ts.get("name_col")
        color_col = ts.get("color_col", "")
        if not jt or not jt_tag or not jt_match or not id_col or not name_col:
            raise ValueError("Tag schema not detected.")
        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        dc = self._find_col("matches", [
            "demo_path", "demo_file_path", "demo_filepath", "file_path", "path"])

        tag_ids = list(tag_ids) if tag_ids else None

        conn = self._pg_fresh()
        try:
            with conn.cursor() as cur:
                cols_sel = f'"{id_col}","{name_col}"' + (f',"{color_col}"' if color_col else "")
                cur.execute(f'SELECT {cols_sel} FROM tags ORDER BY "{name_col}"')
                tag_rows = cur.fetchall()
                if tag_ids:
                    tag_rows = [r for r in tag_rows if r[0] in set(tag_ids)]
                tag_map = {
                    r[0]: {"name": r[1], "color": (r[2] if len(r) > 2 and color_col else "") or ""}
                    for r in tag_rows
                }
                exported_ids = set(tag_map)

                ph_sql = (f' WHERE jt."{jt_tag}" IN ({",".join(["%s"] * len(tag_ids))})'
                          if tag_ids else "")
                ph_params = tuple(tag_ids) if tag_ids else ()
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
        finally:
            conn.close()

        by_chk = {}
        for row in rows:
            chk = str(row[0])
            tag_id = row[1]
            demo_nm = os.path.basename(str(row[2])) if len(row) > 2 and row[2] else ""
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
        Path(path).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"tag_count": len(tag_map), "demo_count": len(by_chk), "path": str(path)}

    @staticmethod
    def _read_tags_import_file(path):
        """Read and validate a tags export file. Shared by `scan_tag_import`
        and `apply_tag_import` -- both re-parse the same file rather than
        carry parsed state between the two round trips."""
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as e:
            raise ValueError(f"Could not read file: {e}") from e
        if not isinstance(data, dict) or "assignments" not in data:
            raise ValueError("Invalid tags export file.")
        return data

    def scan_tag_import(self, path):
        """Read a tags export file and report which tags it references that
        don't exist yet in the DB, without writing anything.

        Ported from the first half of `_tags_import_worker` -- the blocking
        `TagImportMissingDialog` this used to feed is gone. The renderer
        calls this first, decides what to create, then calls
        `apply_tag_import` with that list.
        """
        data = self._read_tags_import_file(path)

        assignments = data.get("assignments", [])
        all_names = {t for a in assignments for t in a.get("tags", [])}
        exported_defs = {t["name"]: t for t in data.get("tags", []) if t.get("name")}
        existing_names = {tn for _, tn, _ in self._tags_list}
        missing = sorted(n for n in all_names if n not in existing_names)

        missing_tags = [
            {"name": n, "color": (exported_defs.get(n) or {}).get("color") or "#f97316"}
            for n in missing
        ]
        return {"missing_tags": missing_tags, "assignment_count": len(assignments)}

    def apply_tag_import(self, path, tags_to_create=None):
        """Create `tags_to_create`, then re-parse `path` and replay its
        assignments.

        Ported from the second half of `_tags_import_worker` (post-dialog):
        creation reuses `create_tag` instead of duplicating its SQL, and
        assignment reuses `_tag_by_checksum` (the export file only carries
        checksums, not demo paths, so `apply_tags` -- which resolves paths to
        checksums itself -- does not fit here).
        """
        for t in (tags_to_create or []):
            name = (t.get("name") or "").strip()
            if not name:
                continue
            if any(tn == name for _, tn, _ in self._tags_list):
                continue  # already exists -- nothing to create
            self.create_tag(name, t.get("color"))

        data = self._read_tags_import_file(path)

        mkm = self._find_col("matches", ["checksum", "id", "match_id"])
        if not mkm:
            raise ValueError("Cannot find checksum column in matches table.")

        ok_count = skip_count = fail_count = 0
        for asgn in data.get("assignments", []):
            chk = str(asgn.get("checksum", "")).strip()
            if not chk or not self._checksum_in_db(chk, mkm):
                skip_count += 1
                continue
            for tag_name in asgn.get("tags", []):
                tag_id = next((tid for tid, tn, _ in self._tags_list if tn == tag_name), None)
                if tag_id is None:
                    fail_count += 1
                    continue
                ok, _ = self._tag_by_checksum(chk, tag_id)
                if ok:
                    ok_count += 1
                else:
                    fail_count += 1

        return {"ok_count": ok_count, "skip_count": skip_count, "fail_count": fail_count}

    def _calc_summary(self, all_events, cfg):
        """Return (nb_demos, nb_clips, total_sec, avg_sec) from events and config."""
        tickrate = cfg.get("tickrate", 64)
        before_s = self._effective_before(cfg)
        after_s = cfg.get("after", 5)
        nb_demos = len(all_events)
        nb_clips = 0
        total_ticks = 0
        for events in all_events.values():
            seqs = self._build_sequences(events, tickrate, before_s, after_s)
            nb_clips += len(seqs)
            for s in seqs:
                total_ticks += s["end_tick"] - s["start_tick"]
        total_sec = total_ticks / tickrate if tickrate else 0
        avg_sec = (total_sec / nb_clips) if nb_clips else 0
        return nb_demos, nb_clips, total_sec, avg_sec

    def _summary_counts(self, nb_demos, nb_clips, total_sec, avg_sec):
        """The summary's numbers, unformatted.

        `_fmt_summary` already renders them into a sentence, and the sentence
        is what the Tkinter window shows. A second host (the Electron window)
        puts the same four values in a counter strip, and parsing them back out
        of the prose would break the first time the wording changed. Same
        event, extra keys: no existing consumer sees a difference.
        """
        return {"demos": nb_demos, "clips": nb_clips,
                "total_s": total_sec, "avg_s": avg_sec}

    def _fmt_summary(self, nb_demos, nb_clips, total_sec, avg_sec):
        h = self._hms
        return (f"  {nb_clips} clip{'s' if nb_clips != 1 else ''}  •  "
                f"total duration {h(total_sec)}  •  "
                f"avg. {h(avg_sec)}/clip  •  "
                f"{nb_demos} demo{'s' if nb_demos != 1 else ''}")
