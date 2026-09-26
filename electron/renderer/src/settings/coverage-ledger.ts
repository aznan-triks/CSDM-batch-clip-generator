/**
 * The parity ledger (D20 / R1).
 *
 * Two lists, two very different meanings:
 *
 *  - NO_CONTROL_BY_DESIGN: keys the Tkinter application itself never put on
 *    screen. Each carries the reason, taken from docs/INVENTAIRE_REGLAGES.md.
 *    This list is stable; it shrinks only if a key is deleted outright.
 *    A key superseded by another control (not merely hidden) also belongs here, with the control that replaced it.
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
  encoder: "ENCODER_OPTIONS has a single value, so no selector was ever built",
  tickrate: "used only for tick maths",
  use_config_file_mode: "never referenced outside its own initialisation",
  tag_on_export: "derived from the first active tag, not an editable field",
  kill_mod_logic_mods: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  kill_mod_logic_dp2: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  kill_mod_logic_db: "forced to 'mixed'; no ANY/ALL/MIXED selector exists",
  dp2_cache_max_demos: "memory bound for the demoparser2 cache, a safety cap rather than a user choice",
  positions_cache_max_demos: "memory bound for the player-positions cache, a safety cap rather than a user choice",
  // Added in v213 with the confirmed process exit, after the inventory was
  // written. Read by the engine through _host_cfg; no widget was ever built.
  process_exit_poll_interval: "engine-only: how often the task list is polled",
  process_exit_timeout: "engine-only: how long the engine waits for cs2.exe to go",
  cs2_process_name: "engine-only: the image name the exit watcher looks for",
  // Moved out of engine literals (HC.1, 2026-09-25); tuning values, no widget.
  recording_timeout_auto_factor: "engine-only: automatic timeout = clip time times this factor",
  recording_timeout_auto_floor_s: "engine-only: the automatic timeout never goes under this",
  airborne_shot_speed_z: "engine-only: AIRBORNE vertical-speed threshold for shots",
  airborne_position_delta_z: "engine-only: AIRBORNE height-change threshold from positions",
  ui_sections: "driven by drag-and-drop and the card header toggle, not a form field",
  ui_card_row_height: "card grid row step; changed via config, never a widget",
  ui_card_collapsed_rows: "collapsed card height; changed via config, never a widget",
  // Superseded, not forgotten: Ally / Enemy (Event Type) is the one team model.
  teamkills_mode: "superseded by Ally / Enemy; kept for config migration and the Tkinter window",
};

/** Has a control in Tkinter, not ported yet. MUST shrink at every chantier. */
export const NOT_YET_PORTED: readonly string[] = [];
