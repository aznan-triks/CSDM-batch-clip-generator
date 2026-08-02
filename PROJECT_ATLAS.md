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
