"""T5 bench (ticket 08, stage 2): the tag writes of the 3.5 engine and of csdm-db, replayed on a
throwaway local copy of the CSDM database, compared table by table. Never writes to the author's
server: the copy is read from it by pg_dump (read-only session), restored into a PostgreSQL 16
cluster created by initdb in a temporary folder, listening on the loopback only, and stopped and
deleted at the end (dumps included: they hold the author's data).

    python rust/tools/t5_tags_bench.py --config <copy of csdm_config.json> --pg-bin <PostgreSQL 16 bin>
    python rust/tools/t5_tags_bench.py --self-test

`--target <config>` replaces the local copy as the target; the guard refuses anything that is not
the loopback or that carries the author's database name (proof that the bench cannot be aimed at
the author's server).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RUST = REPO / "rust"
LOOPBACK = ("127.0.0.1", "localhost", "::1")
BENCH_PORT = 54329            # non-standard: never the 5432 of a real server
BENCH_USER = "csdm_bench"
SEED_DB = "csdm_bench_seed"
BENCH_DB = "csdm_bench"
# Tables the tag writes touch or read (tags, junction, matches for paths, demos for the map join).
COPIED_TABLES = ("tags", "checksum_tags", "matches", "demos", "tags_id_seq")
# 3.5 tag rollback statements (core.py `_run_batch`), replayed by `py_rollback` below.
ROLLBACK_SQL = ("SELECT id FROM tags WHERE name = %s LIMIT 1",
                "DELETE FROM checksum_tags WHERE checksum = %s AND tag_id = %s")
# Intended differences (research/03 §8 and the T5 journal), each checked, not just tolerated.
EXPECTED = {
    "new_tag_ids": "3.5 draws a random id (100 000 000 - 9 999 999 999) and never advances tags_id_seq; "
                   "Rust inserts without an id, the column default takes the next sequence value",
    "rollback_keeps_prior_link": "3.5 rollback also deletes a link that existed before the batch "
                                 "(_tag_demo reports success for it); Rust removes only the links the batch inserted",
    "rollback_counts": "same cause: 3.5 counts the prior link as rolled back, Rust counts it as kept",
    "error_sentences": "per-item error sentences are reworded (same items fail)",
}


def refuse_target(target, author):
    """Why the bench must not write to `target` (a pg_* dict), or None when it may."""
    host = str(target.get("pg_host", "")).strip().lower()
    db = str(target.get("pg_db", "")).strip().lower()
    if host not in LOOPBACK:
        return "target host is not the loopback"   # the address itself is never printed
    if db == str(author.get("pg_db", "")).strip().lower():
        return "target database has the author's database name"
    a_host = str(author.get("pg_host", "")).strip().lower()
    if host == a_host and str(target.get("pg_port")) == str(author.get("pg_port")):
        return "target is the author's server address and port"
    return None


def self_test():
    author = {"pg_host": "192.168.1.20", "pg_port": "5432", "pg_db": "csdm"}
    local = {"pg_host": "127.0.0.1", "pg_port": str(BENCH_PORT), "pg_db": BENCH_DB}
    assert refuse_target(local, author) is None
    assert refuse_target(author, author), "the author's own server must be refused"
    assert refuse_target({**local, "pg_host": "192.168.1.20"}, author), "a remote host must be refused"
    assert refuse_target({**local, "pg_db": "CSDM"}, author), "the author's database name must be refused"
    assert refuse_target({**local, "pg_host": "db.example.org", "pg_db": "x"}, author)
    loop_author = {"pg_host": "localhost", "pg_port": "5432", "pg_db": "csdm"}
    assert refuse_target({"pg_host": "localhost", "pg_port": "5432", "pg_db": "other"}, loop_author), \
        "the author's local server must be refused even under another database name"
    print("self-test: OK")


def run(cmd, **kw):
    """Runs a tool; its output goes to the bench log, a failure stops the bench."""
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit(f"{Path(cmd[0]).name} failed ({r.returncode}):\n{r.stdout}\n{r.stderr}")
    return r.stdout


class Cluster:
    """A throwaway PostgreSQL cluster in a temporary folder."""

    def __init__(self, pg_bin, root):
        self.bin = Path(pg_bin)
        self.root = Path(root)
        self.data = self.root / "data"
        self.started = False

    def tool(self, name):
        return str(self.bin / f"{name}.exe")

    def up(self):
        run([self.tool("initdb"), "-D", str(self.data), "-U", BENCH_USER, "-A", "trust", "-E", "UTF8", "--no-locale"])
        with open(self.data / "postgresql.conf", "a", encoding="utf-8") as f:
            f.write(f"\nlisten_addresses = '127.0.0.1'\nport = {BENCH_PORT}\n")
        # pg_ctl's server inherits the pipes of a captured run and would never let it return.
        r = subprocess.run([self.tool("pg_ctl"), "-D", str(self.data), "-l", str(self.root / "server.log"), "-w", "start"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.started = True   # set before the check: a half-started server is still stopped by down()
        if r.returncode != 0:
            raise SystemExit(f"pg_ctl start failed ({r.returncode}), see {self.root / 'server.log'}")

    def down(self):
        if self.started:
            run([self.tool("pg_ctl"), "-D", str(self.data), "-m", "fast", "-w", "stop"])
            self.started = False

    def psql(self, db, *args):
        return run([self.tool("psql"), "-h", "127.0.0.1", "-p", str(BENCH_PORT), "-U", BENCH_USER, "-d", db,
                    "-v", "ON_ERROR_STOP=1", "-q", "-X", *args])

    def seed(self, author):
        """Schema of the author's database and a copy of the tag tables, read-only."""
        env = {**os.environ, "PGPASSWORD": str(author["pg_pass"]), "PGCONNECT_TIMEOUT": "5",
               "PGOPTIONS": "-c default_transaction_read_only=on"}
        src = ["-h", str(author["pg_host"]), "-p", str(author["pg_port"]), "-U", str(author["pg_user"]),
               "-d", str(author["pg_db"]), "--no-owner", "--no-privileges"]
        schema, data = self.root / "schema.sql", self.root / "data.sql"
        try:
            run([self.tool("pg_dump"), *src, "--schema-only", "-f", str(schema)], env=env)
            tables = [a for t in COPIED_TABLES for a in ("-t", t)]
            run([self.tool("pg_dump"), *src, "--data-only", *tables, "-f", str(data)], env=env)
            self.psql("postgres", "-c", f"CREATE DATABASE {SEED_DB}")
            self.psql(SEED_DB, "-f", str(schema))
            self.psql(SEED_DB, "-f", str(data))
        finally:
            for f in (schema, data):
                f.unlink(missing_ok=True)

    def fresh(self):
        self.psql("postgres", "-c", f"DROP DATABASE IF EXISTS {BENCH_DB}")
        self.psql("postgres", "-c", f"CREATE DATABASE {BENCH_DB} TEMPLATE {SEED_DB}")


def connect(target):
    import psycopg2
    return psycopg2.connect(host=target["pg_host"], port=int(target["pg_port"]), user=target["pg_user"],
                            password=target["pg_pass"], dbname=target["pg_db"], connect_timeout=5)


def state(target):
    """The contents the tag writes change, keyed so that both engines compare."""
    conn = connect(target)
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, name, color FROM tags ORDER BY name")
        tags = [list(r) for r in cur.fetchall()]
        cur.execute("SELECT ct.checksum, t.name, ct.tag_id FROM checksum_tags ct LEFT JOIN tags t ON t.id = ct.tag_id "
                    "ORDER BY ct.checksum, t.name, ct.tag_id")
        links = [list(r) for r in cur.fetchall()]
        cur.execute("SELECT last_value, is_called FROM tags_id_seq")
        seq = list(cur.fetchone())
    finally:
        conn.close()
    return {"tags": tags, "links": links, "seq": seq}


def pick_demos(target):
    """Demos of the copy for the scenario: X = a tag already in use, X_demo carries it, A-E do not."""
    conn = connect(target)
    try:
        cur = conn.cursor()
        cur.execute("SELECT t.name, m.demo_path FROM checksum_tags ct JOIN tags t ON t.id = ct.tag_id "
                    "JOIN matches m ON m.checksum = ct.checksum WHERE m.demo_path <> '' "
                    "ORDER BY ct.checksum, t.name LIMIT 1")
        x_name, x_demo = cur.fetchone()
        cur.execute("SELECT demo_path FROM matches m WHERE demo_path <> '' AND NOT EXISTS "
                    "(SELECT 1 FROM checksum_tags ct WHERE ct.checksum = m.checksum) "
                    "AND (SELECT count(*) FROM matches m2 WHERE m2.demo_path = m.demo_path) = 1 "
                    "ORDER BY checksum LIMIT 5")
        free = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    if len(free) < 5:
        raise SystemExit("the copy has fewer than 5 untagged demos: cannot build the scenario")
    return x_name, x_demo, free


def scenario(work, x_name, x_demo, free):
    a, b, c, d, e = free
    imp = work / "import.json"
    exp_all, exp_some = work / "export_all.json", work / "export_some.json"
    steps = [
        {"op": "create_tag", "name": "t5 alpha", "color": "#112233"},
        {"op": "create_tag", "name": "t5 beta", "color": ""},
        {"op": "create_tag", "name": "  ", "color": ""},
        {"op": "apply_tags", "paths": [a.replace("\\", "/"), b, c, x_demo], "tags": ["t5 alpha", x_name]},
        {"op": "apply_tags", "paths": [d], "tags": ["t5 beta"]},
        {"op": "apply_tags", "paths": [r"C:\nope\t5_missing_demo.dem"], "tags": ["t5 alpha"]},
        {"op": "apply_tags", "paths": [a], "tags": ["t5 no such tag"]},
        {"op": "remove_tags", "paths": [b], "tags": ["t5 alpha"]},
        {"op": "remove_tags", "paths": [c], "tags": ["t5 no such tag"]},
        {"op": "search", "tags": ["t5 alpha", x_name]},
        {"op": "export", "file": str(exp_all), "tags": []},
        {"op": "export", "file": str(exp_some), "tags": ["t5 alpha", "t5 beta"]},
        {"op": "delete_tag", "tag": "t5 beta"},
        {"op": "import_scan", "file": str(imp)},
        {"op": "import_apply", "file": str(imp), "create": [{"name": "t5 gamma", "color": "#445566"}]},
        {"op": "batch_rollback", "paths": [e, x_demo], "tag": x_name},
    ]
    import_file = {"version": 1, "tags": [{"name": "t5 gamma", "color": "#445566"}, {"name": "t5 delta", "color": ""}],
                   "assignments": [{"checksum": None, "tags": []}]}
    return {"steps": steps}, import_file


def write_import_file(target, path, body, a, d):
    """The import file names real checksums of the copy (A and D), one unknown, one missing tag."""
    conn = connect(target)
    try:
        cur = conn.cursor()
        cur.execute("SELECT checksum FROM matches WHERE demo_path = %s", (a,))
        chk_a = cur.fetchone()[0]
        cur.execute("SELECT checksum FROM matches WHERE demo_path = %s", (d,))
        chk_d = cur.fetchone()[0]
    finally:
        conn.close()
    body["assignments"] = [
        {"checksum": chk_a, "demo_name": "", "tags": ["t5 gamma", "t5 alpha"]},
        {"checksum": "t5-no-such-checksum", "demo_name": "", "tags": ["t5 gamma"]},
        {"checksum": f" {chk_d} ", "demo_name": "", "tags": ["t5 delta", "t5 gamma"]},
        {"checksum": None, "tags": ["t5 gamma"]},
    ]
    Path(path).write_text(json.dumps(body, indent=2), encoding="utf-8")


def make_host(target):
    sys.path.insert(0, str(REPO))
    from csdm.engine.core import EngineMixin
    from csdm.engine.ports import CollectingPorts
    from csdm.engine.state import EngineStateMixin

    class Host(EngineStateMixin, EngineMixin):
        def __init__(self, ports):
            self.init_engine_state()
            self.log, self.log_parts = ports.log, ports.log_parts
            self.state, self.ask = ports.state, ports.ask

    host = Host(CollectingPorts())
    host.set_pg_params(target)
    host.apply_discovery(host.discover_database())
    return host


def py_rollback(host, tagged):
    """The rollback loop of 3.5 `_run_batch`, which only runs inside a batch: same statements,
    same order (checked against core.py by `check_rollback_source`)."""
    rolled_back, failed = 0, 0
    for dp, tn in tagged:
        try:
            conn = host._pg()
            chk = host._demo_checksums.get(dp)
            if not chk:
                failed += 1
                continue
            with conn.cursor() as cur:
                cur.execute(ROLLBACK_SQL[0], (tn,))
                row = cur.fetchone()
                if not row:
                    failed += 1
                    continue
                cur.execute(ROLLBACK_SQL[1], (chk, row[0]))
                conn.commit()
                rolled_back += 1
        except Exception:   # 3.5 swallows here too; kept to replay it faithfully
            failed += 1
    return {"rolled_back": rolled_back, "failed": failed}


def check_rollback_source():
    src = (REPO / "csdm" / "engine" / "core.py").read_text(encoding="utf-8")
    for sql in ROLLBACK_SQL:
        if f'"{sql}"' not in src:
            raise SystemExit(f"3.5 rollback changed (statement not found in core.py): {sql}")


def run_python(target, steps):
    host = make_host(target)
    id_of = lambda n: next((tid for tid, tn, _ in host._tags_list if tn == n), None)  # noqa: E731
    out = []
    for st in steps:
        op = st["op"]
        try:
            if op == "create_tag":
                r = host.create_tag(st["name"], st["color"])
            elif op == "apply_tags":
                r = host.apply_tags(st["paths"], st["tags"])
            elif op == "remove_tags":
                r = host.remove_tags(st["paths"], st["tags"])
            elif op == "search":
                r = host.search_tagged_demos([i for i in map(id_of, st["tags"]) if i is not None])
            elif op == "export":
                r = host.export_tags(st["file"], [i for i in map(id_of, st["tags"]) if i is not None])
            elif op == "delete_tag":
                r = host.delete_tag(id_of(st["tag"]))
            elif op == "import_scan":
                r = host.scan_tag_import(st["file"])
            elif op == "import_apply":
                r = host.apply_tag_import(st["file"], st["create"])
            elif op == "batch_rollback":
                tagged = [(p, st["tag"]) for p in st["paths"] if host._tag_demo(p, st["tag"])[0]]
                r = py_rollback(host, tagged)
            else:
                raise SystemExit(f"unknown step {op}")
        except SystemExit:
            raise
        except Exception as e:   # the bridge turns an engine exception into its sentence
            r = {"error": str(e)}
        out.append({"op": op, "result": json.loads(json.dumps(r, default=str))})
    return {"steps": out}


def run_rust(scenario_path, target_path, out_path):
    cargo = shutil.which("cargo") or str(Path(os.environ["USERPROFILE"]) / ".cargo" / "bin" / "cargo.exe")
    run([cargo, "run", "-q", "-p", "csdm-db", "--example", "t5_tags", "--",
         str(scenario_path), str(target_path), str(out_path)], cwd=RUST)
    return json.loads(Path(out_path).read_text(encoding="utf-8"))


def export_tree(path):
    tree = json.loads(Path(path).read_text(encoding="utf-8"))
    tree.pop("exported_at")
    return tree


def compare(seed, py_state, rs_state, py_out, rs_out, exports):
    problems, notes = [], []
    seed_ids = {t[1]: t[0] for t in seed["tags"]}
    # tags: same names and colours; ids equal for tags of the seed; new ids per EXPECTED.
    py_tags = [[n, c] for _, n, c in py_state["tags"]]
    rs_tags = [[n, c] for _, n, c in rs_state["tags"]]
    if py_tags != rs_tags:
        problems.append(f"tags differ:\n  3.5:  {py_tags}\n  Rust: {rs_tags}")
    for name, sid in seed_ids.items():
        for who, st in (("3.5", py_state), ("Rust", rs_state)):
            now = {t[1]: t[0] for t in st["tags"]}
            if name in now and now[name] != sid:
                problems.append(f"{who} changed the id of existing tag {name!r}")
    seq0 = seed["seq"][0]
    py_new = sorted(t[0] for t in py_state["tags"] if t[1] not in seed_ids)
    rs_new = sorted(t[0] for t in rs_state["tags"] if t[1] not in seed_ids)
    created = 3   # t5 alpha, t5 beta (deleted later), t5 gamma
    if py_state["seq"][0] != seq0 or not all(100_000_000 <= i <= 9_999_999_999 for i in py_new):
        problems.append(f"3.5 new ids not as described: {py_new}, seq {py_state['seq']}")
    if rs_state["seq"][0] != seq0 + created or not all(seq0 < i <= seq0 + created for i in rs_new):
        problems.append(f"Rust new ids not from the sequence: {rs_new}, seq {rs_state['seq']} (seed {seq0})")
    notes.append(f"new_tag_ids: 3.5 {py_new} (sequence stays {seq0}); Rust {rs_new} (sequence {rs_state['seq'][0]})")
    # links by (checksum, tag name): equal except the prior link the 3.5 rollback deletes.
    py_links = {(c, n) for c, n, _ in py_state["links"]}
    rs_links = {(c, n) for c, n, _ in rs_state["links"]}
    only_rs, only_py = rs_links - py_links, py_links - rs_links
    if only_py or len(only_rs) != 1:
        problems.append(f"links differ beyond the rollback defect: only 3.5 {sorted(only_py)}, only Rust {sorted(only_rs)}")
    else:
        prior = next(iter(only_rs))
        if prior not in {(c, n) for c, n, _ in seed["links"]}:
            problems.append(f"the extra Rust link {prior} did not exist before the batch")
        notes.append(f"rollback_keeps_prior_link: {prior} kept by Rust, deleted by 3.5")
    seed_orphans = [l for l in seed["links"] if l[1] is None]   # already in the author's data
    if seed_orphans:
        notes.append(f"{len(seed_orphans)} link(s) of the copy already point to a missing tag (left alone by both)")
    for who, st in (("3.5", py_state), ("Rust", rs_state)):
        orphans = [l for l in st["links"] if l[1] is None and l not in seed_orphans]
        if orphans:
            problems.append(f"{who} left links to deleted tags: {orphans}")
    # step results.
    for i, (p, r) in enumerate(zip(py_out["steps"], rs_out["steps"])):
        pr, rr = p["result"], r["result"]
        op = p["op"]
        if op == "batch_rollback":
            if not (pr == {"rolled_back": 2, "failed": 0} and rr == {"rolled_back": 1, "failed": 0, "kept": 1}):
                problems.append(f"step {i} {op}: 3.5 {pr} / Rust {rr}")
            continue
        if isinstance(pr, dict) and isinstance(rr, dict) and ("first_error" in pr or "error" in pr):
            pe = pr.get("first_error", pr.get("error", ""))
            re_ = rr.get("first_error", rr.get("error", ""))
            if bool(pe) != bool(re_):
                problems.append(f"step {i} {op}: error on one side only: 3.5 {pe!r} / Rust {re_!r}")
            elif pe != re_:
                notes.append(f"error_sentences: step {i} {op}: 3.5 {pe!r} / Rust {re_!r}")
            pr = {k: v for k, v in pr.items() if k not in ("first_error", "error")}
            rr = {k: v for k, v in rr.items() if k not in ("first_error", "error")}
        if op == "export" and isinstance(pr, dict) and "path" in pr:
            # each engine writes its own file (`per_engine`): compare the path without the suffix
            pr = {**pr, "path": pr["path"].replace("_py.json", ".json")}
            rr = {**rr, "path": rr.get("path", "").replace("_rs.json", ".json")}
        if isinstance(pr, dict) and "tag_id" in pr:
            # ids differ by design (EXPECTED new_tag_ids, checked above): compare the rest
            pr, rr = {**pr}, {**rr}
            pr.pop("tag_id"), rr.pop("tag_id", None)
        if pr != rr:
            problems.append(f"step {i} {op}: 3.5 {pr} / Rust {rr}")
    if len(py_out["steps"]) != len(rs_out["steps"]):
        problems.append("step counts differ")
    # export files: same tree except the time stamp.
    for name in exports:
        a, b = export_tree(exports[name][0]), export_tree(exports[name][1])
        if a != b:
            sa = {**a, "assignments": sorted(a["assignments"], key=lambda x: x["checksum"])}
            sb = {**b, "assignments": sorted(b["assignments"], key=lambda x: x["checksum"])}
            if sa != sb:
                problems.append(f"export {name} differs")
            else:
                notes.append(f"export {name}: same content, assignment order differs (no ORDER BY in 3.5)")
        else:
            notes.append(f"export {name}: identical tree ({len(a['assignments'])} assignments)")
    rp = rs_out["read_path"]
    if not (rp["refused"] and rp["unchanged"]):
        problems.append(f"the read path wrote or was not refused: {rp}")
    notes.append(f"read path refused a write on the copy: {rp['sentence']}")
    return problems, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="copy of csdm_config.json (the author's server, read only)")
    ap.add_argument("--pg-bin", help="PostgreSQL 16 bin folder (initdb, pg_ctl, pg_dump, psql)")
    ap.add_argument("--target", help="a pg_* config to write to instead of the local copy (refused unless local)")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    if not a.config or not a.pg_bin:
        ap.error("--config and --pg-bin are required")
    author = json.loads(Path(a.config).read_text(encoding="utf-8"))
    local = {"pg_host": "127.0.0.1", "pg_port": str(BENCH_PORT), "pg_user": BENCH_USER, "pg_pass": "", "pg_db": BENCH_DB}
    target = json.loads(Path(a.target).read_text(encoding="utf-8")) if a.target else local
    why = refuse_target(target, author)
    if why:
        raise SystemExit(f"bench refused: {why}. It only writes to a throwaway local copy.")
    check_rollback_source()

    root = Path(tempfile.mkdtemp(prefix="csdm_t5_"))
    os.environ["CSDM_PROFILE_ROOT"] = str(root / "profile")   # the 3.5 engine never touches the real profile
    cluster = Cluster(a.pg_bin, root)
    t0 = time.time()
    try:
        cluster.up()
        cluster.seed(author)
        cluster.fresh()
        seed = state(target)
        x_name, x_demo, free = pick_demos(target)
        sc, import_body = scenario(root, x_name, x_demo, free)
        write_import_file(target, root / "import.json", import_body, free[0], free[3])
        target_path = root / "target.json"
        target_path.write_text(json.dumps(target), encoding="utf-8")

        def per_engine(tag):
            s = json.loads(json.dumps(sc))
            for st in s["steps"]:
                if st["op"] == "export":
                    st["file"] = st["file"].replace(".json", f"_{tag}.json")
            p = root / f"scenario_{tag}.json"
            p.write_text(json.dumps(s), encoding="utf-8")
            return s, p

        py_sc, _ = per_engine("py")
        py_out = run_python(target, py_sc["steps"])
        py_state = state(target)
        cluster.fresh()
        _, rs_path = per_engine("rs")
        rs_out = run_rust(rs_path, target_path, root / "rust_out.json")
        rs_state = state(target)
        exports = {n: (root / f"{n}_py.json", root / f"{n}_rs.json") for n in ("export_all", "export_some")}
        problems, notes = compare(seed, py_state, rs_state, py_out, rs_out, exports)
        print(f"seed: {len(seed['tags'])} tags, {len(seed['links'])} links, sequence {seed['seq']}")
        print(f"after 3.5: {len(py_state['tags'])} tags, {len(py_state['links'])} links")
        print(f"after Rust: {len(rs_state['tags'])} tags, {len(rs_state['links'])} links")
        print("steps:", ", ".join(s["op"] for s in sc["steps"]))
        for n in notes:
            print("  expected/info:", n)
        for k, v in EXPECTED.items():
            print(f"  intended difference {k}: {v}")
        if problems:
            print("UNEXPECTED DIFFERENCES:")
            for p in problems:
                print("  -", p)
            raise SystemExit(1)
        print(f"T5 bench: OK ({time.time() - t0:.1f} s)")
    finally:
        cluster.down()
        shutil.rmtree(root, ignore_errors=False)
        print("local cluster stopped, copy deleted")


if __name__ == "__main__":
    main()
