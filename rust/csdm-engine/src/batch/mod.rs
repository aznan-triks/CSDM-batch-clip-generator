//! The batch run (T4): 3.5 `start_run`, `_worker`, `_run_batch`. Same console lines, same states,
//! same files as 3.5 (Conception: `.scratch/rust-rewrite/issues/05-t4-lot.md`). The demo stages
//! are the preview's (T3); recording goes through [`Exec`] (the real one starts CS Demo Manager's
//! CLI in a job object, the golden bench captures the job file instead).

pub mod assemble;
pub mod cli_json;
pub mod cs_inject;
pub mod record;
pub mod tags;

use crate::event::{AskKind, Level, StateName};
use crate::preview::clips::{self, build_sequences, calc_summary, effective_before, fmt_summary, player_str, summary_counts, whole, ClipEntry, LastPreview, Sequence};
use crate::preview::cfg::{on, py_str};
use crate::preview::dates::{demo_sort_key, format_demo_date};
use crate::preview::dp2::{self, gate_events, progress_bar, Stage};
use crate::preview::event::{self as pev, DemoEvents, EventId};
use crate::preview::sql::{self, clauses::detect_date_col};
use crate::preview::Ctx;
use crate::process::Exec;
use crate::run::RunControl;
use crate::EngineError;
use cli_json::{abspath, build_json, clips_root, got, normalize_recsys};
use csdm_core::batch::{
    BANNER_WIDTH, CLI_FILE_NAMES, CLI_RESOURCES_DIR, CLI_SEARCH_NAMES, CLI_VIDEO_ARGS, DP2_TIME_SHOWN_ABOVE_S, HLAE_ARGS_SHOWN, MS_PER_SECOND, RECSYS_HLAE, RULE_WIDTH,
    SEQ_TIME_SHOWN_ABOVE_S, SLOW_MOTION_NEUTRAL, TAGGED_NAMES_SHOWN, WHERE_PATHS,
};
use csdm_core::migrate::truthy;
use csdm_core::preview::clips::CSDM_CLI_COMMAND;
use csdm_core::preview::sql::CLUTCH_MAX_OPPONENTS;
use csdm_core::registries::registries;
use csdm_core::settings::def;
use csdm_core::Settings;
use csdm_db::tags::Linked;
use serde_json::{json, Map, Value};
use std::collections::hash_map::RandomState;
use std::collections::HashSet;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

pub use tags::RunTags;

/// A file the run could not use: its path and Windows' reason (3.5 `report(e, …)` on an OSError).
pub(crate) fn os_error(path: &Path, e: &std::io::Error) -> EngineError {
    EngineError::File { path: path.to_path_buf(), reason: strerror(e) }
}

/// 3.5 `exc.strerror or exc`: Windows' sentence without Rust's " (os error N)".
pub(crate) fn strerror(e: &std::io::Error) -> String {
    let text = e.to_string();
    text.split(" (os error").next().unwrap_or_default().trim().to_string()
}

/// 3.5 `ask(kind, message, options)`; `None` = Cancel.
pub type AskFn<'a> = dyn Fn(AskKind, &str, &[String]) -> Option<String> + 'a;

/// One demo of the run and its events.
type DemoItem = (String, Vec<EventId>);

/// What a run talks to besides the database: STOP / KILL, the program runner, tags, the user.
pub struct RunIo<'a> {
    pub control: &'a RunControl,
    pub exec: &'a mut dyn Exec,
    /// `None` = tags are never written (golden bench, tests without a database to write to).
    pub tags: Option<&'a mut dyn RunTags>,
    /// 3.5 `ask(kind, message, options)`; `None` = Cancel.
    pub ask: &'a AskFn<'a>,
    /// The EDITING tab's clip selection (`selected_clips`, normalised).
    pub selected: Option<&'a [ClipEntry]>,
    /// The user's folder (FFmpeg under `.csdm`).
    pub home: PathBuf,
}

fn clock() -> String {
    chrono::Local::now().format(csdm_core::preview::BANNER_TIME_FORMAT).to_string()
}

/// `start_run` after its checks: the launch banner (3.5, character for character).
pub fn launch_banner(ports: &dyn crate::preview::Ports) {
    ports.state(StateName::Buttons, json!({"run": false, "stop": true, "kill": true}));
    let rule = "═".repeat(BANNER_WIDTH);
    ports.log(&format!("\n{rule}"), Level::Dim);
    ports.log(&format!("  ▶ LAUNCH  —  {}", clock()), Level::Info);
    ports.log(&rule, Level::Dim);
    ports.state(StateName::Summary, json!({"text": "  Querying DB…", "level": "running"}));
}

/// 3.5 `_worker`: the run, and the one place its failures surface. Returns the preview redone
/// without already-tagged demos when the user asked for it.
pub fn worker(cx: &mut Ctx, io: &mut RunIo, cfg: &Settings) -> Option<LastPreview> {
    let out = match run_batch(cx, io, cfg) {
        Ok(last) => last,
        Err(e) => {
            report_failure(cx.ports, &e);
            None
        }
    };
    // Over whichever way it ended (3.5 `finally: self._running = False`).
    io.control.running.store(false, std::sync::atomic::Ordering::SeqCst);
    out
}

/// 3.5 `_worker`'s `except`: the failure in the console, the run shown as over.
pub fn report_failure(ports: &dyn crate::preview::Ports, e: &EngineError) {
    ports.trace(&format!("running the batch: {e:?}"));
    ports.log(&format!("\n✗ Run stopped: {}", e.user_message()), Level::Err);
    ports.state(StateName::Summary, json!({"text": "  Run failed — see the console.", "level": "err"}));
    ports.state(StateName::ButtonsIdle, Value::Null);
}

/// 3.5 `_resolve_cli`: the CLI file from the setting, else the installed one, else `csdm` on PATH.
pub fn resolve_cli(p: &str) -> String {
    if p.is_empty() {
        let found = clips::detect_csdm_cli();
        return if found.is_empty() { CSDM_CLI_COMMAND.into() } else { found };
    }
    let p = abspath(p);
    let path = Path::new(&p);
    let base = path.file_name().map(|b| b.to_string_lossy().to_lowercase()).unwrap_or_default();
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    if CLI_FILE_NAMES.contains(&base.as_str()) && path.is_file() {
        return p;
    }
    for name in CLI_SEARCH_NAMES {
        for sub in [dir.clone(), dir.join(CLI_RESOURCES_DIR)] {
            let c = sub.join(name);
            if c.exists() {
                return c.to_string_lossy().into_owned();
            }
        }
    }
    clips::which(CSDM_CLI_COMMAND).map_or(p, |w| w.to_string_lossy().into_owned())
}

/// `cfg.get(key)` as 3.5's f-strings print it.
fn shown(cfg: &Settings, key: &str) -> String {
    py_str(got(cfg, key))
}

/// The table default of a whole / number setting (3.5 wrote it as a literal in the check).
fn table_number(key: &str) -> f64 {
    def(key).and_then(|d| crate::preview::cfg::py_float(&d.default)).unwrap_or_else(|| panic!("`{key}` has a number default"))
}

/// `int(cfg.get(key, default)) != default` (`float(...)` when `whole` is false).
fn differs(cfg: &Settings, key: &str, whole: bool) -> bool {
    let v = crate::preview::cfg::py_float(got(cfg, key)).unwrap_or_default();
    let v = if whole { v.trunc() } else { v };
    v != table_number(key)
}

/// 3.5 header lines: player(s), video, encoder / recsys / HLAE / physics / TrueView / perspective.
fn header(cx: &Ctx, cfg: &Settings, recsys: &str, tag: Option<&str>) {
    cx.log(&format!("Player(s): {}", player_str(cfg, &cx.disc.names)), Level::Info);
    let v = |k: &str| shown(cfg, k);
    cx.log(&format!("Video: {}x{}@{}fps CRF={} {} {}", v("width"), v("height"), v("framerate"), v("crf"), v("video_codec"), v("video_container")), Level::Info);
    let mut hlae = String::new();
    if recsys == RECSYS_HLAE {
        hlae = format!(" | FOV:{}", v("hlae_fov"));
        let sm = crate::preview::cfg::py_float(got(cfg, "hlae_slow_motion")).unwrap_or_default().trunc();
        if sm != SLOW_MOTION_NEUTRAL as f64 {
            hlae += &format!(" Slow:{}%", v("hlae_slow_motion"));
        }
        if truthy(got(cfg, "hlae_fix_scope_fov")) {
            hlae += " | ScopeFOV:fix";
        }
        let mut phys = Vec::new();
        if differs(cfg, "phys_ragdoll_gravity", true) {
            phys.push(format!("RagGrav:{}", v("phys_ragdoll_gravity")));
        }
        if differs(cfg, "phys_sv_gravity", true) {
            phys.push(format!("Grav:{}", v("phys_sv_gravity")));
        }
        if differs(cfg, "phys_ragdoll_scale", false) {
            phys.push(format!("RagScale:{}", v("phys_ragdoll_scale")));
        }
        for (key, label) in [("phys_ragdoll_enable", "NoRagdoll"), ("phys_blood", "NoBlood"), ("phys_dynamic_lighting", "NoDynLight")] {
            if !truthy(got(cfg, key)) {
                phys.push(label.to_string());
            }
        }
        if !phys.is_empty() {
            hlae += &format!(" | Phys: {}", phys.join(" "));
        }
    }
    let perspective = py_str(got(cfg, "perspective"));
    let label = registries().perspective_labels.get(&perspective).cloned().unwrap_or(perspective);
    let tag_str = tag.map_or_else(String::new, |t| format!(" | Tag: \u{1f3f7} {t}"));
    let tv = if truthy(got(cfg, "true_view")) { "ON" } else { "OFF" };
    cx.log(&format!("Encoder: {} | RecSys: {recsys}{hlae} | TrueView: {tv} | Perspective: {label}{tag_str}", v("encoder")), Level::Info);
}

/// 3.5 mode lines: headshots, suicides, allies / enemies, clutch.
fn mode_lines(cx: &Ctx, cfg: &Settings) {
    match py_str(got(cfg, "headshots_mode")).as_str() {
        "only" => cx.log("🎯 Headshots only", Level::Info),
        "exclude" => cx.log("🎯 Headshots excluded", Level::Info),
        _ => {}
    }
    match py_str(got(cfg, "suicides_mode")).as_str() {
        "exclude" => cx.log("🚫 Suicides excluded", Level::Info),
        "only" => cx.log("💀 Suicides only", Level::Info),
        _ => {}
    }
    let side = |run_key: &str, key: &str| truthy(cfg.get(run_key).unwrap_or_else(|| got(cfg, key)));
    match (side("_events_ally", "event_ally"), side("_events_enemy", "event_enemy")) {
        (true, false) => cx.log("⚔ Allies only", Level::Info),
        (false, true) => cx.log("🚫 Allies excluded", Level::Info),
        (false, false) => cx.log("⚠ Neither allies nor enemies ticked: no kill or damage can match.", Level::Warn),
        (true, true) => {}
    }
    if on(cfg, "clutch_enabled") {
        let mode = if cfg.get("clutch_mode").and_then(Value::as_str) == Some("full_clutch") { "Full clutch" } else { "Kills only" };
        let sizes: Vec<String> = (1..=CLUTCH_MAX_OPPONENTS).map(|n| format!("1v{n}")).filter(|s| on(cfg, &format!("clutch_{s}"))).collect();
        let sizes = if sizes.is_empty() { " (all sizes)".to_string() } else { format!(" {}", sizes.join(" ")) };
        let wins = if on(cfg, "clutch_wins_only") { " · Wins only" } else { "" };
        cx.log(&format!("🎯 Clutch: {mode}{sizes}{wins}"), Level::Info);
    }
}

/// `random.shuffle`, drawn from std's per-process random keys (no crate).
fn shuffle<T>(items: &mut [T]) {
    for i in (1..items.len()).rev() {
        let mut h = RandomState::new().build_hasher();
        h.write_usize(i);
        let j = usize::try_from(h.finish() % (i as u64 + 1)).unwrap_or_default();
        items.swap(i, j);
    }
}

/// One row of the final summary (3.5 `summary` tuple).
struct Row {
    name: String,
    status: &'static str,
    seconds: f64,
    attempts: i64,
    note: String,
}

fn file_name(dp: &str) -> String {
    Path::new(dp).file_name().map_or_else(|| dp.to_string(), |n| n.to_string_lossy().into_owned())
}

/// 3.5 `_run_batch`. `Ok(Some)` = the preview redone without already-tagged demos.
pub fn run_batch(cx: &mut Ctx, io: &mut RunIo, cfg: &Settings) -> Result<Option<LastPreview>, EngineError> {
    cx.ports.state(StateName::RunStarted, Value::Null);
    cx.ports.state(StateName::ButtonsBusy, Value::Null);
    let exe = got(cfg, "csdm_exe");
    let mut cli = resolve_cli(&if truthy(exe) { py_str(exe) } else { String::new() });
    cx.log(&format!("CLI: {cli}"), Level::Dim);
    if !Path::new(&cli).is_file() {
        match clips::which(&cli) {
            Some(w) => cli = w.to_string_lossy().into_owned(),
            None => {
                cx.log(&format!("CS Demo Manager's command-line tool was not found at {cli}. Install CS Demo Manager, or set CSDM Executable in {WHERE_PATHS}."), Level::Err);
                cx.ports.state(StateName::Summary, json!({"text": "  CSDM executable not found.", "level": "err"}));
                cx.ports.state(StateName::ButtonsIdle, Value::Null);
                return Ok(None);
            }
        }
    }
    let clips_dir = clips_root(cfg);
    if let Err(e) = std::fs::create_dir_all(&clips_dir) {
        cx.log(&format!("Raw clips folder unusable: {} ({}). Choose another one in {WHERE_PATHS} › Raw clips folder.", clips_dir.display(), strerror(&e)), Level::Err);
        cx.ports.state(StateName::ButtonsIdle, Value::Null);
        return Ok(None);
    }
    cx.log(&format!("Clips folder: {}", clips_dir.display()), Level::Dim);
    let tag_name = py_str(got(cfg, "tag_on_export"));
    let tag_enabled = truthy(got(cfg, "tag_enabled")) && truthy(got(cfg, "tag_on_export"));
    // 3.5 `cfg["recsys"] = recsys`: the normalised value is what the rest of the run reads.
    let mut cfg = cfg.clone();
    let recsys = normalize_recsys(got(&cfg, "recsys"));
    cfg.insert("recsys".into(), recsys.into());
    let cfg = &cfg;
    header(cx, cfg, recsys, tag_enabled.then_some(tag_name.as_str()));
    if recsys != RECSYS_HLAE {
        let shared = cli_json::common_cs2_injection(cx.ports, cfg);
        cs_inject::inject_cs_runtime_cfg(cx.ports, cfg, &shared);
        cx.log(
            "  ⚠ RecSys CS: CS2 replays the demo from tick 0 to reach the target tick.\n  Each clip will take as long as the full demo before the event.\n  HLAE is strongly recommended for batch recording.",
            Level::Warn,
        );
    }
    mode_lines(cx, cfg);
    let batch_start = (Instant::now(), SystemTime::now());
    let (df, dt) = (py_str(got(cfg, "date_from")), py_str(got(cfg, "date_to")));
    if truthy(got(cfg, "date_from")) || truthy(got(cfg, "date_to")) {
        let shown = |s: &str, set: bool| if set { s.to_string() } else { "∞".into() };
        let level = if detect_date_col(cx).is_some() { Level::Info } else { Level::Warn };
        cx.log(&format!("Date filter: {}  →  {}", shown(&df, truthy(got(cfg, "date_from"))), shown(&dt, truthy(got(cfg, "date_to")))), level);
    }
    cx.log("Querying DB...", Level::Info);
    let t0 = Instant::now();
    let all_events = sql::query_events(cx, cfg)?;
    let t_query = t0.elapsed();
    if all_events.is_empty() {
        if let Err(e) = clips::explain_empty_result(cx, cfg, &[("database query".to_string(), 0)]) {
            cx.ports.trace(&format!("explaining the empty result: {e:?}"));
            cx.log(&format!("✗ {}", e.user_message()), Level::Err);
        }
        cx.ports.state(StateName::ButtonsIdle, Value::Null);
        return Ok(None);
    }
    let te = pev::count(&all_events);
    let (nd, nc, ts, avg) = calc_summary(&cx.arena, &all_events, cfg)?;
    let summary_state = |text: String, level: &str| {
        let mut s = Map::new();
        s.insert("text".into(), text.into());
        s.insert("level".into(), level.into());
        if let Value::Object(counts) = summary_counts(nd, nc, ts, avg) {
            s.extend(counts);
        }
        Value::Object(s)
    };
    cx.ports.state(StateName::Summary, summary_state(fmt_summary(nd, nc, ts, avg) + "  [running…]", "running"));
    cx.log(&format!("OK: {} demo(s), {te} events  ⏱ DB {}ms", all_events.len(), t_query.as_millis()), Level::Ok);
    cx.log(&"-".repeat(RULE_WIDTH), Level::Dim);

    // 3.5 `_demo_picker_get_active` is left out: only the Tk window ever filled it (Conception #5).
    let mut demo_list: Vec<DemoItem> = all_events.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    if py_str(got(cfg, "clip_order")) == "random" {
        shuffle(&mut demo_list);
        cx.log("Order: Random 🎲", Level::Info);
    } else {
        let mut keyed: Vec<((u8, f64), DemoItem)> = demo_list.into_iter().map(|d| (demo_sort_key(cx, &d.0), d)).collect();
        keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        demo_list = keyed.into_iter().map(|(_, d)| d).collect();
        cx.log("Order: Chronological", Level::Info);
    }
    let n = demo_list.len();
    let paths: Vec<String> = demo_list.iter().map(|(dp, _)| dp.clone()).collect();
    dp2::preparse(cx, cfg, &paths)?;

    let mut skip_tagged = false;
    let mut already: HashSet<String> = HashSet::new();
    if tag_enabled {
        if let Some(tags) = io.tags.as_deref_mut() {
            match tags.already_tagged(cx, &tag_name, &paths) {
                Ok(found) => already = found,
                // 3.5 swallowed this; the run goes on as if none were tagged, but says so.
                Err(e) => cx.log(&format!("  ⚠ Could not check which demos already have tag \"{tag_name}\": {e}"), Level::Warn),
            }
        }
        if !already.is_empty() {
            let k = already.len();
            let names: Vec<String> = paths.iter().filter(|p| already.contains(*p)).map(|p| file_name(p)).collect();
            let lines: Vec<String> = names.iter().take(TAGGED_NAMES_SHOWN).map(|nm| format!("  • {nm}")).collect();
            let more = if k > TAGGED_NAMES_SHOWN { "\n  …" } else { "" };
            let msg = format!(
                "{k}/{n} demo(s) already have tag \"{tag_name}\":\n{}{more}\n\n[Yes] Include anyway\n[No] Ignore\n[Cancel] Stop and redo preview without them",
                lines.join("\n")
            );
            let tagged_paths: Vec<&String> = paths.iter().filter(|p| already.contains(*p)).collect();
            match (io.ask)(AskKind::Confirm, &msg, &["Already tagged demos".into(), "include".into(), "ignore".into()]).as_deref() {
                None => {
                    cx.ports.state(StateName::DemosUnchecked, json!({"paths": tagged_paths}));
                    cx.log(&format!("  ⏭ Cancelled — preview restarted without {k} already-tagged demo(s)"), Level::Info);
                    let rule = "─".repeat(BANNER_WIDTH);
                    cx.log(&format!("\n{rule}"), Level::Dim);
                    cx.log(&format!("  PREVIEW (without already tagged)  —  {}", clock()), Level::Info);
                    cx.log(&rule, Level::Dim);
                    cx.ports.state(StateName::Summary, json!({"text": "  Computing…", "level": "running"}));
                    let rest: DemoEvents = all_events.into_iter().filter(|(dp, _)| !already.contains(dp)).collect();
                    let last = match preview_without(cx, cfg, rest) {
                        Ok(last) => Some(last),
                        Err(e) => {
                            cx.ports.trace(&format!("computing the preview: {e:?}"));
                            cx.log(&format!("✗ Preview failed: {}", e.user_message()), Level::Err);
                            None
                        }
                    };
                    cx.ports.state(StateName::ButtonsIdle, Value::Null);
                    return Ok(last);
                }
                Some("include") => cx.log(&format!("  ▶ {k} already-tagged demo(s) → included anyway"), Level::Info),
                Some(_) => {
                    skip_tagged = true;
                    cx.ports.state(StateName::DemosUnchecked, json!({"paths": tagged_paths}));
                    cx.log(&format!("  ⏭ {k} already-tagged demo(s) → ignored"), Level::Info);
                }
            }
        }
    }

    let tickrate = whole(cfg, "tickrate", None)?;
    let (before, after) = (effective_before(cfg)?, whole(cfg, "after", None)?);
    let (mut ok, mut fail, mut skip, mut retried, mut tagged) = (0usize, 0usize, 0usize, 0i64, 0usize);
    let mut rows: Vec<Row> = Vec::new();
    let mut produced: Vec<String> = Vec::new();
    let mut links: Vec<Linked> = Vec::new();
    for (idx0, (dp, events)) in demo_list.iter().enumerate() {
        let i = idx0 + 1;
        if io.control.stop_requested() || !io.control.running() {
            for (rest, _) in &demo_list[idx0..] {
                rows.push(Row { name: file_name(rest), status: "SKIP", seconds: 0.0, attempts: 0, note: "Stop".into() });
                skip += 1;
            }
            break;
        }
        if skip_tagged && already.contains(dp) {
            cx.log(&format!("  ⏭ SKIP (already tagged): {}", file_name(dp)), Level::Dim);
            rows.push(Row { name: file_name(dp), status: "SKIP", seconds: 0.0, attempts: 0, note: "Already tagged".into() });
            skip += 1;
            continue;
        }
        let t_dp2 = Instant::now();
        let kept = Stage::of(cx).apply_modifiers(dp, events.clone(), cfg)?;
        let kept = kept.and_then(|ev| gate_events(&cx.arena, &ev, cfg));
        let t_dp2 = t_dp2.elapsed().as_secs_f64();
        let Some(events) = kept else {
            rows.push(Row { name: file_name(dp), status: "SKIP", seconds: 0.0, attempts: 0, note: "0 kills after filter".into() });
            skip += 1;
            continue;
        };
        let t_seq = Instant::now();
        let seqs = build_sequences(&cx.arena, &events, tickrate, before, after);
        let t_seq = t_seq.elapsed().as_secs_f64();
        let seqs = clips::apply_clip_edits(&cx.arena, &seqs, dp, io.selected, tickrate);
        if seqs.is_empty() {
            // 3.5 `continue` without a summary row (kept, Conception #9).
            continue;
        }
        let dn = file_name(dp);
        let ad = abspath(dp);
        io.control.set_current_demo(&dn);
        let date_str = format_demo_date(cx, dp);
        cx.ports.state(StateName::Progress, json!({"text": progress_bar(i, n)}));
        let mut parts = Vec::new();
        if t_dp2 > DP2_TIME_SHOWN_ABOVE_S {
            parts.push(format!("dp2 {:.0}ms", t_dp2 * MS_PER_SECOND));
        }
        if t_seq > SEQ_TIME_SHOWN_ABOVE_S {
            parts.push(format!("seq {:.1}ms", t_seq * MS_PER_SECOND));
        }
        let timing = if parts.is_empty() { String::new() } else { format!("  ⏱ {}", parts.join(" ")) };
        let events_json: Vec<Value> = events.iter().map(|&id| cx.arena.get(id).to_json()).collect();
        cx.ports.state(
            StateName::DemoEntry,
            json!({"date_str": date_str, "demo_name": dn, "events": events_json, "seq_count": seqs.len(), "cfg": cfg, "idx": i, "total": n, "timing_str": timing}),
        );
        if !Path::new(&ad).is_file() {
            cx.log(&format!("  SKIP: {ad}"), Level::Warn);
            rows.push(Row { name: dn, status: "SKIP", seconds: 0.0, attempts: 0, note: "Not found".into() });
            skip += 1;
            continue;
        }
        let names = cx.dp2.demo_names(dp).cloned();
        let cj = build_json(cx.ports, &cx.arena, cx.disc, dp, &seqs, cfg, names.as_ref())?;
        log_job(cx, cfg, &seqs, &cj, tickrate);
        let job_file = match record::write_job_file(&cj) {
            Ok(p) => p,
            Err(e) => {
                rows.push(Row { name: dn, status: "FAIL", seconds: 0.0, attempts: 0, note: os_error(&std::env::temp_dir(), &e).user_message() });
                fail += 1;
                continue;
            }
        };
        cx.log(&format!("  JSON: {}", job_file.display()), Level::Dim);
        let mut cmd = vec![cli.clone()];
        cmd.extend(CLI_VIDEO_ARGS.iter().map(|s| s.to_string()));
        cmd.push(job_file.to_string_lossy().into_owned());
        cx.log(&format!("  CMD: {}", cmd.join(" ")), Level::Dim);
        let pacing = record::batch_pacing(cx.ports, cfg);
        let timeout_s = record::recording_timeout(cx.ports, cfg, &seqs, pacing);
        let rec = record::record(cx.ports, io.control, io.exec, cfg, &cmd, pacing, timeout_s);
        retried += rec.retried;
        record::delete_later(job_file, record::job_file_delay());
        let ds = record::fmt_duration(rec.seconds);
        if rec.ok {
            let ri = if rec.attempts > 1 { format!(" x{}", rec.attempts) } else { String::new() };
            let mut tag_msg = String::new();
            if tag_enabled {
                if let Some(tags) = io.tags.as_deref_mut() {
                    let active = tags.active_names();
                    let names = if active.is_empty() { vec![tag_name.clone()] } else { active };
                    let (mut done, mut failed) = (Vec::new(), String::new());
                    for t in &names {
                        match tags.tag_demo(cx, dp, t) {
                            Ok(link) => {
                                done.push(t.clone());
                                links.push(link);
                            }
                            Err(e) if failed.is_empty() => failed = e,
                            Err(_) => {}
                        }
                    }
                    if !done.is_empty() {
                        tagged += 1;
                        tag_msg = format!(" \u{1f3f7} {}", done.join(", "));
                    }
                    if !failed.is_empty() {
                        tag_msg += &format!(" \u{1f3f7} FAILED: {failed}");
                    }
                }
            }
            cx.log(&format!("  ✓ OK [{ds}]{ri}{tag_msg}"), Level::Ok);
            rows.push(Row { name: dn, status: "OK", seconds: rec.seconds, attempts: rec.attempts, note: String::new() });
            produced.push(cj.get("outputFolderPath").map(py_str).unwrap_or_default());
            ok += 1;
        } else {
            cx.log(&format!("  ✗ FAILED [{ds}] {}", rec.error), Level::Err);
            rows.push(Row { name: dn, status: "FAIL", seconds: rec.seconds, attempts: rec.attempts, note: rec.error });
            fail += 1;
        }
        if i < n && !io.control.stop_requested() && pacing.delay_between_demos > 0 {
            cx.log(&format!("  Pause {}s...", pacing.delay_between_demos), Level::Dim);
            record::pause(pacing.delay_between_demos, &|| !io.control.stop_requested());
        }
    }

    let bd = record::fmt_duration(batch_start.0.elapsed().as_secs_f64());
    let rule = "═".repeat(BANNER_WIDTH);
    cx.log(&format!("\n{rule}"), Level::Dim);
    cx.log("  SUMMARY", Level::Info);
    cx.log(&rule, Level::Dim);
    for r in &rows {
        let ds = if r.seconds > 0.0 { record::fmt_duration(r.seconds) } else { "-".into() };
        let rs = if r.attempts > 1 { format!(" x{}", r.attempts) } else { String::new() };
        match r.status {
            "OK" => cx.log(&format!("  ✓ {} [{ds}]{rs}", r.name), Level::Ok),
            "SKIP" => cx.log(&format!("  ⏭ {} {}", r.name, r.note), Level::Warn),
            _ => cx.log(&format!("  ✗ {} [{ds}]{rs} {}", r.name, r.note), Level::Err),
        }
    }
    cx.log(&"─".repeat(BANNER_WIDTH), Level::Dim);
    let tag_summary = if tag_enabled { format!(" Tagged:{tagged}") } else { String::new() };
    cx.log(&format!("  OK:{ok} Failed:{fail} Skip:{skip} Retries:{retried}{tag_summary} Duration:{bd}"), Level::Info);
    cx.log(&rule, Level::Dim);
    cx.ports.state(StateName::Progress, json!({"text": format!("{ok}/{n} OK ({bd})")}));
    let level = if fail == 0 { "ok" } else if ok > 0 { "warn" } else { "err" };
    let status = if fail == 0 { format!("  ✓ {ok}/{n} demos OK") } else { format!("  ⚠ {ok} OK / {fail} failed") };
    cx.ports.state(StateName::Summary, summary_state(format!("{}  —  {bd}{status}", fmt_summary(nd, nc, ts, avg)), level));

    let killed = io.control.killed();
    if ok > 0 && on(cfg, "assemble_after") && !killed {
        cx.log("\n⚙  Final assembly in progress...", Level::Info);
        if let Err(e) = assemble::assemble_clips(cx.ports, io.exec, cfg, &produced, batch_start.1, &io.home) {
            cx.ports.trace(&format!("assembling the clips: {e:?}"));
            cx.log(&format!("  Assembly: {}", e.user_message()), Level::Err);
        }
    } else if killed && on(cfg, "assemble_after") {
        cx.log("\n⏭ Assembly skipped (batch killed).", Level::Warn);
    }

    let interrupted = killed || (io.control.stop_requested() && ok < n);
    if interrupted && !links.is_empty() && tag_enabled {
        if let Some(tags) = io.tags.as_deref_mut() {
            cx.log(&format!("\n↩ Rolling back {} tag(s)…", links.len()), Level::Warn);
            let r = tags.rollback(cx, &links);
            let mut msg = format!("  ↩ Rolled back {} tag(s)", r.rolled_back);
            if r.failed > 0 {
                msg += &format!(" ({} failed)", r.failed);
            }
            if r.kept > 0 {
                msg += &format!(", {} kept (already there before the batch)", r.kept);
            }
            cx.log(&msg, Level::Warn);
        }
    }
    cx.ports.state(StateName::ButtonsIdle, Value::Null);
    Ok(None)
}

/// 3.5 extended logging of one demo's job: each sequence, recsys / TrueView / concat, HLAE.
fn log_job(cx: &Ctx, cfg: &Settings, seqs: &[Sequence], cj: &Value, tickrate: i64) {
    let job_seqs = cj.get("sequences").and_then(Value::as_array).cloned().unwrap_or_default();
    for (si, seq) in seqs.iter().enumerate() {
        let dur = if tickrate != 0 { (seq.end_tick - seq.start_tick) as f64 / tickrate as f64 } else { 0.0 };
        let sid0 = job_seqs.get(si).and_then(|s| s.get("playerCameras")).and_then(Value::as_array).and_then(|c| c.first()).and_then(|c| c.get("playerSteamId")).filter(|v| truthy(v)).map_or_else(|| "-".to_string(), py_str);
        cx.log(&format!("  seq {}/{}  tick {}→{}  ({dur:.1}s)  cam:{sid0}", si + 1, seqs.len(), seq.start_tick, seq.end_tick), Level::Dim);
    }
    let onoff = |k: &str| if on(cfg, k) { "ON" } else { "OFF" };
    cx.log(&format!("  RecSys: {} | TrueView: {} | Concat: {}", shown(cfg, "recsys"), onoff("true_view"), onoff("concatenate_sequences")), Level::Dim);
    if let Some(ho) = cj.get("hlaeOptions").and_then(Value::as_object).filter(|o| !o.is_empty()) {
        let mut parts = Vec::new();
        if let Some(v) = ho.get("mirv_fov") {
            parts.push(format!("FOV={}", py_str(v)));
        }
        if let Some(v) = ho.get("host_timescale") {
            parts.push(format!("Slow={}", py_str(v)));
        }
        if ho.get("afxStream").is_some_and(truthy) {
            parts.push("AFX".into());
        }
        if ho.get("hideSpectatorUi").is_some_and(truthy) {
            parts.push("NoUI".into());
        }
        if let Some(a) = ho.get("extraArgs").filter(|v| truthy(v)) {
            parts.push(format!("args={}", py_str(a).chars().take(HLAE_ARGS_SHOWN).collect::<String>()));
        }
        if !parts.is_empty() {
            cx.log(&format!("  HLAE: {}", parts.join(" | ")), Level::Dim);
        }
    }
}

/// The 3.5 Cancel answer: the preview again, without the already-tagged demos (`_bg`).
fn preview_without(cx: &mut Ctx, cfg: &Settings, evts: DemoEvents) -> Result<LastPreview, EngineError> {
    let demos: Vec<String> = evts.keys().cloned().collect();
    dp2::preparse(cx, cfg, &demos)?;
    let evts = dp2::apply_filters(cx, evts, cfg)?;
    let evts = dp2::apply_global_gate(cx, evts, cfg)?;
    for dp in evts.keys() {
        if let Some(names) = cx.dp2.demo_names(dp).cloned() {
            cx.host.demo_names.insert(dp.clone(), names);
        }
    }
    let seqs = clips::preview_sequences(cx, &evts, cfg)?;
    let mut payload = clips::payload(cx, &evts, &seqs);
    payload["cfg"] = Value::Object(cfg.clone());
    payload["timings"] = Value::Null;
    let last = LastPreview::new(cx, seqs, cfg);
    cx.ports.state(StateName::PreviewReady, payload);
    Ok(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strerror_drops_the_os_error_number() {
        let e = std::io::Error::from_raw_os_error(5);
        assert!(!strerror(&e).contains("os error"));
        assert!(!strerror(&e).is_empty());
    }

    #[test]
    fn shuffle_keeps_every_item() {
        let mut v: Vec<u32> = (0..50).collect();
        shuffle(&mut v);
        let mut s = v.clone();
        s.sort_unstable();
        assert_eq!(s, (0..50).collect::<Vec<_>>());
    }

    #[test]
    fn the_cli_named_in_a_folder_is_found_there_or_in_resources() {
        let dir = tempfile::tempdir().unwrap();
        let res = dir.path().join(CLI_RESOURCES_DIR);
        std::fs::create_dir(&res).unwrap();
        std::fs::write(res.join("csdm.cmd"), "").unwrap();
        let got = resolve_cli(&dir.path().join("whatever.exe").to_string_lossy());
        assert!(got.to_lowercase().ends_with("resources\\csdm.cmd"), "{got}");
        let direct = dir.path().join("csdm.exe");
        std::fs::write(&direct, "").unwrap();
        assert_eq!(resolve_cli(&direct.to_string_lossy()), abspath(&direct.to_string_lossy()));
    }
}
