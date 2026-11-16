//! Recording one demo (3.5 `_run_batch`, inside the demo loop): the job file, the timeout, the
//! attempts with their retry delay, the TrueView fallback, and the pauses STOP cuts short.

use super::cli_json::got;
use crate::event::Level;
use crate::preview::cfg::cfg_int;
use crate::preview::clips::Sequence;
use crate::preview::Ports;
use crate::process::{Exec, ExecOutcome};
use crate::run::RunControl;
use csdm_core::batch::{JOB_FILE_DELETE_AFTER_S, JOB_FILE_PREFIX, JOB_FILE_SUFFIX, PAUSE_STEP_MS, PERCENT, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, SLOW_MOTION_NEUTRAL, TIMESCALE_MIN, TIMESCALE_SHOWN_BELOW};
use csdm_core::settings::def;
use csdm_core::Settings;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 3.5 `_batch_pacing`: whole, non-negative numbers, read from text boxes ("3", "2.5").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pacing {
    pub retry_count: i64,
    pub retry_delay: i64,
    pub delay_between_demos: i64,
    pub recording_timeout: i64,
}

fn table_i64(key: &str) -> i64 {
    def(key).and_then(|d| d.default.as_i64()).unwrap_or_else(|| panic!("`{key}` has a whole default"))
}

pub fn batch_pacing(ports: &dyn Ports, cfg: &Settings) -> Pacing {
    let read = |key: &str| cfg_int(ports, cfg, key, table_i64(key), Some(0), None);
    Pacing { retry_count: read("retry_count"), retry_delay: read("retry_delay"), delay_between_demos: read("delay_between_demos"), recording_timeout: read("recording_timeout") }
}

/// 3.5 `_auto_recording_timeout_s`: `max(int(content × factor), floor)`.
pub fn auto_timeout_s(ports: &dyn Ports, cfg: &Settings, content_s: f64) -> i64 {
    let factor_key = "recording_timeout_auto_factor";
    let factor_default = def(factor_key).and_then(|d| d.default.as_f64()).expect("the auto factor has a number default");
    let factor = crate::preview::cfg::cfg_float(ports, cfg, factor_key, factor_default, Some(1.0), None);
    let floor = cfg_int(ports, cfg, "recording_timeout_auto_floor_s", table_i64("recording_timeout_auto_floor_s"), Some(1), None);
    ((content_s * factor) as i64).max(floor)
}

/// 3.5 `fmt_duration`: "m:ss", or "h:mm:ss" from an hour.
pub fn fmt_duration(seconds: f64) -> String {
    let s = seconds as u64;
    if s < SECONDS_PER_HOUR {
        format!("{}:{:02}", s / SECONDS_PER_MINUTE, s % SECONDS_PER_MINUTE)
    } else {
        format!("{}:{:02}:{:02}", s / SECONDS_PER_HOUR, (s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE, s % SECONDS_PER_MINUTE)
    }
}

/// Sleeps `seconds` one second at a time while `go_on` holds (3.5 `for _ in range(n): … sleep(1)`).
pub fn pause(seconds: i64, go_on: &dyn Fn() -> bool) {
    for _ in 0..seconds.max(0) {
        if !go_on() {
            break;
        }
        std::thread::sleep(Duration::from_millis(PAUSE_STEP_MS));
    }
}

/// The recording timeout of one demo and the line that says it: `max(user × 60, auto)` when the
/// user set one, else auto; auto from the clips' game time divided by the slow motion.
pub fn recording_timeout(ports: &dyn Ports, cfg: &Settings, seqs: &[Sequence], pacing: Pacing) -> u64 {
    let user = pacing.recording_timeout * SECONDS_PER_MINUTE as i64;
    let tickrate = got(cfg, "tickrate").as_f64().filter(|t| *t != 0.0).unwrap_or_else(|| table_i64("tickrate") as f64);
    // 3.5 `(cfg.get("hlae_slow_motion", 100) or 100) / 100`, raw: not clamped like the injection.
    let raw_slow = got(cfg, "hlae_slow_motion").as_f64().filter(|s| *s != 0.0).unwrap_or(SLOW_MOTION_NEUTRAL as f64);
    let timescale = (raw_slow / PERCENT).max(TIMESCALE_MIN);
    let content: f64 = seqs.iter().map(|s| (s.end_tick - s.start_tick) as f64 / tickrate).sum();
    let auto = auto_timeout_s(ports, cfg, content / timescale);
    let timeout = if user > 0 { user.max(auto) } else { auto };
    let slow_part = if timescale < TIMESCALE_SHOWN_BELOW { format!(", slow {}%", (timescale * PERCENT) as i64) } else { String::new() };
    let t = timeout as u64;
    ports.log_parts(&[
        ("  ⏱ Timeout: ".into(), Level::Dim),
        (format!("{}m{:02}s", t / SECONDS_PER_MINUTE, t % SECONDS_PER_MINUTE), Level::Info),
        ("  (content ".into(), Level::Dim),
        (format!("{content:.0}s"), Level::Ok),
        (", ".into(), Level::Dim),
        // 3.5 "blue": the console's accent colour, which Info draws.
        (format!("{} seq", seqs.len()), Level::Info),
        (format!("{slow_part})"), Level::Dim),
    ]);
    t
}

/// Writes the job file (`%TEMP%\csdm_*.json`, kept until the deletion that follows the demo).
pub fn write_job_file(job: &Value) -> std::io::Result<PathBuf> {
    let file = tempfile::Builder::new().prefix(JOB_FILE_PREFIX).suffix(JOB_FILE_SUFFIX).tempfile()?;
    let (_, path) = file.keep().map_err(|e| e.error)?;
    std::fs::write(&path, serde_json::to_string_pretty(job).expect("a JSON value serialises"))?;
    Ok(path)
}

/// Deletes the job file `after` from now, on its own thread (3.5: ten seconds later).
pub fn delete_later(path: PathBuf, after: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(after);
        // Already gone is fine; anything else changes nothing for the run.
        let _ = std::fs::remove_file(path);
    });
}

pub fn job_file_delay() -> Duration {
    Duration::from_secs(JOB_FILE_DELETE_AFTER_S)
}

/// How one demo's recording ended.
#[derive(Debug, Clone, PartialEq)]
pub struct Recorded {
    pub ok: bool,
    pub error: String,
    pub attempts: i64,
    /// Attempts after the first (3.5 `retried`).
    pub retried: i64,
    pub seconds: f64,
}

/// The attempts of one demo (3.5 attempt loop + TrueView fallback). `cmd` ends with the job file.
pub fn record(ports: &dyn Ports, control: &RunControl, exec: &mut dyn Exec, cfg: &Settings, cmd: &[String], pacing: Pacing, timeout_s: u64) -> Recorded {
    let job_file = Path::new(cmd.last().map_or("", String::as_str));
    let max = 1 + pacing.retry_count;
    let (mut att, mut ok, mut error, mut retried) = (0i64, false, String::new(), 0i64);
    let mut last = ExecOutcome::default();
    let t0 = Instant::now();
    while att < max {
        // 3.5 checked this only after the first attempt: a STOP that came while the demo was being
        // prepared still started it. Checked before every attempt here.
        if control.stop_requested() {
            break;
        }
        att += 1;
        if att > 1 {
            retried += 1;
            ports.log(&format!("  ↻ Retry {} — {}s...", att - 1, pacing.retry_delay), Level::Warn);
            pause(pacing.retry_delay, &|| control.running());
            if !control.running() {
                break;
            }
        }
        last = exec.exec(cmd, cfg, timeout_s);
        if last.success {
            ok = true;
            break;
        }
        error = last.errs.first().cloned().unwrap_or_else(|| format!("code {}", last.rc));
        if last.retryable && att < max {
            continue;
        }
        break;
    }
    // 3.5 `cfg.get("true_view", True)`.
    let true_view = cfg.get("true_view").is_none_or(csdm_core::migrate::truthy);
    if !ok && true_view && last.raw_not_found {
        ports.log("  ⚠ TrueView: raw files not found (old demo?) — retrying with TrueView OFF…", Level::Warn);
        match turn_true_view_off(job_file) {
            Ok(()) => {
                let tv = exec.exec(cmd, cfg, 0);
                if tv.success {
                    ok = true;
                    error.clear();
                    ports.log("  ✓ TrueView-OFF retry succeeded", Level::Ok);
                } else if let Some(e) = tv.errs.first() {
                    error = e.clone();
                }
            }
            Err(e) => ports.log(&format!("  ⚠ TrueView-OFF retry: {}", super::os_error(job_file, &e).user_message()), Level::Warn),
        }
    }
    Recorded { ok, error, attempts: att, retried, seconds: t0.elapsed().as_secs_f64() }
}

/// Rewrites the job file with `trueView` false (3.5 reloads, edits and dumps it).
fn turn_true_view_off(path: &Path) -> std::io::Result<()> {
    let mut job: Value = serde_json::from_slice(&std::fs::read(path)?).map_err(std::io::Error::other)?;
    job["trueView"] = Value::Bool(false);
    std::fs::write(path, serde_json::to_string_pretty(&job).expect("a JSON value serialises"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::{CollectPorts, NoPorts};
    use serde_json::json;

    fn cfg(v: Value) -> Settings {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn pacing_reads_typed_text_as_whole_numbers() {
        // test_batch_pacing.py
        let got = batch_pacing(&NoPorts, &cfg(json!({"retry_count": "3", "retry_delay": "20", "delay_between_demos": "2.5", "recording_timeout": " 4 "})));
        assert_eq!(got, Pacing { retry_count: 3, retry_delay: 20, delay_between_demos: 2, recording_timeout: 4 });
        let bad = batch_pacing(&NoPorts, &cfg(json!({"retry_count": -2, "retry_delay": "abc", "delay_between_demos": ""})));
        assert_eq!(bad.retry_count, 0);
        assert_eq!(bad.retry_delay, table_i64("retry_delay"));
        assert_eq!(bad.delay_between_demos, table_i64("delay_between_demos"));
        assert_eq!(bad.recording_timeout, table_i64("recording_timeout"));
    }

    #[test]
    fn auto_timeout_follows_its_settings() {
        assert_eq!(auto_timeout_s(&NoPorts, &Settings::new(), 100.0), 300);
        assert_eq!(auto_timeout_s(&NoPorts, &Settings::new(), 5.0), 60);
        let c = cfg(json!({"recording_timeout_auto_factor": 2, "recording_timeout_auto_floor_s": 30}));
        assert_eq!(auto_timeout_s(&NoPorts, &c, 100.0), 200);
        assert_eq!(auto_timeout_s(&NoPorts, &c, 5.0), 30);
    }

    #[test]
    fn the_timeout_takes_the_larger_of_user_and_auto_and_counts_slow_motion() {
        let seqs = [Sequence { start_tick: 0, end_tick: 64 * 50, ..Default::default() }];
        let ports = CollectPorts::default();
        let p = Pacing { retry_count: 0, retry_delay: 0, delay_between_demos: 0, recording_timeout: 0 };
        assert_eq!(recording_timeout(&ports, &cfg(json!({"tickrate": 64, "hlae_slow_motion": 50})), &seqs, p), 300); // 50 s / 0.5 × 3
        assert_eq!(recording_timeout(&NoPorts, &cfg(json!({"tickrate": 64})), &seqs, Pacing { recording_timeout: 4, ..p }), 240);
        assert_eq!(recording_timeout(&NoPorts, &cfg(json!({"tickrate": 64})), &seqs, Pacing { recording_timeout: 1, ..p }), 150);
        assert_eq!(fmt_duration(59.9), "0:59");
        assert_eq!(fmt_duration(3725.0), "1:02:05");
    }
}
