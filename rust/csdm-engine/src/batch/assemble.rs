//! The final assembly (3.5 `_assemble_clips`, with the `ca108f3` fix): FFmpeg joins the clips this
//! run wrote, then, if asked, deletes exactly those clips and the folders they leave empty.
//! Clip folders are per demo (or the bare clips root): earlier runs' clips sit beside this run's
//! and are neither assembled nor deleted.

use super::cli_json::{abspath, clips_root, got};
use super::{os_error, strerror};
use crate::event::Level;
use crate::preview::cfg::{on, py_str};
use crate::preview::clips::which;
use crate::preview::Ports;
use crate::process::Exec;
use crate::EngineError;
use csdm_core::batch::{
    ASSEMBLE_OUTPUT_DEFAULT, CLIP_EXTENSIONS, CONCAT_PREFIX, CONCAT_SUFFIX, FAST_START_CONTAINERS, FFMPEG_BITRATE_FLAG, FFMPEG_CODECS, FFMPEG_COMMAND, FFMPEG_FAST_START,
    FFMPEG_FORMATS, FFMPEG_FORMAT_FLAG, FFMPEG_HEAD, FFMPEG_HOME_DIR_PARTS, FFMPEG_HOME_PARTS, FFMPEG_INPUT_FLAG, FFMPEG_RESAMPLE, FFMPEG_SAFE_VALUE, RENAME_CHARS,
    TMP_OUTPUT_HEX, TMP_OUTPUT_PREFIX,
};
use csdm_core::Settings;
use std::collections::hash_map::RandomState;
use std::collections::HashSet;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn under(home: &Path, parts: &[&str]) -> PathBuf {
    parts.iter().fold(home.to_path_buf(), |p, s| p.join(s))
}

/// The files of `dir` ending in `.ext` (any case, as Windows globs), in Windows path order.
fn glob_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let want = format!(".{}", ext.to_lowercase());
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().ends_with(&want)))
        .collect();
    found.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    found
}

/// The clips written since `since` in `produced` (or the output root), each once, in 3.5 order.
fn gather(produced: &[String], out_root: &Path, container: &str, since: SystemTime) -> Vec<PathBuf> {
    let dirs: Vec<PathBuf> = if produced.iter().any(|d| !d.is_empty()) {
        produced.iter().filter(|d| !d.is_empty()).map(PathBuf::from).collect()
    } else {
        vec![out_root.to_path_buf()]
    };
    let mut seen = HashSet::new();
    let mut clips = Vec::new();
    for d in dirs.iter().filter(|d| d.is_dir()) {
        for ext in std::iter::once(container).chain(CLIP_EXTENSIONS) {
            for c in glob_ext(d, ext) {
                let fresh = std::fs::metadata(&c).and_then(|m| m.modified()).is_ok_and(|t| t >= since);
                if seen.insert(c.to_string_lossy().into_owned()) && fresh {
                    clips.push(c);
                }
            }
        }
    }
    clips
}

/// `_csdm_tmp_<8 hex>`: a name FFmpeg's command line cannot misread.
fn tmp_name(ext: &str) -> String {
    let hex = format!("{:016x}", RandomState::new().build_hasher().finish());
    format!("{TMP_OUTPUT_PREFIX}{}{ext}", &hex[..TMP_OUTPUT_HEX])
}

/// 3.5 `_assemble_clips(cfg, produced_dirs, since)`; `home` holds `.csdm\ffmpeg`.
pub fn assemble_clips(ports: &dyn Ports, exec: &mut dyn Exec, cfg: &Settings, produced: &[String], since: SystemTime, home: &Path) -> Result<(), EngineError> {
    let container = py_str(got(cfg, "video_container"));
    let format = FFMPEG_FORMATS.iter().find(|(c, _)| *c == container).map_or(container.as_str(), |(_, f)| f).to_string();
    let local = under(home, &FFMPEG_HOME_PARTS);
    let Some(ffmpeg) = which(FFMPEG_COMMAND).or_else(|| local.exists().then_some(local)) else {
        ports.log(
            &format!("  Assembly skipped: FFmpeg not found (searched PATH and {}). The clips themselves are recorded.", under(home, &FFMPEG_HOME_DIR_PARTS).display()),
            Level::Err,
        );
        return Ok(());
    };
    let base = py_str(got(cfg, "output_dir_assembled")).trim().to_string();
    let out_root = if base.is_empty() || base == "None" { clips_root(cfg) } else { PathBuf::from(abspath(&base)) };
    let clips = gather(produced, &out_root, &container, since);
    if clips.is_empty() {
        ports.log("  Assembly: no clip found.", Level::Warn);
        return Ok(());
    }
    ports.log(&format!("  {} clip(s) to assemble…", clips.len()), Level::Info);

    let name = cfg.get("assemble_output").map(py_str).filter(|s| !s.is_empty() && s != "None").unwrap_or_else(|| ASSEMBLE_OUTPUT_DEFAULT.into());
    let mut out = PathBuf::from(name.trim());
    if !out.is_absolute() {
        out = out_root.join(out);
    }
    if out.extension().is_none_or(|e| e.is_empty()) {
        out = PathBuf::from(format!("{}.{container}", out.display()));
    }
    let out_dir = out.parent().map(Path::to_path_buf).unwrap_or_default();
    std::fs::create_dir_all(&out_dir).map_err(|e| os_error(&out_dir, &e))?;

    let list = write_list(&clips).map_err(|e| os_error(&std::env::temp_dir(), &e))?;
    let rename = out.file_name().is_some_and(|n| n.to_string_lossy().chars().any(|c| RENAME_CHARS.contains(c)));
    let ext = out.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let tmp_out = if rename { out_dir.join(tmp_name(&ext)) } else { out.clone() };

    let mut cmd: Vec<String> = vec![ffmpeg.to_string_lossy().into_owned()];
    cmd.extend(FFMPEG_HEAD.iter().map(|s| s.to_string()));
    cmd.push(FFMPEG_SAFE_VALUE.into());
    cmd.push(FFMPEG_INPUT_FLAG.into());
    cmd.push(list.to_string_lossy().into_owned());
    cmd.extend(FFMPEG_CODECS.iter().map(|s| s.to_string()));
    cmd.push(FFMPEG_BITRATE_FLAG.into());
    cmd.push(format!("{}k", py_str(got(cfg, "audio_bitrate"))));
    cmd.extend(FFMPEG_RESAMPLE.iter().map(|s| s.to_string()));
    if FAST_START_CONTAINERS.contains(&container.as_str()) {
        cmd.extend(FFMPEG_FAST_START.iter().map(|s| s.to_string()));
    }
    cmd.push(FFMPEG_FORMAT_FLAG.into());
    cmd.push(format);
    cmd.push(tmp_out.to_string_lossy().into_owned());

    let res = exec.exec(&cmd, cfg, 0);
    // A list left behind in %TEMP% harms nothing.
    let _ = std::fs::remove_file(&list);
    if !res.success {
        if rename && tmp_out.exists() {
            let _ = std::fs::remove_file(&tmp_out);
        }
        let err = res.errs.first().cloned().unwrap_or_else(|| format!("code {}", res.rc));
        ports.log(&format!("  ✗ Assembly failed: {err}"), Level::Err);
        return Ok(());
    }
    let mut shown = out.clone();
    if rename && tmp_out != out {
        let moved = (if out.exists() { std::fs::remove_file(&out) } else { Ok(()) }).and_then(|()| std::fs::rename(&tmp_out, &out));
        if let Err(e) = moved {
            ports.log(&format!("  ⚠ Assembled but not renamed: {}\n  File: {}", os_error(&out, &e).user_message(), tmp_out.display()), Level::Warn);
            shown = tmp_out;
        }
    }
    ports.log(&format!("  ✓ Assembled: {}", shown.display()), Level::Ok);
    if on(cfg, "delete_after_assemble") {
        delete_assembled(ports, &clips, &clips_root(cfg));
    }
    Ok(())
}

/// The FFmpeg concat list in `%TEMP%`: `file '<path with />'`, `'` escaped.
fn write_list(clips: &[PathBuf]) -> std::io::Result<PathBuf> {
    let mut f = tempfile::Builder::new().prefix(CONCAT_PREFIX).suffix(CONCAT_SUFFIX).tempfile()?;
    for c in clips {
        let safe = c.to_string_lossy().replace('\\', "/").replace('\'', "\\'"); // allow-hardcode: FFmpeg concat list syntax (3.5)
        writeln!(f, "file '{safe}'")?;
    }
    let (_, path) = f.keep().map_err(|e| e.error)?;
    Ok(path)
}

/// Deletes the assembled clips, then each folder they leave empty, upward, never `root` or above
/// it (a recursive delete here once wiped other sessions of the same demo).
fn delete_assembled(ports: &dyn Ports, clips: &[PathBuf], root: &Path) {
    let (mut deleted, mut kept) = (0usize, Vec::new());
    let mut dirs: Vec<PathBuf> = Vec::new();
    for c in clips {
        if let Some(p) = c.parent() {
            if !dirs.iter().any(|d| d == p) {
                dirs.push(p.to_path_buf());
            }
        }
        match std::fs::remove_file(c) {
            Ok(()) => deleted += 1,
            Err(e) => kept.push(format!("{} ({})", c.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), strerror(&e))),
        }
    }
    let root = std::fs::canonicalize(root).ok();
    let mut visited = HashSet::new();
    let mut removed = 0usize;
    for d in dirs {
        let mut next = std::fs::canonicalize(&d).ok();
        while let Some(dir) = next.take() {
            if !visited.insert(dir.clone()) {
                break;
            }
            let Some(root) = root.as_ref() else { break };
            if &dir == root || !dir.starts_with(root) {
                break;
            }
            // Fails on a folder that is not empty, which must stay.
            if std::fs::remove_dir(&dir).is_err() {
                break;
            }
            removed += 1;
            next = dir.parent().map(Path::to_path_buf);
        }
    }
    let mut msg = format!("  🗑 {deleted} clip(s) deleted");
    if removed > 0 {
        msg += &format!(", {removed} folder(s) removed");
    }
    ports.log(&format!("{msg}."), Level::Dim);
    if !kept.is_empty() {
        ports.log(&format!("  ⚠ {} clip(s) could not be deleted: {}", kept.len(), kept.join(", ")), Level::Warn);
    }
}

#[cfg(test)]
mod tests {
    //! 3.5 `tests/test_assemble_delete.py`, all four.
    use super::*;
    use crate::preview::CollectPorts;
    use crate::process::ExecOutcome;
    use serde_json::json;
    use std::time::{Duration, UNIX_EPOCH};

    /// Stands in for FFmpeg: writes the output file.
    struct FakeFfmpeg;
    impl Exec for FakeFfmpeg {
        fn exec(&mut self, cmd: &[String], _cfg: &Settings, _timeout_s: u64) -> ExecOutcome {
            std::fs::write(cmd.last().unwrap(), b"").unwrap();
            ExecOutcome { success: true, ..Default::default() }
        }
    }

    fn touch(p: &Path) -> PathBuf {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"x").unwrap();
        p.to_path_buf()
    }

    fn run(tmp: &Path, produced: &[&Path], since: SystemTime) -> CollectPorts {
        let home = tmp.join("home");
        touch(&under(&home, &FFMPEG_HOME_PARTS));
        let cfg: Settings = json!({
            "output_dir_clips": tmp.join("clips"), "output_dir_assembled": tmp.join("assembled"),
            "delete_after_assemble": true, "video_container": "mp4"
        })
        .as_object()
        .unwrap()
        .clone();
        let ports = CollectPorts::default();
        let produced: Vec<String> = produced.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        assemble_clips(&ports, &mut FakeFfmpeg, &cfg, &produced, since, &home).unwrap();
        ports
    }

    #[test]
    fn other_session_of_same_demo_survives() {
        let t = tempfile::tempdir().unwrap();
        let mine = touch(&t.path().join("clips/demo/sessA/a.mp4"));
        let other = touch(&t.path().join("clips/demo/sessB/b.mp4"));
        run(t.path(), &[mine.parent().unwrap()], UNIX_EPOCH);
        assert!(!mine.exists());
        assert!(other.exists());
        assert!(!mine.parent().unwrap().exists(), "emptied folder is tidied");
        assert!(t.path().join("assembled/assembled.mp4").exists());
    }

    #[test]
    fn non_clip_file_keeps_its_folder() {
        let t = tempfile::tempdir().unwrap();
        let mine = touch(&t.path().join("clips/demo/sessA/a.mp4"));
        let keep = touch(&t.path().join("clips/demo/sessA/notes.json"));
        run(t.path(), &[mine.parent().unwrap()], UNIX_EPOCH);
        assert!(!mine.exists());
        assert!(keep.exists());
    }

    #[test]
    fn empty_folders_removed_up_to_but_not_including_root() {
        let t = tempfile::tempdir().unwrap();
        let mine = touch(&t.path().join("clips/demo/sessA/a.mp4"));
        run(t.path(), &[mine.parent().unwrap()], UNIX_EPOCH);
        assert!(!t.path().join("clips/demo").exists());
        assert!(t.path().join("clips").is_dir());
    }

    #[test]
    fn clips_from_earlier_runs_are_neither_assembled_nor_deleted() {
        let t = tempfile::tempdir().unwrap();
        let old = touch(&t.path().join("clips/demo/old.mp4"));
        std::fs::File::options().write(true).open(&old).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(1_000_000)).unwrap();
        let mine = touch(&t.path().join("clips/demo/new.mp4"));
        let ports = run(t.path(), &[mine.parent().unwrap()], UNIX_EPOCH + Duration::from_secs(2_000_000));
        assert!(!mine.exists());
        assert!(old.exists());
        assert!(ports.logs.lock().unwrap().iter().any(|(m, _)| m.contains("1 clip(s) to assemble")));
    }

    #[test]
    fn a_name_ffmpeg_would_misread_goes_through_a_temporary_name() {
        let t = tempfile::tempdir().unwrap();
        let mine = touch(&t.path().join("clips/demo/a.mp4"));
        let home = t.path().join("home");
        touch(&under(&home, &FFMPEG_HOME_PARTS));
        let cfg: Settings = json!({"output_dir_clips": t.path().join("clips"), "assemble_output": "best #1", "video_container": "mkv"}).as_object().unwrap().clone();
        let ports = CollectPorts::default();
        assemble_clips(&ports, &mut FakeFfmpeg, &cfg, &[mine.parent().unwrap().to_string_lossy().into_owned()], UNIX_EPOCH, &home).unwrap();
        assert!(t.path().join("clips/best #1.mkv").exists());
        assert!(mine.exists(), "nothing deleted unless asked");
    }
}
