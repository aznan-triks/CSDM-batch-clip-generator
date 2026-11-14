//! Rotating error journal next to the settings (3.5 `errors.py`, `RotatingFileHandler`):
//! full detail of unexpected errors, secrets scrubbed, one previous file kept.

use crate::error::EngineError;
use crate::event::Secrets;
use csdm_core::values::{ERROR_LOG_BACKUPS, ERROR_LOG_FILE, ERROR_LOG_MAX_BYTES};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Journal {
    path: PathBuf,
    max_bytes: u64,
    backups: u32,
    secrets: Secrets,
    lock: Mutex<()>,
}

impl Journal {
    /// The journal of a settings folder, with 3.5's size and backup count.
    pub fn in_dir(dir: &Path, secrets: Secrets) -> Self {
        Self::new(dir.join(ERROR_LOG_FILE), ERROR_LOG_MAX_BYTES, ERROR_LOG_BACKUPS, secrets)
    }

    pub fn new(path: PathBuf, max_bytes: u64, backups: u32, secrets: Secrets) -> Self {
        Self { path, max_bytes, backups, secrets, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Appends one timestamped line, rotating first when it would pass the size limit.
    pub fn write(&self, message: &str) -> Result<(), EngineError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let line = format!("{} {}\n", utc_now(), self.secrets.scrub(message));
        let err = |e: std::io::Error| EngineError::Journal { path: self.path.clone(), reason: e.to_string() };
        let size = fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        if size > 0 && size + line.len() as u64 >= self.max_bytes {
            self.rotate().map_err(err)?;
        }
        let mut f = OpenOptions::new().create(true).append(true).open(&self.path).map_err(err)?;
        f.write_all(line.as_bytes()).map_err(err)
    }

    fn backup(&self, n: u32) -> PathBuf {
        let mut name = self.path.as_os_str().to_owned();
        name.push(format!(".{n}"));
        PathBuf::from(name)
    }

    /// `log` → `log.1` → … → `log.<backups>`; the oldest is dropped.
    fn rotate(&self) -> std::io::Result<()> {
        if self.backups == 0 {
            return fs::write(&self.path, b"");
        }
        for n in (1..self.backups).rev() {
            if self.backup(n).exists() {
                fs::rename(self.backup(n), self.backup(n + 1))?;
            }
        }
        fs::rename(&self.path, self.backup(1))
    }
}

pub(crate) const SECS_PER_DAY: u64 = 86_400;
pub(crate) const SECS_PER_HOUR: u64 = 3_600;
pub(crate) const SECS_PER_MINUTE: u64 = 60;

/// `YYYY-MM-DD HH:MM:SSZ` in UTC, without a date crate.
fn utc_now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / SECS_PER_DAY) as i64);
    let t = secs % SECS_PER_DAY;
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", t / SECS_PER_HOUR, t % SECS_PER_HOUR / SECS_PER_MINUTE, t % SECS_PER_MINUTE)
}

/// Days since 1970-01-01 → (year, month, day), H. Hinnant's algorithm.
pub(crate) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468; // allow-hardcode: epoch shift of the published algorithm
    let era = z.div_euclid(146_097); // allow-hardcode: days per 400-year era
    let doe = z.rem_euclid(146_097); // allow-hardcode: days per 400-year era
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // allow-hardcode: calendar constants
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // allow-hardcode: calendar constants
    let mp = (5 * doy + 2) / 153; // allow-hardcode: month table of the algorithm
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // allow-hardcode: month table of the algorithm
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // allow-hardcode: March-based months
    (yoe + era * 400 + i64::from(m <= 2), m, d) // allow-hardcode: years per era
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_771), (2026, 11, 14));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn secrets_never_reach_the_file_and_files_rotate() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Secrets::default();
        secrets.add("pw-journal-secret");
        let j = Journal::new(dir.path().join("e.log"), 120, 1, secrets);
        for i in 0..6 {
            j.write(&format!("line {i} password=pw-journal-secret")).unwrap();
        }
        let now = fs::read_to_string(j.path()).unwrap();
        let old = fs::read_to_string(j.backup(1)).unwrap();
        assert!(!now.contains("pw-journal-secret") && !old.contains("pw-journal-secret"));
        assert!(now.contains("line 5") && !now.contains("line 0"), "rotated: {now}");
        assert!(fs::metadata(j.path()).unwrap().len() < 120);
        assert!(!j.backup(2).exists(), "only one backup is kept");
    }

    #[test]
    fn unwritable_journal_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let j = Journal::new(dir.path().join("missing").join("e.log"), 100, 1, Secrets::default());
        assert!(matches!(j.write("x"), Err(EngineError::Journal { .. })));
    }
}
