//! Constants local to clips, cameras, summary and export of the preview.

/// `build_camera_ticks`: a camera point `tickrate // 8` ticks after each event.
pub const CAMERA_POST_TICK_DIVISOR: i64 = 8;

/// `_hms`.
pub const SECONDS_PER_MINUTE: i64 = 60;
pub const SECONDS_PER_HOUR: i64 = 3600;

/// `preview_export` meta `generated` (3.5 `time.strftime`).
pub const EXPORT_GENERATED_FORMAT: &str = "%Y-%m-%d %H:%M:%S";
/// `_render_txt`: the line after each row starts with this many spaces more than the date column.
pub const TXT_COMMAND_INDENT: usize = 2;

/// `_demo_picker_fmt_name`: a longer file name keeps its last characters after an ellipsis.
pub const PICKER_NAME_MAX_CHARS: usize = 44;
pub const PICKER_NAME_TAIL_CHARS: usize = 43;
pub const PICKER_NAME_ELLIPSIS: &str = "…";
/// `_demo_picker_fmt_date`.
pub const PICKER_DATE_FORMAT: &str = "%d-%m-%Y %H:%M";
pub const PICKER_UNKNOWN_DATE: &str = "??-??-???? ??:??";
/// `_CS2_DEMO_BREAKS` cutoffs (`data/preview.json`) are dates in this form.
pub const DEMO_BREAK_CUTOFF_FORMAT: &str = "%Y-%m-%d";


/// `describe_filters` `default_paths` (3.5 `csdm/config.py`): where the CS Demo Manager installer
/// puts its command-line entry point under %LOCALAPPDATA%, most likely first.
pub const CSDM_CLI_INSTALL_PATHS: [[&str; 3]; 2] = [["Programs", "cs-demo-manager", "csdm.CMD"], ["Programs", "cs-demo-manager", "csdm.exe"]];
/// The command `shutil.which` looks for when no install path holds the CLI.
pub const CSDM_CLI_COMMAND: &str = "csdm";
/// %LOCALAPPDATA% when the variable is unset: under the home folder.
pub const LOCAL_APP_DATA_UNDER_HOME: [&str; 2] = ["AppData", "Local"];
/// The raw clips folder used when `output_dir_clips` is empty: `<home>/Videos/<this>`.
pub const VIDEOS_DIR: &str = "Videos";
pub const DEFAULT_CLIPS_SUBDIR: &str = "CSDM Batch Clips";
/// Home folder and command search variables (Python `Path.home()`, `shutil.which`).
pub const HOME_ENV: &str = "USERPROFILE";
pub const PATH_ENV: &str = "PATH";
pub const PATHEXT_ENV: &str = "PATHEXT";
/// `PATHEXT` when unset (Python `shutil.which` default).
pub const PATHEXT_DEFAULT: &str = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC";
/// The preset category that saves every key, first in the preset checkbox list.
pub const PRESET_FULL_CATEGORY: &str = "full";
