"""T9 end-to-end: the TAGS tab driven headless against the real engine, on a throwaway local copy.

The copy holds the real CS Demo Manager *schema* (read from the author's database by a read-only
`pg_dump --schema-only`) and **synthetic rows only**: the scenario this run records is committed to
a public repository, so no tag, demo or path of the author may reach it. The cluster comes from the
T5 bench (initdb in a folder under TEMP, loopback only, non-standard port) and is stopped and
deleted at the end.

    python rust/tools/t9_tags_e2e.py --config <copy of csdm_config.json> --pg-bin <PostgreSQL 16 bin>
    python rust/tools/t9_tags_e2e.py ... --record   # also rewrites csdm-app/tests/scenarios/tags-flow.json

The driven test is `csdm-app/tests/tags.rs::tags_tab_on_the_real_engine` (ignored by default).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import t5_tags_bench as t5  # noqa: E402  (cluster, guard, throwaway root)

DB = "csdm_t9"
# The demos of the copy: (checksum, file name, date). Paths point nowhere: dates come from the database.
DEMOS = [
    ("t9-chk-a", "ace-ancient.dem", "2024-01-05 20:00:00"),
    ("t9-chk-b", "clutch-mirage.dem", "2024-02-10 20:00:00"),
    ("t9-chk-c", "entry-nuke.dem", "2024-03-15 20:00:00"),
    ("t9-chk-d", "eco-inferno.dem", "2024-04-20 20:00:00"),
]
DEMO_DIR = "D:/csdm-t9-fixture/demos/"   # never created: a spelling only
TAGS = [("Aces", "#22c55e"), ("Clutch", "#3b82f6"), ("Entry", "#ef4444")]
LINKS = [("t9-chk-a", "Aces"), ("t9-chk-b", "Aces"), ("t9-chk-c", "Clutch")]


def filler(name, data_type, k):
    """A value of the column's type, distinct per row `k` (but one value for date-like columns, so
    the discovery picks the date column the seed sets: it takes the most distinct values)."""
    t = data_type.lower()
    if any(w in name.lower() for w in ("date", "time", "played")):
        k = 0
    if "char" in t or t == "text":
        return f"'t9-{k}'"
    if t in ("smallint", "integer", "bigint", "numeric", "real", "double precision"):
        return str(k)
    if t == "boolean":
        return "false"
    if t.startswith("timestamp"):
        return "'2024-01-01 00:00:00'"
    if t == "date":
        return "'2024-01-01'"
    if t == "uuid":
        return f"'00000000-0000-0000-0000-{k:012d}'"
    if t in ("json", "jsonb"):
        return "'{}'"
    if t == "array":
        return "'{}'"
    raise SystemExit(f"no synthetic value for a required column of type {data_type}")


def required(cluster, table):
    """Columns of `table` a row must name: NOT NULL without a default."""
    out = cluster.psql(DB, "-At", "-F", "\t", "-c",
                       "SELECT column_name, data_type FROM information_schema.columns "
                       f"WHERE table_name = '{table}' AND is_nullable = 'NO' AND column_default IS NULL "
                       "ORDER BY ordinal_position")
    return [tuple(line.split("\t")) for line in out.splitlines() if line]


def columns(cluster, table):
    """Column name -> SQL type."""
    out = cluster.psql(DB, "-At", "-F", "	", "-c", f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}'")
    return dict(line.split("	") for line in out.splitlines() if line)


def insert(cluster, table, rows):
    """Inserts `rows` (column -> SQL literal), filling every other required column."""
    need = required(cluster, table)
    for k, given in enumerate(rows, start=1):
        cols = dict(given)
        for name, data_type in need:
            cols.setdefault(name, filler(name, data_type, k))
        names = ", ".join(f'"{c}"' for c in cols)
        cluster.psql(DB, "-c", f'INSERT INTO "{table}" ({names}) VALUES ({", ".join(cols.values())})')


def seed(cluster, author):
    """The author's schema (read only), then synthetic rows; foreign keys dropped (throwaway copy)."""
    env = {**os.environ, "PGPASSWORD": str(author["pg_pass"]), "PGCONNECT_TIMEOUT": "5",
           "PGOPTIONS": "-c default_transaction_read_only=on"}
    src = ["-h", str(author["pg_host"]), "-p", str(author["pg_port"]), "-U", str(author["pg_user"]),
           "-d", str(author["pg_db"]), "--no-owner", "--no-privileges"]
    schema = cluster.root / "schema.sql"
    try:
        t5.run([cluster.tool("pg_dump"), *src, "--schema-only", "-f", str(schema)], env=env)
        cluster.psql("postgres", "-c", f"CREATE DATABASE {DB}")
        cluster.psql(DB, "-f", str(schema))
    finally:
        schema.unlink(missing_ok=True)
    fks = cluster.psql(DB, "-At", "-F", "\t", "-c",
                       "SELECT conrelid::regclass, conname FROM pg_constraint WHERE contype = 'f'")
    for line in fks.splitlines():
        table, name = line.split("\t")
        cluster.psql(DB, "-c", f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
    m = columns(cluster, "matches")
    path_col = next(c for c in ("demo_path", "demo_file_path", "demo_filepath", "file_path", "path") if c in m)
    # Every column the discovery may take as the match date (csdm-db discovery step 3) carries it.
    def dated(c, t):
        low, t = c.lower(), t.lower()
        named = any(w in low for w in ("date", "time", "played"))
        if t in ("date",) or t.startswith("timestamp"):
            return "stamp"
        if named and t in ("smallint", "integer", "bigint"):
            return "epoch"
        if named and t in ("text", "character varying"):
            return "stamp"
        return None
    date_cols = {c: dated(c, t) for c, t in m.items() if dated(c, t)}
    if not date_cols:
        raise SystemExit("matches has no column the discovery can date")
    rows = []
    for chk, name, date in DEMOS:
        row = {"checksum": f"'{chk}'", path_col: f"'{DEMO_DIR}{name}'"}
        epoch = int(datetime.strptime(date, "%Y-%m-%d %H:%M:%S").timestamp())
        for c, kind in date_cols.items():
            row[c] = str(epoch) if kind == "epoch" else f"'{date}'"
        if "name" in m:
            row["name"] = f"'{name}'"
        rows.append(row)
    if "demos" in cluster.psql(DB, "-At", "-c", "SELECT tablename FROM pg_tables WHERE schemaname = 'public'").split():
        d = columns(cluster, "demos")
        demo_rows = [{c: v for c, v in r.items() if c in d} for r in rows]
        insert(cluster, "demos", demo_rows)
    insert(cluster, "matches", rows)
    insert(cluster, "tags", [{"name": f"'{n}'", "color": f"'{c}'"} for n, c in TAGS])
    for chk, tag in LINKS:
        cluster.psql(DB, "-c", f"INSERT INTO checksum_tags (checksum, tag_id) SELECT '{chk}', id FROM tags WHERE name = '{tag}'")
    print(f"copy: {len(DEMOS)} demos, {len(TAGS)} tags, {len(LINKS)} links (synthetic); path column {path_col}, dated columns {sorted(date_cols)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="copy of csdm_config.json (the author's server, read only)")
    ap.add_argument("--pg-bin", required=True, help="PostgreSQL 16 bin folder")
    ap.add_argument("--record", action="store_true", help="rewrite the replayed scenario from this run")
    a = ap.parse_args()
    author = json.loads(Path(a.config).read_text(encoding="utf-8"))
    local = {"pg_host": "127.0.0.1", "pg_port": str(t5.BENCH_PORT), "pg_user": t5.BENCH_USER, "pg_pass": "", "pg_db": DB}
    why = t5.refuse_target(local, author)
    if why:
        raise SystemExit(f"e2e refused: {why}")
    root = t5.make_root()
    cluster = t5.Cluster(a.pg_bin, root)
    t0 = time.time()
    try:
        cluster.up()
        seed(cluster, author)
        env = {**os.environ, "CSDM_T9_PG": json.dumps(local), "CSDM_PROFILE_ROOT": str(root / "profile")}
        if a.record:
            env["CSDM_T9_RECORD"] = "1"
        cargo = shutil.which("cargo") or str(Path.home() / ".cargo" / "bin" / "cargo.exe")
        r = subprocess.run([cargo, "test", "-p", "csdm-app", "--test", "tags", "--", "--ignored", "--nocapture",
                            "tags_tab_on_the_real_engine"], cwd=t5.RUST, env=env)
        if r.returncode != 0:
            raise SystemExit(f"driven test failed ({r.returncode})")
        print(f"T9 e2e: OK ({time.time() - t0:.1f} s)")
    finally:
        cluster.down()
        shutil.rmtree(root, ignore_errors=False)
        print("local cluster stopped, copy deleted")


if __name__ == "__main__":
    main()
