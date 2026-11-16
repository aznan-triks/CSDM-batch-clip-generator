//! Fixed values of the batch run (T4): what 3.5 wrote as literals in `core.py`, `errors.py`,
//! `static_data.py` and `core_utils.py` for the recording loop, the CS Demo Manager CLI, CS2
//! injection, the CS2 window watcher, process control and assembly. Settings with a key live in
//! the settings table; these have none (the parity test refuses keys 3.5 does not have).

// ── CLI output (3.5 `EngineMixin.RETRYABLE` / `FATAL` / `ALL_ERR`, matched without case) ──────
pub const RETRYABLE: [&str; 4] = ["game error", "game crashed", "process exited", "timed out"];
pub const FATAL: [&str; 10] = [
    "is not iterable", "ENOENT", "Cannot find", "not found", "TypeError", "ReferenceError", "SyntaxError", "FATAL", "Unhandled",
    "Cannot read properties",
];
/// "error:" with its colon: "no errors found" is not an error.
pub const ERROR_MARKS: [&str; 2] = ["error:", "Error:"];
/// TrueView cannot work on this demo: the run retries once with TrueView off.
pub const RAW_FILES_NOT_FOUND: &str = "raw files not found";

/// Where the user fixes each kind of problem (3.5 `errors.WHERE`).
pub const WHERE_PATHS: &str = "SETTINGS › Paths";
pub const WHERE_RECSYS: &str = "VIDEO › Recording System";

/// 3.5 `_CSDM_CLI_RULES`: (every fragment the lower-cased line must contain, the sentence shown).
/// First match wins: the specific rows come first.
pub const CSDM_CLI_RULES: [(&[&str], &str); 13] = [
    (&["hlae", "not installed"], NO_HLAE),
    (&["hlae", "not found"], NO_HLAE),
    (&["hlae", "invalid"], "The HLAE executable CS Demo Manager uses is invalid. Reinstall HLAE or fix its path in CS Demo Manager's own Settings › Video, or switch VIDEO › Recording System to CS."),
    (&["ffmpeg", "not installed"], NO_FFMPEG),
    (&["ffmpeg", "not found"], NO_FFMPEG),
    (&["ffmpeg", "invalid"], "The FFmpeg executable CS Demo Manager uses is invalid. Reinstall FFmpeg or fix its path in CS Demo Manager's own Settings › Video."),
    (&["virtualdub", "not installed"], "CS Demo Manager cannot find VirtualDub. Install it from CS Demo Manager's own Settings › Video."),
    (&["counter-strike executable not found"], "CS Demo Manager cannot find CS2. Check that CS2 is installed through Steam, or fix the custom game path in CS Demo Manager's own Settings › Playback."),
    (&["steam is not running"], "Steam is not running. Start Steam, sign in, then run again."),
    (&["make sure steam is running"], "CS2 could not start. Start Steam, sign in, then run again."),
    (&["counter-strike is already running"], "CS2 is already running. Close it, then run again."),
    (&["match not found in the database"], "CS Demo Manager has not analyzed this demo. Analyze it in CS Demo Manager, then run again."),
    (&["database schema is outdated"], "CS Demo Manager's database is out of date. Open CS Demo Manager once so it updates the database, then run again."),
];
const NO_HLAE: &str = "CS Demo Manager cannot find HLAE. Install HLAE from CS Demo Manager's own Settings › Video, or switch VIDEO › Recording System to CS to record without it.";
const NO_FFMPEG: &str = "CS Demo Manager cannot find FFmpeg. Install it from CS Demo Manager's own Settings › Video.";

// ── The CLI command and its job file ───────────────────────────────────────────────────────────
pub const CLI_VIDEO_ARGS: [&str; 2] = ["video", "--config-file"];
/// 3.5 `_resolve_cli`: names accepted as the CLI itself, then searched in a chosen folder and its `resources`.
pub const CLI_FILE_NAMES: [&str; 2] = ["csdm.exe", "csdm.cmd"];
pub const CLI_SEARCH_NAMES: [&str; 3] = ["csdm.CMD", "csdm.cmd", "csdm.exe"];
pub const CLI_RESOURCES_DIR: &str = "resources";
/// `%TEMP%\csdm_*.json`, deleted this long after its last use (3.5 thread `time.sleep(10)`).
pub const JOB_FILE_PREFIX: &str = "csdm_";
pub const JOB_FILE_SUFFIX: &str = ".json";
pub const JOB_FILE_DELETE_AFTER_S: u64 = 10;
/// `recordingOutput` of the job file: CS Demo Manager records a video.
pub const RECORDING_OUTPUT: &str = "video";
/// 3.5 `_normalize_recsys`: anything but "CS" records with HLAE.
pub const RECSYS_CS: &str = "CS";
pub const RECSYS_HLAE: &str = "HLAE";

// ── Batch pacing (3.5 `_run_batch`) ────────────────────────────────────────────────────────────
/// Slow motion below this share of real time still counts (`max(0.05, slow / 100)`).
pub const TIMESCALE_MIN: f64 = 0.05;
/// The timeout line names the slow motion below this share.
pub const TIMESCALE_SHOWN_BELOW: f64 = 0.99;
pub const PERCENT: f64 = 100.0;
pub const SECONDS_PER_MINUTE: u64 = 60;
/// Pauses and retry delays tick by one second, so STOP cuts them short.
pub const PAUSE_STEP_MS: u64 = 1000;
pub const BANNER_WIDTH: usize = 60;
/// Per-demo timings shown only above these (seconds), and in milliseconds.
pub const DP2_TIME_SHOWN_ABOVE_S: f64 = 0.01;
pub const SEQ_TIME_SHOWN_ABOVE_S: f64 = 0.001;
pub const MS_PER_SECOND: f64 = 1000.0;
pub const RULE_WIDTH: usize = 56;
/// `fmt_duration`: minutes:seconds below an hour.
pub const SECONDS_PER_HOUR: u64 = 3600;
/// Already-tagged demos named in the question before "…".
pub const TAGGED_NAMES_SHOWN: usize = 5;
/// `progress_bar` width (blocks) and glyphs.
pub const PROGRESS_WIDTH: usize = 12;
/// HLAE `extraArgs` shown in the console up to this many characters.
pub const HLAE_ARGS_SHOWN: usize = 60;
/// `ensure_csdm_dirs`: `<home>/.csdm/{,virtualdub,hlae,ffmpeg}`.
pub const CSDM_HOME_DIR: &str = ".csdm";
pub const CSDM_HOME_SUBDIRS: [&str; 4] = ["", "virtualdub", "hlae", "ffmpeg"];
/// `safe_folder_name`: characters Windows refuses in a folder name, and the longest name kept.
pub const FOLDER_NAME_FORBIDDEN: &str = "<>:\"/\\|?*";
pub const FOLDER_NAME_MAX_CHARS: usize = 100;

// ── CS2 injection (3.5 `_common_cs2_injection`, `_inject_hlae_extra_args`, `_inject_cs_runtime_cfg`) ──
pub const WINDOW_MODE_ARGS: [(&str, &str); 3] = [("fullscreen", "-fullscreen"), ("windowed", "-windowed"), ("noborder", "-windowed -noborder")];
pub const RAGDOLL_GRAVITY_RANGE: (i64, i64) = (-5000, 5000);
pub const RAGDOLL_SCALE_RANGE: (f64, f64) = (-10.0, 10.0);
pub const SV_GRAVITY_RANGE: (i64, i64) = (-5000, 5000);
pub const SLOW_MOTION_RANGE: (i64, i64) = (1, 1000);
pub const FOV_RANGE: (i64, i64) = (1, 179);
/// Neutral values: nothing is injected for them.
pub const SLOW_MOTION_NEUTRAL: i64 = 100;
pub const FOV_NEUTRAL: i64 = 90;
/// `round(slow / 100, 4)`.
pub const TIMESCALE_DECIMALS: i32 = 4;
pub const RUNTIME_CFG_NAME: &str = "csdm_batch_runtime.cfg";
pub const RUNTIME_BLOCK_START: &str = "// >>> CSDM_BATCH_RUNTIME START >>>";
pub const RUNTIME_BLOCK_END: &str = "// <<< CSDM_BATCH_RUNTIME END <<<";
pub const AUTOEXEC_NAME: &str = "autoexec.cfg";
/// `_resolve_cs2_cfg_dir`: Steam under `%ProgramFiles(x86)%` (or its usual path), then these roots.
pub const PROGRAM_FILES_X86_ENV: &str = "ProgramFiles(x86)";
pub const PROGRAM_FILES_X86_DEFAULT: &str = r"C:\Program Files (x86)";
pub const STEAM_DIR: &str = "Steam";
pub const STEAM_ROOTS: [&str; 4] = [r"C:\Steam", r"D:\Steam", r"E:\Steam", r"F:\Steam"];
pub const CS2_CFG_PARTS: [&str; 6] = ["steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"];
pub const LIBRARY_VDF_PARTS: [&str; 2] = ["steamapps", "libraryfolders.vdf"];
pub const LIBRARY_VDF_PATH_KEY: &str = "\"path\"";

// ── Processes ──────────────────────────────────────────────────────────────────────────────────
/// The CS2 window watcher (3.5 `_start_cs2_send_to_back_watcher`): wait this long for CS2, then
/// push it behind every other window at this pace while the CLI runs.
pub const SEND_TO_BACK_WAIT_MS: u64 = 120_000;
pub const SEND_TO_BACK_POLL_MS: u64 = 500;
/// A window belongs to CS2 when its program's file name contains this (else by title).
pub const CS2_EXE_MARK: &str = "cs2";
pub const CS2_WINDOW_TITLES: [&str; 2] = ["counter-strike 2", "cs2"];
/// Longest program path read for a window (`QueryFullProcessImageNameW` buffer, characters).
pub const IMAGE_NAME_CHARS: usize = 512;
/// How often the run checks the CLI while reading its output.
pub const EXEC_POLL_MS: u64 = 100;
/// Exit code given to every process of the tree when the run stops it.
pub const STOPPED_EXIT_CODE: u32 = 1;

// ── Assembly (3.5 `_assemble_clips`) ───────────────────────────────────────────────────────────
pub const FFMPEG_COMMAND: &str = "ffmpeg";
pub const FFMPEG_HOME_PARTS: [&str; 3] = [".csdm", "ffmpeg", "ffmpeg.exe"];
pub const FFMPEG_HOME_DIR_PARTS: [&str; 2] = [".csdm", "ffmpeg"];
/// Container → FFmpeg `-f` name; any other container is passed as is.
pub const FFMPEG_FORMATS: [(&str, &str); 5] = [("mkv", "matroska"), ("mp4", "mp4"), ("avi", "avi"), ("mov", "mov"), ("webm", "webm")];
/// Clip files gathered besides the chosen container, in this order.
pub const CLIP_EXTENSIONS: [&str; 4] = ["mp4", "avi", "mkv", "mov"];
/// `-movflags +faststart` only for these containers.
pub const FAST_START_CONTAINERS: [&str; 2] = ["mp4", "mov"];
pub const CONCAT_PREFIX: &str = "csdm_concat_";
pub const CONCAT_SUFFIX: &str = ".txt";
/// An output name holding one of these goes through a temporary name, then is renamed.
pub const RENAME_CHARS: &str = "#%?*";
pub const TMP_OUTPUT_PREFIX: &str = "_csdm_tmp_";
pub const TMP_OUTPUT_HEX: usize = 8;
pub const ASSEMBLE_OUTPUT_DEFAULT: &str = "assembled.mp4";
/// The FFmpeg command around the list, the bitrate and the output (3.5 order).
pub const FFMPEG_HEAD: [&str; 6] = ["-y", "-fflags", "+genpts", "-f", "concat", "-safe"];
pub const FFMPEG_SAFE_VALUE: &str = "0";
pub const FFMPEG_INPUT_FLAG: &str = "-i";
pub const FFMPEG_CODECS: [&str; 4] = ["-c:v", "copy", "-c:a", "aac"];
pub const FFMPEG_BITRATE_FLAG: &str = "-b:a";
pub const FFMPEG_RESAMPLE: [&str; 2] = ["-af", "aresample=async=1000"];
pub const FFMPEG_FAST_START: [&str; 2] = ["-movflags", "+faststart"];
pub const FFMPEG_FORMAT_FLAG: &str = "-f";
