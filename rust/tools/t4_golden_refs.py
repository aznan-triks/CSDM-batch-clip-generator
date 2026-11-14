"""Golden references for T4 (batch run): what the 3.5 engine hands CS Demo Manager, case by case.

Runs the real 3.5 batch loop (`EngineMixin._run_batch`) in-process, read-only, on the author's
database and demo files, with the same corrections and cases as the T3 generator
(`t3_golden_refs.py`: letters (a)…(j), SQL tie-breaker, 243 cases at a fixed seed). The CLI is
never started: `_exec` is replaced by a capture of the `--config-file` JSON it would have been
given. Everything a run writes goes to a throwaway folder: clips root, CS2 cfg folder (RecSys CS
injection), job files. Tags, assembly, pauses and retries are switched off.

One file per case: `<out>/cases/NNNN.json` with the overrides applied (paths as `{ROOT}`), then per
run (plain, and for every fourth previewed case an EDITING selection taken from the T3 reference)
the CLI jobs in order (`json` tree, `timeout_s`), the `demo_entry` states, the batch counts line
and the RecSys CS runtime files.

    python rust/tools/t4_golden_refs.py --config <copy of csdm_config.json> \
        --presets <copy of csdm_presets.json> --t3-refs <T3 refs dir> --out <dir> [--only 0,5] [--limit N]

Then: cargo run --release -p csdm-engine --example t4_golden -- <dir> <copy of csdm_config.json>
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ROOT_MARK = "{ROOT}"
# Every fourth case that previews clips also runs with an EDITING selection.
SELECTION_EVERY = 4


def load_t3():
    spec = importlib.util.spec_from_file_location("t3_golden_refs", HERE / "t3_golden_refs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def overrides(root):
    """What both engines apply over each case: throwaway paths, nothing slow, nothing written elsewhere."""
    return {
        "csdm_exe": str(root / "cli" / "csdm.CMD"),
        "output_dir_clips": str(root / "clips"),
        "output_dir": "",
        "cs2_cfg_dir": str(root / "cs2cfg"),
        "tag_enabled": False,
        "assemble_after": False,
        "delay_between_demos": 0,
        "retry_count": 0,
        "cs2_send_to_back": False,
    }


def marked(v, root):
    """`v` with the throwaway root written as {ROOT} (both engines get their own root)."""
    text = str(root)
    if isinstance(v, str):
        return v.replace(text, ROOT_MARK)
    if isinstance(v, list):
        return [marked(x, root) for x in v]
    if isinstance(v, dict):
        return {k: marked(x, root) for k, x in v.items()}
    return v


COUNTS = re.compile(r"^  (OK:\d+ Failed:\d+ Skip:\d+ Retries:\d+)")


def run_batch(t3, core_mod, cfg_db, disc, conn, case_cfg, root, selection):
    host = t3.make_host(core_mod, cfg_db, disc)
    host._db_conn = conn
    jobs = []

    def capture(cmd, cfg, timeout_s=0):
        with open(cmd[-1], encoding="utf-8") as f:
            jobs.append({"args": [Path(cmd[0]).name] + list(cmd[1:-1]), "json": json.load(f), "timeout_s": timeout_s})
        return True, 0, [], False

    host._exec = capture
    host._resolve_cs2_cfg_dir = lambda cfg: str(root / "cs2cfg")
    run_cfg = host.build_run_cfg(case_cfg)
    problem = host.run_inputs_problem(run_cfg)
    if problem:
        return {"problem": problem}
    host._running = True
    host._stop_after_current = False
    host._kill_triggered = False
    host._tagged_this_batch = []
    from csdm.engine.clip_edits import normalize_clip_selection
    host._selected_clips = normalize_clip_selection(selection)
    t0 = time.time()
    host._run_batch(run_cfg)
    states = host.ports.states
    logs = host.ports.logs
    entries = [{k: p[k] for k in ("date_str", "demo_name", "seq_count", "idx", "total")}
               for n, p in states if n == "demo_entry"]
    counts = [m.group(1) for msg, _ in logs for m in [COUNTS.match(msg)] if m]
    errors = [msg for msg, lvl in logs if lvl == "err"]
    runtime = {}
    for name in ("csdm_batch_runtime.cfg", "autoexec.cfg"):
        p = root / "cs2cfg" / name
        if p.exists():
            runtime[name] = p.read_text(encoding="utf-8")
            p.unlink()
    return marked({"jobs": jobs, "demo_entries": entries, "counts": counts, "errors": errors,
                   "cs_runtime": runtime, "seconds": time.time() - t0}, root)


def selection_from_t3(t3_case):
    """First demo's first two clips: one as previewed, one edited (lead, tail, first event out)."""
    seqs = (t3_case.get("result") or {}).get("sequences") or {}
    for dp, rows in seqs.items():
        if not rows:
            continue
        sel = [{"demo_path": dp, "start_tick": rows[0]["start_tick"]}]
        if len(rows) > 1:
            edited = {"demo_path": dp, "start_tick": rows[1]["start_tick"], "before_s": 1, "after_s": 2}
            keys = rows[1].get("event_keys") or []
            if len(keys) > 1:
                edited["excluded_events"] = [keys[0]]
            sel.append(edited)
        return sel
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="copy of csdm_config.json (never the original)")
    ap.add_argument("--presets", required=True, help="copy of csdm_presets.json (never the original)")
    ap.add_argument("--t3-refs", required=True, help="T3 golden references (EDITING selections)")
    ap.add_argument("--out", required=True, help="folder outside the repository")
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    out = Path(a.out)
    if REPO in out.resolve().parents or out.resolve() == REPO:
        sys.exit("refusing to write the author's data inside the repository")
    (out / "cases").mkdir(parents=True, exist_ok=True)

    # Plain mkdir under TEMP, not mkdtemp: rust/PIEGES.md (protected ACL under an elevated shell).
    root = Path(tempfile.gettempdir()) / f"csdm_t4_root_{os.getpid()}"
    for sub in ("cli", "clips", "cs2cfg", "profile"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    (root / "cli" / "csdm.CMD").write_text("@echo off\r\nexit /b 1\r\n", encoding="utf-8")
    os.environ["CSDM_PROFILE_ROOT"] = str(root / "profile")

    t3 = load_t3()
    sys.path.insert(0, str(REPO))
    import psycopg2
    t3.install_read_only_connect(psycopg2)
    memo = t3.install_parser_memo()
    src, applied = t3.patched_core_source()
    fixed_core = t3.load_engine_module(src, "csdm_t4_fixed_core")

    user_cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    presets = json.loads(Path(a.presets).read_text(encoding="utf-8"))
    probe = t3.make_host(fixed_core, user_cfg, {})
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
    cases = t3.build_cases(fixed_core, base, disc, presets, (int(lo), int(hi)))
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        selected = [(i, c) for i, c in enumerate(cases) if i in wanted]
    else:
        selected = list(enumerate(cases))[: a.limit or None]

    conn = t3.make_host(fixed_core, user_cfg, disc)._pg()
    ov = overrides(root)
    meta = {"engine": "3.5 csdm/engine/core.py + corrections (T3)", "patches": applied, "seed": t3.SEED,
            "cases": len(cases), "overrides": marked(ov, root), "selection_every": SELECTION_EVERY}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    log = open(out / "generate.log", "a", encoding="utf-8")
    previewed = 0
    for i, (name, cfg) in selected:
        t0 = time.time()
        case_cfg = {**cfg, **ov}
        record = {"index": i, "name": name, "cfg": cfg, "runs": []}
        t3_file = Path(a.t3_refs) / "cases" / f"{i:04d}.json"
        t3_case = json.loads(t3_file.read_text(encoding="utf-8")) if t3_file.exists() else {}
        selections = [None]
        sel = selection_from_t3(t3_case)
        if sel:
            previewed += 1
            if previewed % SELECTION_EVERY == 0:
                selections.append(sel)
        for selection in selections:
            try:
                result = run_batch(t3, fixed_core, user_cfg, disc, conn, case_cfg, root, selection)
            except Exception:  # noqa: BLE001 -- a generator crash is reported, never hidden
                result = {"generator_error": traceback.format_exc()}
                conn.rollback()
            record["runs"].append({"selection": selection, "result": result})
            shutil.rmtree(root / "clips", ignore_errors=True)
            (root / "clips").mkdir(exist_ok=True)
        text = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        (out / "cases" / f"{i:04d}.json").write_text(text, encoding="utf-8")
        kinds = ",".join(next((k for k in ("problem", "generator_error") if k in r["result"]), "jobs=%d" % len(r["result"].get("jobs", [])))
                         for r in record["runs"])
        line = f"{i:4d} {name:<48} {kinds:<24} {time.time() - t0:6.1f}s sha={hashlib.sha256(text.encode()).hexdigest()[:12]}"
        print(line, flush=True)
        log.write(line + "\n")
        log.flush()
    print(f"parse memo entries: {len(memo)}")
    shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
