"""Golden references for T3 (preview): what the 3.5 engine previews, case by case.

Runs the real 3.5 engine (`csdm/engine/core.py`) in-process, read-only, on the
author's database and demo files, and writes one JSON file per case:
`<out>/cases/NNNN.json` with the resolved settings and the canonical preview
(events per demo, sequences, export rows, clip cameras, empty explanation).

Two engines run every case:
  * "fixed": 3.5 with the corrections the Rust engine makes (intended
    deviations, letters (a)…(j) of the T3 journal) and the same SQL
    tie-breaker. The patches are textual (old -> new, each found exactly the
    expected number of times or the run stops), applied to an in-memory copy
    of core.py; nothing under csdm/ is written. This is the reference.
  * "shipped": 3.5 as it is, only to say whether a case depends on the
    corrections (same result, differs only by the order of equal ticks,
    differs, or fails).
Every case starts from a fresh engine state (D (f)); demo parses are memoised
underneath, which changes no result.

Read-only three ways: session `default_transaction_read_only=on`, psycopg2
`set_session(readonly=True)`, and a cursor that refuses anything but SELECT.
The references hold the author's data: write them outside the repository.

    python rust/tools/t3_golden_refs.py --config <copy of csdm_config.json> \
        --presets <copy of csdm_presets.json> --out <dir> [--only 0,5,7] [--limit N]

Then: cargo run --release -p csdm-engine --example t3_golden -- <dir> <copy of csdm_config.json>
"""
import argparse
import ast
import copy
import hashlib
import importlib
import json
import math
import os
import random
import re
import sys
import tempfile
import time
import traceback
import types
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEED = 20261114
RANDOM_CASES = 200

# ── Corrections (intended deviations) ────────────────────────────────────────
# (letter, function, [(old, new, expected count)]). Applied inside that
# function's source only. The letters are the T3 journal's.
PATCHES = [
    ("a", "_query_damages", [  # damages alias "d" collided with the map join "demos d"
        ("f'd.\"{", "f'dg.\"{", 6),
        ("(cfg, \"d\", params, table=\"damages\")", "(cfg, \"dg\", params, table=\"damages\")", 1),
        ("_nonkill_where_sql(cfg, \"d\", \"damages\")", "_nonkill_where_sql(cfg, \"dg\", \"damages\")", 1),
        ("FROM damages d '", "FROM damages dg '", 1),
        ("=d.\"{mkk}\" {self._map_join} '", "=dg.\"{mkk}\" {self._map_join} '", 1),
        ("ORDER BY m.\"{dc}\",d.\"{tc}\"')", "ORDER BY m.\"{dc}\",dg.\"{tc}\"{_t3_tb(self, 'damages', 'dg')}')", 1),
    ]),
    ("b", "_dp2_parse_demo", [  # flick read the assister's angles (first sorted column)
        ("col_yaw = next((c for c, cl in _dcols_low.items() if \"yaw\" in cl), None)",
         "col_yaw = \"attacker_yaw\" if \"attacker_yaw\" in dcols else next((c for c, cl in _dcols_low.items() if \"yaw\" in cl), None)", 1),
        ("col_pitch = next((c for c, cl in _dcols_low.items() if \"pitch\" in cl), None)",
         "col_pitch = \"attacker_pitch\" if \"attacker_pitch\" in dcols else next((c for c, cl in _dcols_low.items() if \"pitch\" in cl), None)", 1),
    ]),
    ("c", "_dp2_parse_demo", [  # shots keyed on user_player_steamid only; user_steamid first now
        ("wdf[\"sid\"] = wdf[\"sid\"].fillna(\"\").astype(str)",
         "wdf[\"sid\"] = _t3_shooter_sids(fire_df, col_sid)", 1),
    ]),
    ("e", "_dp2_required_sections", [  # WALLBANG / BLIND FIRE (demo) read "death" without asking for it
        ("        if cfg.get(\"kill_mod_savior\") or cfg.get(\"kill_mod_savior_exclude\"):",
         "        if any(cfg.get(k) or cfg.get(f\"{k}_exclude\") for k in (\"kill_mod_wall_bang\", \"kill_mod_attacker_blind\")):\n"
         "            sections.add(\"death\")\n"
         "        if cfg.get(\"kill_mod_wall_bang\") or cfg.get(\"kill_mod_wall_bang_exclude\"):\n"
         "            sections.add(\"fire\")\n"
         "        if cfg.get(\"kill_mod_savior\") or cfg.get(\"kill_mod_savior_exclude\"):", 1),
    ]),
    ("g", "_query_events", [  # post-filters grouped kills by tick // 7680, never by round
        ("                    if dtc:\n                        extra += f',k.\"{dtc}\"'\n                        enames.append(\"dt\")\n",
         "                    if dtc:\n                        extra += f',k.\"{dtc}\"'\n                        enames.append(\"dt\")\n"
         "                    _t3_rnc = self._find_col(\"kills\", [\"round_number\", \"round_num\", \"round\"])\n"
         "                    if _t3_rnc:\n                        extra += f',k.\"{_t3_rnc}\"'\n                        enames.append(\"_t3_rn\")\n", 1),
        ("                        if _vwc and ex.get(\"vw\"):",
         "                        if _t3_rnc:\n                            evt[\"_chk\"] = chk\n                            evt[\"round_idx\"] = ex.get(\"_t3_rn\")\n"
         "                        if _vwc and ex.get(\"vw\"):", 1),
    ]),
    ("h", "_query_events", [  # rounds read `events_rounds`, a key build_run_cfg never sets
        ("if cfg.get(\"events_rounds\") and self._db_schema.get(\"rounds\"):",
         "if cfg.get(\"_events_rounds\") and self._db_schema.get(\"rounds\"):", 1),
        ("                        except Exception:\n                            pass\n",
         "                        except Exception:\n                            raise\n", 1),
    ]),
    ("i", "_build_sequences", [  # merged event_types kept only the last pair
        ("p[\"event_types\"] = sorted({p[\"event_type\"], s[\"event_type\"]})",
         "p[\"event_types\"] = sorted({ev.get(\"type\", \"kill\") for ev in p[\"events\"]})", 1),
    ]),
    ("j", "_query_events", [  # suicide params appended after the match-type ones, placeholders before
        ("WHERE {psql}{wsql}{hsql}{tksql}{suicidesql}{modsql}{_mt_clause}{_mf_sql}{dsql}",
         "WHERE {psql}{wsql}{hsql}{tksql}{_mt_clause}{suicidesql}{modsql}{_mf_sql}{dsql}", 1),
    ]),
    ("tie", "_query_events", [  # same tie-breaker as Rust (`id` of the event table)
        ("ORDER BY m.\"{dc}\",k.\"{tc}\"')", "ORDER BY m.\"{dc}\",k.\"{tc}\"{_t3_tb(self, 'kills', 'k')}')", 1),
        ("ORDER BY m.\"{dc}\",r.\"{rtc}\"')", "ORDER BY m.\"{dc}\",r.\"{rtc}\"{_t3_tb(self, 'rounds', 'r')}')", 1),
    ]),
    ("tie", "_query_shots", [
        ("ORDER BY m.\"{dc}\",s.\"{tc}\"')", "ORDER BY m.\"{dc}\",s.\"{tc}\"{_t3_tb(self, 'shots', 's')}')", 1),
    ]),
    ("tie", "_fetch_all_kills_for_demos", [
        ("ORDER BY m.\"{dc}\", k.\"{tc}\"')", "ORDER BY m.\"{dc}\", k.\"{tc}\"{_t3_tb(self, 'kills', 'k')}')", 2),
    ]),
    ("tie", "_fetch_native_clutches", [
        ("c.\"{col[\"tick\"]}\"')", "c.\"{col[\"tick\"]}\"{_t3_tb(self, 'clutches', 'c')}')", 1),
    ]),
]

HELPERS = '''

def _t3_tb(host, table, alias):
    """Tie-breaker on the table's own id, when it has one."""
    return f',{alias}."id"' if "id" in host._db_schema.get(table, []) else ""


def _t3_shooter_sids(fire_df, col_sid):
    """Shooter id per shot: the event's user_steamid, else the player prop (3.5 text form)."""
    import pandas as _pd
    user = fire_df["user_steamid"] if "user_steamid" in fire_df.columns else None
    prop = fire_df[col_sid].fillna("").astype(str)
    out = []
    for i in range(len(fire_df)):
        u = user.iloc[i] if user is not None else None
        if u is not None and not (isinstance(u, float) and math.isnan(u)) and not _pd.isna(u) and str(u) != "":
            out.append(str(u) if isinstance(u, str) else str(int(u)))
        else:
            out.append(prop.iloc[i])
    return _pd.Series(out, index=fire_df.index, dtype=object)
'''


def function_span(src, name):
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "EngineMixin":
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == name:
                    start = item.decorator_list[0].lineno if item.decorator_list else item.lineno
                    return start, item.end_lineno
    raise SystemExit(f"patch target not found: EngineMixin.{name}")


def patched_core_source():
    path = REPO / "csdm" / "engine" / "core.py"
    src = path.read_text(encoding="utf-8")
    applied = []
    for letter, fn, edits in PATCHES:
        lines = src.splitlines(keepends=True)
        a, b = function_span(src, fn)
        body = "".join(lines[a - 1:b])
        for old, new, count in edits:
            found = body.count(old)
            if found != count:
                raise SystemExit(f"patch ({letter}) {fn}: expected {count}× {old[:70]!r}, found {found}")
            body = body.replace(old, new)
        src = "".join(lines[:a - 1]) + body + "".join(lines[b:])
        applied.append(f"{letter}:{fn}")
    return src + HELPERS, applied


def load_engine_module(src, name):
    mod = types.ModuleType(name)
    mod.__file__ = str(REPO / "csdm" / "engine" / "core.py")
    exec(compile(src, f"<{name}>", "exec"), mod.__dict__)
    return mod


# ── Read-only database ───────────────────────────────────────────────────────

class Blocked(Exception):
    pass


class RoCursor:
    def __init__(self, cur):
        self._cur = cur

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._cur.close()

    def execute(self, sql, params=None):
        if not sql.lstrip().upper().startswith("SELECT"):
            raise Blocked(f"write refused by the golden generator: {sql.split()[0]}")
        return self._cur.execute(sql, params)

    def fetchall(self):
        return self._cur.fetchall()

    def fetchone(self):
        return self._cur.fetchone()

    def close(self):
        self._cur.close()


class RoConn:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return RoCursor(self._conn.cursor())

    def commit(self):
        self._conn.rollback()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    @property
    def closed(self):
        return self._conn.closed


def install_read_only_connect(psycopg2):
    real = psycopg2.connect

    def connect(**kw):
        conn = real(**kw, options="-c default_transaction_read_only=on")
        conn.set_session(readonly=True, autocommit=True)
        return RoConn(conn)

    psycopg2.connect = connect


# ── Memoised demo parser (changes no result: same calls, same frames) ────────

def install_parser_memo():
    import demoparser2
    real = demoparser2.DemoParser
    memo = {}

    def key(path, *rest):
        st = os.stat(path)
        return (path, st.st_size, st.st_mtime_ns) + rest

    class MemoParser:
        def __init__(self, path):
            self._path = path
            self._real = None

        def _p(self):
            if self._real is None:
                self._real = real(self._path)
            return self._real

        def _get(self, k, fn):
            if k not in memo:
                try:
                    memo[k] = ("ok", fn())
                except Exception as e:  # noqa: BLE001 -- replayed as the same exception
                    memo[k] = ("err", e)
            kind, v = memo[k]
            if kind == "err":
                raise v
            return v.copy() if hasattr(v, "copy") else v

        def parse_event(self, name, player=None, other=None):
            k = key(self._path, "event", name, tuple(player or ()), tuple(other or ()))
            return self._get(k, lambda: self._p().parse_event(name, player=player, other=other))

        def parse_player_info(self):
            return self._get(key(self._path, "info"), lambda: self._p().parse_player_info())

        def parse_ticks(self, props, ticks=None):
            k = key(self._path, "ticks", tuple(props), tuple(ticks or ()))
            return self._get(k, lambda: self._p().parse_ticks(props, ticks=ticks))

    # The constructor is memoised too: DemoParser(path) on a missing / broken file raises.
    ctor_memo = {}

    def make(path):
        k = key(path) if os.path.isfile(path) else (path,)
        if k not in ctor_memo:
            try:
                real(path)
                ctor_memo[k] = None
            except Exception as e:  # noqa: BLE001
                ctor_memo[k] = e
        if ctor_memo[k] is not None:
            raise ctor_memo[k]
        return MemoParser(path)

    demoparser2.DemoParser = make
    return memo


# ── Canonical form ───────────────────────────────────────────────────────────

def canon_value(v):
    if isinstance(v, (set, frozenset)):
        return sorted(canon_value(x) for x in v)
    if isinstance(v, (list, tuple)):
        return [canon_value(x) for x in v]
    if isinstance(v, dict):
        return {str(k): canon_value(x) for k, x in v.items()}
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return {"float": v.hex()} if (math.isnan(v) or math.isinf(v)) else v
    raise TypeError(f"no canonical form for {type(v).__name__}: {v!r}")


def canon_event(e):
    out = {}
    for k, v in e.items():
        if k == "_chk":  # the demo's checksum, already the key of its list (set by correction g)
            continue
        if k == "_clutch_kills":
            out[k] = [canon_event(x) for x in v]
        else:
            out[k] = canon_value(v)
    return out


def canon_payload(host, payload):
    events = payload["events"]
    seqs = payload["sequences"]
    out_events, out_seqs = {}, {}
    for dp, evs in events.items():
        out_events[dp] = [canon_event(e) for e in evs]
    for dp, ss in seqs.items():
        pos = {id(e): i for i, e in enumerate(events.get(dp, []))}
        rows = []
        for s in ss:
            row = {k: canon_value(v) for k, v in s.items() if k not in ("events",)}
            # Sequence events are the same objects as the demo's list: refer to them by position.
            row["events"] = [pos[id(e)] if id(e) in pos else {"copy": canon_event(e)} for e in s["events"]]
            rows.append(row)
        out_seqs[dp] = rows
    return {"events": out_events, "sequences": out_seqs,
            "empty_reason": canon_value(payload.get("empty_reason"))}


def tie_insensitive(c):
    """The same preview with events sorted inside each (demo, tick) group (order of equals)."""
    ev = {}
    for dp, evs in c.get("events", {}).items():
        ev[dp] = sorted(evs, key=lambda e: (e.get("tick", 0), json.dumps(e, sort_keys=True)))
    return {"events": ev, "empty_reason": c.get("empty_reason")}


# ── Cases ────────────────────────────────────────────────────────────────────

def filter_case(f, base):
    cfg = {**base, f.key: True}
    if "damage" in f.applies_to and "kill" not in f.applies_to:
        cfg.update({"event_non_lethal": True, "event_lethal": False, "event_ally": True})
    if "shot" in f.applies_to and "kill" not in f.applies_to:
        cfg.update({"event_other": True, "event_lethal": False})
    if f.key == "kill_mod_mate_pov":
        cfg["perspective"] = "victim"
    return cfg


def mixed_cases(base, disc, years):
    weapons = disc["weapons"]
    maps = [k for k, _ in disc["maps"]]
    y0, y1 = years
    return [
        ("mixed_required_optional", {**base, "kill_mod_one_tap": True, "kill_mod_one_tap_req": True,
                                     "kill_mod_through_smoke": True, "kill_mod_entry_frag": True,
                                     "kill_mod_flick": True}),
        ("mixed_exclusions", {**base, "kill_mod_no_scope_exclude": True, "kill_mod_eco_frag_exclude": True,
                              "kill_mod_spray_transfer_exclude": True, "kill_mod_airborne": True}),
        ("mixed_clutch_kills", {**base, "clutch_enabled": True, "clutch_1v2": True, "clutch_1v3": True,
                                "kill_mod_multi_kill": True}),
        ("mixed_clutch_full_won", {**base, "clutch_enabled": True, "clutch_mode": "full_clutch",
                                   "clutch_wins_only": True}),
        ("mixed_nonlethal_other", {**base, "event_non_lethal": True, "event_other": True, "event_target": True,
                                   "event_ally": True, "dmg_mod_big_hit": True, "dmg_mod_team_damage": True,
                                   "shot_mod_long_spray": True, "shot_mod_run_gun_req": True,
                                   "date_from": f"01-01-{y1}", "date_to": f"31-03-{y1}"}),
        ("mixed_both_mate_pov", {**base, "perspective": "both", "kill_mod_mate_pov": True,
                                 "kill_mod_savior": True, "victim_pre_s": 3}),
        ("mixed_scope_filters", {**base, "weapons": weapons[: max(1, len(weapons) // 3)],
                                 "map_filter_enabled": True, "map_filter": maps[: max(1, len(maps) // 2)],
                                 "headshots_mode": "only", "date_from": f"01-06-{y0}", "date_to": f"31-12-{y1}"}),
        ("mixed_suicides_match_types_rounds", {**base, "suicides_mode": "exclude", "match_type_filter_enabled": True,
                                               "match_type_premier": True, "match_type_competitive": True,
                                               "events": ["Rounds"], "event_target": True}),
        ("mixed_trois_tap_bully", {**base, "kill_mod_trois_tap": True, "kill_mod_bully": True,
                                   "kill_mod_wall_bang": True, "kill_mod_wall_bang_req": True}),
        ("mixed_empty_explained", {**base, "weapons": ["knife"], "headshots_mode": "only",
                                   "kill_mod_ace": True, "kill_mod_ace_req": True}),
    ]


INT_RANGES = {
    "before": (0, 8), "after": (0, 10), "victim_pre_s": (0, 5),
    "kill_mod_one_tap_s": (1, 4), "kill_mod_high_vel_thr": (60, 240), "kill_mod_flick_deg": (20, 120),
    "kill_mod_multi_kill_n": (2, 5), "kill_mod_multi_kill_s": (3, 20), "kill_mod_bully_n": (2, 5),
    "dmg_mod_big_hit_min": (40, 100), "dmg_mod_low_hp_max": (1, 20), "dmg_mod_multi_nade_min": (2, 4),
    "shot_mod_long_spray_min": (5, 20), "shot_mod_run_gun_speed": (120, 250),
}


def random_case(rng, base, registry, disc, years, settings_types):
    cfg = dict(base)
    for f in registry:
        if rng.random() < 0.12:
            cfg[f.key] = True
            if rng.random() < 0.35:
                cfg[f"{f.key}_req"] = True
        if f"{f.key}_exclude" in settings_types and rng.random() < 0.05:
            cfg[f"{f.key}_exclude"] = True
        for k in (f.extra_config or {}):
            if settings_types.get(k) == "bool":
                cfg[k] = rng.random() < 0.5
            elif k in INT_RANGES and rng.random() < 0.5:
                cfg[k] = rng.randint(*INT_RANGES[k])
    for k in ("before", "after", "victim_pre_s"):
        if rng.random() < 0.4:
            cfg[k] = rng.randint(*INT_RANGES[k])
    cfg["event_actor"] = rng.random() < 0.85
    cfg["event_target"] = rng.random() < 0.3
    cfg["event_ally"] = rng.random() < 0.25
    cfg["event_enemy"] = rng.random() < 0.9
    cfg["event_lethal"] = rng.random() < 0.85
    cfg["event_non_lethal"] = rng.random() < 0.15
    cfg["event_other"] = rng.random() < 0.1
    cfg["events"] = ["Rounds"] if rng.random() < 0.08 else []
    cfg["perspective"] = rng.choice(["killer", "killer", "victim", "both"])
    cfg["headshots_mode"] = rng.choice(["all", "all", "all", "only", "exclude"])
    cfg["suicides_mode"] = rng.choice(["include", "include", "include", "exclude", "only"])
    if rng.random() < 0.15:
        cfg["clutch_enabled"] = True
        cfg["clutch_mode"] = rng.choice(["kills_only", "full_clutch"])
        cfg["clutch_wins_only"] = rng.random() < 0.3
        for n in range(1, 6):
            cfg[f"clutch_1v{n}"] = rng.random() < 0.3
    if rng.random() < 0.15:
        cfg["weapons"] = rng.sample(disc["weapons"], k=min(len(disc["weapons"]), rng.randint(1, 12)))
    if rng.random() < 0.15:
        maps = [k for k, _ in disc["maps"]]
        cfg["map_filter_enabled"] = True
        cfg["map_filter"] = rng.sample(maps, k=min(len(maps), rng.randint(0, 4)))
    if rng.random() < 0.15:
        from csdm.static_data import MATCH_TYPE_DEFS
        cfg["match_type_filter_enabled"] = True
        for _db, key, _l, _t in MATCH_TYPE_DEFS:
            cfg[key] = rng.random() < 0.4
    heavy = cfg["event_other"] or cfg["event_non_lethal"]
    if heavy or rng.random() < 0.2:
        y = rng.randint(*years)
        m = rng.randint(1, 10)
        span = 1 if heavy else rng.randint(1, 18)
        m2 = min(12, m + span)
        cfg["date_from"] = f"01-{m:02d}-{y}"
        cfg["date_to"] = f"28-{m2:02d}-{y}"
    return cfg


def build_cases(core_mod, base, disc, presets, years):
    from csdm.config import preset_payload
    from csdm.static_data import KILL_FILTER_REGISTRY
    settings_types = {}
    from csdm.config import DEFAULT_CONFIG
    for k, v in DEFAULT_CONFIG.items():
        settings_types[k] = "bool" if isinstance(v, bool) else type(v).__name__
    cases = [(f"filter:{f.key}", filter_case(f, base)) for f in KILL_FILTER_REGISTRY]
    cases += [(f"mixed:{n}", c) for n, c in mixed_cases(base, disc, years)]
    for i, (_name, preset) in enumerate(presets.items()):
        data, keys, _sel = preset_payload(preset)
        picked = {k: data[k] for k in (data if keys is None else keys) if k in data}
        for secret in ("pg_pass", "pass", "password"):
            picked.pop(secret, None)
        cases.append((f"preset:{i}", {**base, **picked}))
    rng = random.Random(SEED)
    for i in range(RANDOM_CASES):
        cases.append((f"random:{i}", random_case(rng, base, KILL_FILTER_REGISTRY, disc, years, settings_types)))
    return cases


# ── Running one case ─────────────────────────────────────────────────────────

def make_host(core_mod, cfg_db, disc):
    from csdm.engine.ports import CollectingPorts
    from csdm.engine.state import EngineStateMixin

    class Host(EngineStateMixin, core_mod.EngineMixin):
        def __init__(self, ports):
            self.init_engine_state()
            self.ports = ports
            self.log, self.log_parts = ports.log, ports.log_parts
            self.state, self.ask = ports.state, ports.ask

    host = Host(CollectingPorts())
    host.set_pg_params(cfg_db)
    if disc:  # the probe host only discovers
        host.apply_discovery(copy.deepcopy(disc))
    return host


def run_case(core_mod, cfg_db, disc, conn, case_cfg):
    host = make_host(core_mod, cfg_db, disc)
    host._db_conn = conn
    run_cfg = host.build_run_cfg(case_cfg)
    problem = host.run_inputs_problem(run_cfg)
    if problem:
        return {"problem": problem}
    states = host.ports.states
    t0 = time.time()
    host._preview_worker(run_cfg)
    elapsed = time.time() - t0
    ready = [p for n, p in states if n == "preview_ready"]
    if not ready:
        logs = [m for m, lvl in host.ports.logs if lvl == "err"]
        return {"failed": logs[-1] if logs else "no preview_ready", "seconds": elapsed}
    payload = ready[-1]
    out = canon_payload(host, payload)
    out["summary"] = canon_value([p for n, p in states if n == "summary"][-1])
    out["seconds"] = elapsed
    seqs = payload["sequences"]
    out["export_rows"] = canon_value(host.preview_clip_rows(seqs, payload["cfg"]))
    cams = []
    for dp in list(seqs)[:2]:
        for s in seqs[dp][:2]:
            entry = {"demo_path": dp, "start_tick": s["start_tick"]}
            cams.append({"entry": entry, "cameras": canon_value(host.edited_clip_cameras(entry))})
            if len(s["events"]) > 1:
                from csdm.engine.clip_edits import event_key
                edited = {**entry, "before_s": 1, "after_s": 2, "excluded_events": [event_key(s["events"][0])]}
                cams.append({"entry": edited, "cameras": canon_value(host.edited_clip_cameras(edited))})
    out["clip_cameras"] = cams
    return out


def compare_shipped(fixed, shipped):
    if "failed" in shipped and "failed" not in fixed:
        return "shipped_fails"
    def no_round(v):  # correction g adds round_idx to kills; 3.5 never sets it
        if isinstance(v, dict):
            return {k: no_round(x) for k, x in v.items() if k != "round_idx"}
        return [no_round(x) for x in v] if isinstance(v, list) else v
    strip = lambda c: no_round({k: c.get(k) for k in ("problem", "failed", "events", "sequences", "empty_reason")})
    if strip(fixed) == strip(shipped):
        return "same"
    if "events" in fixed and "events" in shipped and tie_insensitive(no_round(fixed)) == tie_insensitive(no_round(shipped)):
        return "tie_order_only"
    return "differs"


def exercised(cfg, run_cfg_flags):
    """Which corrections a case's settings can reach (upper bound of its dependence)."""
    on = lambda k: bool(cfg.get(k)) or bool(cfg.get(f"{k}_exclude"))
    out = []
    if run_cfg_flags.get("_events_non_lethal"):
        out.append("a")
    if on("kill_mod_flick"):
        out.append("b")
    if any(on(k) for k in ("kill_mod_trois_tap", "kill_mod_trois_shot", "kill_mod_one_tap",
                           "kill_mod_spray_transfer", "kill_mod_high_velocity", "kill_mod_collateral")):
        out.append("c")
    if on("kill_mod_wall_bang") or on("kill_mod_attacker_blind"):
        out.append("e")
    if any(on(k) for k in ("kill_mod_entry_frag", "kill_mod_ace", "kill_mod_multi_kill",
                           "kill_mod_bully", "kill_mod_eco_frag")):
        out.append("g")
    if run_cfg_flags.get("_events_rounds"):
        out.append("h")
    out.append("i")  # any merged sequence of three or more events
    if cfg.get("suicides_mode", "include") != "include" and cfg.get("match_type_filter_enabled"):
        out.append("j")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="copy of csdm_config.json (never the original)")
    ap.add_argument("--presets", required=True, help="copy of csdm_presets.json (never the original)")
    ap.add_argument("--out", required=True, help="folder outside the repository")
    ap.add_argument("--only", default="", help="comma-separated case numbers")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-shipped", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    if REPO in out.resolve().parents or out.resolve() == REPO:
        sys.exit("refusing to write the author's data inside the repository")
    (out / "cases").mkdir(parents=True, exist_ok=True)

    profile = tempfile.mkdtemp(prefix="csdm_t3_profile_")
    os.environ["CSDM_PROFILE_ROOT"] = profile
    sys.path.insert(0, str(REPO))
    import psycopg2
    install_read_only_connect(psycopg2)
    memo = install_parser_memo()
    import csdm.engine.core as shipped_core
    src, applied = patched_core_source()
    fixed_core = load_engine_module(src, "csdm_t3_fixed_core")

    user_cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    presets = json.loads(Path(a.presets).read_text(encoding="utf-8"))
    probe = make_host(fixed_core, user_cfg, {})
    disc = probe.discover_database()
    from csdm.config import DEFAULT_CONFIG
    base = copy.deepcopy(DEFAULT_CONFIG)
    for k in ("steam_ids", "steam_id", "player_name"):
        base[k] = user_cfg.get(k, base[k])
    for k in [k for k in base if k.startswith("pg_")]:
        base.pop(k)
    with probe._pg().cursor() as cur:
        cur.execute(f'SELECT MIN(EXTRACT(YEAR FROM m."{disc["date_col"]}")), MAX(EXTRACT(YEAR FROM m."{disc["date_col"]}")) FROM matches m')
        lo, hi = cur.fetchone()
    years = (int(lo), int(hi))
    cases = build_cases(fixed_core, base, disc, presets, years)
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        selected = [(i, c) for i, c in enumerate(cases) if i in wanted]
    else:
        selected = list(enumerate(cases))[: a.limit or None]

    conn_fixed = make_host(fixed_core, user_cfg, disc)._pg()
    conn_shipped = make_host(shipped_core, user_cfg, disc)._pg()
    meta = {"engine": "3.5 csdm/engine/core.py + corrections", "patches": applied, "seed": SEED,
            "cases": len(cases), "base_keys": sorted(base), "years": years}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    log = open(out / "generate.log", "a", encoding="utf-8")
    for i, (name, cfg) in selected:
        flags = make_host(fixed_core, user_cfg, disc).build_run_cfg(cfg)
        t0 = time.time()
        try:
            fixed = run_case(fixed_core, user_cfg, disc, conn_fixed, cfg)
        except Exception:  # noqa: BLE001 -- a generator crash is reported, never hidden
            fixed = {"generator_error": traceback.format_exc()}
        verdict = "skipped"
        if not a.skip_shipped and "generator_error" not in fixed:
            try:
                shipped = run_case(shipped_core, user_cfg, disc, conn_shipped, cfg)
            except Exception as e:  # noqa: BLE001
                shipped = {"failed": f"{type(e).__name__}: {e}"}
                conn_shipped.rollback()
            verdict = compare_shipped(fixed, shipped)
        record = {"index": i, "name": name, "cfg": cfg, "result": fixed, "shipped": verdict,
                  "exercised": exercised(cfg, flags)}
        text = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        (out / "cases" / f"{i:04d}.json").write_text(text, encoding="utf-8")
        n_ev = sum(len(v) for v in fixed.get("result", fixed).get("events", {}).values()) if "events" in fixed else 0
        kind = next((k for k in ("problem", "failed", "generator_error") if k in fixed), "preview")
        line = (f"{i:4d} {name:<48} {kind:<10} events={n_ev:<7} shipped={verdict:<15} "
                f"{time.time() - t0:6.1f}s sha={hashlib.sha256(text.encode()).hexdigest()[:12]}")
        print(line, flush=True)
        log.write(line + "\n")
        log.flush()
    print(f"parse memo entries: {len(memo)}")


if __name__ == "__main__":
    main()
