/**
 * The parity ledger (D20 / R1).
 *
 * Two lists, two very different meanings:
 *
 *  - NO_CONTROL_BY_DESIGN: keys the Tkinter application itself never put on
 *    screen. Each carries the reason, taken from docs/INVENTAIRE_REGLAGES.md.
 *    This list is stable; it shrinks only if a key is deleted outright.
 *
 *  - NOT_YET_PORTED: keys that DO have a control in Tkinter and do not have
 *    one here yet. This list is temporary and MUST shrink at every chantier.
 *    A key removed from it can never come back: that would be a regression
 *    dressed up as bookkeeping.
 *
 * Both lists are generated from DEFAULT_CONFIG, never hand-copied: the
 * inventory document dates from v207 and DEFAULT_CONFIG has grown since.
 */

/** Defined in DEFAULT_CONFIG, never shown by the Tkinter application either. */
export const NO_CONTROL_BY_DESIGN: Record<string, string> = {
  output_dir: "internal fallback, mirrors output_dir_clips",
  ui_font_family: "read once at start-up, before any variable exists",
  encoder: "ENCODER_OPTIONS has a single value, so no selector was ever built",
  tickrate: "used only for tick maths",
  use_config_file_mode: "never referenced outside its own initialisation",
  tag_on_export: "derived from the first active tag, not an editable field",
  kill_mod_logic_mods: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  kill_mod_logic_dp2: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  kill_mod_logic_db: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  kill_mod_no_trois_shot: "dead branch since kill_mod_trois_shot_exclude exists",
  kill_mod_no_trois_shot_req: "auto-generated; no Must box is ever built for it",
  kill_mod_high_velocity_exclude: "auto-generated; FERRARI PEEK builds no Exclude box",
  // Added in v213 with the confirmed process exit, after the inventory was
  // written. Read by the engine through _host_cfg; no widget was ever built.
  process_exit_poll_interval: "engine-only: how often the task list is polled",
  process_exit_timeout: "engine-only: how long the engine waits for cs2.exe to go",
  cs2_process_name: "engine-only: the image name the exit watcher looks for",
};

/** Has a control in Tkinter, not ported yet. MUST shrink at every chantier. */
export const NOT_YET_PORTED: readonly string[] = [
  "assemble_after",
  "assemble_output",
  "audio_bitrate",
  "audio_codec",
  "close_game_after",
  "concatenate_sequences",
  "crf",
  "cs2_cfg_dir",
  "cs2_send_to_back",
  "cs2_window_mode",
  "csdm_exe",
  "death_notices_duration",
  "delete_after_assemble",
  "dp2_threads",
  "ffmpeg_input_params",
  "ffmpeg_output_params",
  "framerate",
  "height",
  "hlae_afx_stream",
  "hlae_extra_args",
  "hlae_fix_scope_fov",
  "hlae_fov",
  "hlae_no_spectator_ui",
  "hlae_slow_motion",
  "output_dir_assembled",
  "output_dir_clips",
  "output_dir_concat",
  "pg_db",
  "pg_host",
  "pg_pass",
  "pg_port",
  "pg_user",
  "phys_blood",
  "phys_dynamic_lighting",
  "phys_ragdoll_enable",
  "phys_ragdoll_gravity",
  "phys_ragdoll_scale",
  "phys_sv_gravity",
  "recsys",
  "show_only_death_notices",
  "show_xray",
  "subfolder_per_demo",
  "tag_enabled",
  "theme_accent",
  "theme_bg",
  "true_view",
  "ui_remember_layout",
  "ui_split_pct",
  "ui_window_h",
  "ui_window_w",
  "video_codec",
  "video_container",
  "video_preset",
  "width",
];
