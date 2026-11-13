"""Golden references for T1 (csdm-db): every database read of the 3.5 engine, recorded
query by query (SQL, parameters, rows with their Python types) while the real engine runs.

Read-only three ways: the session (`default_transaction_read_only=on`), psycopg2
`set_session(readonly=True)`, and this recorder, which refuses any statement that is not a
SELECT before it reaches the server. The references hold the author's data: write them
outside the repository.

    python rust/tools/t1_golden_refs.py --config <copy of csdm_config.json> --out <dir>

Then: cargo run -p csdm-db --example t1_golden -- <dir>/t1_refs.json <copy of csdm_config.json>
"""
import argparse
import datetime as dt
import decimal
import json
import os
import re
import struct
import sys
import tempfile
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# Read numbers of research/03 §1.3 for each Rust builder (coverage report).
READS = {
    "discovery": "1-7", "players_plain": "2b/2c", "raw_preview": "8-11",
    "all_kills_for_demos": "12-13", "roster_sizes": "14", "native_clutches": "15",
    "matches_with_tag": "16", "tag_id_by_name": "17", "all_demos": "19",
    "checksum_by_path": "20", "checksum_by_file_name": "21/25", "sample_demos": "22",
    "tag_link_exists": "23/27", "checksum_exists": "29", "demos_with_tags": "30",
    "matches_with_tags": "31", "tagged_demo_dates": "32", "export_tag_list": "36",
    "export_tag_links": "37/38",
}


def enc(v):
    """One cell with its Python type; floats as their exact bits."""
    if v is None:
        return {"t": "null"}
    if isinstance(v, bool):
        return {"t": "bool", "v": v}
    if isinstance(v, int):
        return {"t": "int", "v": v}
    if isinstance(v, float):
        return {"t": "float", "v": struct.unpack("<Q", struct.pack("<d", v))[0]}
    if isinstance(v, decimal.Decimal):
        return {"t": "decimal", "v": str(v)}
    if isinstance(v, str):
        return {"t": "str", "v": v}
    if isinstance(v, dt.datetime):
        if v.tzinfo is not None:
            return {"t": "datetimetz", "v": v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")}
        return {"t": "datetime", "v": v.strftime("%Y-%m-%dT%H:%M:%S.%f")}
    if isinstance(v, dt.date):
        return {"t": "date", "v": v.isoformat()}
    if isinstance(v, uuid.UUID):
        return {"t": "uuid", "v": str(v)}
    raise TypeError(f"no golden encoding for {type(v).__name__}")


def dollar(sql):
    """psycopg2 %s placeholders -> $1..$n, the form csdm-db builds."""
    n = iter(range(1, 10_000))
    return re.sub(r"%s", lambda _m: f"${next(n)}", sql)


class Blocked(Exception):
    """A statement the recorder refused to send."""


class Recorder:
    """Shared by every connection: the executed reads, in order."""

    def __init__(self):
        self.log = []
        self.fail_on = None   # substring: raise before sending (forces 3.5's fallback branch)

    def take(self):
        out, self.log = self.log, []
        return out


REC = Recorder()


class RecCursor:
    def __init__(self, cur):
        self._cur = cur
        self._buf = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._cur.close()

    def execute(self, sql, params=None):
        if not sql.lstrip().upper().startswith("SELECT"):
            raise Blocked(f"write refused by the golden recorder: {sql.split()[0]}")
        if REC.fail_on and REC.fail_on in sql:
            raise Blocked("injected failure")
        try:
            self._cur.execute(sql, params)
        except Exception as e:
            REC.log.append({"sql": dollar(sql), "params": [enc(p) for p in (params or [])],
                            "error": {"code": getattr(e, "pgcode", None),
                                      "message": getattr(getattr(e, "diag", None), "message_primary", str(e))}})
            raise
        rows = self._cur.fetchall()
        REC.log.append({"sql": dollar(sql), "params": [enc(p) for p in (params or [])],
                        "rows": [[enc(c) for c in r] for r in rows]})
        self._buf = list(rows)

    def fetchall(self):
        out, self._buf = self._buf, []
        return out

    def fetchone(self):
        return self._buf.pop(0) if self._buf else None

    def close(self):
        self._cur.close()


class RecConn:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return RecCursor(self._conn.cursor())

    def commit(self):
        self._conn.rollback()   # nothing to keep: the session is read-only

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
        conn.set_session(readonly=True)
        return RecConn(conn)

    psycopg2.connect = connect


def classify(sql):
    """The csdm-db builder that must produce this statement."""
    rules = [
        ("FROM clutches c", "native_clutches"),
        ('COUNT(DISTINCT "', "roster_sizes"),
        ("FROM tags WHERE", "tag_id_by_name"),
        ("FROM tags ORDER BY", "export_tag_list"),
        (" AS jt", "export_tag_links"),
        ("SELECT 1 FROM matches", "checksum_exists"),
        ("SELECT 1 FROM \"", "tag_link_exists"),
        ("LIKE $1", "checksum_by_file_name"),
        ("FROM matches LIMIT", "sample_demos"),
        ("FROM matches WHERE", "checksum_by_path"),
        ("FROM players p WHERE p.name", "players_plain"),
    ]
    for needle, name in rules:
        if needle in sql:
            return name
    if " FROM kills k JOIN matches m ON" in sql and ", k." in sql:
        return "all_kills_for_demos"
    if " ct JOIN matches m" in sql:
        return "demos_with_tags" if "ORDER BY" in sql else "tagged_demo_dates"
    if sql.startswith('SELECT DISTINCT "') and " IN (" in sql:
        return "matches_with_tags"
    if sql.startswith('SELECT "') and '"=$1' in sql:
        return "matches_with_tag"
    if sql.startswith('SELECT m."') and " FROM matches m " in sql and "WHERE" not in sql:
        return "all_demos"
    raise ValueError(f"unclassified read: {sql[:120]}")


def demo_key(sql):
    """Path or checksum: which column the IN list compares."""
    first = re.match(r'SELECT m\."([^"]+)"', sql).group(1)
    return "path" if f'm."{first}" IN (' in sql else "checksum"


def to_cases(step, recorded, hide=None):
    cases = []
    for r in recorded:
        fn = "raw_preview" if step == "preview" else classify(r["sql"])
        case = {"step": step, "fn": fn, "reads": READS[fn], **r}
        if fn in ("all_kills_for_demos", "native_clutches"):
            case["by"] = demo_key(r["sql"])
        if hide:
            case["hide"] = hide
        cases.append(case)
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="copy of csdm_config.json (never the original)")
    ap.add_argument("--out", required=True, help="folder outside the repository")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if REPO in out.resolve().parents:
        sys.exit("refusing to write the author's data inside the repository")

    profile = tempfile.mkdtemp(prefix="csdm_t1_profile_")
    os.environ["CSDM_PROFILE_ROOT"] = profile   # the engine never touches the real profile
    sys.path.insert(0, str(REPO))
    import psycopg2
    install_read_only_connect(psycopg2)
    from csdm.config import DEFAULT_CONFIG
    from csdm.engine.core import EngineMixin
    from csdm.engine.ports import CollectingPorts
    from csdm.engine.state import EngineStateMixin

    class Host(EngineStateMixin, EngineMixin):
        def __init__(self, ports):
            self.init_engine_state()
            self.log, self.log_parts = ports.log, ports.log_parts
            self.state, self.ask = ports.state, ports.ask

    user_cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    host = Host(CollectingPorts())
    host.set_pg_params(user_cfg)
    cases = []

    # Reads 1-7: discovery, then the plain players query by forcing 3.5's fallback.
    disc = host.discover_database()
    disc_trace = REC.take()
    disc_json = json.loads(json.dumps(host.discovery_to_json(disc)))
    host.apply_discovery(disc)
    REC.fail_on = "DISTINCT ON (p.steam_id)"
    host.discover_database()
    REC.fail_on = None
    cases += to_cases("players_fallback", [r for r in REC.take() if "FROM players p WHERE p.name" in r["sql"]])

    # Read 19.
    demos = host.list_all_demos()
    rec19 = REC.take()
    cases += to_cases("list_all_demos", rec19)
    all_rows = rec19[0]["rows"]
    paths = [r[0]["v"] for r in all_rows if r[0]["t"] == "str"]

    ts = host._tags_schema
    jt, jt_tag, jt_match = ts["junction_table"], ts["jt_tag_col"], ts["jt_match_col"]
    tags = host._tags_list
    if not tags:
        sys.exit("no tag in the database: reads 16-38 cannot be recorded")

    # Read 16 and 17 live inside _run_batch: their SQL is copied verbatim (core.py:4641, :4995).
    tag_id, tag_name = None, None
    tagged = []
    for tid, tname, _c in tags:
        with host._pg_fresh().cursor() as cur:
            cur.execute(f'SELECT "{jt_match}" FROM "{jt}" WHERE "{jt_tag}"=%s', (tid,))
            got = [r[0] for r in cur.fetchall()]
        if got and tag_id is None:
            tag_id, tag_name, tagged = tid, tname, got
    cases += to_cases("run_batch_tagged", REC.take())
    with host._pg_fresh().cursor() as cur:
        cur.execute("SELECT id FROM tags WHERE name = %s LIMIT 1", (tag_name,))
    cases += to_cases("run_batch_rollback", REC.take())
    if tag_id is None:
        sys.exit("no tag carries a demo: reads 23-38 cannot be recorded")

    chk_to_path = {r[1]["v"]: r[0]["v"] for r in all_rows if len(r) > 1 and r[0]["t"] == "str"}
    tagged_path = next(chk_to_path[c] for c in tagged if c in chk_to_path)
    untagged_path = next(p for c, p in chk_to_path.items() if c not in set(tagged))

    # Reads 20-22, 25 (checksum lookups), 23, 27, 29.
    absent = "Z:\\csdm_t1_nowhere\\csdm_t1_absent_demo.dem"
    for step, call in [
        ("checksum_exact", lambda: host._get_demo_checksum(tagged_path)),
        ("checksum_like", lambda: host._get_demo_checksum("Z:\\csdm_t1_nowhere\\" + os.path.basename(tagged_path))),
        ("checksum_absent", lambda: host._get_demo_checksum(absent)),
        ("tag_demo_existing", lambda: host._tag_demo(tagged_path, tag_name)),
        ("tag_demo_new", lambda: host._tag_demo(untagged_path, tag_name)),
        ("untag_absent", lambda: host._untag_demo(absent, tag_name)),
        ("tag_by_checksum", lambda: host._tag_by_checksum(tagged[0], tag_id)),
        ("checksum_in_db", lambda: host._checksum_in_db(tagged[0], "checksum")),
        ("checksum_not_in_db", lambda: host._checksum_in_db("csdm_t1_absent_checksum", "checksum")),
    ]:
        host._demo_checksums = {}
        result = call()
        if step == "tag_demo_new" and result[0]:
            sys.exit("the recorder let a write through")
        cases += to_cases(step, REC.take())

    # Reads 30, 32, 36-38.
    host.search_tagged_demos([tag_id])
    cases += to_cases("search_tagged", REC.take())
    host.calc_tag_date_range([tag_id])
    cases += to_cases("tag_date_range", REC.take())
    tmp = Path(profile) / "tags_export.json"
    host.export_tags(str(tmp))
    cases += to_cases("export_all", REC.take())
    host.export_tags(str(tmp), [tag_id])
    cases += to_cases("export_one", REC.take())
    export_cols = ["demo_path", "demo_file_path", "demo_filepath", "file_path", "path"]
    schema = host._db_schema
    host._db_schema = {**schema, "matches": [c for c in schema["matches"] if c not in export_cols]}
    host._col_cache = {}
    host.export_tags(str(tmp))
    host._db_schema, host._col_cache = schema, {}
    cases += to_cases("export_without_paths", REC.take(), hide={"matches": export_cols})

    # Reads 31 and 8-11: config-filtered tag search runs the preview queries.
    # One small map keeps the reference small; filters off so no demo is parsed.
    maps_by_count = {}
    map_idx = 3 if host._date_col else 2
    for r in all_rows:
        if len(r) > map_idx and r[map_idx]["t"] == "str":
            key = next((k for k, raws in host._db_maps if r[map_idx]["v"].strip() in raws), None)
            if key:
                maps_by_count[key] = maps_by_count.get(key, 0) + 1
    small_map = min((k for k, n in maps_by_count.items() if n >= 3), key=lambda k: (maps_by_count[k], k))
    base = {**DEFAULT_CONFIG, "steam_ids": user_cfg["steam_ids"], "event_actor": True, "event_target": True,
            "event_lethal": True, "event_non_lethal": False, "event_other": True, "events_rounds": True,
            "map_filter_enabled": True, "map_filter": [small_map]}
    host._demo_checksums = {}
    found = host.search_tagged_demos([], base)
    cases += to_cases("preview", REC.take())
    host.search_tagged_demos([tag_id], base)
    cases += to_cases("preview_tagged", [r for r in REC.take() if r["sql"].startswith('SELECT DISTINCT "')])

    # Read 10 (damages): 3.5 aliases damages "d" and also joins the map table as "demos d",
    # so the statement fails on CSDM's schema. Recorded as is (both engines must fail alike),
    # then once without the map join to prove the decoding of the damages columns.
    dmg = {**base, "event_lethal": False, "event_other": False, "events_rounds": False, "event_non_lethal": True}
    try:
        host._query_events(host.build_run_cfg(dmg))
        sys.exit("3.5 damages query unexpectedly succeeded: update the T1 bench notes")
    except psycopg2.Error:
        host._db_conn.rollback()
    cases += to_cases("preview", [r for r in REC.take() if " FROM damages d " in r["sql"]])
    join = host._map_join
    host._map_join = ""
    host._query_events(host.build_run_cfg({**dmg, "map_filter_enabled": False,
                                           "weapons": [disc["weapons"][0]]}))
    host._map_join = join
    cases += to_cases("preview", [r for r in REC.take() if " FROM damages d " in r["sql"]])

    # Reads 12-15 on the demos the preview found.
    sample = [d["path"] for d in found["demos"]][:4]
    if not sample:
        sys.exit("the preview found no demo: reads 12-15 cannot be recorded")
    sids = user_cfg["steam_ids"]
    host._demo_checksums = {}
    host._fetch_all_kills_for_demos(sample)
    host._fetch_native_clutches(sample, sids)
    cases += to_cases("kills_and_clutches_by_path", REC.take())
    for p in sample:
        host._get_demo_checksum(p)
    REC.take()
    host._fetch_all_kills_for_demos(sample)
    host._fetch_native_clutches(sample, sids)
    cases += to_cases("kills_and_clutches_by_checksum", REC.take())

    refs = {"engine": "3.5 (csdm/engine/core.py)", "discovery": {"json": disc_json, "trace": disc_trace},
            "cases": cases, "small_map": small_map}
    path = out / "t1_refs.json"
    path.write_text(json.dumps(refs, ensure_ascii=False), encoding="utf-8")
    cover = {}
    for c in cases:
        cover[c["reads"]] = cover.get(c["reads"], 0) + 1
    print(f"discovery: {len(disc_trace)} queries; cases: {len(cases)}")
    for k in sorted(cover, key=lambda s: int(re.match(r"\d+", s).group())):
        print(f"  reads {k}: {cover[k]}")
    print(f"written: {path} ({path.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
