"""Golden references for csdm-demo: what demoparser2 (Python) returns for the five calls 3.5.x made.

Development tool only (the app runs no Python). Needs the demoparser2 version equal to rust/vendor/PARSER_TAG.
Usage: python dp2_reference.py <demos.txt> <out_dir>   -> <out_dir>/<demo file name>.json, one per demo

Same call arguments as csdm/engine/core.py (_dp2_parse_demo, _parse_mate_positions); the rows keep the raw
column values, in event order, with the columns listed in COLUMNS (the same order examples/golden.rs writes).
"""
import json
import math
import os
import sys
import time

COLUMNS = {
    "weapon_fire": ["tick", "weapon", "user_player_steamid", "user_steamid", "user_accuracy_penalty",
                    "user_is_scoped", "user_velocity_X", "user_velocity_Y"],
    "player_death": ["tick", "attacker_steamid", "user_steamid", "weapon", "headshot", "noscope", "thrusmoke",
                     "attackerblind", "attackerinair", "penetrated", "attacker_pitch", "attacker_yaw",
                     "user_pitch", "user_yaw", "assister_pitch", "assister_yaw"],
    "player_hurt": ["tick", "attacker_steamid", "user_steamid"],
    "players": ["steamid", "name", "team_number"],
    "player_ticks": ["tick", "steamid", "name", "X", "Y", "Z", "pitch", "yaw", "team_num", "health"],
}
STEAMID_COLUMNS = {"user_player_steamid", "user_steamid", "attacker_steamid", "steamid"}


def plain(v, steamid):
    """JSON-able raw value: missing -> None; a SteamID that is an integer -> its decimal text.
    A SteamID column pandas turned into float64 stays a float: that is the 3.5.x defect the bench lists."""
    if v is None:
        return None
    try:
        import pandas as pd
        if v is pd.NA or v is pd.NaT:
            return None
    except ImportError:
        pass
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and math.isnan(v):
        return None
    if steamid and isinstance(v, int) and not isinstance(v, bool):
        return str(v)
    return v


def rows(df, call):
    cols = COLUMNS[call]
    if df is None or len(df) == 0:
        return [], []
    present = list(df.columns)
    values = [df[c].tolist() if c in present else [None] * len(df) for c in cols]
    out = [[plain(values[j][i], cols[j] in STEAMID_COLUMNS) for j in range(len(cols))] for i in range(len(df))]
    return out, [c for c in cols if c not in present]


def run(name, fn):
    t0 = time.perf_counter()
    try:
        df = fn()
        r, missing = rows(df, name)
        return {"error": None, "rows": r, "absent_columns": missing, "ms": int((time.perf_counter() - t0) * 1000)}
    except BaseException as e:  # pyo3 PanicException derives from BaseException
        if isinstance(e, (KeyboardInterrupt, SystemExit)):
            raise
        return {"error": f"{type(e).__name__}: {e}", "rows": [], "absent_columns": []}


def reference(path):
    from demoparser2 import DemoParser
    with open(path, "rb") as f:
        if f.read(7) == b"HL2DEMO":
            return {"source1": True}
    p = DemoParser(path)
    out = {"source1": False, "calls": {}}
    c = out["calls"]
    c["weapon_fire"] = run("weapon_fire", lambda: p.parse_event(
        "weapon_fire", player=["is_scoped", "velocity_X", "velocity_Y", "accuracy_penalty", "player_steamid"],
        other=[]))
    c["player_death"] = run("player_death", lambda: p.parse_event(
        "player_death", player=["pitch", "yaw"],
        other=["attacker_steamid", "noscope", "thrusmoke", "attackerblind", "penetrated", "attackerinair"]))
    c["player_hurt"] = run("player_hurt", lambda: p.parse_event(
        "player_hurt", player=[], other=["attacker_steamid", "userid_steamid"]))
    c["players"] = run("players", p.parse_player_info)
    # Mate POV asks for each kill tick and the tick before it (core.py: "parse_ticks sometimes lags by 1").
    kills = sorted({r[0] for r in c["player_death"]["rows"]})
    wanted = sorted({t for k in kills for t in (k, k - 1)})
    c["player_ticks"] = run("player_ticks", lambda: p.parse_ticks(
        ["X", "Y", "Z", "pitch", "yaw", "team_num", "health"], ticks=wanted))
    c["player_ticks"]["wanted"] = wanted
    return out


def main():
    from importlib.metadata import version
    listing, out_dir = sys.argv[1:3]
    os.makedirs(out_dir, exist_ok=True)
    tag = version("demoparser2")
    for demo in [l.strip() for l in open(listing, encoding="utf-8-sig") if l.strip()]:
        t0 = time.perf_counter()
        ref = reference(demo)
        ref["demoparser2"] = tag
        ref["demo"] = os.path.basename(demo)
        with open(os.path.join(out_dir, os.path.basename(demo) + ".json"), "w", encoding="utf-8") as f:
            json.dump(ref, f, ensure_ascii=False)
        summary = "CS:GO" if ref["source1"] else ", ".join(
            f"{k} {v['error'] or len(v['rows'])}" for k, v in ref["calls"].items())
        print(f"{os.path.basename(demo)}: {summary} ({time.perf_counter() - t0:.1f} s)", flush=True)


if __name__ == "__main__":
    main()
