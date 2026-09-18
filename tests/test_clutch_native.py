"""Clutch filter: CSDM's native `clutches` table first, kill-based detection as fallback.

Audit C6 / E9 (2026-09-18). The engine used to rebuild clutches from the kills
alone, so a clutch won on the bomb, the defuse or the clock counted as lost.
These tests pin:
  * `_apply_clutch_windows` — size, wins-only, kills-only and full-clutch modes
    on hand-made windows (pure, no database);
  * `_fetch_native_clutches` — the SQL it sends and the windows it builds;
  * `_clutch_windows_for` — native when the table covers the demo, fallback else;
  * the fallback — same output as the pre-E9 `_apply_clutch_filter`, kept
    verbatim below as an oracle.
"""
import itertools

from csdm.engine.core import DISCOVERY_TABLES, EngineMixin
from csdm.engine.state import EngineStateMixin


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self):
        self.init_engine_state()
        self.logs = []
        self.log = lambda message, level="": self.logs.append((level, message))
        self.log_parts = lambda parts: None
        self.state = lambda name, payload=None: None
        self.ask = lambda kind, message, options: None


class _Cursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, list(params or [])))
        self._rows = self.conn.rows_for(sql)

    def fetchall(self):
        return list(self._rows)


class _Conn:
    closed = False

    def __init__(self, clutch_rows=()):
        self.clutch_rows = list(clutch_rows)
        self.executed = []

    def cursor(self):
        return _Cursor(self)

    def rows_for(self, sql):
        return self.clutch_rows if "clutches" in sql else []


CLUTCH_SCHEMA = {
    "matches": ["checksum", "demo_path"],
    "rounds": ["match_checksum", "number", "start_tick", "end_tick", "end_officially_tick"],
    "clutches": ["id", "match_checksum", "round_number", "tick", "clutcher_steam_id",
                 "won", "opponent_count", "has_clutcher_survived", "clutcher_kill_count"],
}

BASE_CFG = {"clutch_enabled": True, "tickrate": 64, "before": 3, "after": 5}


def _cfg(**kw):
    cfg = dict(BASE_CFG)
    cfg.update(kw)
    return cfg


def _win(start, opponents, won, rmin, rmax, end=None, round_no=1, dp="a.dem"):
    return (dp, round_no), {
        "start_tick": start, "opponents": opponents, "won": won,
        "round_tick_min": rmin, "round_tick_max": rmax,
        "end_tick": rmax if end is None else end, "kill_ticks": [],
    }


def _kill(tick, killer="P"):
    return {"tick": tick, "type": "kill", "weapon": "ak47", "killer_sid": killer}


# ─────────────────────────────────────────────────────────────────────────────
# Pre-E9 implementation, copied verbatim from main 663ef98 (core.py:1815-2116).
# Only the name changed. It is the oracle for the fallback path.
# ─────────────────────────────────────────────────────────────────────────────
def legacy_apply_clutch_filter(self, results, sids, cfg, all_kills_by_demo):
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


# ── Discovery ────────────────────────────────────────────────────────────────

def test_clutches_table_is_discovered():
    assert "clutches" in DISCOVERY_TABLES


# ── _apply_clutch_windows: pure ──────────────────────────────────────────────

def _two_rounds():
    """Round 1: 1v2 won, starts at 1000. Round 2: 1v4 lost, starts at 5200."""
    return dict([
        _win(1000, 2, True, 500, 2000, end=2400, round_no=1),
        _win(5200, 4, False, 4000, 6000, end=6100, round_no=2),
    ])


def _events():
    return [
        _kill(800),                 # round 1, before the clutch started
        _kill(1200), _kill(1500),   # round 1, inside the clutch
        _kill(1300, killer="X"),    # a kill by somebody else
        _kill(3000),                # between rounds: no window
        _kill(5300),                # round 2, inside the clutch
        {"tick": 1100, "type": "damage_actor", "weapon": "ak47"},
        {"tick": 900, "type": "round", "weapon": ""},
        {"tick": 950, "type": "death", "weapon": ""},
    ]


def test_kills_only_keeps_the_players_kills_after_the_clutch_start():
    host = _Host()
    out = host._apply_clutch_windows({"a.dem": _events()}, ["P"], _cfg(),
                                     {"a.dem": _two_rounds()})
    kills = [e for e in out["a.dem"] if e["type"] == "kill"]
    assert [e["tick"] for e in kills] == [1200, 1500, 5300]
    assert [(e["_clutch_opponents"], e["_clutch_won"], e["_clutch_start_tick"])
            for e in kills] == [(2, True, 1000), (2, True, 1000), (4, False, 5200)]
    assert [e["type"] for e in out["a.dem"] if e["type"] != "kill"] == ["damage_actor"]


def test_kills_only_does_not_mutate_the_input_events():
    host = _Host()
    events = _events()
    host._apply_clutch_windows({"a.dem": events}, ["P"], _cfg(), {"a.dem": _two_rounds()})
    assert all("_clutch_won" not in e for e in events)


def test_wins_only_drops_lost_clutches():
    host = _Host()
    out = host._apply_clutch_windows({"a.dem": _events()}, ["P"],
                                     _cfg(clutch_wins_only=True), {"a.dem": _two_rounds()})
    assert [e["tick"] for e in out["a.dem"] if e["type"] == "kill"] == [1200, 1500]


def test_size_filter_keeps_only_the_ticked_sizes():
    host = _Host()
    out = host._apply_clutch_windows({"a.dem": _events()}, ["P"],
                                     _cfg(clutch_1v4=True), {"a.dem": _two_rounds()})
    assert [e["tick"] for e in out["a.dem"] if e["type"] == "kill"] == [5300]
    out = host._apply_clutch_windows({"a.dem": _events()}, ["P"],
                                     _cfg(clutch_1v1=True), {"a.dem": _two_rounds()})
    assert "a.dem" not in out   # no window left for this demo


def test_full_clutch_builds_one_padded_event_per_window_ending_at_the_window_end():
    host = _Host()
    out = host._apply_clutch_windows({"a.dem": _events()}, ["P"],
                                     _cfg(clutch_mode="full_clutch"), {"a.dem": _two_rounds()})
    rounds = [e for e in out["a.dem"] if e["type"] == "clutch_round"]
    assert [(e["tick"], e["_clutch_end_tick"], e["_seq_start_tick"], e["_seq_end_tick"])
            for e in rounds] == [(1000, 2400, 1000 - 3 * 64, 2400 + 5 * 64),
                                 (5200, 6100, 5200 - 3 * 64, 6100 + 5 * 64)]
    assert sorted(k["tick"] for k in rounds[0]["_clutch_kills"]) == [1200, 1300, 1500]
    assert [k["tick"] for k in rounds[1]["_clutch_kills"]] == [5300]
    assert [e["type"] for e in out["a.dem"]][-1] == "damage_actor"


def test_a_demo_without_windows_is_dropped():
    host = _Host()
    out = host._apply_clutch_windows({"a.dem": _events(), "b.dem": _events()}, ["P"],
                                     _cfg(), {"a.dem": _two_rounds()})
    assert set(out) == {"a.dem"}


def test_kills_are_matched_to_their_round_by_tick_not_by_an_approximate_round_index():
    # Round 4 is a clutch (ticks 20000-21000). A kill at tick 30000 belongs to a
    # later round, yet 30000 // (64*115) == 4: the pre-E9 key lookup tagged it
    # as part of round 4's clutch.
    host = _Host()
    windows = dict([_win(20100, 2, True, 20000, 21000, round_no=4)])
    out = host._apply_clutch_windows({"a.dem": [_kill(20500), _kill(30000)]}, ["P"],
                                     _cfg(), {"a.dem": windows})
    assert [e["tick"] for e in out["a.dem"]] == [20500]


# ── _fetch_native_clutches: fake database ────────────────────────────────────

def _native_host(rows, schema=CLUTCH_SCHEMA):
    host = _Host()
    host._db_schema = {t: list(c) for t, c in schema.items()}
    host._db_conn = _Conn(rows)
    host._demo_checksums = {"a.dem": "chkA", "b.dem": "chkB"}
    return host


# (demo_path, checksum, round, tick, clutcher, won, opponents, r_start, r_end, r_end_officially)
NATIVE_ROWS = [
    ("a.dem", "chkA", 3, 12000, "P", True, 2, 10000, 14000, 14400),
    ("a.dem", "chkA", 5, 22000, "P", False, 4, 20000, 23000, 23400),
    ("a.dem", "chkA", 5, 22500, "X", True, 1, 20000, 23000, 23400),   # someone else
    ("a.dem", "chkA", 7, 31000, "Q", True, 1, 30000, 32000, 32400),   # other sid, later
    ("a.dem", "chkA", 7, 30500, "P", False, 1, 30000, 32000, 32400),  # than this one
]


def test_native_fetch_builds_windows_from_clutches_joined_to_rounds():
    host = _native_host(NATIVE_ROWS)
    out = host._fetch_native_clutches({"a.dem", "b.dem"}, ["P", "Q"])
    assert set(out) == {"a.dem"}
    w = out["a.dem"]
    assert sorted(w) == [("a.dem", 3), ("a.dem", 5), ("a.dem", 7)]
    assert w[("a.dem", 3)] == {
        "start_tick": 12000, "opponents": 2, "won": True,
        "round_tick_min": 10000, "round_tick_max": 14400, "end_tick": 14000,
        "kill_ticks": [],
    }
    assert w[("a.dem", 5)]["won"] is False
    assert w[("a.dem", 7)]["start_tick"] == 30500   # earliest clutch of the round


def test_native_fetch_sql_excludes_anomalies_and_joins_rounds():
    host = _native_host(NATIVE_ROWS)
    host._fetch_native_clutches({"a.dem", "b.dem"}, ["P"])
    sql, params = next((s, p) for s, p in host._db_conn.executed if "clutches" in s)
    assert "opponent_count" in sql and ">= 1" in sql
    assert "JOIN rounds" in sql
    assert sorted(params) == ["chkA", "chkB"]
    assert not any(w in sql.upper() for w in ("INSERT", "UPDATE", "DELETE"))


def test_native_fetch_reports_absent_table_or_columns_as_none():
    no_table = {k: v for k, v in CLUTCH_SCHEMA.items() if k != "clutches"}
    assert _native_host([], no_table)._fetch_native_clutches({"a.dem"}, ["P"]) is None
    partial = dict(CLUTCH_SCHEMA, clutches=["match_checksum", "round_number", "tick"])
    assert _native_host([], partial)._fetch_native_clutches({"a.dem"}, ["P"]) is None


def test_native_fetch_reports_a_database_error_as_none():
    host = _native_host([])

    class _Broken(_Cursor):
        def execute(self, sql, params=None):
            raise RuntimeError("relation does not exist")
    host._db_conn.cursor = lambda: _Broken(host._db_conn)
    assert host._fetch_native_clutches({"a.dem"}, ["P"]) is None


# ── _clutch_windows_for: native or fallback, logged ──────────────────────────

def test_native_source_is_used_and_logged_when_the_table_covers_the_demo():
    host = _native_host(NATIVE_ROWS)

    def no_fallback(paths):
        raise AssertionError("fallback must not run")
    host._fetch_all_kills_for_demos = no_fallback
    windows = host._clutch_windows_for({"a.dem": []}, ["P"], _cfg())
    assert sorted(windows["a.dem"]) == [("a.dem", 3), ("a.dem", 5), ("a.dem", 7)]
    assert any("clutches table" in m for _, m in host.logs)


def test_a_demo_absent_from_the_table_falls_back_to_kill_detection():
    host = _native_host(NATIVE_ROWS)
    seen = []

    def fake_fetch(paths):
        seen.append(set(paths))
        return {"b.dem": [{"tick": 1}]}
    host._fetch_all_kills_for_demos = fake_fetch
    host._detect_clutch_windows_from_kills = lambda results, sids, cfg, kills: {
        dp: {(dp, 1): "fallback"} for dp in kills}
    windows = host._clutch_windows_for({"a.dem": [], "b.dem": []}, ["P"], _cfg())
    assert seen == [{"b.dem"}]
    assert windows["b.dem"] == {("b.dem", 1): "fallback"}
    assert ("a.dem", 3) in windows["a.dem"]
    assert any("kill-based" in m for _, m in host.logs)


def test_without_the_table_every_demo_uses_the_fallback():
    host = _native_host([], {k: v for k, v in CLUTCH_SCHEMA.items() if k != "clutches"})
    host._fetch_all_kills_for_demos = lambda paths: {dp: [{"tick": 1}] for dp in paths}
    host._detect_clutch_windows_from_kills = lambda results, sids, cfg, kills: {
        dp: {} for dp in kills}
    windows = host._clutch_windows_for({"a.dem": []}, ["P"], _cfg())
    assert windows == {"a.dem": {}}
    assert any("kill-based" in m for _, m in host.logs)


def test_no_source_at_all_returns_none_so_the_filter_is_skipped():
    host = _native_host([], {k: v for k, v in CLUTCH_SCHEMA.items() if k != "clutches"})
    host._fetch_all_kills_for_demos = lambda paths: {}
    assert host._clutch_windows_for({"a.dem": []}, ["P"], _cfg()) is None


# ── Fallback == pre-E9 behaviour ─────────────────────────────────────────────

def _k(tick, killer, kteam, victim, vteam, rn):
    return {"tick": tick, "killer_sid": killer, "victim_sid": victim,
            "killer_team": kteam, "victim_team": vteam, "round_num": rn}


def _fixture():
    """All kills + the player's events for four demos.

    Round n sits at ticks [n*7360+100, n*7360+7000] so the pre-E9 approximate
    round index equals the true round number: the oracle's key lookup and the
    new tick-range match then agree, and any difference is a real regression.
    """
    def at(rn, off):
        return rn * 7360 + 100 + off

    a = []
    # Round 1: P (alpha) ends up 1v2 and wins by kills.
    a += [_k(at(1, 0), "P", "alpha", "t1", "bravo", 1), _k(at(1, 10), "c1", "alpha", "t2", "bravo", 1),
          _k(at(1, 20), "t3", "bravo", "c1", "alpha", 1), _k(at(1, 30), "t3", "bravo", "c2", "alpha", 1),
          _k(at(1, 40), "c3", "alpha", "t3", "bravo", 1), _k(at(1, 50), "t4", "bravo", "c3", "alpha", 1),
          _k(at(1, 60), "t4", "bravo", "c4", "alpha", 1),
          _k(at(1, 70), "P", "alpha", "t4", "bravo", 1), _k(at(1, 80), "P", "alpha", "t5", "bravo", 1)]
    # Round 2: four killers take out P's team: 1v5, P gets one then dies.
    a += [_k(at(2, i * 10), f"t{i + 1}", "bravo", f"c{i + 1}", "alpha", 2) for i in range(4)]
    a += [_k(at(2, 50), "P", "alpha", "t5", "bravo", 2),
          _k(at(2, 60), "t1", "bravo", "P", "alpha", 2)]
    # Round 3: P dies first, no clutch.
    a += [_k(at(3, 0), "t1", "bravo", "P", "alpha", 3), _k(at(3, 10), "c1", "alpha", "t1", "bravo", 3)]
    # Round 4: P scores early, three more opponents fall, then 1v1 won.
    a += [_k(at(4, 0), "P", "alpha", "t1", "bravo", 4),
          _k(at(4, 10), "c1", "alpha", "t3", "bravo", 4),
          _k(at(4, 20), "c2", "alpha", "t4", "bravo", 4),
          _k(at(4, 30), "c3", "alpha", "t5", "bravo", 4)]
    a += [_k(at(4, 40 + i * 10), "t2", "bravo", f"c{i + 1}", "alpha", 4) for i in range(4)]
    a += [_k(at(4, 100), "P", "alpha", "t2", "bravo", 4)]

    # Demo b: no team data at all.
    b = [_k(at(1, 0), "X1", "", "Y1", "", 1), _k(at(1, 10), "Z1", "", "P", "", 1),
         _k(at(2, 0), "X1", "", "P", "", 2)]

    # Demo c: wingman, a teammate who never kills nor dies (ghost), roster known.
    c = [_k(at(1, 0), "P", "alpha", "t1", "bravo", 1), _k(at(1, 10), "t2", "bravo", "P", "alpha", 1),
         _k(at(2, 0), "t1", "bravo", "c1", "alpha", 2), _k(at(2, 10), "P", "alpha", "t1", "bravo", 2),
         _k(at(2, 20), "P", "alpha", "t2", "bravo", 2)]

    all_kills = {"a.dem": a, "b.dem": b, "c.dem": c}

    def player_events(kills):
        ev = [{"tick": k["tick"], "type": "kill", "weapon": "ak47", "killer_sid": "P"}
              for k in kills if k["killer_sid"] == "P"]
        ev += [{"tick": k["tick"], "type": "death", "weapon": ""}
               for k in kills if k["victim_sid"] == "P"]
        return ev

    results = {dp: player_events(k) for dp, k in all_kills.items()}
    results["a.dem"].append({"tick": at(1, 75), "type": "damage_actor", "weapon": "ak47"})
    results["a.dem"].append({"tick": at(1, 1), "type": "round", "weapon": ""})
    results["d.dem"] = [_kill(at(1, 0))]          # no all-kills data at all
    return results, all_kills


def _all_cfgs():
    sizes = [(), (1,), (2, 5), (3,)]
    for mode, wins, size in itertools.product(("kills_only", "full_clutch"),
                                               (False, True), sizes):
        cfg = _cfg(clutch_mode=mode, clutch_wins_only=wins)
        for n in size:
            cfg[f"clutch_1v{n}"] = True
        yield cfg


def _host_for_fallback():
    host = _Host()
    host._demo_checksums = {"c.dem": "chkC"}
    # Team names that are not substrings of each other: the fallback matches
    # roster names to kill-row team labels by substring ("t" in "ct").
    host._clutch_roster_sizes = {"chkC": {"alpha": 2, "bravo": 2}}
    return host


def test_fallback_matches_the_pre_e9_filter_on_every_setting():
    compared = 0
    for cfg in _all_cfgs():
        results, all_kills = _fixture()
        expected = legacy_apply_clutch_filter(_host_for_fallback(), results, ["P"], cfg,
                                              all_kills)
        results, all_kills = _fixture()
        got = _host_for_fallback()._apply_clutch_filter(results, ["P"], cfg, all_kills)
        assert got == expected, cfg
        compared += bool(expected)
    assert compared >= 10   # the fixture really produces clutches


def test_fallback_fixture_covers_wins_losses_and_sizes():
    results, all_kills = _fixture()
    windows = _host_for_fallback()._detect_clutch_windows_from_kills(
        results, ["P"], _cfg(), all_kills)
    got = {(dp, rk[1]): (w["opponents"], w["won"])
           for dp, per in windows.items() for rk, w in per.items()}
    assert got[("a.dem", 1)] == (2, True)
    assert got[("a.dem", 2)] == (5, False)
    assert ("a.dem", 3) not in got
    assert got[("a.dem", 4)] == (1, True)
    assert ("c.dem", 1) not in got          # the ghost teammate was still alive
    assert got[("c.dem", 2)] == (2, True)
    assert "d.dem" not in windows


# ── Ghost-player correction must match team names exactly, not by substring ──
#
# The roster-based ghost correction used to match a roster team name to a
# kill-row team label by substring containment ("t" in "ct"). With real team
# names "t"/"ct" (the side labels CSDM falls back to), that check is true no
# matter which name is on which side, so *both* roster entries collapse onto
# whichever label python's `set` iterates first for that process — an order
# the test cannot control or predict. Whichever label wins ends up sized
# max(t_roster, ct_roster) and the other is left at its raw, uncorrected kill
# count. Sizing the two rosters asymmetrically (5 vs 2) makes sure that is
# wrong under *either* winner: the losing team is either stuck at 1 (raw,
# never topped up) or ballooned to 5 (the other team's roster size stolen).
# Only an exact match reliably yields the real opponent size (2) both ways.

def test_ghost_correction_matches_team_names_exactly_not_by_substring():
    host = _Host()
    host._demo_checksums = {"e.dem": "chkE"}
    # "t" team: 5 rostered, all 5 show up in the kills below (no ghost need).
    # "ct" team: 2 rostered, only e1 shows up in kills (e2 is a silent ghost).
    host._clutch_roster_sizes = {"chkE": {"t": 5, "ct": 2}}

    e = [
        _k(100, "e1", "ct", "c2", "t", 1),
        _k(110, "e1", "ct", "c3", "t", 1),
        _k(120, "e1", "ct", "c4", "t", 1),
        _k(130, "e1", "ct", "c5", "t", 1),   # P's team now down to P alone
        _k(140, "P",  "t",  "e1", "ct", 1),  # P trades the only observed opponent
    ]
    all_kills = {"e.dem": e}
    results = {"e.dem": [{"tick": k["tick"], "type": "kill", "weapon": "ak47",
                           "killer_sid": k["killer_sid"]}
                          for k in e if k["killer_sid"] == "P"]}

    windows = host._detect_clutch_windows_from_kills(results, ["P"], _cfg(), all_kills)
    window = windows["e.dem"][("e.dem", 1)]
    # The real roster says 2 opponents (e1 + the ghost e2), never 1 and never 5.
    assert window["opponents"] == 2
