//! Fixed values shared by the crates (HC.1): file names, folder names, limits.
//! User-tunable values are settings (`settings.json`), not constants here.

/// Settings folder name, under the app root, %LOCALAPPDATA% or a chosen parent (3.5 `CONFIG_SUBDIR`).
pub const CONFIG_SUBDIR: &str = "CSDM-batch-clip_config";
/// Pre-3.1.1 folder name, read when the new one has no settings (3.5 `LEGACY_CONFIG_SUBDIR`).
pub const LEGACY_CONFIG_SUBDIR: &str = "CSDM Batch Clip Generator";
pub const CONFIG_FILE: &str = "csdm_config.json";
pub const PRESETS_FILE: &str = "csdm_presets.json";
pub const PLAYERS_FILE: &str = "csdm_players.json";
pub const ASM_NAMES_FILE: &str = "csdm_asm_names.json";
/// The four JSON files that hold every 3.5 user state (research/05).
pub const CONFIG_FILES: [&str; 4] = [CONFIG_FILE, PRESETS_FILE, PLAYERS_FILE, ASM_NAMES_FILE];
/// Folder (relative to an app root) whose presence marks a 3.5 install.
pub const LEGACY_ENGINE_MARKER: [&str; 2] = ["csdm", "bridge"];
/// How many parent folders above the exe are searched for an app root (3.5 `main.js`: 6).
pub const ROOT_SEARCH_DEPTH: usize = 6;
/// `config_dir` values with a meaning of their own.
pub const CONFIG_DIR_DEFAULT: &str = "";
pub const CONFIG_DIR_APPDATA: &str = "appdata";

/// Environment variable naming a throwaway profile root: tests and scripted
/// launches never touch the real settings (3.5 `CSDM_PROFILE_ROOT`).
pub const PROFILE_ROOT_ENV: &str = "CSDM_PROFILE_ROOT";
pub const LOCAL_APP_DATA_ENV: &str = "LOCALAPPDATA";

/// Unexpected-error journal, next to the settings (3.5 `ERROR_LOG`).
pub const ERROR_LOG_FILE: &str = "csdm_errors.log";
pub const ERROR_LOG_MAX_BYTES: u64 = 1_000_000;
pub const ERROR_LOG_BACKUPS: u32 = 1;

/// Keys whose value is a secret: never in an event, a log line or a preset.
pub const SECRET_KEYS: [&str; 3] = ["pass", "pg_pass", "password"];
pub const SECRET_MASK: &str = "***";
/// What a state payload's `cfg` may carry to the UI (3.5 `PREVIEW_CFG_KEYS`).
pub const PREVIEW_CFG_KEYS: [&str; 2] = ["tickrate", "player_name"];

/// `dp2_threads` default: the CPU count clamped to this range, 4 when unknown (3.5 `DEFAULT_CONFIG`).
pub const DP2_THREADS_MIN: usize = 2;
pub const DP2_THREADS_MAX: usize = 8;
pub const DP2_THREADS_UNKNOWN_CPU: usize = 4;
/// Settings folder name, under the app root, %LOCALAPPDATA% or a chosen parent (3.5 `CONFIG_SUBDIR`, shared per D-0016).
pub const V5_CONFIG_SUBDIR: &str = CONFIG_SUBDIR;
/// One-time automatic backup folder created inside `CONFIG_SUBDIR` before v5's first write (D-0016).
pub const PRE_V5_BACKUP_DIR: &str = "backup-pre-v5";
/// Prefix of the folder that keeps the files a settings-folder switch overwrote (3.5 `backup-<stamp>`).
pub const CONFIG_BACKUP_PREFIX: &str = "backup-";
