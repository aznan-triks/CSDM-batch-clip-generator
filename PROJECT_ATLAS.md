# PROJECT_ATLAS -- CSDM Batch Clips Generator

> GENERATED FILE. DO NOT EDIT BY HAND.
> Regenerate: `python scripts/build_atlas.py`
> Freshness check: `python scripts/build_atlas.py --check`

## Python functions (554)

| Name | File:line | Signature | Tested |
|---|---|---|---|
| `state` | `csdm/bridge/ports.py:30` | `state(self, name, payload=None)` | yes |
| `state` | `csdm/engine/ports.py:46` | `state(self, name, payload=None)` | yes |
| `state` | `csdm_batch_clips_generator.py:4662` | `state(self, name, payload=None)` | yes |
| `send` | `csdm/bridge/protocol.py:47` | `send(self, obj)` | yes |
| `add` | `csdm/widgets.py:139` | `add(self, widget)` | yes |
| `add` | `csdm/widgets.py:207` | `add(self, card)` | yes |
| `log` | `csdm/bridge/ports.py:23` | `log(self, message, level='')` | yes |
| `log` | `csdm/engine/ports.py:40` | `log(self, message, level='')` | yes |
| `log` | `csdm_batch_clips_generator.py:4654` | `log(self, message, level='')` | yes |
| `grid` | `csdm/widgets.py:504` | `grid(self, **kw)` | - |
| `describe_filters` | `csdm/bridge/tables.py:15` | `describe_filters()` | yes |
| `place` | `csdm/widgets.py:510` | `place(self, **kw)` | yes |
| `task` | `csdm_batch_clips_generator.py:519` | `task()` | yes |
| `task` | `csdm_batch_clips_generator.py:889` | `task()` | yes |
| `task` | `csdm_batch_clips_generator.py:3363` | `task()` | yes |
| `task` | `csdm_batch_clips_generator.py:3500` | `task()` | yes |
| `task` | `csdm_batch_clips_generator.py:3591` | `task()` | yes |
| `task` | `csdm_batch_clips_generator.py:3742` | `task()` | yes |
| `ask` | `csdm/bridge/ports.py:34` | `ask(self, kind, message, options)` | yes |
| `ask` | `csdm/engine/ports.py:49` | `ask(self, kind, message, options)` | yes |
| `ask` | `csdm_batch_clips_generator.py:4715` | `ask(self, kind, message, options)` | yes |
| `log_parts` | `csdm/bridge/ports.py:26` | `log_parts(self, parts)` | yes |
| `log_parts` | `csdm/engine/ports.py:43` | `log_parts(self, parts)` | yes |
| `log_parts` | `csdm_batch_clips_generator.py:4658` | `log_parts(self, parts)` | yes |
| `show` | `csdm_batch_clips_generator.py:3387` | `show()` | - |
| `show` | `csdm_batch_clips_generator.py:3543` | `show()` | - |
| `show` | `csdm_batch_clips_generator.py:3652` | `show()` | - |
| `load_config` | `csdm/config.py:335` | `load_config()` | yes |
| `_tab_video` | `csdm_batch_clips_generator.py:2372` | `_tab_video(self, parent)` | - |
| `save_config` | `csdm/config.py:344` | `save_config(cfg)` | yes |
| `scroll` | `csdm/widgets.py:95` | `scroll(self, delta)` | - |
| `start_run` | `csdm/engine/core.py:3221` | `start_run(self, cfg)` | yes |
| `__init__` | `csdm/bridge/host.py:26` | `__init__(self, ports)` | yes |
| `__init__` | `csdm/bridge/ports.py:16` | `__init__(self, writer)` | yes |
| `__init__` | `csdm/bridge/protocol.py:43` | `__init__(self, stream)` | yes |
| `__init__` | `csdm/widgets.py:40` | `__init__(self, parent, **kw)` | yes |
| `__init__` | `csdm/widgets.py:127` | `__init__(self, parent, gap_x=6, gap_y=4, **kw)` | yes |
| `__init__` | `csdm/widgets.py:194` | `__init__(self, parent, breakpoint_px=UI_BENTO_BREAKPOINT, gap=UI_BENTO_GAP, **kw)` | yes |
| `__init__` | `csdm/widgets.py:391` | `__init__(self, widget, text)` | yes |
| `__init__` | `csdm/widgets.py:447` | `__init__(self, parent, title, collapsed=False, **kw)` | yes |

> 514 more in PROJECT_ATLAS.json

## Python classes (20)

| Name | File:line | Tested |
|---|---|---|
| `App` | `csdm_batch_clips_generator.py:177` | yes |
| `Sec` | `csdm/widgets.py:435` | - |
| `DateField` | `csdm/widgets.py:799` | - |
| `EngineMixin` | `csdm/engine/core.py:95` | yes |
| `FilterDef` | `csdm/static_data.py:25` | - |
| `PathField` | `csdm/widgets.py:552` | - |
| `BentoGrid` | `csdm/widgets.py:180` | - |
| `CollectingPorts` | `csdm/engine/ports.py:32` | yes |
| `ColorPickerDialog` | `csdm/widgets.py:662` | - |
| `EngineStateMixin` | `csdm/engine/state.py:48` | yes |
| `PlayerSearchWidget` | `csdm/widgets.py:832` | - |
| `TagImportMissingDialog` | `csdm/widgets.py:727` | yes |
| `CalendarPopup` | `csdm/widgets.py:578` | - |
| `EnginePorts` | `csdm/engine/ports.py:23` | yes |
| `LineWriter` | `csdm/bridge/protocol.py:35` | yes |
| `PipePorts` | `csdm/bridge/ports.py:13` | yes |
| `ScrollableFrame` | `csdm/widgets.py:33` | - |
| `Tooltip` | `csdm/widgets.py:389` | - |
| `WrapRow` | `csdm/widgets.py:110` | - |
| `BridgeHost` | `csdm/bridge/host.py:23` | yes |

## Config keys (177)

| Key | Default |
|---|---|
| `pg_host` | `'127.0.0.1'` |
| `pg_port` | `'5432'` |
| `pg_user` | `'postgres'` |
| `pg_pass` | `''` |
| `pg_db` | `'csdm'` |
| `csdm_exe` | `'C:\\Users\\Trois\\AppData\\Local\\Programs\\cs...` |
| `output_dir` | `'H:\\CS\\CSVideos\\Raws'` |
| `output_dir_clips` | `'H:\\CS\\CSVideos\\Raws'` |
| `output_dir_concat` | `''` |
| `output_dir_assembled` | `''` |
| `cs2_cfg_dir` | `''` |
| `ui_window_w` | `1600` |
| `ui_window_h` | `900` |
| `ui_split_pct` | `60` |
| `ui_remember_layout` | `True` |
| `ui_sections` | `{}` |
| `theme_bg` | `'dark'` |
| `theme_accent` | `'green'` |
| `ui_font_family` | `'auto'` |
| `steam_id` | `''` |
| `player_name` | `''` |
| `player_name_override` | `''` |
| `events` | `['Kills']` |
| `weapons` | `[]` |
| `date_from` | `''` |
| `date_to` | `''` |
| `before` | `3` |
| `after` | `5` |
| `encoder` | `'FFmpeg'` |
| `recsys` | `'HLAE'` |
| `tickrate` | `64` |
| `use_config_file_mode` | `True` |
| `close_game_after` | `True` |
| `subfolder_per_demo` | `True` |
| `width` | `1920` |
| `height` | `1080` |
| `framerate` | `60` |
| `crf` | `18` |
| `video_codec` | `'libx264'` |
| `audio_codec` | `'libmp3lame'` |

> 137 more in PROJECT_ATLAS.json

## React components (41)

| Name | File:line | Props |
|---|---|---|
| `App` | `electron/renderer/src/App.tsx:4` | - |
| `ActionButton` | `electron/renderer/src/components/ActionButton.tsx:45` | - |
| `Card` | `electron/renderer/src/components/Card.tsx:58` | title, icon, children, className, count, open, onToggle, dragHandle, onResizeToggle |
| `Chip` | `electron/renderer/src/components/Chip.tsx:20` | label, selected, onToggle, disabled |
| `DateField` | `electron/renderer/src/components/DateField.tsx:38` | id, label, value, onChange |
| `DemoPicker` | `electron/renderer/src/components/DemoPicker.tsx:39` | demos, checked, onToggle, onSetAll, onSetSelected |
| `Field` | `electron/renderer/src/components/Field.tsx:25` | value, onChange, mono, placeholder, id, label, type |
| `NumberField` | `electron/renderer/src/components/NumberField.tsx:25` | value, onChange, min, max, step, label, id |
| `PathField` | `electron/renderer/src/components/PathField.tsx:23` | value, onChange, placeholder, id, label, mode |
| `Segmented` | `electron/renderer/src/components/Segmented.tsx:28` | options, value, onChange, label, disabled |
| `Slider` | `electron/renderer/src/components/Slider.tsx:27` | value, onChange, min, max, step, label, readout, id |
| `StatStrip` | `electron/renderer/src/components/StatStrip.tsx:40` | compact |
| `Tab` | `electron/renderer/src/components/Tab.tsx:21` | label, icon, active, onSelect |
| `TabBar` | `electron/renderer/src/components/Tab.tsx:60` | children |
| `Reticle` | `electron/renderer/src/cursor/Reticle.tsx:53` | - |
| `ClickSpark` | `electron/renderer/src/effects/ClickSpark.tsx:24` | - |
| `FilterRow` | `electron/renderer/src/settings/FilterRow.tsx:17` | - |
| `SettingControl` | `electron/renderer/src/settings/SettingControl.tsx:19` | - |
| `SettingsProvider` | `electron/renderer/src/settings/store.tsx:32` | - |
| `DatabaseProvider` | `electron/renderer/src/settings/useDatabase.tsx:106` | - |
| `TablesProvider` | `electron/renderer/src/settings/useTables.tsx:105` | - |
| `ActionBar` | `electron/renderer/src/shell/ActionBar.tsx:38` | registerButton, weapon |
| `AppShell` | `electron/renderer/src/shell/AppShell.tsx:36` | - |
| `Backdrop` | `electron/renderer/src/shell/Backdrop.tsx:46` | - |
| `EngineLostBanner` | `electron/renderer/src/shell/EngineLostBanner.tsx:21` | - |
| `LogConsole` | `electron/renderer/src/shell/LogConsole.tsx:147` | - |
| `SectionList` | `electron/renderer/src/shell/SectionList.tsx:48` | tabId, sections |
| `CaptureTab` | `electron/renderer/src/tabs/CaptureTab.tsx:62` | - |
| `Cs2EffectsSection` | `electron/renderer/src/tabs/Cs2EffectsSection.tsx:85` | - |
| `DemoSelectionSection` | `electron/renderer/src/tabs/DemoSelectionSection.tsx:82` | - |
| `HlaeOptionsSection` | `electron/renderer/src/tabs/HlaeOptionsSection.tsx:24` | - |
| `KillFiltersSection` | `electron/renderer/src/tabs/KillFiltersSection.tsx:254` | - |
| `MapFilterSection` | `electron/renderer/src/tabs/MapFilterSection.tsx:23` | - |
| `MatchTypesSection` | `electron/renderer/src/tabs/MatchTypesSection.tsx:44` | - |
| `PlayerSection` | `electron/renderer/src/tabs/PlayerSection.tsx:79` | - |
| `PresetSection` | `electron/renderer/src/tabs/PresetSection.tsx:56` | open, onToggle, dragHandle |
| `SettingsTab` | `electron/renderer/src/tabs/SettingsTab.tsx:52` | - |
| `TagsTab` | `electron/renderer/src/tabs/TagsTab.tsx:54` | - |
| `VideoTab` | `electron/renderer/src/tabs/VideoTab.tsx:60` | - |
| `WeaponFilterSection` | `electron/renderer/src/tabs/WeaponFilterSection.tsx:32` | - |

> 1 more in PROJECT_ATLAS.json

## React hooks (10)

| Name | File:line |
|---|---|
| `useEngineState` | `electron/renderer/src/motion/useEngineState.ts:124` |
| `useWindowActivity` | `electron/renderer/src/motion/useWindowActivity.ts:17` |
| `useSectionLayout` | `electron/renderer/src/shell/sectionLayout.ts:37` |
| `useCardDrag` | `electron/renderer/src/shell/useCardDrag.ts:18` |
| `useTypewriter` | `electron/renderer/src/shell/useTypewriter.ts:30` |
| `useSettingsBatch` | `electron/renderer/src/settings/store.tsx:116` |
| `useAllSettings` | `electron/renderer/src/settings/store.tsx:128` |
| `useSettingsStatus` | `electron/renderer/src/settings/store.tsx:133` |
| `useDatabase` | `electron/renderer/src/settings/useDatabase.tsx:111` |
| `useTables` | `electron/renderer/src/settings/useTables.tsx:110` |

## Mock CSS classes (109)

Owned by `theme/mock-v12.css` -- naming an internal class that collides silently inherits its rule (section 10).

`a`, `actbar`, `active`, `amb`, `app`, `av`, `b`, `bento`, `big-sw`, `bl`, `blue`, `body`, `boomfx`, `box`, `br`, `brand`, `brs`, `btn`, `bx`, `c4`, `car`, `casc`, `casc-g`, `cbr`, `cc`, `cd`, `ch`, `chip`, `chips`, `closed`, `cnt`, `console`, `cring`, `cur`, `customcursor`, `d`, `danger`, `derived`, `dot`, `dv`, `excl`, `fire`, `fl`, `fld`, `g`, `ghost`, `gl`, `glx`, `go`, `grid`, `gun`, `gun2`, `gunmini`, `guns`, `hexin`, `hit`, `html`, `hud-inner`, `hud-nav`, `ic`, `in`, `ind`, `k`, `lab`, `mark`, `muzzle`, `navtools`, `o`, `on`, `p`, `panel`, `pcard`, `pl`, `primary`, `prompt`, `rc`, `reticle`, `row`, `sb`, `scrollwrap`, `sec`, `seg`, `sel`, `sh`, `shake`, `shell`, `show`, `slider`, `snap`, `spark`, `spot`, `sq`, `st`, `stats`, `swrow`, `t`, `tab`, `tabs`, `tcursor`, `test`, `tk`, `tl`, `tools`, `tr`, `tracer`, `ts`, `v`, `wband`, `wide`

## Registries

### KILL_FILTER_REGISTRY (21)

`kill_mod_through_smoke`, `kill_mod_no_scope`, `kill_mod_assisted_flash`, `kill_mod_wall_bang`, `kill_mod_attacker_blind`, `kill_mod_airborne`, `kill_mod_collateral`, `kill_mod_trois_shot`, `kill_mod_no_trois_shot`, `kill_mod_trois_tap`, `kill_mod_one_tap`, `kill_mod_spray_transfer`, `kill_mod_high_velocity`, `kill_mod_flick`, `kill_mod_savior`, `kill_mod_entry_frag`, `kill_mod_ace`, `kill_mod_multi_kill`, `kill_mod_bully`, `kill_mod_eco_frag`, `kill_mod_mate_pov`

### COMMANDS (29)

`cancel_preview`, `connect_db`, `delete_preset`, `demo_ask`, `demo_logs`, `describe_filters`, `hello`, `list_demos`, `list_presets`, `load_config`, `load_preset`, `ping`, `request_kill`, `request_stop`, `save_config`, `save_preset`, `start_preview`, `start_run`, `tag_create`, `tag_delete`, `tags_apply`, `tags_calc_range`, `tags_export`, `tags_import_apply`, `tags_import_scan`, `tags_remove`, `tags_search`, `tags_set_active`, `tkinter_check`

## Bridge commands (29)

| Command | Handler |
|---|---|
| `ping` | `_cmd_ping` |
| `hello` | `_cmd_hello` |
| `describe_filters` | `_cmd_describe_filters` |
| `start_run` | `_cmd_start_run` |
| `start_preview` | `_cmd_start_preview` |
| `load_config` | `_cmd_load_config` |
| `save_config` | `_cmd_save_config` |
| `list_presets` | `_cmd_list_presets` |
| `save_preset` | `_cmd_save_preset` |
| `load_preset` | `_cmd_load_preset` |
| `delete_preset` | `_cmd_delete_preset` |
| `request_stop` | `_cmd_request_stop` |
| `request_kill` | `_cmd_request_kill` |
| `cancel_preview` | `_cmd_cancel_preview` |
| `demo_logs` | `_cmd_demo_logs` |
| `demo_ask` | `_cmd_demo_ask` |
| `tkinter_check` | `_cmd_tkinter_check` |
| `connect_db` | `_cmd_connect_db` |
| `list_demos` | `_cmd_list_demos` |
| `tags_search` | `_cmd_tags_search` |
| `tags_calc_range` | `_cmd_tags_calc_range` |
| `tags_set_active` | `_cmd_tags_set_active` |
| `tags_apply` | `_cmd_tags_apply` |
| `tags_remove` | `_cmd_tags_remove` |
| `tag_create` | `_cmd_tag_create` |
| `tag_delete` | `_cmd_tag_delete` |
| `tags_export` | `_cmd_tags_export` |
| `tags_import_scan` | `_cmd_tags_import_scan` |
| `tags_import_apply` | `_cmd_tags_import_apply` |

## Engine state events (13)

`buttons`, `buttons_busy`, `buttons_idle`, `demo_entry`, `demos_unchecked`, `kill_requested`, `preview_ready`, `preview_started`, `process_exited`, `progress`, `run_started`, `stop_requested`, `summary`

## Guards -- what each test forbids (100)

| File | Forbids |
|---|---|
| `tests/test_atlas.py` | The atlas is generated, never transcribed -- so what it claims must be true. |
| `tests/test_bridge_e2e.py` | Drive the bridge as a real subprocess -- the only honest way to test a pipe. |
| `tests/test_bridge_isolation.py` | Guard rails: nothing but the protocol may ever touch standard output. |
| `tests/test_bridge_list_demos.py` | `list_demos`: the manual-mode "load ALL demos from DB" bridge command. |
| `tests/test_bridge_ports.py` | The four sockets, wired to the pipe instead of to widgets. |
| `tests/test_bridge_protocol.py` | One JSON object per line, and never two writers interleaving one. |
| `tests/test_bridge_tables.py` | The static tables must cross the pipe, never be retyped in TypeScript. |
| `tests/test_bridge_tags_apply.py` | `tags_apply` / `tags_remove` / `tag_create` / `tag_delete`: the tag |
| `tests/test_bridge_tags_export_import.py` | `tags_export` / `tags_import_scan` / `tags_import_apply`: the tag |
| `tests/test_bridge_tags_search.py` | `tags_search` / `tags_calc_range` / `tags_set_active`: the tag-search, |
| `tests/test_config_presets.py` | Preset category logic, extracted from the window so a pipe can call it. |
| `tests/test_cs_injection.py` | CS2 config injection, runtime cfg writing, and App's small pure helpers stay correct. |
| `tests/test_db_discovery.py` | Database discovery must run with no window and no real server. |
| `tests/test_engine_globals.py` | Every free name used by an engine module must resolve inside that module. |
| `tests/test_engine_headless.py` | The engine must run with no window and no Tkinter anywhere in the process. |
| `tests/test_engine_isolation.py` | Test de garde : le moteur ne touche pas a l'interface (chantier 1). |
| `tests/test_engine_pg_params.py` | Guard for the PostgreSQL connection seam (chantier 4a1, task 5 review fix). |
| `tests/test_engine_port_shadowing.py` | No instance attribute may shadow an engine port. |
| `tests/test_engine_ports.py` | Tests des trois prises du moteur (chantier 1, tache 1). |
| `tests/test_engine_state.py` | Every attribute the engine reads must be declared in one place. |
| `tests/test_pg_params_live.py` | The PostgreSQL identifiers must be live, not copied at three chosen moments. |
| `tests/test_process_exit.py` | A process is announced dead only when the task list says it is gone. |
| `tests/test_pure_logic.py` | Tests de la logique pure et des donnees statiques (Phase 2.3 — filet de securite). |
| `tests/test_run_inputs.py` | Run and preview must be validatable with no window. |
| `electron/renderer/src/__tests__/bridge-commands.test.ts` | The pipe must carry arguments and hand answers back. |
| `electron/renderer/src/__tests__/EngineLostBanner.test.tsx` |  |
| `electron/renderer/src/__tests__/ErrorBoundary.test.tsx` | A render crash must not unmount the whole app to a blank page. |
| `electron/renderer/src/__tests__/no-hover-motion.test.ts` | The hover lock (D13, D16, R7). The most important test in this stage. |
| `electron/renderer/src/__tests__/one-button-vocabulary.test.ts` | One vocabulary for small buttons. |
| `electron/renderer/src/__tests__/strip-mock-hover-motion.test.ts` | Proves the scoping property that makes postcss-strip-mock-hover-motion.mjs |
| `electron/renderer/src/__tests__/stylesheet-order.test.ts` | The shipped cascade order, guarded. |
| `electron/renderer/src/__tests__/wheel-reaches-the-pane.test.ts` | The wheel belongs to the pane that actually scrolls. |
| `electron/renderer/src/components/__tests__/ActionButton.css.test.ts` | What is LEFT in ActionButton.css. |
| `electron/renderer/src/components/__tests__/ActionButton.fx.test.tsx` | The button's impact feedback. |
| `electron/renderer/src/components/__tests__/Card.css.test.ts` | What is LEFT in Card.css. |
| `electron/renderer/src/components/__tests__/Card.test.tsx` | The card's fold state must not drift from its open/onToggle contract (menus-C). |
| `electron/renderer/src/components/__tests__/Chip.test.tsx` | The chip's selected face. |
| `electron/renderer/src/components/__tests__/FieldChip.css.test.ts` | What is LEFT in Field.css and Chip.css. |
| `electron/renderer/src/components/__tests__/GlassMigration.css.test.ts` | Restyle 2's completion gate (the plan's Task 6) grepped for leftover flat |
| `electron/renderer/src/components/__tests__/SegmentedSlider.css.test.ts` | What is LEFT in Segmented.css and Slider.css. |
| `electron/renderer/src/components/__tests__/Slider.number.test.tsx` | A gauge must be typeable, and the rail must follow what was typed. |
| `electron/renderer/src/components/__tests__/Tab.css.test.ts` | What is LEFT in Tab.css, and why nothing else may join it. |
| `electron/renderer/src/components/__tests__/Tab.test.tsx` | The sliding indicator must not lose sync with the active tab's measured position and width. |
| `electron/renderer/src/cursor/__tests__/Reticle.css.test.ts` | `(hover: none)` must hide the reticle AND restore the native cursor -- never one without the other. |
| `electron/renderer/src/cursor/__tests__/Reticle.selectors.test.ts` | Every class the reticle names must still exist. |
| `electron/renderer/src/cursor/__tests__/Reticle.shape.test.ts` | The reticle's SHAPE, resolved through a real cascade -- not read out of the |
| `electron/renderer/src/cursor/__tests__/Reticle.test.tsx` | The reticle must move via custom properties, never a layout style (paint, don't move). |
| `electron/renderer/src/effects/__tests__/ClickSpark.test.tsx` | The click spark's particle count and colour must not drift from the approved effect. |
| `electron/renderer/src/icons/__tests__/icons.test.tsx` | D14: every menu and every button carries its own glyph. |
| `electron/renderer/src/motion/__tests__/intensity.test.ts` | The motion engine must not play sequences at the wrong intensity, ignore |
| `electron/renderer/src/motion/__tests__/windowActivity.test.ts` |  |
| `electron/renderer/src/parity/__tests__/coverage.test.tsx` |  |
| `electron/renderer/src/parity/__tests__/inventory.test.ts` |  |
| `electron/renderer/src/settings/__tests__/coverage.test.tsx` | The parity guard of D20 / R1: no setting may vanish in the port. |
| `electron/renderer/src/settings/__tests__/FilterRow.test.tsx` | One filter row carries three boxes, and dropping one of them is a silent |
| `electron/renderer/src/settings/__tests__/store.test.tsx` | The settings store: one flat dictionary, keyed exactly like DEFAULT_CONFIG. |
| `electron/renderer/src/shell/__tests__/ActionBar.css.test.ts` | What is LEFT in ActionBar.css. |
| `electron/renderer/src/shell/__tests__/ActionBar.test.tsx` | ActionBar: the four action buttons (RUN, PREVIEW, STOP, KILL) and the |
| `electron/renderer/src/shell/__tests__/AppShell.css.test.ts` | The page's base face, guarded across the two files that decide it. |
| `electron/renderer/src/shell/__tests__/AppShell.test.tsx` | The shell must mount, show its four tabs, and switch between them. |
| `electron/renderer/src/shell/__tests__/backdrop-per-tab.test.ts` | The ground is configurable per tab. |
| `electron/renderer/src/shell/__tests__/backdrop.test.ts` | NOTE: the pure module lives in "backdropField.ts", not "backdrop.ts" as the |
| `electron/renderer/src/shell/__tests__/console-rules.test.ts` | The console's ruled lines and its text share ONE period. |
| `electron/renderer/src/shell/__tests__/consoleNarrative.test.ts` | What the console says, against what the pipe carries. |
| `electron/renderer/src/shell/__tests__/HudNav.test.tsx` | The tab nav must not lose its aria-current wiring or the mock's `.hud-nav` vocabulary. |
| `electron/renderer/src/shell/__tests__/LogConsole.ask.test.tsx` | The ask panel must answer BOTH shapes the engine sends. |
| `electron/renderer/src/shell/__tests__/LogConsole.cap.test.tsx` | The console must not grow without bound. |
| `electron/renderer/src/shell/__tests__/LogConsole.prompt.test.tsx` | The console's titled header and its prompt line. |
| `electron/renderer/src/shell/__tests__/LogConsole.test.tsx` | LogConsole's tools: auto-scroll, search, and the always-mounted requirement |
| `electron/renderer/src/shell/__tests__/LogConsole.typing.test.tsx` | The console writes itself out, as the approved mock does. |
| `electron/renderer/src/shell/__tests__/sectionLayout.test.ts` | A card's order and collapsed state must persist across renders, keyed by tab. |
| `electron/renderer/src/shell/__tests__/SectionList.test.tsx` | Dragging or resizing a card must not break the section list's live reorder/collapse state. |
| `electron/renderer/src/shell/__tests__/tabs.test.ts` | The four tabs are data, so nothing can quietly grow a fifth. |
| `electron/renderer/src/shell/__tests__/useCardDrag.test.ts` | The reorder drag hook must not fire on the wrong pointer target, or miss the drop. |
| `electron/renderer/src/tabs/__tests__/bento-layout.test.ts` | Every tab panel is a two-column bento grid with a full-width escape hatch. |
| `electron/renderer/src/tabs/__tests__/CaptureTab.test.tsx` | The Capture tab's conditional rows, which are the window's own rules. |
| `electron/renderer/src/tabs/__tests__/DemoSelectionSection.test.tsx` | The DEMO SELECTION section. |
| `electron/renderer/src/tabs/__tests__/HlaeOptionsSection.test.tsx` | IN-GAME OPTIONS, RECORDING SYSTEM, HLAE OPTIONS and CS2 EFFECTS. |
| `electron/renderer/src/tabs/__tests__/KillFiltersSection.test.tsx` | The KILL FILTERS section and the CLUTCH block. |
| `electron/renderer/src/tabs/__tests__/MatchTypesSection.test.tsx` | The MATCH TYPES section. |
| `electron/renderer/src/tabs/__tests__/PlayerSection.paging.test.tsx` | The player list must survive a real database. |
| `electron/renderer/src/tabs/__tests__/PresetSection.test.tsx` | PresetSection: the name field, one checkbox per category the Python side |
| `electron/renderer/src/tabs/__tests__/SettingsTab.test.tsx` | The Settings tab: PATHS, UI THEME, UI LAYOUT, POSTGRESQL CONNECTION, |
| `electron/renderer/src/tabs/__tests__/TagsTab.colour.test.tsx` | A tag carries its own colour, whether or not it is picked. |
| `electron/renderer/src/tabs/__tests__/TagsTab.test.tsx` | TagsTab: the tag grid, the TAG RANGE block and the OPERATIONS block. |
| `electron/renderer/src/tabs/__tests__/VideoTab.test.tsx` | The Video tab -- first slice: FINAL ASSEMBLY, RESOLUTION/FRAMERATE/WINDOW, |
| `electron/renderer/src/tabs/__tests__/WeaponFilterSection.silhouettes.test.tsx` | The silhouettes of the selected weapons, in the filter card. |
| `electron/renderer/src/tabs/__tests__/WeaponFilterSection.test.tsx` | The WEAPON FILTER section. |
| `electron/renderer/src/theme/__tests__/accent-default.test.ts` | The default accent must not drift from the V12 mock's electric blue (#2563EB). |
| `electron/renderer/src/theme/__tests__/accent-reaches-the-ground.test.ts` | A chosen accent must reach the holographic ground. |
| `electron/renderer/src/theme/__tests__/accent.test.ts` | A legacy Tkinter accent preset name must resolve to its Electron hex, case-insensitively. |
| `electron/renderer/src/theme/__tests__/contrast.test.ts` | Token contrast ratios (light and dark) must not drop below tokens.css's own values. |
| `electron/renderer/src/theme/__tests__/dark-ground.test.ts` | Every light colour the approved mock writes as a LITERAL, accounted for. |
| `electron/renderer/src/theme/__tests__/grounds.test.ts` | The night grounds must be DISTINCT, and each must be legible. |
| `electron/renderer/src/theme/__tests__/mock-bridge.test.ts` | The measured disagreements in mock-bridge.css that are full rules, not |
| `electron/renderer/src/theme/__tests__/mock-v12.test.ts` | mock-v12.css must not drift from a fresh extraction of the approved mock -- it is GENERATED. |
| `electron/renderer/src/theme/__tests__/mode.test.ts` | A night ground preset must never land the window in light mode. |
| `electron/renderer/src/weapon/__tests__/silhouettes.test.ts` | Every weapon the database can return must have something to draw. |
| `electron/renderer/src/weapon/__tests__/stop-waits.test.ts` | STOP has no timer. This is D18 written as a test. |
| `electron/renderer/src/weapon/__tests__/WeaponBand.css.test.ts` | The weapon band must not restate the action bar's background, blur, or layout -- it rides inside it. |

## Principle-1 mechanisable checks

Suspects, not verdicts -- each is a signal of a possible §1 violation, ranked by how sure the signal is. See context_guide.md §1.

### hardcoded_config_defaults (1238)

| File:line | What | Why |
|---|---|---|
| `csdm/engine/core.py:543` | `pg_db` | the default value of `pg_db` ('csdm') is rewritten literally here |
| `csdm/engine/core.py:554` | `pg_db` | the default value of `pg_db` ('csdm') is rewritten literally here |
| `csdm_batch_clips_generator.py:2845` | `ui_window_w` | the default value of `ui_window_w` (1600) is rewritten literally here |
| `csdm_batch_clips_generator.py:191` | `ui_window_w` | the default value of `ui_window_w` (1600) is rewritten literally here |
| `csdm_batch_clips_generator.py:2800` | `ui_window_w` | the default value of `ui_window_w` (1600) is rewritten literally here |
| `csdm_batch_clips_generator.py:191` | `ui_window_w` | the default value of `ui_window_w` (1600) is rewritten literally here |
| `csdm_batch_clips_generator.py:2861` | `ui_window_w` | the default value of `ui_window_w` (1600) is rewritten literally here |
| `csdm_batch_clips_generator.py:2846` | `ui_window_h` | the default value of `ui_window_h` (900) is rewritten literally here |
| `csdm_batch_clips_generator.py:192` | `ui_window_h` | the default value of `ui_window_h` (900) is rewritten literally here |
| `csdm_batch_clips_generator.py:2804` | `ui_window_h` | the default value of `ui_window_h` (900) is rewritten literally here |
| `csdm_batch_clips_generator.py:192` | `ui_window_h` | the default value of `ui_window_h` (900) is rewritten literally here |
| `csdm_batch_clips_generator.py:2861` | `ui_window_h` | the default value of `ui_window_h` (900) is rewritten literally here |
| `csdm/core_utils.py:73` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/core_utils.py:73` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/core_utils.py:72` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/core_utils.py:72` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:5191` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:2300` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3659` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3665` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3670` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3671` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3777` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3787` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3790` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3775` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:5193` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:5193` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3237` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3239` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3248` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3250` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:5192` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:5192` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3516` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3519` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:2462` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:2462` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/engine/core.py:3633` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |
| `csdm/static_data.py:254` | `ui_split_pct` | the default value of `ui_split_pct` (60) is rewritten literally here |

> 1198 more in PROJECT_ATLAS.json

### repeated_literals (585)

| File:line | What | Why |
|---|---|---|
| `csdm/bridge/__main__.py:6` | `'__main__'` | the literal '__main__' appears unnamed in 2 files: csdm/bridge/__main__.py, csdm_batch_clips_generator.py |
| `csdm/bridge/__main__.py:13` | `'utf-8'` | the literal 'utf-8' appears unnamed in 5 files: csdm/bridge/__main__.py, csdm/config.py, csdm/core_utils.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/__main__.py:13` | `'replace'` | the literal 'replace' appears unnamed in 3 files: csdm/bridge/__main__.py, csdm/core_utils.py, csdm/engine/core.py |
| `csdm/bridge/host.py:50` | `'dim'` | the literal 'dim' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:51` | `'data'` | the literal 'data' appears unnamed in 3 files: csdm/bridge/host.py, csdm/config.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:62` | `'info'` | the literal 'info' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:62` | `'warn'` | the literal 'warn' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:62` | `'err'` | the literal 'err' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:65` | `'buttons_idle'` | the literal 'buttons_idle' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:66` | `'buttons_busy'` | the literal 'buttons_busy' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:71` | `'confirm'` | the literal 'confirm' appears unnamed in 2 files: csdm/bridge/host.py, csdm/engine/core.py |
| `csdm/bridge/host.py:136` | `'cfg'` | the literal 'cfg' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:182` | `'path'` | the literal 'path' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:331` | `'name'` | the literal 'name' appears unnamed in 5 files: csdm/bridge/host.py, csdm/bridge/ports.py, csdm/engine/core.py, csdm/widgets.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:50` | `' \| '` | the literal ' \| ' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:71` | `'include'` | the literal 'include' appears unnamed in 4 files: csdm/bridge/host.py, csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:126` | `'demos'` | the literal 'demos' appears unnamed in 2 files: csdm/bridge/host.py, csdm/engine/core.py |
| `csdm/bridge/host.py:156` | `'tag_names'` | the literal 'tag_names' appears unnamed in 2 files: csdm/bridge/host.py, csdm/engine/core.py |
| `csdm/bridge/host.py:236` | `'cats'` | the literal 'cats' appears unnamed in 3 files: csdm/bridge/host.py, csdm/config.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:171` | `'tag_name'` | the literal 'tag_name' appears unnamed in 2 files: csdm/bridge/host.py, csdm/engine/core.py |
| `csdm/bridge/host.py:171` | `'color'` | the literal 'color' appears unnamed in 4 files: csdm/bridge/host.py, csdm/engine/core.py, csdm/widgets.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:176` | `'tag_id'` | the literal 'tag_id' appears unnamed in 2 files: csdm/bridge/host.py, csdm/engine/core.py |
| `csdm/bridge/host.py:340` | `'type'` | the literal 'type' appears unnamed in 6 files: csdm/bridge/host.py, csdm/bridge/ports.py, csdm/config.py, csdm/core_utils.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:372` | `'command'` | the literal 'command' appears unnamed in 3 files: csdm/bridge/host.py, csdm/bridge/protocol.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:78` | `'none'` | the literal 'none' appears unnamed in 5 files: csdm/bridge/host.py, csdm/config.py, csdm/engine/core.py, csdm/widgets.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:336` | `'error'` | the literal 'error' appears unnamed in 3 files: csdm/bridge/host.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/host.py:376` | `'answer'` | the literal 'answer' appears unnamed in 2 files: csdm/bridge/host.py, csdm/bridge/protocol.py |
| `csdm/bridge/host.py:367` | `'message'` | the literal 'message' appears unnamed in 2 files: csdm/bridge/host.py, csdm/bridge/ports.py |
| `csdm/bridge/host.py:368` | `'level'` | the literal 'level' appears unnamed in 4 files: csdm/bridge/host.py, csdm/bridge/ports.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:18` | `'filters'` | the literal 'filters' appears unnamed in 4 files: csdm/bridge/tables.py, csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:23` | `'match_types'` | the literal 'match_types' appears unnamed in 2 files: csdm/bridge/tables.py, csdm/engine/core.py |
| `csdm/bridge/tables.py:19` | `'key'` | the literal 'key' appears unnamed in 2 files: csdm/bridge/tables.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:19` | `'label'` | the literal 'label' appears unnamed in 2 files: csdm/bridge/tables.py, csdm/widgets.py |
| `csdm/bridge/tables.py:19` | `'tip'` | the literal 'tip' appears unnamed in 3 files: csdm/bridge/tables.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:20` | `'hidden'` | the literal 'hidden' appears unnamed in 2 files: csdm/bridge/tables.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:29` | `'width'` | the literal 'width' appears unnamed in 4 files: csdm/bridge/tables.py, csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:29` | `'height'` | the literal 'height' appears unnamed in 4 files: csdm/bridge/tables.py, csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/bridge/tables.py:41` | `'full'` | the literal 'full' appears unnamed in 3 files: csdm/bridge/tables.py, csdm/config.py, csdm_batch_clips_generator.py |
| `csdm/config.py:26` | `'pg_host'` | the literal 'pg_host' appears unnamed in 3 files: csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |
| `csdm/config.py:26` | `'pg_port'` | the literal 'pg_port' appears unnamed in 3 files: csdm/config.py, csdm/engine/core.py, csdm_batch_clips_generator.py |

> 545 more in PROJECT_ATLAS.json

### duplicate_bodies (3)

| File:line | What | Why |
|---|---|---|
| `csdm/engine/core.py:5391` | `_demo_picker_fmt_date` | identical body (names erased) shared with: _demo_picker_fmt_date (csdm_batch_clips_generator.py:2185) |
| `csdm/engine/core.py:5620` | `_untag_demo` | identical body (names erased) shared with: _untag_demo (csdm_batch_clips_generator.py:838) |
| `csdm/engine/core.py:5670` | `_tag_by_checksum` | identical body (names erased) shared with: _tag_by_checksum (csdm_batch_clips_generator.py:3969) |

### unused_symbols (313)

| File:line | What | Why |
|---|---|---|
| `csdm/bridge/host.py:32` | `_cmd_ping` | `_cmd_ping` has zero usages outside its own definition |
| `csdm/bridge/host.py:36` | `_cmd_hello` | `_cmd_hello` has zero usages outside its own definition |
| `csdm/bridge/host.py:56` | `_cmd_describe_filters` | `_cmd_describe_filters` has zero usages outside its own definition |
| `csdm/bridge/host.py:61` | `_cmd_demo_logs` | `_cmd_demo_logs` has zero usages outside its own definition |
| `csdm/bridge/host.py:70` | `_cmd_demo_ask` | `_cmd_demo_ask` has zero usages outside its own definition |
| `csdm/bridge/host.py:76` | `_cmd_tkinter_check` | `_cmd_tkinter_check` has zero usages outside its own definition |
| `csdm/bridge/host.py:82` | `_cmd_request_stop` | `_cmd_request_stop` has zero usages outside its own definition |
| `csdm/bridge/host.py:87` | `_cmd_request_kill` | `_cmd_request_kill` has zero usages outside its own definition |
| `csdm/bridge/host.py:92` | `_cmd_cancel_preview` | `_cmd_cancel_preview` has zero usages outside its own definition |
| `csdm/bridge/host.py:119` | `_cmd_list_demos` | `_cmd_list_demos` has zero usages outside its own definition |
| `csdm/bridge/host.py:129` | `_cmd_tags_search` | `_cmd_tags_search` has zero usages outside its own definition |
| `csdm/bridge/host.py:142` | `_cmd_tags_calc_range` | `_cmd_tags_calc_range` has zero usages outside its own definition |
| `csdm/bridge/host.py:148` | `_cmd_tags_set_active` | `_cmd_tags_set_active` has zero usages outside its own definition |
| `csdm/bridge/host.py:154` | `_cmd_tags_apply` | `_cmd_tags_apply` has zero usages outside its own definition |
| `csdm/bridge/host.py:161` | `_cmd_tags_remove` | `_cmd_tags_remove` has zero usages outside its own definition |
| `csdm/bridge/host.py:168` | `_cmd_tag_create` | `_cmd_tag_create` has zero usages outside its own definition |
| `csdm/bridge/host.py:174` | `_cmd_tag_delete` | `_cmd_tag_delete` has zero usages outside its own definition |
| `csdm/bridge/host.py:179` | `_cmd_tags_export` | `_cmd_tags_export` has zero usages outside its own definition |
| `csdm/bridge/host.py:188` | `_cmd_tags_import_scan` | `_cmd_tags_import_scan` has zero usages outside its own definition |
| `csdm/bridge/host.py:198` | `_cmd_tags_import_apply` | `_cmd_tags_import_apply` has zero usages outside its own definition |
| `csdm/bridge/host.py:208` | `_cmd_load_config` | `_cmd_load_config` has zero usages outside its own definition |
| `csdm/bridge/host.py:213` | `_cmd_save_config` | `_cmd_save_config` has zero usages outside its own definition |
| `csdm/bridge/host.py:226` | `_cmd_list_presets` | `_cmd_list_presets` has zero usages outside its own definition |
| `csdm/bridge/host.py:230` | `_cmd_save_preset` | `_cmd_save_preset` has zero usages outside its own definition |
| `csdm/bridge/host.py:248` | `_cmd_load_preset` | `_cmd_load_preset` has zero usages outside its own definition |
| `csdm/bridge/host.py:258` | `_cmd_delete_preset` | `_cmd_delete_preset` has zero usages outside its own definition |
| `csdm/bridge/host.py:270` | `_cmd_start_run` | `_cmd_start_run` has zero usages outside its own definition |
| `csdm/bridge/host.py:282` | `_cmd_start_preview` | `_cmd_start_preview` has zero usages outside its own definition |
| `csdm/bridge/host.py:322` | `_run_command` | `_run_command` has zero usages outside its own definition |
| `csdm/config.py:233` | `preset_keys_for` | `preset_keys_for` has zero usages outside its own definition |
| `csdm/config.py:258` | `preset_cats` | `preset_cats` has zero usages outside its own definition |
| `csdm/engine/core.py:108` | `_detect_map_col` | `_detect_map_col` has zero usages outside its own definition |
| `csdm/engine/core.py:379` | `_json_scalar` | `_json_scalar` has zero usages outside its own definition |
| `csdm/engine/core.py:448` | `_await_process_exit` | `_await_process_exit` has zero usages outside its own definition |
| `csdm/engine/core.py:489` | `_pg_connect` | `_pg_connect` has zero usages outside its own definition |
| `csdm/engine/core.py:591` | `_qe_match_type_sql` | `_qe_match_type_sql` has zero usages outside its own definition |
| `csdm/engine/core.py:610` | `_qe_headshot_sql` | `_qe_headshot_sql` has zero usages outside its own definition |
| `csdm/engine/core.py:631` | `_qe_teamkill_sql` | `_qe_teamkill_sql` has zero usages outside its own definition |
| `csdm/engine/core.py:654` | `_mods_dp2_global_any_union_enabled` | `_mods_dp2_global_any_union_enabled` has zero usages outside its own definition |
| `csdm/engine/core.py:666` | `_qe_suicide_sql` | `_qe_suicide_sql` has zero usages outside its own definition |

> 273 more in PROJECT_ATLAS.json

### swallowed_exceptions (184)

| File:line | What | Why |
|---|---|---|
| `csdm/bridge/host.py:334` | `KeyError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/bridge/host.py:341` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/bridge/host.py:382` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/bridge/host.py:366` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/config.py:223` | `OSError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/config.py:215` | `(OSError, ValueError)` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/core_utils.py:24` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/core_utils.py:38` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/core_utils.py:147` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/core_utils.py:28` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/core_utils.py:42` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:37` | `ImportError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:1470` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:2497` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:2703` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:2804` | `AttributeError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:3327` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:3883` | `AttributeError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:4615` | `(TypeError, ValueError)` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:4645` | `(TypeError, ValueError)` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5257` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5269` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5315` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5347` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5416` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5578` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5617` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5667` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5693` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:5707` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:531` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:581` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:587` | `ValueError` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:2014` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:3290` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:3317` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:3644` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:4060` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:4087` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |
| `csdm/engine/core.py:4105` | `Exception` | except handler neither re-raises nor logs -- the failure is swallowed silently |

> 144 more in PROJECT_ATLAS.json
