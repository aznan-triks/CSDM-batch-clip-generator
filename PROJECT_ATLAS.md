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
| `log` | `csdm/bridge/ports.py:23` | `log(self, message, level='')` | yes |
| `log` | `csdm/engine/ports.py:40` | `log(self, message, level='')` | yes |
| `log` | `csdm_batch_clips_generator.py:4654` | `log(self, message, level='')` | yes |
| `add` | `csdm/widgets.py:139` | `add(self, widget)` | yes |
| `add` | `csdm/widgets.py:207` | `add(self, card)` | yes |
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

## React components (40)

| Name | File:line | Props |
|---|---|---|
| `App` | `electron/renderer/src/App.tsx:4` | - |
| `ActionButton` | `electron/renderer/src/components/ActionButton.tsx:46` | label, icon, variant, armed, disabled, onClick |
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
| `AppShell` | `electron/renderer/src/shell/AppShell.tsx:34` | - |
| `Backdrop` | `electron/renderer/src/shell/Backdrop.tsx:46` | - |
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
| `WeaponBand` | `electron/renderer/src/weapon/WeaponBand.tsx:46` | weaponId, status, progress, counter, frameRef, buttonRef |

## React hooks (9)

| Name | File:line |
|---|---|
| `useEngineState` | `electron/renderer/src/motion/useEngineState.ts:124` |
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
