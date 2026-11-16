//! Demo-file stage of the preview: 3.5 `_preparse_dp2`, `_dp2_parse_demo`, the dp2 filters,
//! Mate POV and the ★ / optional / excluded gate. Owner: the T3 demo-file port.
//!
//! One filter = one registry entry: the code of each filter is found by the entry's `dp2_filter`
//! name in [`BEHAVIOURS`], which also says which demo sections it reads.

mod filters;
mod mate;
mod store;

/// 3.5 has no caller for it either; kept so every 3.5 filter has its counterpart.
pub use filters::no_trois_shot;
pub use store::{Cache, DemoStore, Names, Section, Sections};

use super::cfg::{cfg_int, on, split_required_optional};
use super::ctx::Ports;
use super::event::{Arena, DemoEvents, Event, EventId};
use super::Ctx;
use crate::event::{Level, StateName};
use crate::EngineError;
use csdm_core::preview::dp2::{DP2_MAX_THREADS, EXCLUSIVE_FILTER, PREPARSE_PROGRESS_EVERY, PROGRESS_BAR_EMPTY, PROGRESS_BAR_FULL, PROGRESS_BAR_WIDTH};
use csdm_core::preview::preview;
use csdm_core::registries::{registries, FilterDef};
use csdm_core::settings::def;
use csdm_core::Settings;
use indexmap::IndexSet;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;

/// One demo filter: a demo's events in, those it keeps out (3.5 `filter_fn(demo_path, events, cfg)`).
type FilterFn = fn(&mut Stage, &str, &[EventId], &Settings) -> Result<Vec<EventId>, EngineError>;

/// The code behind a registry entry's `dp2_filter` name, and the demo sections it reads.
struct Behaviour {
    dp2_filter: &'static str,
    run: FilterFn,
    sections: &'static [Section],
}

/// Every demo filter. WALLBANG and BLIND FIRE ask for what they read (correction (e)).
const BEHAVIOURS: &[Behaviour] = &[
    Behaviour { dp2_filter: "_wall_bang_dp2_filter", run: filters::wall_bang, sections: &[Section::Death, Section::Fire] },
    Behaviour { dp2_filter: "_attacker_blind_dp2_filter", run: filters::attacker_blind, sections: &[Section::Death] },
    Behaviour { dp2_filter: "_airborne_dp2_filter", run: filters::airborne, sections: &[Section::Death] },
    Behaviour { dp2_filter: "_collateral_dp2_filter", run: filters::collateral, sections: &[Section::Death] },
    Behaviour { dp2_filter: "_trois_shot_filter", run: filters::trois_shot, sections: &[Section::Fire] },
    Behaviour { dp2_filter: "_one_tap_filter", run: filters::one_tap, sections: &[Section::Fire] },
    Behaviour { dp2_filter: "_spray_transfer_filter", run: filters::spray_transfer, sections: &[Section::Fire] },
    Behaviour { dp2_filter: "_high_velocity_filter", run: filters::high_velocity, sections: &[Section::Fire] },
    Behaviour { dp2_filter: "_flick_filter", run: filters::flick, sections: &[Section::Death] },
    Behaviour { dp2_filter: "_savior_filter", run: filters::savior, sections: &[Section::Hurt] },
    Behaviour { dp2_filter: "_mate_pov_filter", run: mate::mate_pov, sections: &[] },
];

/// TROIS TAP has no `dp2_filter` (it always runs alone) and reads the shots.
const EXCLUSIVE_SECTIONS: &[Section] = &[Section::Fire];

fn behaviour(dp2_filter: &str) -> Option<&'static Behaviour> {
    BEHAVIOURS.iter().find(|b| b.dp2_filter == dp2_filter)
}

fn filter_def(key: &str) -> &'static FilterDef {
    registries().kill_filters.iter().find(|f| f.key == key).unwrap_or_else(|| panic!("{key} is in the kill filter registry"))
}

/// `_get_dp2_filter_defs`: registry entries with a demo filter, in registry order, with their code.
fn dp2_filter_defs() -> Vec<(&'static FilterDef, FilterFn)> {
    registries()
        .kill_filters
        .iter()
        .filter_map(|f| {
            let name = f.dp2_filter.as_deref()?;
            Some((f, behaviour(name).unwrap_or_else(|| panic!("no behaviour for dp2 filter {name}")).run))
        })
        .collect()
}

/// The demo sections one registry filter reads.
fn filter_sections(f: &FilterDef) -> &'static [Section] {
    if f.key == EXCLUSIVE_FILTER {
        return EXCLUSIVE_SECTIONS;
    }
    f.dp2_filter.as_deref().and_then(behaviour).map_or(&[], |b| b.sections)
}

/// The log label of a demo filter (`dp2_log`).
fn label(f: &FilterDef) -> &str {
    f.dp2_log.as_deref().unwrap_or(&f.badge)
}

/// What the stage works with: the `Ctx` parts it uses (it never reads the database).
pub struct Stage<'s> {
    pub ports: &'s dyn Ports,
    pub demos: &'s DemoStore,
    pub cache: &'s mut Cache,
    pub arena: &'s mut Arena,
}

/// `e.get("type") == "kill"`: an event without a type is not a kill here (unlike `Event::kind`).
fn is_kill(e: &Event) -> bool {
    e.get("type").and_then(Value::as_str) == Some("kill")
}

/// `(e["tick"], str(e.get("killer_sid", "")))`: how 3.5 matched kills across lists.
fn sig(e: &Event) -> (i64, String) {
    (e.tick(), e.text("killer_sid"))
}

/// `_count_kills`.
fn count_kills(arena: &Arena, events: &[EventId]) -> usize {
    events.iter().filter(|&&id| is_kill(arena.get(id))).count()
}

/// `_non_kill_only`.
fn non_kill_only(arena: &Arena, events: &[EventId]) -> Vec<EventId> {
    events.iter().copied().filter(|&id| !is_kill(arena.get(id))).collect()
}

/// `Path(dp).name`.
fn file_name(dp: &str) -> String {
    Path::new(dp).file_name().map_or_else(|| dp.to_string(), |n| n.to_string_lossy().into_owned())
}

/// `e["_mf"] = (e["_mf"] | keys) if e.get("_mf") else set(keys)`.
fn add_mf(e: &mut Event, keys: &BTreeSet<String>) {
    e.mf.get_or_insert_with(BTreeSet::new).extend(keys.iter().cloned());
}

/// `_stamp_mf`.
fn stamp_mf(arena: &mut Arena, events: &[EventId], key: &str) {
    for &id in events {
        arena.get_mut(id).stamp_mf(key);
    }
}

/// `_dp2_required_sections`: the sections the active and excluded filters read, "positions" when a
/// position-derived filter judges non-kill events, "names" whenever anything is read.
pub fn required_sections(cfg: &Settings) -> Sections {
    let reg = &registries().kill_filters;
    let wanted = |k: &str| on(cfg, k) || on(cfg, &format!("{k}_exclude"));
    let mut s: Sections = reg.iter().filter(|f| wanted(&f.key)).flat_map(|f| filter_sections(f).iter().copied()).collect();
    if on(cfg, "_events_non_lethal") || on(cfg, "_events_other") {
        let kill_only = |f: &FilterDef| !f.applies_to.is_empty() && f.applies_to.iter().all(|a| a == "kill");
        let needs_positions = |f: &FilterDef| preview()["filters"][&f.key]["needs_positions"].as_bool() == Some(true);
        if reg.iter().any(|f| !kill_only(f) && needs_positions(f) && wanted(&f.key)) {
            s.insert(Section::Positions);
        }
    }
    if !s.is_empty() {
        s.insert(Section::Names);
    }
    s
}

/// 3.5 `progress_bar`: "▰▰▰▱▱ 12/17".
pub(crate) fn progress_bar(done: usize, total: usize) -> String {
    if total == 0 {
        return format!("{done}/{total}");
    }
    let done = done.min(total);
    let filled = ((PROGRESS_BAR_WIDTH * done) as f64 / total as f64).round_ties_even() as usize;
    format!("{}{} {done}/{total}", PROGRESS_BAR_FULL.repeat(filled), PROGRESS_BAR_EMPTY.repeat(PROGRESS_BAR_WIDTH - filled))
}

fn table_default_i64(key: &str) -> i64 {
    def(key).and_then(|d| d.default.as_i64()).unwrap_or_else(|| panic!("{key} is an integer setting"))
}

impl<'s> Stage<'s> {
    pub fn new(ports: &'s dyn Ports, demos: &'s DemoStore, cache: &'s mut Cache, arena: &'s mut Arena) -> Self {
        Stage { ports, demos, cache, arena }
    }

    pub fn of(cx: &'s mut Ctx<'_>) -> Self {
        Stage { ports: cx.ports, demos: cx.demos, cache: &mut cx.dp2, arena: &mut cx.arena }
    }

    fn log(&self, message: &str, level: Level) {
        self.ports.log(message, level);
    }

    /// `_preparse_dp2`: reads, in parallel, the sections this preview's filters need for every demo
    /// file of the query (results identical to a sequential run: each demo is read on its own and
    /// put into the view in query order).
    pub fn preparse(&mut self, cfg: &Settings, demo_paths: &[String]) {
        let cap = cfg_int(self.ports, cfg, store::CACHE_CAP_KEY, table_default_i64(store::CACHE_CAP_KEY), Some(1), None);
        self.demos.pin(demo_paths, usize::try_from(cap).unwrap_or(usize::MAX));
        let required = required_sections(cfg);
        if required.is_empty() {
            return;
        }
        let paths: Vec<&str> = demo_paths.iter().map(String::as_str).filter(|p| Path::new(p).is_file()).collect();
        if paths.is_empty() {
            return;
        }
        let jobs: Vec<(&str, Sections)> = paths
            .iter()
            .filter_map(|&p| {
                let missing: Sections = required.difference(&self.cache.sections(p)).copied().collect();
                (!missing.is_empty()).then_some((p, missing))
            })
            .collect();
        let n_cached = paths.len() - jobs.len();
        if jobs.is_empty() {
            self.log(&format!("  ⚡ Pre-parse: all {} demo(s) already cached — skipping", paths.len()), Level::Dim);
            return;
        }
        let threads_key = "dp2_threads";
        let n_threads = cfg_int(self.ports, cfg, threads_key, table_default_i64(threads_key), Some(1), Some(DP2_MAX_THREADS));
        let n_threads = usize::try_from(n_threads).unwrap_or(1);
        let cached = if n_cached > 0 { format!(" ({n_cached} already cached)") } else { String::new() };
        self.log(&format!("  ⚡ Pre-parsing {} demo(s){cached} with {n_threads} thread(s)…", jobs.len()), Level::Info);
        let outcomes = self.read_parallel(&jobs, n_threads);
        let done = outcomes.len();
        for ((dp, _), outcome) in jobs.iter().zip(outcomes) {
            store::apply(self, dp, &required, outcome);
        }
        self.log(&format!("  ✓ Pre-parse done ({done} parsed, {}/{} total in cache)", n_cached + done, paths.len()), Level::Ok);
    }

    /// Reads each job on up to `n_threads` threads; a progress state every few demos, as 3.5.
    fn read_parallel(&self, jobs: &[(&str, Sections)], n_threads: usize) -> Vec<store::Outcome> {
        let total = jobs.len();
        let next = AtomicUsize::new(0);
        let demos = self.demos;
        let mut slots: Vec<Option<store::Outcome>> = (0..total).map(|_| None).collect();
        std::thread::scope(|scope| {
            let (tx, rx) = mpsc::channel();
            for _ in 0..n_threads.min(total) {
                let (tx, next) = (tx.clone(), &next);
                scope.spawn(move || loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some((dp, needed)) = jobs.get(i) else { break };
                    if tx.send((i, store::read(demos, dp, needed))).is_err() {
                        break;
                    }
                });
            }
            drop(tx);
            for (n, (i, outcome)) in rx.iter().enumerate() {
                slots[i] = Some(outcome);
                let done = n + 1;
                if done == total || done % PREPARSE_PROGRESS_EVERY == 0 {
                    self.ports.state(StateName::Progress, json!({"text": format!("PRE-PARSE {}", progress_bar(done, total))}));
                }
            }
        });
        slots.into_iter().map(|s| s.expect("every pre-parse job answers")).collect()
    }

    /// `_apply_filter_to_events`: one filter over every demo; surviving kills get its key in `_mf`,
    /// demos left empty go.
    fn apply_filter_to_events(&mut self, evts: &DemoEvents, cfg: &Settings, f: &FilterDef, run: FilterFn, label: &str) -> Result<DemoEvents, EngineError> {
        if !on(cfg, &f.key) {
            return Ok(evts.clone());
        }
        let mut result = DemoEvents::new();
        for (dp, events) in evts {
            let n_before = count_kills(self.arena, events);
            let combined = run(self, dp, events, cfg)?;
            let n_after = count_kills(self.arena, &combined);
            // A camera filter (Mate POV) keeps its kills: its line counts the kills it filmed.
            if f.camera_fn.is_some() {
                let filmed = combined.iter().filter(|&&id| self.arena.get(id).get("_mate_pov_sid").is_some_and(csdm_core::migrate::truthy)).count();
                let level = if filmed > 0 { Level::Info } else { Level::Dim };
                self.log(&format!("  {label} [{}] : {filmed}/{n_before} with qualifying mate", file_name(dp)), level);
            } else {
                let level = if n_after > 0 { Level::Info } else { Level::Dim };
                self.log(&format!("  {label} [{}] : {n_before} kills → {n_after}", file_name(dp)), level);
            }
            if !combined.is_empty() {
                stamp_mf(self.arena, &combined, &f.key);
                result.insert(dp.clone(), combined);
            }
        }
        Ok(result)
    }

    /// `_apply_dp2_filters_to_events`: exclusions first, then ★ filters chained (AND), optional ones
    /// run side by side (each only tags `_mf`); TROIS TAP alone when on. Demos left empty go.
    pub fn apply_filters(&mut self, evts: DemoEvents, cfg: &Settings) -> Result<DemoEvents, EngineError> {
        if on(cfg, EXCLUSIVE_FILTER) {
            let f = filter_def(EXCLUSIVE_FILTER);
            self.log(&format!("  {} — analyzing demos…", label(f)), Level::Info);
            let result_label = format!("{} → {}", label(f), f.dp2_result.as_deref().unwrap_or_default());
            return self.apply_filter_to_events(&evts, cfg, f, filters::trois_tap, &result_label);
        }
        let defs = dp2_filter_defs();
        let no_auto = &registries().no_auto_exclude;
        let excl: Vec<FilterFn> = defs.iter().filter(|(f, _)| on(cfg, &format!("{}_exclude", f.key)) && !no_auto.contains(&f.key)).map(|(_, run)| *run).collect();
        let mut evts = evts;
        if !excl.is_empty() {
            let mut kept = DemoEvents::new();
            for (dp, events) in &evts {
                let mut excluded = HashSet::new();
                for run in &excl {
                    for id in run(self, dp, events, cfg)? {
                        let e = self.arena.get(id);
                        if is_kill(e) {
                            excluded.insert(sig(e));
                        }
                    }
                }
                let surviving: Vec<EventId> = events
                    .iter()
                    .copied()
                    .filter(|&id| {
                        let e = self.arena.get(id);
                        !is_kill(e) || !excluded.contains(&sig(e))
                    })
                    .collect();
                if !surviving.is_empty() {
                    kept.insert(dp.clone(), surviving);
                }
            }
            evts = kept;
            if evts.is_empty() {
                return Ok(evts);
            }
        }
        let active: Vec<(&FilterDef, FilterFn)> = defs.into_iter().filter(|(f, _)| on(cfg, &f.key)).collect();
        if active.is_empty() {
            return Ok(evts);
        }
        let keys: Vec<&'static str> = active.iter().map(|&(f, _)| f.key.as_str()).collect();
        let (req_keys, _) = split_required_optional(cfg, &keys);
        let (req, opt): (Vec<_>, Vec<_>) = active.into_iter().partition(|(f, _)| req_keys.contains(&f.key.as_str()));
        let req_result = if req.is_empty() { None } else { Some(self.chain(&req, &evts, cfg)?) };
        let opt_result = if opt.is_empty() { None } else { Some(self.union(&opt, &evts, cfg)?) };
        let base = req_result.unwrap_or(evts);
        let Some(opt_result) = opt_result else { return Ok(base) };
        let req_set: BTreeSet<String> = req_keys.iter().map(|k| k.to_string()).collect();
        let mut merged = DemoEvents::new();
        for (dp, original) in &base {
            let opt_sig_mf: HashMap<(i64, String), BTreeSet<String>> = opt_result
                .get(dp)
                .into_iter()
                .flatten()
                .map(|&id| self.arena.get(id))
                .filter(|e| is_kill(e))
                .map(|e| (sig(e), e.mf.clone().unwrap_or_default()))
                .collect();
            let non_kill = non_kill_only(self.arena, original);
            let mut kept = Vec::new();
            for &id in original {
                let e = self.arena.get(id);
                if !is_kill(e) {
                    continue;
                }
                let mut combined = req_set.clone();
                combined.extend(opt_sig_mf.get(&sig(e)).into_iter().flatten().cloned());
                if !combined.is_empty() {
                    add_mf(self.arena.get_mut(id), &combined);
                }
                kept.push(id);
            }
            if !kept.is_empty() || !non_kill.is_empty() {
                merged.insert(dp.clone(), [kept, non_kill].concat());
            }
        }
        Ok(merged)
    }

    /// `_chain`: each ★ filter narrows what the previous one kept.
    fn chain(&mut self, filters: &[(&FilterDef, FilterFn)], src: &DemoEvents, cfg: &Settings) -> Result<DemoEvents, EngineError> {
        let mut result = src.clone();
        for &(f, run) in filters {
            self.log(&format!("  {} — analyzing demos…", label(f)), Level::Info);
            result = self.apply_filter_to_events(&result, cfg, f, run, label(f))?;
        }
        Ok(result)
    }

    /// `_union`: each optional filter runs on the same events; kills any of them kept, with every
    /// key that matched them.
    fn union(&mut self, filters: &[(&FilterDef, FilterFn)], src: &DemoEvents, cfg: &Settings) -> Result<DemoEvents, EngineError> {
        let mut per = Vec::new();
        for &(f, run) in filters {
            self.log(&format!("  {} — analyzing demos…", label(f)), Level::Info);
            per.push(self.apply_filter_to_events(src, cfg, f, run, label(f))?);
        }
        // 3.5 walked these demos as a set; the order never shows, the result is only looked up.
        let demos: IndexSet<&String> = per.iter().flat_map(|r| r.keys()).collect();
        let mut merged = DemoEvents::new();
        for dp in demos {
            let mut sig_to_mf: HashMap<(i64, String), BTreeSet<String>> = HashMap::new();
            for id in per.iter().filter_map(|r| r.get(dp)).flatten() {
                let e = self.arena.get(*id);
                if is_kill(e) {
                    sig_to_mf.entry(sig(e)).or_default().extend(e.mf.iter().flatten().cloned());
                }
            }
            let original = src.get(dp).map_or(&[][..], Vec::as_slice);
            let non_kill = non_kill_only(self.arena, original);
            let mut kept = Vec::new();
            for &id in original {
                let e = self.arena.get(id);
                if !is_kill(e) {
                    continue;
                }
                if let Some(mf) = sig_to_mf.get(&sig(e)) {
                    if !mf.is_empty() {
                        add_mf(self.arena.get_mut(id), mf);
                    }
                    kept.push(id);
                }
            }
            if !kept.is_empty() || !non_kill.is_empty() {
                merged.insert(dp.clone(), [kept, non_kill].concat());
            }
        }
        Ok(merged)
    }

    /// `_apply_dp2_modifiers`: the run's per-demo version of [`Stage::apply_filters`]; `None` = skip the demo.
    pub fn apply_modifiers(&mut self, dp: &str, events: Vec<EventId>, cfg: &Settings) -> Result<Option<Vec<EventId>>, EngineError> {
        let skip = |f: &FilterDef| f.dp2_skip.clone().unwrap_or_default();
        let result_word = |f: &FilterDef| f.dp2_result.clone().unwrap_or_default();
        if on(cfg, EXCLUSIVE_FILTER) {
            let f = filter_def(EXCLUSIVE_FILTER);
            let n_before = count_kills(self.arena, &events);
            let events = filters::trois_tap(self, dp, &events, cfg)?;
            let n_after = count_kills(self.arena, &events);
            self.log(&format!("  {} : {n_before} kills → {n_after} {}", label(f), result_word(f)), Level::Info);
            if events.is_empty() {
                self.log(&format!("  ⏭ SKIP: {} in this demo", skip(f)), Level::Dim);
                return Ok(None);
            }
            stamp_mf(self.arena, &events, &f.key);
            return Ok(Some(events));
        }
        let defs = dp2_filter_defs();
        let no_auto = &registries().no_auto_exclude;
        let excl: Vec<&(&FilterDef, FilterFn)> = defs.iter().filter(|(f, _)| on(cfg, &format!("{}_exclude", f.key)) && !no_auto.contains(&f.key)).collect();
        let mut events = events;
        if !excl.is_empty() {
            let mut excluded = HashSet::new();
            for &&(f, run) in &excl {
                for id in run(self, dp, &events, cfg)? {
                    let e = self.arena.get(id);
                    if is_kill(e) {
                        excluded.insert(sig(e));
                    }
                }
                self.log(&format!("  🚫{} exclude : {} kills removed", label(f), excluded.len()), Level::Dim);
            }
            events.retain(|&id| {
                let e = self.arena.get(id);
                !is_kill(e) || !excluded.contains(&sig(e))
            });
            if events.is_empty() {
                self.log("  ⏭ SKIP: all kills excluded", Level::Dim);
                return Ok(None);
            }
        }
        let active: Vec<(&FilterDef, FilterFn)> = defs.into_iter().filter(|(f, _)| on(cfg, &f.key)).collect();
        if active.is_empty() {
            return Ok(Some(events));
        }
        let keys: Vec<&'static str> = active.iter().map(|&(f, _)| f.key.as_str()).collect();
        let (req_keys, _) = split_required_optional(cfg, &keys);
        let (req, opt): (Vec<_>, Vec<_>) = active.into_iter().partition(|(f, _)| req_keys.contains(&f.key.as_str()));
        let req_sigs: Option<HashSet<(i64, String)>> = if req.is_empty() {
            None
        } else {
            // `_run_and`: chained; a filter that leaves nothing skips the demo.
            let mut kept = events.clone();
            for &(f, run) in &req {
                let n_before = count_kills(self.arena, &kept);
                kept = run(self, dp, &kept, cfg)?;
                let n_after = count_kills(self.arena, &kept);
                self.log(&format!("  {} : {n_before} kills → {n_after} {}", label(f), result_word(f)), Level::Info);
                if kept.is_empty() {
                    self.log(&format!("  ⏭ SKIP: {} in this demo", skip(f)), Level::Dim);
                    return Ok(None);
                }
                stamp_mf(self.arena, &kept, &f.key);
            }
            Some(kept.iter().map(|&id| self.arena.get(id)).filter(|e| is_kill(e)).map(sig).collect())
        };
        // `_run_or`: each optional filter on the same events, noting which keys matched each kill.
        let mut opt_s2k: HashMap<(i64, String), BTreeSet<String>> = HashMap::new();
        for &(f, run) in &opt {
            let n_before = count_kills(self.arena, &events);
            let passed = run(self, dp, &events, cfg)?;
            let n_after = count_kills(self.arena, &passed);
            self.log(&format!("  {} : {n_before} kills → {n_after} {}", label(f), result_word(f)), Level::Info);
            for id in passed {
                let e = self.arena.get(id);
                if is_kill(e) {
                    opt_s2k.entry(sig(e)).or_default().insert(f.key.clone());
                }
            }
        }
        let non_kill = non_kill_only(self.arena, &events);
        let keep: HashSet<(i64, String)> = req_sigs.unwrap_or_else(|| events.iter().map(|&id| self.arena.get(id)).filter(|e| is_kill(e)).map(sig).collect());
        let mut kept = Vec::new();
        for &id in &events {
            let e = self.arena.get(id);
            if !is_kill(e) || !keep.contains(&sig(e)) {
                continue;
            }
            let mut matched: BTreeSet<String> = req_keys.iter().map(|k| k.to_string()).collect();
            matched.extend(opt_s2k.get(&sig(e)).into_iter().flatten().cloned());
            add_mf(self.arena.get_mut(id), &matched);
            kept.push(id);
        }
        let result = [kept, non_kill].concat();
        if result.is_empty() {
            self.log("  ⏭ SKIP: 0 kills after dp2 required filters in this demo", Level::Dim);
            return Ok(None);
        }
        Ok(Some(result))
    }
}

/// `_event_category`: "kill" | "damage" | "shot" | "round"; `None` for a type no filter judges.
fn event_category(etype: &str) -> Option<&'static str> {
    preview()["event_categories"].get(etype).and_then(Value::as_str)
}

/// `_apply_global_filter_gate_events`: a kill must match every ★ kill filter and one optional kill
/// filter; a non-kill event is judged by the active filters of its category (★, optional, excluded,
/// group "dup"); deaths pass. Kills first; `None` when nothing is left.
pub fn gate_events(arena: &Arena, events: &[EventId], cfg: &Settings) -> Option<Vec<EventId>> {
    let reg = &registries().kill_filters;
    let active: Vec<&str> = reg.iter().filter(|f| on(cfg, &f.key)).map(|f| f.key.as_str()).collect();
    let excluded: Vec<&str> = reg.iter().filter(|f| on(cfg, &format!("{}_exclude", f.key))).map(|f| f.key.as_str()).collect();
    if active.is_empty() && excluded.is_empty() {
        return Some(events.to_vec());
    }
    let (req, opt) = split_required_optional(cfg, &active);
    let applies = |k: &str, category: &str| reg.iter().any(|f| f.key == k && f.applies_to.iter().any(|a| a == category));
    let of = |keys: &[&'static str], category: &str| -> Vec<&'static str> { keys.iter().copied().filter(|k| applies(k, category)).collect() };
    let (kill_req, kill_opt) = (of(&req, "kill"), of(&opt, "kill"));
    let (mut kept, mut non_kill) = (Vec::new(), Vec::new());
    for &id in events {
        let e = arena.get(id);
        let matched: HashSet<&str> = e.mf.iter().flatten().map(String::as_str).collect();
        let etype = e.get("type").and_then(Value::as_str);
        if etype == Some("kill") {
            if !kill_req.iter().all(|k| matched.contains(k)) || (!kill_opt.is_empty() && !kill_opt.iter().any(|k| matched.contains(k))) {
                continue;
            }
            kept.push(id);
            continue;
        }
        let Some(category) = etype.filter(|t| *t != "death").and_then(event_category) else {
            non_kill.push(id);
            continue;
        };
        let (c_req, c_opt, c_exc) = (of(&req, category), of(&opt, category), of(&excluded, category));
        if !c_req.iter().all(|k| matched.contains(k)) || (!c_opt.is_empty() && !c_opt.iter().any(|k| matched.contains(k))) || c_exc.iter().any(|k| matched.contains(k)) {
            continue;
        }
        // One clip per grenade / burst: an active group filter keeps only the member it chose.
        let dup = e.get("_grp").and_then(Value::as_object).is_some_and(|g| g.iter().any(|(k, role)| role == "dup" && (c_req.contains(&k.as_str()) || c_opt.contains(&k.as_str()))));
        if !dup {
            non_kill.push(id);
        }
    }
    let result = [kept, non_kill].concat();
    (!result.is_empty()).then_some(result)
}

/// `_preparse_dp2(cfg, demo_paths)`.
pub fn preparse(cx: &mut Ctx, cfg: &Settings, demo_paths: &[String]) -> Result<(), EngineError> {
    Stage::of(cx).preparse(cfg, demo_paths);
    Ok(())
}

/// `_apply_dp2_filters_to_events(evts, cfg)`.
pub fn apply_filters(cx: &mut Ctx, evts: DemoEvents, cfg: &Settings) -> Result<DemoEvents, EngineError> {
    Stage::of(cx).apply_filters(evts, cfg)
}

/// `_apply_global_filter_gate_dict(evts, cfg)`.
pub fn apply_global_gate(cx: &mut Ctx, evts: DemoEvents, cfg: &Settings) -> Result<DemoEvents, EngineError> {
    Ok(evts.into_iter().filter_map(|(dp, events)| gate_events(&cx.arena, &events, cfg).map(|g| (dp, g))).collect())
}

#[cfg(test)]
mod testkit {
    use super::store::{default_sections, Death, Entry, Fire, Hurt};
    use super::{Cache, DemoStore, Stage};
    use crate::preview::ctx::CollectPorts;
    use crate::preview::event::{Arena, Event, EventId};
    use std::sync::Arc;

    /// A demo file that exists (empty), and the pieces of a `Stage`.
    pub struct Kit {
        pub ports: CollectPorts,
        pub demos: DemoStore,
        pub cache: Cache,
        pub arena: Arena,
        pub demo: String,
        pub dir: tempfile::TempDir,
    }

    impl Kit {
        pub fn new() -> Kit {
            let dir = tempfile::tempdir().expect("temporary folder");
            let demo = Kit::file(&dir, "demo.dem");
            Kit { ports: CollectPorts::default(), demos: DemoStore::default(), cache: Cache::default(), arena: Arena::default(), demo, dir }
        }

        /// An empty file in the kit's folder.
        pub fn file(dir: &tempfile::TempDir, name: &str) -> String {
            let path = dir.path().join(name);
            std::fs::write(&path, b"").expect("empty demo file");
            path.to_string_lossy().into_owned()
        }

        pub fn stage(&mut self) -> Stage<'_> {
            Stage::new(&self.ports, &self.demos, &mut self.cache, &mut self.arena)
        }

        /// A kill event with 3.5's keys.
        pub fn kill(&mut self, tick: i64, killer: &str, victim: &str, weapon: &str) -> EventId {
            let mut e = Event::default();
            e.set("tick", tick);
            e.set("type", "kill");
            e.set("weapon", weapon);
            e.set("killer_sid", killer);
            e.set("victim_sid", victim);
            self.arena.add(e)
        }

        pub fn event(&mut self, tick: i64, kind: &str) -> EventId {
            let mut e = Event::default();
            e.set("tick", tick);
            e.set("type", kind);
            self.arena.add(e)
        }

        /// The kit's demo as read with the default sections, holding this data.
        pub fn fill(&mut self, fire: Option<Fire>, death: Option<Death>, hurt: Option<Hurt>) {
            let entry = Entry { sections: default_sections(), fire: fire.map(Arc::new), death: death.map(Arc::new), hurt: hurt.map(Arc::new), names: None, mate: None };
            self.cache.demos.insert(self.demo.clone(), entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::store::{Death, DeathFlags};
    use super::testkit::Kit;
    use super::*;

    fn cfg(v: Value) -> Settings {
        serde_json::from_value(v).unwrap()
    }

    fn names(s: &Sections) -> BTreeSet<String> {
        s.iter().map(|x| x.name().to_string()).collect()
    }

    #[test]
    fn required_sections_match_the_3_5_export_but_for_correction_e() {
        let table = &preview()["filters"];
        for f in &registries().kill_filters {
            let exported = |k: &str| -> BTreeSet<String> { table[&f.key][k].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
            let corrected = |list: &[&str]| -> BTreeSet<String> { list.iter().map(|s| s.to_string()).collect() };
            let (active, excluded, nonkill) = match f.key.as_str() {
                "kill_mod_wall_bang" => (corrected(&["death", "fire", "names"]), corrected(&["death", "fire", "names"]), corrected(&["death", "fire", "names"])),
                "kill_mod_attacker_blind" => (corrected(&["death", "names"]), corrected(&["death", "names"]), corrected(&["death", "names"])),
                _ => (exported("dp2_sections"), exported("dp2_sections_exclude"), exported("dp2_sections_nonkill")),
            };
            assert_eq!(names(&required_sections(&cfg(json!({&f.key: true})))), active, "{}", f.key);
            assert_eq!(names(&required_sections(&cfg(json!({format!("{}_exclude", f.key): true})))), excluded, "{}", f.key);
            assert_eq!(names(&required_sections(&cfg(json!({&f.key: true, "_events_non_lethal": true})))), nonkill, "{}", f.key);
        }
        assert!(required_sections(&Settings::new()).is_empty());
    }

    #[test]
    fn every_demo_filter_has_one_behaviour_and_every_weapon_its_thresholds() {
        let reg = &registries().kill_filters;
        for b in BEHAVIOURS {
            assert_eq!(reg.iter().filter(|f| f.dp2_filter.as_deref() == Some(b.dp2_filter)).count(), 1, "{}", b.dp2_filter);
        }
        assert_eq!(dp2_filter_defs().len(), BEHAVIOURS.len());
        for f in reg {
            // The log line that counts filmed kills is for the one camera filter.
            assert_eq!(f.camera_fn.is_some(), f.dp2_filter.as_deref() == Some("_mate_pov_filter"), "{}", f.key);
        }
        let thresholds = preview()["trois_shot_thresholds"].as_object().unwrap();
        for (_, dp2) in preview()["csdm_to_dp2_weapon"].as_object().unwrap() {
            assert!(thresholds.contains_key(dp2.as_str().unwrap()), "{dp2}");
        }
        assert!(filter_def(EXCLUSIVE_FILTER).dp2_filter.is_none());
    }

    #[test]
    fn progress_bar_rounds_half_to_even() {
        assert_eq!(progress_bar(5, 17), "▰▰▰▰▱▱▱▱▱▱▱▱ 5/17");
        assert_eq!(progress_bar(1, 8), "▰▰▱▱▱▱▱▱▱▱▱▱ 1/8");
        assert_eq!(progress_bar(3, 8), "▰▰▰▰▱▱▱▱▱▱▱▱ 3/8");
        assert_eq!(progress_bar(0, 0), "0/0");
    }

    fn tag(kit: &mut Kit, id: EventId, mf: &[&str], grp: Option<Value>) -> EventId {
        let e = kit.arena.get_mut(id);
        if !mf.is_empty() {
            e.mf = Some(mf.iter().map(|s| s.to_string()).collect());
        }
        if let Some(g) = grp {
            e.set("_grp", g);
        }
        id
    }

    #[test]
    fn the_gate_wants_every_must_one_optional_and_no_excluded_filter_per_category() {
        let mut kit = Kit::new();
        let k1 = kit.kill(1, "1", "2", "AK-47");
        let k1 = tag(&mut kit, k1, &["kill_mod_ace", "kill_mod_flick"], None);
        let k2 = kit.kill(2, "1", "2", "AK-47");
        let k2 = tag(&mut kit, k2, &["kill_mod_ace"], None);
        let k3 = kit.kill(3, "1", "2", "AK-47");
        let k3 = tag(&mut kit, k3, &["kill_mod_flick"], None);
        let d1 = kit.event(4, "damage_actor");
        let d1 = tag(&mut kit, d1, &["dmg_mod_multi_nade"], Some(json!({"dmg_mod_multi_nade": "first"})));
        let d2 = kit.event(5, "damage_actor");
        let d3 = kit.event(6, "damage_target");
        let d3 = tag(&mut kit, d3, &["dmg_mod_multi_nade", "dmg_mod_low_hp"], None);
        let d4 = kit.event(7, "damage_actor");
        let d4 = tag(&mut kit, d4, &["dmg_mod_multi_nade"], Some(json!({"dmg_mod_multi_nade": "dup"})));
        let death = kit.event(8, "death");
        let shot = kit.event(9, "shot");
        let c = cfg(json!({"kill_mod_ace": true, "kill_mod_ace_req": true, "kill_mod_flick": true, "dmg_mod_multi_nade": true, "dmg_mod_low_hp_exclude": true}));
        let events = [d1, k1, d2, k2, d3, k3, d4, death, shot];
        assert_eq!(gate_events(&kit.arena, &events, &c), Some(vec![k1, d1, death, shot]));
        assert_eq!(gate_events(&kit.arena, &[k2], &c), None);
        assert_eq!(gate_events(&kit.arena, &[], &Settings::new()), Some(vec![]));
        assert_eq!(gate_events(&kit.arena, &[k2, d2], &Settings::new()), Some(vec![k2, d2]));
    }

    /// Kills A (airborne, blind), B (airborne), C (blind), D (neither), and a death event.
    fn flagged_demo() -> (Kit, [EventId; 5]) {
        let mut kit = Kit::new();
        let ids = [kit.kill(100, "1", "2", "AK-47"), kit.kill(200, "1", "3", "AK-47"), kit.kill(300, "1", "4", "AK-47"), kit.kill(400, "1", "5", "AK-47"), kit.event(500, "death")];
        let mut d = Death::default();
        let f = |inair, blind| DeathFlags { attackerinair: Some(inair), attackerblind: Some(blind), ..DeathFlags::default() };
        for (tick, flags) in [(100, f(true, true)), (200, f(true, false)), (300, f(false, true)), (400, f(false, false))] {
            d.flags.insert((tick, "1".into()), flags);
        }
        kit.fill(None, Some(d), None);
        (kit, ids)
    }

    fn mf(kit: &Kit, id: EventId) -> Vec<String> {
        kit.arena.get(id).mf.iter().flatten().cloned().collect()
    }

    #[test]
    fn must_filters_chain_optional_ones_only_tag_and_the_gate_decides() {
        let (mut kit, [a, b, c, d, death]) = flagged_demo();
        let dp = kit.demo.clone();
        let evts: DemoEvents = [(dp.clone(), vec![a, b, c, d, death])].into_iter().collect();
        let run = cfg(json!({"kill_mod_airborne": true, "kill_mod_airborne_req": true, "kill_mod_attacker_blind": true}));
        let out = kit.stage().apply_filters(evts, &run).unwrap();
        assert_eq!(out[&dp], [a, b, death]);
        assert_eq!(mf(&kit, a), ["kill_mod_airborne", "kill_mod_attacker_blind"]);
        assert_eq!(mf(&kit, b), ["kill_mod_airborne"]);
        // C was tagged by the optional filter although the ★ chain left it out.
        assert_eq!(mf(&kit, c), ["kill_mod_attacker_blind"]);
        assert_eq!(gate_events(&kit.arena, &out[&dp], &run), Some(vec![a, death]));
        let (mut kit, [a, b, c, d, death]) = flagged_demo();
        let dp = kit.demo.clone();
        let per_demo = kit.stage().apply_modifiers(&dp, vec![a, b, c, d, death], &run).unwrap();
        assert_eq!(per_demo, Some(vec![a, b, death]));
        assert_eq!(mf(&kit, a), ["kill_mod_airborne", "kill_mod_attacker_blind"]);
        assert_eq!(mf(&kit, b), ["kill_mod_airborne"]);
    }

    #[test]
    fn exclusions_run_first_and_trois_tap_runs_alone() {
        let (mut kit, [a, b, c, d, death]) = flagged_demo();
        let dp = kit.demo.clone();
        let evts: DemoEvents = [(dp.clone(), vec![a, b, c, d, death])].into_iter().collect();
        let out = kit.stage().apply_filters(evts.clone(), &cfg(json!({"kill_mod_airborne_exclude": true}))).unwrap();
        assert_eq!(out[&dp], [c, d, death]);
        assert!(mf(&kit, c).is_empty());
        let out = kit.stage().apply_filters(evts.clone(), &cfg(json!({"kill_mod_trois_tap": true, "kill_mod_airborne": true}))).unwrap();
        // No shot data: no kill is lucky; the airborne filter never ran.
        assert_eq!(out[&dp], [death]);
        assert!(mf(&kit, a).is_empty());
        let both = cfg(json!({"kill_mod_attacker_blind_exclude": true, "kill_mod_airborne_exclude": true}));
        assert_eq!(kit.stage().apply_filters(evts, &both).unwrap()[&dp], [d, death]);
    }

    #[test]
    fn the_pre_parse_reads_existing_files_in_parallel_and_logs_unreadable_ones_in_order() {
        let mut kit = Kit::new();
        let second = Kit::file(&kit.dir, "second.dem");
        let missing = kit.dir.path().join("missing.dem").to_string_lossy().into_owned();
        let paths = vec![kit.demo.clone(), missing.clone(), second.clone()];
        kit.stage().preparse(&Settings::new(), &paths);
        assert!(kit.cache.demos.is_empty());
        let run = cfg(json!({"kill_mod_flick": true, "dp2_threads": 3}));
        kit.stage().preparse(&run, &paths);
        let wanted: Sections = [Section::Death, Section::Names].into();
        assert_eq!(kit.cache.sections(&kit.demo), wanted);
        assert_eq!(kit.cache.sections(&second), wanted);
        assert!(!kit.cache.contains(&missing));
        let warns: Vec<String> = kit.ports.logs.lock().unwrap().iter().filter(|(_, l)| *l == Level::Warn).map(|(m, _)| m.clone()).collect();
        assert_eq!(warns.len(), 2, "{warns:?}");
        assert!(warns[0].contains("demo.dem") && warns[1].contains("second.dem"), "{warns:?}");
        assert_eq!(kit.ports.states.lock().unwrap().len(), 1);
        kit.stage().preparse(&run, &paths);
        let last = kit.ports.logs.lock().unwrap().last().cloned().unwrap();
        assert_eq!(last, ("  ⚡ Pre-parse: all 2 demo(s) already cached — skipping".to_string(), Level::Dim));
    }
}
