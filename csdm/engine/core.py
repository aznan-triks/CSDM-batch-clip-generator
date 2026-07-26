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
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from csdm.static_data import (
    SUICIDE_WEAPONS, DELAYED_EFFECT_WEAPONS, KILL_FILTER_REGISTRY,
    KILL_FILTER_SQL_COLS, CPU_VIDEO_CODECS,
    CSDM_RUNTIME_CFG_NAME, CSDM_RUNTIME_BLOCK_START, CSDM_RUNTIME_BLOCK_END,
)
from csdm.core_utils import (
    build_camera_ticks, safe_folder_name, _count_kills, fmt_duration, progress_bar,
)


class EngineMixin:
    """The engine half of App. See module docstring for the three sockets."""

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
                tksql       = self._qe_teamkill_sql(cfg)
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
        Events must be sorted by tick (guaranteed by SQL ORDER BY in _query_events).

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
        bt, at = int(before_s * tickrate), int(after_s * tickrate)
        raw = []
        for e in events:
            if "_seq_start_tick" in e and "_seq_end_tick" in e:
                s_tick = max(0, int(e["_seq_start_tick"]))
                e_tick = max(s_tick + 1, int(e["_seq_end_tick"]))
            else:
                s_tick = max(0, e["tick"] - bt)
                e_tick = e["tick"] + at
            raw.append({"start_tick": s_tick, "end_tick": e_tick, "events": [e]})
        merged = [raw[0]]
        for s in raw[1:]:
            p = merged[-1]
            # Merge when overlap OR gap is within one "before" window
            if s["start_tick"] - p["end_tick"] <= bt:
                p["end_tick"] = max(p["end_tick"], s["end_tick"])
                p["events"].extend(s["events"])
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
    def _seq_anchor_sid(seq, sids_active, primary_sid):
        """First active killer in the sequence, else first active victim, else primary."""
        sorted_evts = sorted(seq["events"], key=lambda e: e["tick"])
        for e in sorted_evts:
            ks = str(e.get("killer_sid") or "")
            if ks in sids_active:
                return ks
        for e in sorted_evts:
            vs = str(e.get("victim_sid") or "")
            if vs in sids_active:
                return vs
        return primary_sid

    @staticmethod
    def _build_cams_killer(seq, sids_active, primary_sid):
        """Killer mode: follow each active killer. One entry per killer change."""
        kill_evts = sorted(
            [e for e in seq["events"] if e.get("killer_sid") in sids_active],
            key=lambda e: e["tick"]
        )
        if not kill_evts:
            anchor = (primary_sid if primary_sid in sids_active
                      else EngineMixin._seq_anchor_sid(seq, sids_active, primary_sid))
            return [{"tick": seq["start_tick"], "playerSteamId": anchor,
                     "playerName": ""}]
        # Start at sequence start pointing to the first killer
        first_ks = kill_evts[0]["killer_sid"]
        cams = [{"tick": seq["start_tick"], "playerSteamId": first_ks,
                 "playerName": ""}]
        # Add a switch entry each time the killer changes
        prev_ks = first_ks
        for ev in kill_evts[1:]:
            ks = ev["killer_sid"]
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
            [e for e in seq["events"] if e.get("killer_sid") in sids_active
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
                # Our player kills: follow victim (or their best-angle teammate).
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
            [e for e in seq["events"] if e.get("killer_sid") in sids_active
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

            ksid = ev.get("killer_sid") or primary_sid
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

        # Collect killers and victims for the sequence
        seq_killer_sids = {ev.get("killer_sid") for ev in seq["events"] if ev.get("killer_sid")}
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
            "kill_mod_no_trois_shot",
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
        # Collect in-demo player names only when dp2 is already running for something else.
        # When no filter needs dp2, DB names serve as fallback — no extra parse triggered.
        if sections:
            sections.add("names")
        return sections

    def _assemble_clips(self, cfg, produced_dirs):
        container = cfg.get("video_container", "mp4")

        # Map conteneur → nom de format FFmpeg (-f) — mkv s'appelle "matroska" pour FFmpeg
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

        if cfg.get("kill_mod_no_trois_shot"):
            n_before = _count_kills(events)
            events = self._no_trois_shot_filter(dp, events, cfg)
            n_after = _count_kills(events)
            self.log(f"  🚫🎲 Exclude : {n_before} kills → {n_after} precise", "info")
            if not events:
                self.log("  ⏭ SKIP: 0 precise kills after Exclude in this demo", "dim")
                return None
            self._stamp_mf(events, "kill_mod_no_trois_shot")

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
                  if cfg.get(k) and k != "kill_mod_no_trois_shot"]
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

        if cfg.get("kill_mod_no_trois_shot"):
            self.log("  🚫🎲 Exclude — analyzing demos…", "info")
            evts = self._apply_filter_to_events(
                evts, cfg, "kill_mod_no_trois_shot",
                self._no_trois_shot_filter, "🚫🎲 Exclude → precise")
            if not evts:
                return {}

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
                  if cfg.get(k) and k != "kill_mod_no_trois_shot"]
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

    def _worker(self, cfg):
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
        self.state("summary", {"text": _stxt + "  [running…]", "level": "running"})
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
        self.state("summary", {"text": _stxt_final, "level": _level})

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

        self.state("buttons_idle")
