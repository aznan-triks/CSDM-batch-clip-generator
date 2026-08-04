# Changelog — CSDM Batch Clips Generator

All notable changes to this project are documented in this file.
Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Public scope:** this file documents what a **user** of the software experiences (features,
> fixes, behaviour). The development-internal journal — chantiers, tooling (atlas, e2e), audits,
> unreleased technical steps — lives in [`CHANGELOG_DEV.md`](CHANGELOG_DEV.md).

> **Version numbering note:** sub-releases previously written as `133.xx` or `143.x` have been
> renumbered as sequential integers. `133.33` → `134`, `133.34` → `135`, …, `133.42` → `143`,
> `143.0` → `144`, `143.1` → `145`, …, `143.8` → `152`. Each dot was always one real increment.
>
> **Numbering re-aligned (2026-08-04):** the artificial `v299` delivery was renumbered to `v216`, and
> the five post-`v216` deliveries are numbered sequentially `v217` → `v221`. Nothing between v215 and
> v216 was skipped — the jump was a user choice at delivery time, undone here for a continuous sequence.
>
> **Semantic switch (2026-08-04):** the Electron-era release is numbered `3.0`, replacing the
> sequential `v22x` series.

---

## 3.0.1 — 2026-08-04

Where the settings files live is now your choice — and switching never deletes anything.

**Humanised:** The four settings files no longer have to sit at the root of the script folder. They now
live in a tidy "CSDM Batch Clip Generator" subfolder beside the script (the new default), and you can
move them to your Local AppData or any folder you pick — the app creates its own subfolder there.
Switching COPIES the files to the new place; the old ones are never removed, so nothing is ever lost.
If the destination already holds settings files, the app asks you twice before replacing them, and
saves a backup of the old ones first.

### Added

**Humanised:** A "Configuration Folder" card in Settings with three buttons — Script folder, Local
AppData, Choose… — and the current location shown. On the first launch of this version, the old files
at the script root are copied into the new default subfolder automatically.

**Technical:** New `config_dir` DEFAULT_CONFIG key (`""` = script subfolder, `"appdata"` =
`%LOCALAPPDATA%\CSDM Batch Clip Generator`, absolute path = subfolder created inside it).
`csdm/config.py` resolves the four JSON paths dynamically (`resolve_config_dir`), bootstraps through
the default-location config acting as pointer (`_bootstrap_dir`), migrates legacy root files once
(`_migrate_legacy_root_files`), and adds `probe_config_dir` / `apply_config_dir` — copy never move,
`backup-<timestamp>/` before any overwrite, pointer update so the next launch lands on the live copy.
New bridge commands `probe_config_dir` / `apply_config_dir`; SettingsTab card with a two-step
confirmation when the destination already has files; `tests/test_config_location.py` and renderer
tests cover the flow.

---

## 3.0 — 2026-08-04 (The Electron Era)

The release that moves CSDM Batch Clips Generator from its Python-only past to its Electron
present. The engine and the interface are now two separate layers: a modern, fluid window
(Electron + React) in front, and the proven Python engine working quietly behind it. Bumped
to `3.0` at delivery (user go-ahead, 2026-08-04).

**Humanised:** This is the version where the application changed skin — and structure. Before,
one classic desktop window drawn entirely by Python; now, a modern interface built around the
same engine, which still does all the real work. The change took eight careful steps, and the
application stayed usable through every one of them.

### Added

**Humanised:** A brand-new interface — a modern window with a holographic theme matching the
approved design, readable contrasts, and smooth animations everywhere: cards rearrange by
dragging, fold and unfold gently (no more abrupt jumps), and the tab indicators glide between
tabs. Your layout is remembered between sessions: card order, folded cards and widths all
survive a restart. Clip capture now goes beyond kills — non-lethal damage, friendly fire,
shots into the void, jumps and near-misses, each clip tagged with a coloured badge. And an
automated visual watch compares every change to the approved design, so a style regression is
caught before it reaches you.

**Technical:** Electron shell with a React 19 renderer and the Python engine spawned as a
child process behind a JSON bridge (`csdm/bridge/`); the engine runs headless (`stage 1.5`),
its events reach the UI through typed ports, and the window never needs the console. The
interface is styled from an approved mock (`mock-v12.css` + `mock-bridge.css`, generated,
never hand-edited) with FLIP drag-to-reorder, a persisted per-tab layout (`ui_sections`), the
two-axis event capture model, and an e2e camera suite that diffs the real window against a
pixel baseline.

### Changed

**Humanised:** Cards open and close smoothly instead of snapping, so nothing jumps under your
cursor mid-click. The engine reports when CS2 is really dead, previews can be cancelled
without a window, and log lines with accents or special characters no longer break anything.

**Technical:** Card bodies stay mounted and fold through a `grid-template-rows: 1fr → 0fr`
transition (mock-bridge.css) instead of the mock's `display:none`; process kill is verified
by polling, not a timer; the bridge forces UTF-8 on Windows.

### Fixed

**Humanised:** The layout-shift when folding a card (the "everything jumps" effect) is gone.
Resizing the window no longer crashes. The engine no longer fails silently after the move to
its own package. Log lines with accented characters survive the trip to the console.

---

## v221 — 2026-08-04

Clip capture is no longer kill-only: the engine now also selects non-lethal damage, friendly fire,
shots, jumps and near-miss, through a new two-axis selection model (Perspective × Action type)
validated by a local council review (3 roles: scalability, maintainability, simplicity — 3 critical
bugs caught in the plan and fixed before implementation, plus 1 BLOCK in the post-implementation
review, fixed the same day). Bumped to `v221` at delivery (user go-ahead, 2026-08-04).
Verified by 340+ backend tests (migration, e2e, sequences) and the existing
frontend suite (317 passed in the broken-jsdom environment; 222 pre-existing failures untouched).

### Added

**Humanised:** You can now capture clips for more than kills: non-lethal damage (shots that injure
without killing), friendly fire, and "other" actions (shots into the void, jumps, near-miss). The
Capture tab's event selection is a new two-axis control — choose who acts (you, or someone acting on
you) and what counts (lethal, non-lethal, other) — plus a separate choice of ally/enemy events. You
can even capture non-lethal and "other" actions with lethal turned off, and the editing tab labels
every clip with its type (kill / damage / shot) with a coloured badge.

**Technical:** `DEFAULT_CONFIG` gained the keys `event_actor`, `event_target`, `event_lethal`,
`event_ally`, `event_enemy`, `event_non_lethal`, `event_other` replacing the flat `events` list;
`_migrate_config` converts old configs transparently (including the three-way `teamkills_mode`
mapping include/exclude/only). `derive_event_flags_v2` derives `_events_*` booleans consumed by the
new queries `_query_damages` (non-lethal damage) and `_query_shots` (other actions). `FilterDef`
gained `applicable_to` so kill modifiers (headshot, no-scope, airborne…) evaluate on damage/shot
events through `_evaluate_modifiers_for_event`. `_build_team_filter_sql` replaces the deprecated
`_qe_teamkill_sql` for ally/enemy filtering. `_build_sequences` now interleaves kill/damage/shot
sequences in tick order and tags each clip with `event_type`. New UI: `EventTypeSection.tsx`
(Perspective × Action type × Team chips) in `CaptureTab.tsx`; `EditingTab.tsx` shows typed badges.
New tests: `test_config_migration.py` (20), `test_e2e_events_beyond_kill.py` (20 incl. Lethal
toggle behaviour), +8 in `test_pure_logic.py`.

### Fixed

**Humanised:** The Lethal toggle actually controls kills now — before this fix it was computed but
never wired to the kill query, so switching it off changed nothing.
**Technical:** `derive_event_flags_v2` now emits `events_kills = actor AND event_lethal` and
`events_deaths = target AND event_lethal` so the legacy query path respects the toggle; 2 behaviour
tests prove Lethal off → no kill events while damage still appears.

## v220 — 2026-08-03 (Weapon cascade proportions)

### Changed

**Humanised:** Weapon silhouettes in the Weapon Filter card keep their own proportions — a HE
grenade no longer floats in empty space and a sniper rifle no longer dominates the row.
**Technical:** `weapon/silhouettes.ts` exposes `silhouetteRatio()` (from each SVG viewBox);
`tabs/WeaponFilterSection.tsx` renders every icon at a shared 44px height with a width that
follows the weapon's own ratio, clamped to keep tiny grenades readable and stop long rifles from
crowding the cascade. Silhouette fade-out mirrors the CSS transition duration instead of a
hardcoded delay. CS2 weapon art refreshed from the community pack (`scripts/refetch_cs2_icons.mjs`).

## v219 — 2026-08-03 (Must/Enable coupling fix)

### Fixed

**Humanised:** The ★ Must box now behaves like the Tkinter window: clicking it arms the filter
and turns Enable on by itself — Enable is no longer required first. Switching Enable off still
drops Must, so a required filter can never stay armed under a disabled one.
**Technical:** `settings/FilterRow.tsx` and `tabs/CaptureTab.tsx` now mirror the engine's
`_wire_enable_must` coupling (React previously refused to arm `*_req` unless the base key was
on). Both toggles go through dedicated handlers; `FilterRow.test.tsx` and `CaptureTab.test.tsx`
updated from "refuses to arm" to "arms Must on its own and auto-enables the filter".

## v218 — 2026-08-02 (Priority fixes, from `IMPROVEMENT_SUGGESTIONS.md`)

Five punch-list items reported against the running app, fixed and verified against the live
renderer (Playwright + stubbed bridge, screenshots in `electron/e2e/output/`; 622/622 unit tests
green, `npm run typecheck` unchanged — the two `restartEngine` mock errors are pre-existing on this
branch, untouched by this change).

### Fixed

**Humanised:** Picking a weapon finally shows its icon in the cascade (before, most of them were
invisible). Picking lots of weapons no longer hides the ones that don't fit in one row — they wrap
to the next line instead. The crosshair no longer locks onto the navigation tabs (only real action
buttons keep the "aim" treatment). Switching tabs no longer teleports the top bar while the bottom
indicator slides. And the cursor stops feeling laggy/floaty outside the cards: the crosshair now
tracks the mouse instantly, the way the approved mock always did.
**Technical:** `tabs/WeaponFilterSection.css` gave `.casc .gun` the mock's own `height: 44px` (the
mock's `.gun` is 44px; the port painted a `width: 96px` silhouette with no height, i.e. a 0-height
mask nobody could see) and added `flex-wrap: wrap` to `.casc` (the mock shows two guns and never
scrolls; the real database holds ~30 with art, so `nowrap` pushed every gun past the card edge).
`cursor/Reticle.tsx` removed `.tab` from `SNAP_SELECTOR` (the restyle-6 widening to `.btn, .chip,
.tab, .seg button` made the reticle fight the tab indicator animation and "aim at a menu";
`Reticle.selectors.test.ts` now asserts `.tab` is NOT named). `components/Tab.css` added
`transition: background .25s, transform .25s` to `.tab` and `transition: opacity .25s` to
`.tab.active::after` — the mock animates `.ic`/`.tk`/`.ind` but never the tab box itself, so the top
accent bar snapped while the bottom indicator slid; this is a documented addition beyond the mock
(no pseudo-element transition exists there). `cursor/Reticle.css` dropped `left`/`top` from
`.cursor-reticle`'s transition — the mock's `.tcursor` has no position transition either, so the
port's `left/top var(--dur-fast)` tween is what made the crosshair drag behind the pointer over the
background; it now follows `clientX/clientY` instantly (width/height/opacity still tween for the
snap gesture).

## v217 — 2026-08-01

Restyle 6 (2026-08-01, same day as v216): a punch list of HUD polish and one Tkinter-parity gap,
reported directly by the user against the running app. Version assigned during the 2026-08-04
numbering re-alignment. No manual recette on real data this session either —
verified by `npm test`/`npm run typecheck` (583/583, clean) and a live DOM/console check on a
throwaway Vite instance (port 5283, no Electron/bridge), not a screenshot: the Browser pane could
not compose frames in this session (headless, user AFK), so no pixel-level "before/after" proof
exists for these changes yet — flag before the next visual close-out (context_guide.md §1 P8).

### Added
**Humanised:** Creating a tag now offers 20 colour swatches plus a custom colour picker, instead of
every new tag being silently orange. Cards can be resized between one and two columns by clicking
their bottom-right corner bracket (the same one that already flickered on hover), and the choice
is remembered.
**Technical:** `TagsTab.tsx`'s `tag_create` call used to hardcode `color: "#f97316"`; the picker
mirrors `theme/accent.ts`'s pattern with a new `TAG_COLOR_PRESETS` (`csdm/static_data.py`'s
`TAG_PRESET_COLORS`, mirrored the same way `ACCENT_PRESETS` mirrors `_ACCENT_PRESETS`) plus a
native `<input type="color">`. `Card.tsx` now forwards a ref and renders an invisible
`.resize-br` hit target (the mock's own `.cbr.br` stays `pointer-events:none` decoration);
`sectionLayout.ts`'s `ui_sections` gained a per-card `wide` override, read/written by
`SectionList.tsx`'s `toggleWide`.

### Changed
**Humanised:** Cards reorder and resize live now (no more snap-into-place), the holographic grid
behind every tab is the same size everywhere, the flicker on card hover is easier to see, cards
pack more tightly instead of leaving empty space next to shorter ones, every card has a visible
line between its title and its content, the crosshair now locks onto tags/tabs/segmented options
too (not just the big action buttons), the four run counters (Demos/Clips/Total/Avg per clip) live
in the bottom bar now so they are visible from every tab instead of only at the bottom of Capture,
the Tags page no longer repeats every tag name twice (once to select, once to delete), and buttons
and text fields pick up a couple of small CS2-style touches (a bevel sheen on flat buttons, a glow
on a focused field).
**Technical:** `SectionList.tsx` gained a FLIP reorder animation (`useLayoutEffect`, no new pointer
listener, so neither no-hover-motion.test.ts guard applies). `shell/backdropField.ts`'s
`BACKDROP_BY_TAB` no longer overrides `cell`/`gap` per tab. `Card.css`'s `.sec:hover .glx`/`.cbr`
now run `mix-blend-mode: normal` and loop `infinite` while hovered instead of stopping after two
cycles (`background`/`border` stay untouched — Card.css.test.ts reserves those for the mock).
`.capture-tab`/`.tags-tab`/`.video-tab`/`.settings-tab` all gained `grid-auto-flow: dense`. New
`.sep` element between `.sh` and `.sb`. `cursor/Reticle.tsx`'s snap target widened from `.btn` to
`SNAP_SELECTOR = ".btn, .chip, .tab, .seg button"`. `StatStrip` gained a `compact` prop, mounted in
`weapon/WeaponBand.tsx`'s `.band-meta` instead of a standalone `.wide` cell in `CaptureTab.tsx`.
`TagsTab.tsx`'s per-tag delete button merged into the same `.chips` row as the selection chip.
`ActionButton.css`/`Field.css` gained a `box-shadow` (inset sheen / focus glow respectively).

### Fixed
**Humanised:** Five follow-up polish issues reported against the restyle above, audited first
(`docs/audits/AUDIT_restyle6_polish_regressions.md`) then fixed: resizing a card no longer makes
everything jump around unreadably, a collapsed card now actually shrinks even when its neighbour
stays open, the crosshair now locks onto the exact center of the button you're hovering instead of
trailing the mouse inside it, the flicker on card hover stops after a few blinks instead of running
the whole time you hover, and dragging a card to reorder it now updates live as you drag instead of
only once you let go.
**Technical:** `SectionList.tsx`'s FLIP effect now also inverts `width` (not just `translate`) when
`.wide` toggles, and calls `reorder()` on `onDragEnter` instead of only `onDrop` (`onDragOver` keeps
just `preventDefault()`); `Card.tsx`/`CardProps` gained `onDragEnter`. `mock-bridge.css` gained two
measured full-rule disagreements (previously token-remaps only): `.bento{align-items:start}` (CSS
Grid's default `stretch` was keeping a closed card's box at its open neighbour's height) and `.sec`'s
`transition` list gained `width` (mock-v12.css:109 only had `transform`/`box-shadow` — its static demo
never resizes a card). `Card.css`'s `.sec:hover .glx`/`.cbr` `animation-iteration-count` went from
`infinite` (the 2026-08-01 fix over-corrected "stops after two cycles" into "never stops") to a finite
`3`. `cursor/Reticle.tsx`'s button-snap case now centers `--cx`/`--cy` on the hovered button's own
rect instead of `event.clientX`/`clientY` — verified against the mock's actual JS
(`mockup-v12-hologlass.html`), which never did this either; this is a deliberate addition beyond the
mock, not a restored behaviour.

**Humanised (same-day follow-up):** Selecting things like a filter no longer makes every card on the
page slide around — only an actual reorder or resize animates now. The card-hover flicker is brighter
too. Live drag reordering still isn't confirmed working for real (see Known gaps).
**Technical:** `SectionList.tsx`'s FLIP effect ran unconditionally on every render, so any unrelated
content-height change elsewhere in the tab (confirmed live: a date-preset click moved all 8 Capture
cards, `dTop` up to 133px) got animated as if it were a reorder. It now only runs the invert/release
dance when a signature of `order`/`isCollapsed`/`wideOverride` actually changed since the previous
render; an unrelated reflow still moves cards, just without the slide. `Card.css` gained a local
`card-scintillate` keyframe (peaks at .9/.75 instead of the mock's `block-flick` .5/.42,
mock-v12.css:58) for `.sec:hover .glx`/`.cbr` — `.cbr`'s old `opacity:.85` (mock-v12.css:115) was
always beaten by the lower-peaking animation running on top of it.

**Humanised (same-day, second follow-up):** Dragging a card to reorder it no longer relies on the
browser's native drag-and-drop, which was the reason it never updated live.
**Technical:** New `shell/useCardDrag.ts` — `mousedown` on the handle, `window` `mousemove`/`mouseup`
for the gesture's duration, same pattern as `AppShell.tsx`'s console-resize handle, added to
`no-hover-motion.test.ts`'s `CURSOR_DRIVEN_ALLOWLIST`. `Card.tsx`/`CardProps` and `SectionList.tsx`'s
`SectionSpec` lost `onDragOver`/`onDrop`/`onDragEnter` entirely (dead code, not layered under the new
mechanism); `tabs/PresetSection.tsx` had its own now-dead copies of the same two props, removed too.

### Known gaps (not fixed this session, flagged rather than silently skipped)
User also asked to restore "possibilities" the Electron port has fewer of than the Python script.
Audited (`docs/audits/` not written — this was a direct code comparison, not a full audit plan);
findings beyond the tag-colour fix above:
- **Player favorites** (`PlayerSearchWidget`'s "★ REGISTERED ACCOUNTS" persistent list in Tkinter)
  never ported — `tabs/PlayerSection.tsx` already documents this gap in its own header comment.
- **Range-mode demo picker** stays empty outside Manual mode — `DemoSelectionSection.tsx` already
  documents that chantier 4c never piped a Preview result into a state event this component reads.
- **Injection preview panel** (`SettingsTab.tsx`) is a disclosed `"not available yet"` stub.
- Every dropdown/slider/multi-select option list checked (codecs, resolutions, presets, weapon/
  match-type/map filters, kill-count options, HLAE/CS2-effects quick values) matched Python's
  exactly — no other restriction found.
- **Live drag reorder**: native HTML5 drag-and-drop (`onDragEnter`) was replaced entirely with a
  pointer-based drag (`shell/useCardDrag.ts`, same `mousedown`-then-`window` `mousemove`/`mouseup`
  pattern already used by the console-resize handle in `AppShell.tsx`) — native drag-and-drop is known
  to lose track of the hovered target once the DOM under the cursor reorders mid-drag, which is
  exactly what a live reorder needs to do. Confirmed by unit tests
  (`useCardDrag.test.ts`, `SectionList.test.tsx`); **not confirmed against the real running app** this
  session (no screenshot tooling available to drive a real mouse-drag gesture) — please test for real
  before considering this closed. See `docs/audits/AUDIT_restyle6_polish_regressions.md` #8.

## v216 — 2026-08-01

### Fixed

**Humanised:** The console panel can be resized by dragging its edge again, and two buttons the old
window had — Copy all, Copy sel. — are back.
**Technical:** `AUDIT_console_resize_boutons.md`. `.shell` was a fixed `1fr 288px` grid with no drag
handle; `ui_split_pct` already existed as a typed Settings field but drove nothing. A new
`.split-handle` drags it live via `--split-left`/`--split-right` (percent, not `fr` — `calc()`
producing an `fr` value silently fell back to a single implicit column in this Chromium build,
caught live rather than by the test suite). `Copy all`/`Copy sel.` call
`navigator.clipboard.writeText`, mirroring Tkinter's `_log_copy_all`/`_log_copy_sel`.

**Humanised:** Nine kill filters (MATE POV, SPRAY TRANSFER, HIGH VELOCITY / Ferrari Peek, FLICK,
SAVIOR, WALL BANG, AIRBORNE, ATTACKER BLIND, COLLATERAL) crashed Preview outright the moment they
were used in the Electron app — the Tkinter window never had this problem.
**Technical:** Found by actually running the packaged app end-to-end (the manual recette this
chantier had deferred for six sessions), not by reading code: `PREVIEW` with Mate POV on threw
`'BridgeHost' object has no attribute '_mate_pov_filter'`. Root cause: chantier 1's engine
extraction moved the camera builders (`_build_cams_*`) and three dp2 filters
(`_trois_shot_filter`/`_one_tap_filter`/`_no_trois_shot_filter`) into `csdm/engine/core.py`, but
left these nine — plus their shared helpers (`_parse_mate_positions`, `_find_sid_in_tick`,
`_fuzzy_sid_in_set`, `_find_best_mate_sid`, `_death_flag_filter`, `_death_flags_for_kill`,
`_penetrated_kills`, `_weapon_suffix_key`) and the `_mate_pov_camera_sid` hook — as `App`-only
methods. They ran fine under Tkinter (`App` has them directly) and threw under `BridgeHost`, which
only inherits the extracted mixins. Moved all of it verbatim into `EngineMixin` (829 lines); `App`
still gets them through inheritance, so Tkinter behaviour is unchanged. Two isolation bugs the move
itself introduced, caught by this repo's own guard tests before either shipped: eight `self.log(...)`
calls had been written as `self._async_log(...)` (a Tkinter-only method name, not the engine's
`log`/`log_parts`/`state`/`ask` port contract — `tests/test_engine_isolation.py`), and `math` wasn't
imported in `core.py` (`tests/test_engine_globals.py`, the same class of bug chantier 1 hit in v208).
Re-verified live: the exact Preview that crashed now completes cleanly.

**Humanised:** Cards, the top nav bar and the console are frosted glass again in the real packaged
app — they had gone fully see-through, with none of the soft blur the mockup shows.
**Technical:** Vite's default CSS minifier read the standard `backdrop-filter` and its `-webkit-`
twin on `.sec`/`.hud-nav` as the same declaration made twice and dropped the standard one, leaving
only the `-webkit-` fallback this Electron's Chromium no longer reads. The dev server (unminified)
looked correct throughout, which is why the restyle-5 audit — run against it — never caught this.
`cssMinify: false` in `electron/vite.config.ts`. Verified visually in the packaged app, side by side
with the mockup, not just via `getComputedStyle`.

**Humanised:** A weapon's silhouette, in the Weapon Filter card, painted as a solid block of the
accent colour instead of the weapon's actual shape.
**Technical:** `.casc .gun` (`WeaponFilterSection.css`) masks the icon through `mask`/`-webkit-mask`
without a `mask-mode`. The standard `mask` defaults to luminance-based compositing for an external
image source — unlike the legacy `-webkit-mask` beside it, which is alpha-only. The vendored CS2
icons are a single black fill on a transparent background: under luminance, the black silhouette and
the transparent background both score near-zero, so almost nothing was cut out. Confirmed live in
the packaged app (not jsdom, which never paints and let this ship): `getComputedStyle` showed a
valid `--gun-art` `url()` and the resource fetched fine (200), yet the paint was a solid rectangle.
`mask-mode: alpha` (+ the `-webkit-` twin) fixes it — verified live before being written to source.
Root cause: `docs/audits/AUDIT_weapon_silhouettes.md` (local, not tracked — `docs/` is gitignored).

**Humanised:** Some small labels (stat keys, the card chevron, console timestamps) were too pale to
read comfortably in light mode.
**Technical:** `mock-v12.css` defines `--faint: #93a1b5` and six selectors use it; `mock-bridge.css`
already remapped the mock's other under-AA colour (`--muted`) to `--dim` but never did the same for
`--faint`. Now `--faint: var(--dim)` too. Guarded by `theme/__tests__/contrast.test.ts`.

**Humanised:** Pressing KILL now shows the weapon actually firing — a muzzle flash and tracer round —
before it racks and gets put away, instead of jumping straight to the retraction.
**Technical:** `playKill` (`weapon/sequences.ts`) never called `shot()`/`recoil()`, which already
existed and were used by RUN and PREVIEW. Now called first, ahead of the existing bolt-cycle, shake
and retraction. `weapon/__tests__/stop-waits.test.ts` asserts the flash and tracer are spawned.

### Added

**Humanised:** Capture, Video and Settings cards can now be folded shut and dragged into a different
order, and both survive a restart, per tab.
**Technical:** `Card.tsx` gained a controlled fold state (`open`/`onToggle`, optional -- every prior
caller keeps its own internal state). A new hook `useSectionLayout` and component `SectionList`
render each tab's cards from a `SECTIONS` array instead of a fixed JSX sequence, backed by one new
settings key (`ui_sections`, per-tab `{order, collapsed}`, reconciled against each tab's declared
sections on every read so a stale or missing id can never drop a card). Deliberately not a preset key
-- presets are run configuration, this is display state. Drag-and-drop is native HTML5, no new
dependency; no DOM wrapper around `Card` (`.bento`'s grid and `.wide`'s `grid-column:1/-1` sit on
`.sec` itself, so drag handlers pass straight through to it).

**Humanised:** The log panel writes itself out now, a character at a time, like the approved design.
**Technical:** `useTypewriter` reproduces the mock's `pump()` with three differences it never had to
face: only the last twelve lines are typed (a batch emits hundreds, and a log still spelling out what
happened a minute ago is unreadable), nothing types at all under motion intensity `none`, and one
timer owns the queue rather than one per line. The cut runs ACROSS the coloured pieces, so a
two-colour line is written straight through its colour change. All three numbers are in `MOTION`.

**Humanised:** Each tab now stamps its own mark on the moving background — a crosshair on Capture,
quiet dots on Tags, the card's bracket on Video, hatch on Settings.
**Technical:** `drawMotif` is pure and derives everything from the plate's side, so a mark is legible
at any cell size a tab picks. Geometric, not images: the mark is redrawn every frame for every plate
inside the cursor's reach, and an image blit per plate is exactly the per-tile cost that moved this
layer off the DOM in the first place. The caller scales it by the plate's intensity, like everything
else in that pass.

**Humanised:** The Tags tab can now delete a tag outright, not just remove it from selected demos.
**Technical:** `csdm/bridge/host.py::_cmd_tag_delete` existed with no UI entry point anywhere — flagged
by `AUDIT_retours_restyle5.md` R12 and left open. `TagsTab.tsx` now has a delete button per tag,
wired to `tag_delete`, reloading the tag list on success.

### Changed

**Humanised:** In the Video tab, Recording System (and HLAE Options) now come before Encoding, ahead
of how the result gets encoded rather than after. In Capture, the retry/timeout/output-order controls
that used to live inside "Capture & Timing" now have their own "Timing & Retries" card. In Settings,
PostgreSQL Connection is now the first card, not the fourth.
**Technical:** Pure JSX reorder plus one card split, no settings key touched, no behaviour change --
`electron/renderer/src/tabs/{VideoTab,CaptureTab,SettingsTab}.tsx`.

**Humanised:** The weapon icons are the game's own now, all forty-two of them, and every hand-drawn
shape this project ever carried is gone.
**Technical:** 42 SVGs from `Juknum/counter-strike-icons` (`cs2/panorama/images/icons/equipment/`),
vendored under `weapon/assets/cs2/` with provenance and Valve's ownership statement in SOURCE.md.
Checked before vendoring: no `<script>`, no external `href`, no embedded `<image>`, no event
handler. Then reduced 585 kB → 461 kB (metadata dropped, `viewBox` left to drive the scale, `fill`
left to CSS, coordinates rounded to two decimals). They are asset URLs painted through a CSS mask
over `currentColor`, so they keep the accent, stay out of the JavaScript bundle, and the cascade no
longer needs `dangerouslySetInnerHTML`. `GAME_FILE` earns its place as a translation table: `P2000`
is `hkp2000`, `Dual Berettas` is `elite`, `Zeus x27` is `taser`, and `M4A4` is the game's plain
`m4a1` while `M4A1` is `m4a1_silencer`. `World` takes `prop_exploding_barrel`, since the pack's own
`world.svg` is an empty frame.

### Fixed

**Humanised:** The crosshair cursor locks onto buttons again. It always could — but it was also
showing over every card, and something already on screen everywhere cannot be seen to arrive
somewhere.
**Technical:** The reticle chose where to appear from a DENYLIST of widgets naming `.panel-box` and
`.segment`. Restyle 5 renamed those to `.sec` and `.seg`; both names have had zero usages ever
since, so the reticle showed over cards and segmented controls. It is an allowlist of backgrounds
now, matched on the target itself, exactly as the approved design does it (`BG_SEL`) — and one that
fails the safe way round: a renamed container makes the reticle vanish from somewhere, which is
visible, rather than appear everywhere. A new guard requires every class the reticle names to exist
elsewhere in the source; it caught two mistakes in the change that introduced it.

---

### Added

**Humanised:** Gauges can be typed into now, not only dragged, and the rail follows what you type.
**Technical:** Every `Slider` carries a `NumberField`. The rail and the box are two views of one
number, both re-rendered from `value`, so neither can drift. Clamping lives in the field: a free
box can hold 99 or -3 and the rail beside it cannot. An empty box reports nothing, since
`Number("")` is 0 and would jump the value to the floor mid-edit.

**Humanised:** The dark themes are three different themes now. Amoled is true black, deepblue is
navy, terminal is the industrial blue-black — where all four used to be the same screen.
**Technical:** `applyMode` stamps `data-ground` beside `data-mode`; `theme/grounds.css` keys on it.
The values are `_BG_PRESETS` from `csdm/theme.py`, not invented: each preset gives four steps where
the ladder needs five and demands strictly increasing luminance (D9), and each quiet ink is lifted
a little to clear AA on its own ground. `--page-0`/`--page-1` are set per ground because the mock
writes them as literals at a higher specificity than the bridge's mapping — without that, four
nights kept one identical page. `theme/__tests__/grounds.test.ts` holds all three to the ladder and
to 4.5:1.

**Humanised:** Each tab can give the moving background its own character.
**Technical:** `BACKDROP_BY_TAB` states per tab only what that tab changes; `fieldForTab` merges it
over the reference field and hands an unknown tab the reference rather than nothing. `cellIntensity`
takes the field as a parameter, so the maths still knows nothing about tabs, and a test forbids any
`BACKDROP.` left in the drawing code — one would silently ignore the tab. The shell stamps
`data-tab` on `<html>`; the backdrop's existing observer watches for it.

**Humanised:** Every weapon shows a silhouette when you pick it, not just two of the forty-two.
**Technical:** `weapon/silhouettes.ts` prefers the firing table's own art, then falls back to the
weapon's class — taken from `WEAPON_CATEGORIES`, which the engine already ships through
`describe_filters`, so there is no second list to drift. Seven class shapes join the two real ones.
A per-weapon set would mean vendoring game-extracted assets whose licence the user has to settle
first; when that happens, adding a weapon to `WEAPONS` is enough, since the specific table is
consulted first. An unclassed weapon still draws nothing, on purpose.

### Changed

**Humanised:** The log panel says what the engine is doing instead of reciting the plumbing. Lines
are timestamped, multicolour lines keep their colours, and the prompt shows the action under way.
**Technical:** `shell/consoleNarrative.ts` turns each protocol message into the line a person would
read, or into `null` for the events that steer the interface without being worth saying. `[log:ok]`
repeated in text what the CSS class already said. `log_parts` arrives as a list of coloured runs —
the engine really sends `[["  ⏱ Timeout: ","dim"],["2m30s","info"],…]` — and was joined into one
grey string; the capability existed at both ends of the pipe and died at the last step. A successful
`[result]` is a counter and a fact already visible; a failed one keeps its explanation. The thirteen
state events, the moments the approved design narrates, were dumped as raw JSON. An unheard-of event
is still printed: a silent unknown is how a new engine event goes unnoticed for a release.

**Humanised:** The player list is paged and sortable, so 7892 players stop freezing the tab.
**Technical:** Measured on the real database — not the 3000 reported — the list rendered whole was
31 568 DOM nodes and 139 ms of layout, against 395 nodes for the whole rest of the page, and it was
rebuilt on every keystroke. It now takes 60 at a time, ordered by name or by most recently seen.
Filtering runs over the whole database before the page is cut, so a name stays findable without
walking to it. The page index is clamped rather than reset by an effect, so a narrowing search
cannot render an empty page first.

**Humanised:** The last four odd button styles now match the rest of the window.
**Technical:** `date-field-btn`, `dp-btn` with its green/red inks, `log-toggle`, and the console's
unclassed Export button all become the mock's `.chip`. Measured on the rendered page: 14 variants →
10, and `chip on` appears for the first time. The console restates density only — the mock draws
three icon-only tools where this window has five with text labels in a 288px column.

### Fixed

**Humanised:** Tags show their colours. They only ever showed one when the tag was already picked —
which is never the case when the tab opens.
**Technical:** The colour rides on the mock's own `.d` dot, in both states. An inline style outranks
`.chip.on .d { background: var(--lime-ink) }`, so picking a tag no longer costs it its identity —
before, a blue tag rendered green either way.

**Humanised:** The accent colour finally reaches the moving background.
**Technical:** Three links were missing and each alone broke the chain: `theme/accent.ts` and
`shell/Backdrop.tsx` had an empty intersection of token names; the glows repeated `--holo` instead
of referencing it (`rgba(34, 211, 238, …)` IS #22d3ee in decimal); and the backdrop's observer
watched `data-mode` only, where `applyAccent` writes inline custom properties. Verified in a real
browser: `applyAccent('#ff0000')` moves `--holo`, `--glow-in`, `--tile-border` and `--amb-a`
together.

**Humanised:** The log panel no longer grows without limit while a batch runs.
**Technical:** It renders the last 1500 lines. The lines themselves are kept — a work tool's log is
the record of a run, and the export still writes every one. The mock drops its own past 40.

---

### Fixed

**Humanised:** Clicking RUN without picking a player froze the app for good. An error message
appeared with no button on it — nothing to press, no way to dismiss it — and behind the scenes the
engine sat waiting for an answer that could never be sent. Every further click piled on another
stuck request.
**Technical:** `csdm/engine/core.py::validate_run_inputs` refuses an incomplete run or preview with
`ask("error", "…", [])` — a blocking dialog carrying no options — and `csdm/bridge/ports.py::ask`
then waits on `done.wait()` with no timeout. `shell/LogConsole.tsx` rendered `options.slice(1)`,
which on an empty array is no buttons at all, with no cancel outside that loop: `answer()` was
unreachable, `resolve_answer` was never called, the engine thread never woke, and the command's
`result` was never sent. The Tkinter host has always handled both shapes — `kind == "error"` opens a
`showerror` with one OK button and always answers `"ok"`, ignoring `options`; anything else is
titled by `options[0]`, offers `options[1..]`, and cancels to null. `PendingAsk` now carries `kind`
and the panel always renders a closing button. The null also revives a live engine branch: `if
answer is None` on the already-tagged-demos question unchecks them and restarts the preview, and it
was unreachable from this window. Guarded by `shell/__tests__/LogConsole.ask.test.tsx`.

**Humanised:** Nothing showed what was selected. A checked weapon, an active kill filter, a chosen
map, a retained video preset — all of them looked exactly like the ones next to them that were not
chosen.
**Technical:** The approved design styles `.chip.on` (lime fill, lime border, dark-green ink) and
restyle 5 emptied `components/Chip.css` of everything the design states — its own comment says so.
But the component was never renamed onto that class: it wrote `chip chip-selected`, and
`chip-selected` has no rule in any stylesheet (`rg -c "chip-selected"` over the shipped bundle
returns 0). One line, 27 call sites across 10 files. `TagsTab` was the only place selection was ever
visible, because it writes `chip on` by hand. Guarded by `components/__tests__/Chip.test.tsx`.

**Humanised:** The crosshair that follows the mouse drew four small filled squares instead of four
corner brackets, and its centre dot wore a ring. It now matches the bracket the cards wear at their
own corners, which is what it was asked to look like.
**Technical:** `.cursor-reticle span` sets the `border` shorthand — all four sides — at specificity
(0,1,1); `.rc-tl` and its three siblings remove two sides each, and `.rc-dot` removes all four and
shrinks to 3px, all at (0,1,0). The shorthand outranked every one of them. Measured on the running
page: `solid/solid/solid/solid` on all five pieces, against `solid/none/none/solid` for the card
bracket `.cbr.tl`. Each piece is now scoped through `.cursor-reticle`, taking it to (0,2,0).
This also closes the separate report that the reticle does not lock onto buttons: it does, and
always did — the `snap` class lands and `--cw` goes 26px → 127px for a 117px button. Four small
squares spreading to a button's corners simply do not read as a lock-on. Guarded by
`cursor/__tests__/Reticle.shape.test.ts`, which loads the sheet into the document and asks the
engine what applies, rather than grepping the file — the existing `Reticle.css.test.ts` has
contained `border-right: none` since the day it was written and passed on every broken build.

---

### Fixed

**Humanised:** The mouse wheel did nothing — not in the tab, not in the log panel. And on the dark
theme, the open tab and the little selectors stayed bright white under pale text, which made them
unreadable.
**Technical:**
- `motion/scroll.ts` installed Lenis on the WINDOW. That was right when it landed (v214): the
  renderer was one long demo page. The shell arrived after it and made the window a fixed 100vh
  frame with the scrolling inside (`.scrollwrap`, `.console .body`), so the library had nothing to
  move — and since a smooth-scroll library must `preventDefault()` every notch to take it over, no
  notch reached the panes. Measured: a wheel event on `.scrollwrap` came back
  `defaultPrevented === true`, the same event that did not bubble came back `false`, and the pane
  scrolled perfectly from JavaScript. Removed, along with the `lenis` dependency and
  `MOTION.scroll`; guarded by `src/__tests__/wheel-reaches-the-pane.test.ts`.
- The approved mock writes four surfaces as literals (`.tab.active`, `.tab:hover`, `.seg`,
  `.seg span.on`) where it takes every other one from a token, so they could not follow the ground.
  Re-pointed at `--solid` / `--surface` / `--recess`, which ARE those literals in light mode.
  `theme/__tests__/dark-ground.test.ts` reads the literals out of the mock and demands a verdict for
  each: corrected, a flash of light that is right on any ground, or an element never mounted here.

### Changed

**Humanised:** The Video, Tags and Settings tabs now speak the same design language as the rest —
same cards, same rows, same small buttons. Fourteen different button styles became one.
**Technical:** The three tabs and their sections (`PresetSection`, `Cs2EffectsSection`,
`HlaeOptionsSection`) wear the mock's `.bento` / `.wide` / `.row` / `.lab` / `.chip` / `.chips` /
`.fld`, and their stylesheets keep only the hints, swatches, lists and status lines the mock never
drew. One new modifier, `.chip.danger`, for actions that cannot be undone: the mock has no
destructive chip, so it borrows the meaning (the same rose tokens) and not the pixels. The Encoding
card pairs its controls the way the mock pairs its own — a lone `.fld` takes `flex: 1` and the whole
card, which is how a codec dropdown measured 825px. Fields wider than 400px: Video 11 → 2 (both hold
whole FFmpeg command lines), Settings 1 → 0. Shipped CSS 53.10 kB → 47.45 kB.
`tabs/__tests__/bento-layout.test.ts` no longer lists unported tabs — there are none — and now fails
if any tab stylesheet redefines one of the mock's classes.

---

### Changed

**Humanised:** The window's look is no longer a hand-made copy of the approved design — it IS the
approved design. The design file's own stylesheet is now the one the window loads, and every screen
piece was renamed to the words that design uses, so a rule written once reaches the screen instead
of being retyped in forty places and drifting a little each time.
**Technical:** `main.tsx` loads `theme/mock-v12.css` → `mock-bridge.css` → `tokens.css` before
`App`, and every component in the shell and the Capture tab was renamed onto the mock's own
selectors (`.hud-inner` / `.brand` / `.mark` / `.navtools .p`, `.tabs` / `.tab.active` / `.ic` /
`.tk` / `.ind`, `.app` / `.shell` / `.scrollwrap` / `.amb`, `.actbar` / `.wband`, `.btn` with
`ghost` / `danger` / `primary`, `.console` / `.ch` / `.body` / `.prompt` / `.cur`, `.bento` /
`.wide`, `.sec` / `.sh` / `.gl` / `.t` / `.cnt` / `.car` / `.sb`, `.row` / `.chips` / `.chip` +
`.d` / `.fld` / `.lab` / `.seg` + `.on`, `.stats` / `.st` / `.k` / `.v`). Each component
stylesheet was emptied of everything the mock states and keeps only what a picture cannot know:
button resets, focus rings, disabled states, the narrow-window layout (D24), and three measured
disagreements. Shipped CSS: 71.15 kB → 53.10 kB. Eight small-button variants collapsed into the
mock's single `.chip`.

### Added

**Humanised:** Buttons now react to a click with the design's own flash, spark and glitch, the Run
button wears a slowly turning ring, the log panel has a titled header and a `csdm>` prompt with a
blinking cursor, and picking weapons in the filter now shows their silhouettes sliding in.
**Technical:** `ActionButton` renders the mock's `.bx` / `.fl` / `.brs` layers plus `.sb` on the
primary; the impact class is cleared on a timer (`MOTION.buttonImpact`), never on `onfinish`
(section 10). `LogConsole` gained `.ch` and an inert `.promptline` — shape of the mock, without its
fake typed command, since this window has no command line. `WeaponFilterSection` renders the mock's
`.casc` from the existing `WEAPONS` table (`MOTION.weaponCascade.stagger`), skipping weapons with
no art.

### Fixed

**Humanised:** Four real defects found while doing the work: the stylesheets were loading in the
wrong order so the design file was overruling every component instead of founding them; a leftover
grid instruction was silently deforming the whole window frame; the design file's words collided
with three of the window's own elements, turning an ejected cartridge case into a two-column
layout and drawing an unwanted cross through the mouse cursor; and every setting's invisible
wrapper was forcing labels and fields onto separate lines, which is what made fields stretch across
the whole card.
**Technical:**
- `main.tsx`: ES modules evaluate in source order, so `import App` above the theme imports pulled
  every component stylesheet in first (measured: Tab.css at byte 37125, mock-v12.css at 47897).
  Guarded by `__tests__/stylesheet-order.test.ts`.
- `HudNav.css`: a leftover `grid-area: nav` against a grid with no named areas invents implicit
  lines rather than being ignored — the frame measured five rows and two columns.
- `motion/engine.ts`: every spawned particle is namespaced through `FX_CLASS_PREFIX`; the crosshair
  moved to `.cursor-reticle`. The mock owns `shell`, `spark` and `reticle` as global class names.
- `settings/SettingControl.css` + `components/Field.tsx`: `display: contents` on the coverage
  marker, and no wrapper around label + input. Fields wider than 400px went from 4 (one at 1246px)
  to 0.

### Removed

**Humanised:** The button's old reflection sweep is gone — the approved design answers a hover with
its glitch grid, and two effects on one gesture read as a bug.
**Technical:** `ActionButton.css`'s `sweep` keyframes and its `::before`/`::after` hover layers,
plus `MOTION.sweep` and `MOTION.armedPulse` (two entries no code ever read). `sweep` was the single
entry in `no-hover-motion.test.ts`'s allowlist, which is now empty: the guard has no exception
left.

---

### Added

**Humanised:** Hovering a card now lights up a soft glowing border that follows your mouse along
the edge. Clicking anywhere sends out a little burst of particles from the click point — blue if
you clicked a Run/Preview/Stop/Kill button, cyan everywhere else. Moving the mouse over the empty
background or over an action button now shows a crosshair cursor instead of the normal arrow (it
switches back to the normal cursor over cards, fields, tabs, and the log console).
**Technical:** `components/Card.tsx` gained an `onMouseMove` handler that paints `--mx`/`--my` as
CSS custom properties (never a layout style — the anti-hover-motion guard polices this), consumed
by a new masked radial-gradient `.spot` overlay in `Card.css`, revealed on `:hover` via `opacity`
only. New `effects/ClickSpark.tsx`/`.css` (mounted once in `AppShell.tsx`, next to `Backdrop`):
listens to `mousedown` — outside the anti-hover-motion guard's scope, so it can legally spawn
particles positioned with `style.left`/`.top` directly — spawns 6 particles + a HUD ring, tinted
`var(--gold)` over a `.btn` or `var(--holo)` elsewhere, silent under motion intensity `none`. New
`MOTION.clickSpark` entry in `motion/tokens.ts` (count, durations, ring sizes). New
`cursor/Reticle.tsx`/`.css` (also mounted in `AppShell.tsx`): a CS2-style crosshair cursor that
replaces the OS cursor over bare background or a button (snapping to the button's size), and stays
hidden over real widgets (inputs, cards, tabs, the log console, chips, segments); listens to
`mousemove`, so — unlike `ClickSpark` — it paints position/size ONLY through `--cx`/`--cy`/`--cw`/
`--ch` custom properties, consumed by `left`/`top`/`width`/`height: var(...)` in CSS; hidden under
`@media (hover: none)`. `Card.tsx` and `cursor/Reticle.tsx` both joined
`CURSOR_DRIVEN_ALLOWLIST` in `__tests__/no-hover-motion.test.ts` (now `["shell/Backdrop.tsx",
"components/Card.tsx", "cursor/Reticle.tsx"]`).

### Changed

**Humanised:** The bottom weapon band's background is now a clear glass panel that matches the top
nav bar and the console, instead of an almost-black gradient that stayed dark even in light mode.
The little progress rail inside it now uses the same translucent grey as the volume-style sliders
elsewhere in the app.
**Technical:** `weapon/WeaponBand.css`'s `.band` background changed from
`linear-gradient(180deg, #0c1116, var(--void))` to `var(--band)` + `backdrop-filter: var(--blur)`;
`.band-progress`'s background changed from a hardcoded `#11171e` to `var(--surface-2)` (the same
rail token already used by `Slider.css`). The weapon FX colours in the same file (muzzle flash,
tracer, spark, impact, C4, detonation) are deliberately untouched — real-world colour invariants
(HC.1), not theme surfaces.

### Fixed

**Humanised:** Two small polish fixes caught in the final review before closing this chantier:
hovering the log console no longer shows the crosshair cursor instead of the normal one (which
made selecting log text awkward), and on the rare touch device that reports no hover support, the
cursor no longer vanishes entirely — it now correctly falls back to the normal OS cursor.
**Technical:** `cursor/Reticle.tsx`'s `WIDGET_SELECTOR` referenced a nonexistent `.console` class
(the log console's real root class is `.shell-logs`) — corrected, with a regression test.
`cursor/Reticle.css`'s `body.customcursor { cursor: none; }` is now neutralized
(`cursor: auto`) inside `@media (hover: none)`, so a hover-incapable device that still dispatches
`mousemove` never loses the cursor entirely (the reticle element was already hidden there, but the
OS cursor stayed suppressed) — new `cursor/__tests__/Reticle.css.test.ts`.

**Humanised:** Fixed a crash that happened when opening the Electron window right after this
chantier: if your accent colour had been set from the older Tkinter window using one of its named
colour swatches (green, blue, orange…) instead of a picked hex colour, the new window refused to
start at all.
**Technical:** `theme_accent` is a config key shared with the Tkinter host, which can still write a
legacy lowercase preset name (`csdm/theme.py`'s `_ACCENT_PRESETS`: green/blue/orange/purple/red/
cyan/pink/yellow) instead of a hex string. `theme/accent.ts#applyAccent` only ever accepted hex, so
`AppShell.tsx`'s boot-time re-apply crashed (`hexToRgb` threw `"not a hex colour: green"`). New
`theme/accent.ts#resolveAccent()` maps a recognised preset name to its Electron hex before
`applyAccent`/`SettingsTab`'s `currentAccent` consume it; anything else still passes through to
`hexToRgb`'s existing validation unchanged, so real corruption still fails fast. Root cause in
`docs/audits/AUDIT_accent_preset_crash.md`.

**Humanised:** The app now opens looking like the V12 mockup by default — a light background with
an electric-blue accent — instead of the old dark background with a gold accent it inherited from
the legacy window. (The other themes and accent colours are still there in Settings; only the
starting point changed.)
**Technical:** The restyle targeted `mockup-v12-hologlass.html`, which boots light (`apply('Light')`)
with `--accent: #2563EB`, but the app defaulted to the legacy Tkinter dark ground and a gold
first-preset. `theme/mode.ts`'s `DEFAULT_GROUND` changed `"dark"` → `"white"` (light); `ACCENT_PRESETS`
reordered so the mock's electric blue `#2563EB` is first and therefore `DEFAULT_ACCENT` (the token
default `--gold: #2563eb` already agreed). All nine swatches remain — only the default moved.
`theme/__tests__/accent-default.test.ts` and a mode-default assertion pin both to the mock.

**Humanised:** Fixed two more things spotted the first time the window was opened for real, that
made it look nothing like the intended design: the whole interface was rendering in a typewriter
(monospace) font instead of the clean sans-serif from the mockup, and a background theme picked in
the older window (the "terminal" look) wasn't recognised by the new window.
**Technical:** `shell/AppShell.css` set `body { font-family: var(--font-mono) }`, so every label
that did not explicitly opt into `--font-display` inherited monospace — the opposite of the mock,
whose base is the Inter sans stack and which uses mono only for the console/buttons/values (all of
which already declare it). Base changed to `var(--font-display)`; `shell/__tests__/AppShell.css.test.ts`
added. `theme/mode.ts`'s `GROUND_MODES` omitted `terminal` (a real `csdm/theme.py` ground a saved
config used), so `applyMode("terminal")` silently fell back to dark — the map's source of truth is
`theme.py`'s five `_BG_PRESETS`, not `config.py`'s four-value comment. Mapped `terminal → dark`,
`theme/__tests__/mode.test.ts` corrected. Both in `docs/audits/AUDIT_accent_preset_crash.md`.

---

### Changed

**Humanised:** The 4 tabs now live inside a full-width bar across the top of the window, next to
the app's mark, instead of sitting alone in the left column. They overlap each other in slanted
shapes, and a small glowing bar slides under whichever tab is open. The Run/Preview/Stop/Kill
button row now stretches across the whole window at the bottom instead of being squeezed into the
narrow right-hand column. Inside each tab, the settings are now arranged in two columns instead of
one long list, so more fits on screen without scrolling as much — the busiest sections (filters,
encoding, paths, database) still take the full width.
**Technical:** New `shell/HudNav.tsx`/`.css` (brand mark + relocated `TabBar`), added as its own
full-width grid row (`.shell`'s `grid-template-areas` grew from 2 to 4 rows: `nav` / `tabs logs` /
`actionbar` / `band`). `Tab.css`'s clip-path is now cut on both sides (`var(--sp-7)`, was one-sided
`12px`), tabs overlap via a negative `margin-left: calc(var(--sp-6) * -1)`, and `.tab-active` gains
a permanent `transform: translateY(-2px)` pop (a selected-state style, not a `:hover` rule — D13/D16
untouched). `TabBar` gained a new `.tab-ind` sliding indicator, measured via `offsetLeft`/
`offsetWidth` on the active tab and positioned with `useLayoutEffect` (no dependency array — it
re-measures on every render to always track whichever child carries `.tab-active`). `ActionBar`
relocated out of the log column into its own `grid-area: actionbar` row and migrated from the flat
`--panel`/`--gold` tokens to the glass family (`--band`/`--blur`) already used by the console and
the new nav band. All 4 tab roots (`CaptureTab`/`TagsTab`/`VideoTab`/`SettingsTab`) switched from
`flex-direction: column` to a 2-column CSS grid, with a `.wide` escape-hatch class (or, for
`CaptureTab`'s non-`Card` sections, direct-child CSS selectors) spanning dense sections across both
columns. No new design tokens.

### Fixed

**Humanised:** N/A (visual-only change, no new behaviour) — except two small polish fixes caught in
review: the glowing tab indicator no longer visibly slides in from the window's edge on every app
launch, and hovering the tab that's already open no longer makes its label look dimmer.
**Technical:** `min-width: 0` added to `CaptureTab.css`'s 6 bespoke section roots and to
`Card.css`'s `.panel-box` — CSS grid children default to `min-width: auto` and could otherwise
refuse to shrink below their content's width inside a half-width bento cell, silently clipping
against `.shell-tabs`'s `overflow: hidden` with no scrollbar to reveal it.

### Added

**Humanised:** N/A (visual-only change, no new behaviour).
**Technical:** New test files: `shell/__tests__/HudNav.test.tsx`, `components/__tests__/Tab.test.tsx`
(sliding indicator, with stubbed `offsetLeft`/`offsetWidth` since jsdom never performs real layout),
`shell/__tests__/ActionBar.css.test.ts`, `tabs/__tests__/bento-layout.test.ts` (cross-file sweep of
all 4 tab CSS files for the grid + `.wide` shape). `components/__tests__/Tab.css.test.ts` extended
for the new overlap geometry.

### Changed

**Humanised:** Cards, tabs, buttons, text fields, chips, the segmented switch, and the slider now
look like frosted glass instead of the old flat dark panels — matching the background from the
previous update. Cards, fields, chips, the segmented switch and the slider also got rounder
corners; tabs and most buttons kept their sharp cut corners, except the main "Run" button which
is now a rounded pill.
**Technical:** `Card.css`, `Tab.css`, `ActionButton.css`, `Field.css`, `Chip.css`,
`Segmented.css`, `Slider.css` migrated from the flat token family (`--panel`/`--raise`/
`--raise-hi`/`--void`, `--radius: 0` + `clip-path` bevels everywhere) to the glass token family
already introduced by restyle 1 (`--surface`/`--surface-2`/`--band`/`--blur`,
`--r-card`/`--r-mid`/`--r-pill`). No new tokens added. `ActionButton.css`'s `.btn-run` explicitly
cancels its inherited `clip-path` (`clip-path: none`) to become the mock's rounded pill primary
button; every other button variant keeps the bevel. `Card.css`'s decorative corner brackets were
re-inset from `-1px` to `6px` (plus `overflow: hidden` on `.panel-box`) so they sit on the new
18px rounded corner instead of floating outside it.

### Added

**Humanised:** N/A (visual-only change, no new behaviour).
**Technical:** 6 new test files under `electron/renderer/src/components/__tests__/` (one per
migration task) asserting the real shipped CSS content, plus `GlassMigration.css.test.ts`: one
cross-file assertion sweeping all 7 migrated files for any lingering reference to the old flat
token family (`--panel`/`--raise`/`--raise-hi`/`--void`), excluding the legitimate `color-mix()`
border tints on `ActionButton.css`'s `preview`/`stop`/`kill` variants.

### Guard rails

**Humanised:** No safety net was loosened this round — this chantier only recolours and
re-rounds existing components.
**Technical:** `contrast.test.ts` and `no-hover-motion.test.ts` untouched, both re-verified green
by the final whole-branch review; no `:hover` rule in the 7 migrated files changes anything but
`background`/`color`/`border-color`.

---

### Added

**Humanised:** The window can now switch between a light and a dark look from Settings, and the
background is no longer a flat colour — it's a soft grid of glass plates that light up gently
near the mouse.
**Technical:** `theme/tokens.css` ships two token blocks (default `:root` + `:root[data-mode="dark"]`
override, same token names ~40 stylesheets already use); `theme/mode.ts` maps the existing
`theme_bg` config key to the mode; `shell/backdropField.ts` + `shell/Backdrop.tsx` render the
backdrop as a single `<canvas>` redrawn once per frame (zero per-tile DOM nodes), gated by the
existing `motion/engine.ts` intensity system so `prefers-reduced-motion`/intensity `none` paints
once and starts no animation loop.

### Changed

**Humanised:** The bottom console now looks like frosted glass instead of near-black, and its
text finally lines up with the faint ruled lines behind it.
**Technical:** `shell/LogConsole.css` drives both `line-height` and the ruled-line gradient period
from one token (`--log-line`), and the gradient's origin from `--log-pad`, so the two can no
longer drift apart; hardcoded `padding: 8px` removed from `#log`/`#ask-panel`.

### Fixed

**Humanised:** Some warning/success text in the console and a few tabs was nearly invisible in
light mode; fixed so it reads clearly in both themes. Also: a saved theme choice now shows up
immediately when you reopen the app, instead of only after visiting Settings once.
**Technical:** added text-safe `--ok-t`/`--fire-t`/`--steel-t` token siblings (WCAG AA ≥4.5:1 in
both modes, following the existing `--blood`/`--blood-t` precedent) and migrated every `color:`
usage of the originals to the `-t` variant; hoisted the `theme_bg`/`theme_accent` re-apply effect
from `SettingsTab.tsx` (only mounted on that tab) to `AppShell.tsx` (mounted for the app's whole
life); wired `--glow-in`/`--glow-out` into `Backdrop.tsx`'s border-alpha computation so the
backdrop's glow actually varies by mode, removing the now-dead fixed constants.

### Guard rails (generalised, not removed)

**Humanised:** Two safety nets from earlier work were loosened just enough to allow the new
background effect, without weakening what they actually protect against.
**Technical:** `contrast.test.ts` now loops its AA and luminance-ladder assertions over both
modes instead of testing one hardcoded palette; `no-hover-motion.test.ts` now allows a small
explicit `CURSOR_DRIVEN_ALLOWLIST` of files that may listen to the pointer (currently only
`shell/Backdrop.tsx`), while keeping the "no layout-affecting style from a pointer handler" ban
absolute even for allowlisted files.

---

## [v215]

### Changed: database discovery runs without a window (Electron migration — stage 4a.1)

**Humanised:** Connecting to the CSDM database used to be something only the old Tkinter window
knew how to do — one 230-line block that read the schema, listed players, weapons, tags, match
types and maps, and guessed which column holds the match date. That block now lives in the
engine, split by what it actually does: *ask* the database, *remember* the answer, *hand it over*.
The new Electron window can therefore connect on its own with a single `connect_db` command, and
gets back the same lists the old window shows. The old window still works exactly as before —
same players, same order, same date column, same deduplicated maps, same tags. Verified against
a real database through the real pipe, not by calling a method directly.

**Technical:** `App._connect_and_load` (`csdm_batch_clips_generator.py`) keeps only its thread and
its widget updates. `EngineMixin` gains `_detect_map_col` (moved off `App`, staticmethod),
`discover_database()` → plain dict on a documented 14-key contract, `apply_discovery(data)` →
writes the 12 state attributes and resets the 7 per-connection caches, and
`discovery_to_json(data)` → shapes and scalars only (datetime → ISO, tuples → lists, Decimal tag
ids → str), so `json.dumps` never needs `default=`. The hardcoded table/type/prefix lists rise to
named module constants in `csdm/engine/core.py` at identical values. `csdm/bridge/host.py` gains
`_cmd_connect_db`, which lets exceptions travel to `_run_command` rather than duplicating the
bridge's error handling; the pg credentials are supplied from the loaded config so a headless host
connects without the window. The date-column warning now goes through `self.log(..., "warn")`
without its `⚠` prefix — the level carries that, and decoration belongs to the interface.
21 new tests (13 in `tests/test_db_discovery.py`, 5 bridge cases, 3 map-column cases); suite at
184 Python + 109 renderer.

---

## [v214]

### Added: the new interface's visual language and its motion vocabulary (Electron migration — stage 3)

**Humanised:** The Electron window now looks like the approved mockup instead of a bare page:
dark grounds, a cold gold accent, corner brackets on cards, cut-corner tabs. Nothing moves when
you hover any more — a reflection sweeps behind the label and the label itself stays put, which
is what keeps a screen of 140 controls calm. There is a motion setting with three levels, and
"none" really does stop everything while leaving the app fully usable; if Windows is set to
reduce animations, the app obeys without being asked.

**Technical:** `electron/renderer/` is a Vite + React 19 + TypeScript app, loaded from disk in
production and from the dev server when `VITE_DEV_SERVER_URL` is set; `contextIsolation` and
`nodeIntegration` are unchanged. Design tokens extracted verbatim from `ui-v5.html` into
`theme/tokens.css`, with the mock's three sub-AA greys corrected and collapsed into one `--dim`;
`applyAccent()` rewrites `--gold` and derives its three siblings. Primitives: `Card`, `Tab`,
`ActionButton`, `Field`, `Chip`, `Segmented`. The hover lock
(`src/__tests__/no-hover-motion.test.ts`) builds the app and scans every shipped stylesheet plus
the source for pointer-driven motion — a computed-style test was rejected on evidence, since
jsdom has no hover state and no pseudo-element styles, so it would have detected nothing.
`motion/engine.ts` holds the sequence registry, the intensity gate and cleanup that runs off the
clock rather than `onfinish`, which never fires while the window is hidden.

### Added: the weapon band and the four action animations

**Humanised:** The bottom of the window carries a status line, a progress bar, and a weapon that
is always fully visible — never cropped. Each action has its own animation: RUN fires the
weapon's own burst, PREVIEW opens a sight and takes one contained shot, KILL slams the bolt and
yanks the weapon out of frame, and STOP plants a demolition charge that beeps. The charge keeps
beeping for as long as the game is still running — ten seconds, a minute, forever if it refuses
— and detonates only when the engine confirms the game is actually gone. Adding another weapon
means drawing its silhouette and filling in its numbers; no animation code changes.

**Technical:** `weapon/weapons.ts` is the per-weapon table (shots, gap, kick, rotation, flash,
impact, shake, shell size, bolt delay) with silhouettes imported from `assets/*.svg?raw`.
`weapon/sequences.ts` holds the one parameterised frame and registers five sequences; every
shared number is in `MOTION`, every per-weapon number in `WEAPONS`, and none in a function.
`weapon/controller.ts` maps engine state events to sequences and owns the armed charge — it
takes engine events and nothing else, so no click can start a long sequence (D18). The
detonation is a separate sequence reachable only from `process_exited`. Proven by
`weapon/__tests__/stop-waits.test.ts`: sixty seconds of clock with no confirmation leaves the
charge beeping and the effects layer free of any explosion element; the AWP goes through every
action with no change to `sequences.ts`. Smoothed scrolling via Lenis (`motion/scroll.ts`),
short by design, switched off under intensity `none` and under `prefers-reduced-motion`.

### Added: the engine announces stop and kill requests

**Technical:** `state("stop_requested")` and `state("kill_requested")` are raised by
`EngineMixin`, so the waiting charge is staged by the engine's own report rather than by the
click that asked for it. `csdm/bridge/e2e` coverage asserts `kill_requested` precedes
`process_exited` over the real pipe.

### Fixed: the window no longer goes blank when opened outside Electron

**Humanised:** Opening the page in a plain browser to look at the layout used to show nothing at
all, with the real cause buried in the console.

**Technical:** `bridge.ts` resolves `window.bridge` through a guard that warns once and returns
null, instead of throwing during mount and unmounting the whole React tree.

---

## [v213]

### Added: the engine now knows when CS2 is really dead (Electron migration — stage 3.5)

**Humanised:** When you hit KILL, the app used to fire the kill order and immediately move on
— it never actually watched CS2 close. It does now: it waits and checks the task list until
the game is really gone, then says so. That matters because the new interface will show a
demolition charge that keeps beeping until the game is down, and it must beep on the truth,
never on a stopwatch.

**Technical:** `core_utils.process_is_running(name)` reads the Windows task list with an
explicit `stdout=` (an inherited handle would corrupt the bridge protocol) and answers
"still running" when the list is unreadable — a bad reading is not proof of death.
`EngineMixin._await_process_exit(name, probe=None)` polls it until the process is absent,
emits `state("process_exited", {"name": …})` on real absence only, and returns `False` on
timeout. `request_kill` now uses `subprocess.run` instead of a fire-and-forget `Popen`, so
the moment of death is observable at all. Three settings in `DEFAULT_CONFIG`:
`process_exit_poll_interval`, `process_exit_timeout`, `cs2_process_name`.

### Added: stop, kill and preview cancellation are reachable without a window

**Humanised:** The three buttons that interrupt a job used to live inside the old window, so
the future interface could not have used them. They moved into the engine; the window now
just asks the engine to do it, and the engine reports back what changed.

**Technical:** `_stop_preview` / `_stop_graceful` / `_kill_now` / `_handle_stop` moved from
`App` into `EngineMixin` as `cancel_preview` / `_stop_graceful` / `request_kill` /
`request_stop`, with every widget call replaced by a `state` event. The preview thread body
moved too, as `EngineMixin._preview_worker(cfg)`; `_dry_run` keeps only widget reading and
starts it. New events: `buttons` (with `stop` / `stop_label` / `kill`), `run_started`,
`preview_started`, `process_exited` — `buttons_busy` finally has a producer. `_previewing`
and `_preview_cancel` joined `ENGINE_STATE_DEFAULTS` (31 → 33 entries) and are no longer
created by hand in `App.__init__`. The three commands are registered in `csdm/bridge/host.py`.
New tests: `tests/test_process_exit.py`, plus headless stop/kill cases and two bridge
round-trips. 147 → 156 tests.

### Fixed: non-ASCII log lines no longer break the bridge

**Humanised:** Any message containing a symbol — and nearly every message the app writes has
one — was killing the connection between the new window and the engine on Windows.

**Technical:** `csdm/bridge/__main__.py` forces UTF-8 on stdin/stdout/stderr before serving.
Windows hands the child a console-codepage stream (cp1252), so the first `⏸` raised
`UnicodeEncodeError` mid-line and corrupted the protocol. Found by the new
`cancel_preview` round-trip test, which now stands as the regression guard.

---

## [v212]

### Added: the bridge between Electron and the Python engine (Electron migration — stage 2)

**What changed:** Nothing in the app you use today — Tkinter is still the interface. What is new
is a second way to talk to the engine: a small Electron window can now start the engine as a
background process and receive its logs, its progress and its questions live, through a plain
text pipe. No network port is opened, so Windows never raises a firewall prompt — that was the
condition for the finished app to install with a double-click.

**The protocol** (`csdm/bridge/protocol.py`): one JSON object per line. Six message types out
(`log`, `log_parts`, `state`, `ask`, `result`, `fatal`), two in (`command`, `answer`).
- `LineWriter` serialises writes from every thread with a **lock**, not a queue drained by a
  thread. Deliberate: a draining thread is a pump, and the log pump was removed in v190 because
  it lagged (R5). The lock gives the same guarantee — no interleaved lines — with no latency.
  Verified under 20 concurrent threads writing 500 lines: all intact.

**The four sockets over the pipe** (`csdm/bridge/ports.py`): `PipePorts` is the third
implementation of the contract from `csdm/engine/ports.py`, next to Tkinter and the test double,
and the engine cannot tell them apart. `ask` blocks the calling worker thread on an event, sends
the question with a correlation id, and resumes exactly where it stopped when the answer returns
with that id. An answer for an unknown id is ignored instead of crashing.

**The host** (`csdm/bridge/host.py`, run with `python -m csdm.bridge`): reads commands line by
line and runs **each one in its own thread** — otherwise a question would block the very reader
that has to deliver its answer. Four demonstration commands only (`ping`, `demo_logs`,
`demo_ask`, `tkinter_check`): this stage proves the transport, it does not port the app.
An unreadable line is reported and skipped; a failing command returns `ok: false` with its
reason and never kills the host.

**Keeping the pipe clean:** verified that both external-process launches in the engine already
capture their output (`core.py:1984`, `core.py:2008`) — nothing to fix, so the task reduced to a
guard test. `serve()` additionally points `sys.stdout` at `sys.stderr` while serving, so a
stray `print()` written years from now goes to the logs instead of corrupting the protocol.

**The Electron shell** (`electron/`): spawns the engine with `windowsHide`, reassembles JSON
lines across chunk boundaries (a line can arrive split in two — the classic bug of this kind of
bridge), routes the child's `stderr` to the console without parsing it, reports the engine's
death instead of freezing, and kills the child on both `window-all-closed` and `before-quit` so
no orphan is left driving CS2. `contextIsolation` on, `nodeIntegration` off, preload exposing
only `send()` and `onMessage()`. Raw line display only — no styling, that is stage 3.

**Not yet verified:** the Electron window has not been opened and looked at. The Python side was
driven by hand end to end (ping, streaming logs, a full question/answer round trip, a garbage
line, an unknown command, and `tkinter modules loaded: none`).

**Tests:** 124 → 145. New: `test_bridge_protocol.py`, `test_bridge_ports.py`,
`test_bridge_e2e.py` (drives a real subprocess), `test_bridge_isolation.py`.

---

## [v211]

### Changed: the engine can now run without a window (Electron migration — stage 1.5)

**What changed:** Nothing you can see. The part of the app that does the real work — reading the
database, filtering kills, reading demo files, tagging, building the summary — used to need the
window to exist before it could run, even though it never showed anything itself. It doesn't
anymore. That was the missing piece before the app can be given a new interface.

**Why a stage 1.5 at all:** stage 1 (v208) claimed the engine was separated, but the engine still
borrowed 26 methods and 23 pieces of state from the interface file. It worked *inside* the
window and nowhere else — which is not what "separated" is for.

**Moved into `csdm/engine/`** (~930 lines, verbatim — no logic rewritten):
- Database and column helpers: `_find_col`, `_pg`, `_pg_fresh`, `_resolve_cli`, the four
  `_qe_*_sql` fragment builders, `_SQL_MOD_KEYS`, `_mods_dp2_global_any_union_enabled`.
- Kill filters and their dp2 cascade: `_dp2_parse_demo` (236 lines), `_trois_shot_filter`,
  `_one_tap_filter`, `_trois_tap_filter`, `_no_trois_shot_filter`, the three `_apply_*` gates,
  `_stamp_mf`, `_split_required_optional`, `_non_kill_only`, `_FILTER_BADGE_DEFS`.
- Demo, tag and summary helpers: `_get_demo_ts`, `_format_demo_date`, `_demo_sort_key`,
  `_demo_picker_get_active`, `_get_demo_checksum`, `_tag_demo`, `_tag_log_line`,
  `_get_active_tag_names`, `_normalize_recsys`, `_hms`, `_calc_summary`, `_fmt_summary`,
  `_read_demo_date_from_info`, `_ts_from_demo_path`.
- Main file: 7 650 → 6 672 lines. `csdm/engine/core.py`: 3 029 → 4 009.

**New: the host contract** (`csdm/engine/state.py`) — the 31 pieces of state an engine host must
provide, declared in one place with a factory per entry so two hosts never share a dict. `App`
now calls `init_engine_state()` instead of setting them one by one. Five defaults in the plan
were wrong and were taken from the real code instead.

**The database credentials stopped being read from the screen:** `_pg` / `_pg_fresh` read
`_pg_params` (fed by `_sync_pg_params()`) instead of the five text fields. Same keys as
`_collect_config()` already produced.

**The proof** (`tests/test_engine_headless.py`): a `HeadlessHost` that inherits only the engine
and the state contract — no Tk, no widget, no main loop — runs the filter chain, the summary
helpers and the SQL fragment builders. A subprocess check asserts Tkinter is never imported;
verified to have real detection power (importing the main file pulls in 10 Tkinter modules,
importing the engine pulls in none). The isolation guard list grew from 39 to 66 methods.
118 → 124 tests.

---

## [v210]

### Fixed: the log console silently swallowed every engine log line

**What changed:** the console text box on screen and the engine's own "write a log line"
function had the same internal name. Whichever was created last won, and the console box
always won — so every time the engine tried to log something (filters running, demo parsing,
DB lookups), the app crashed with an error instead of writing the line. It had been broken
since the previous release; nothing on screen showed it because it was only ever triggered
from code paths not yet covered by a running app test. The console box now has its own,
separate internal name, and a new automatic check will refuse to let this happen again.

**Technical details:** `App.log` was assigned twice with two different meanings —
`self.log = tk.Text(...)` (the on-screen console widget, set at UI construction) and
`def log(self, message, level="")` (the engine port declared in `csdm/engine/ports.py`'s
contract). An instance attribute always shadows a class method of the same name in Python,
so every `self.log(...)` call made from `csdm/engine/core.py` (104 call sites) raised
`TypeError: 'Text' object is not callable`. The widget is renamed to `self.log_widget`
(1 assignment + 67 accesses); `log_parts`, `state`, and `ask` had no competing assignment.
Added `tests/test_engine_port_shadowing.py`, an AST-based guard that fails the suite if any
`self.<port> = ...` assignment reappears for `log` / `log_parts` / `state` / `ask`.

### Fixed: resizing the window could crash the app

**What changed:** the engine's own "what state are we in" channel had the same name as the
window's built-in "is the window normal, minimized, or maximized" check. The two window-size
checks in the app were calling the engine's channel by mistake, which crashed as soon as the
window was resized. They now call the window's own check directly, under its other name.

**Technical details:** the two `self.state()` calls in `_on_configure`/`_remember_layout_state`
(lines 3257 and 3270) resolved to `App.state`, the engine port, not to `tk.Tk.state` — even
though `tk.Tk.state` and `tk.Tk.wm_state` are literally the same function object. Both call
sites now use `self.wm_state()`, the same Tk function under its other, non-shadowed name.
Added `test_main_file_never_calls_the_state_port_itself` to the AST guard suite.

---

## [v209]

### Fixed: the engine could not actually run after the v208 move

**What changed:** v208 moved the engine into its own file, but seven names it relied on stayed
behind in the old one. In Python, a method that moves looks for those names in its *new* file —
not in the file of the class that inherits it — so it no longer found them. The result: PREVIEW
and RUN crashed. All seven are restored, and a new test makes this whole class of mistake
impossible to repeat.

**The seven names, and what each one broke:**
- `PERSP_LABELS` (`core.py:2566`, in `_worker`) — on the header log line, executed on every RUN,
  so **RUN failed unconditionally**. It was a plain label table, so it moved to
  `csdm/static_data.py` next to the other lookup tables; the main file re-imports it, leaving
  its existing call site untouched.
- `_NO_AUTO_EXCLUDE` (`core.py:2220` and `2395`, in `_apply_dp2_modifiers` and
  `_apply_dp2_filters_to_events`) — reached as soon as one kill filter had its Exclude box
  ticked, on **both the PREVIEW and RUN paths**. Now imported from `csdm/static_data.py`,
  where it already lived.
- `concurrent` (`core.py:1932`, in `_preparse_dp2`) — the demo pre-parse, **PREVIEW and RUN**.
- `uuid` (`core.py:2058`, in `_assemble_clips`) — final assembly.
- `shlex` (`core.py:1389`, in `_inject_hlae_extra_args`) — only with extra HLAE arguments.
- `random` (`core.py:2635`, in `_worker`) — only with random demo order enabled.
- Technical: the four stdlib names were simply absent from the header import block. No business
  logic was touched — imports and one constant move, nothing else.

**Why no test caught it:** `tests/test_engine_isolation.py` checks what the engine is *forbidden*
to do (import Tkinter, call `self.after`, read a widget). It never checked what the engine
*needs* in order to run. A relocation cannot be validated by a prohibition test alone.

**The new guard:** `tests/test_engine_globals.py` walks the AST of every module in
`csdm/engine/` and fails if any free name is loaded without being defined, imported, or a
builtin. It reproduced all seven sites before the fix and is green after. Also new:
`TestDp2ExcludePathRuns` in `tests/test_engine_ports.py`, which drives the dp2 exclude branch
through `CollectingPorts` — guarding the behaviour, not just the name. 106 → 108 tests.

---

## [v208]

### Changed: the engine moved out of the UI file (Electron migration — stage 1)

**What changed:** Nothing at all, as far as using the app goes. Under the hood, the part that
does the real work — reading the database, filtering kills, building cameras, driving the CS2
recording — was moved into its own file and no longer knows a window exists. It talks to the
interface through four clearly named channels instead of touching buttons and labels directly.
This is the groundwork that lets the app get a new Electron interface later without rewriting
any of that logic.

**Engine extraction:**
- New package `csdm/engine/`: `ports.py` (the sockets) and `core.py` (`EngineMixin`, 39 engine
  methods moved verbatim). `App` now inherits `EngineMixin`, so every `self.xxx()` call site is
  unchanged. Main file: ~10 615 → 7 650 lines.
- Technical: the move is a cut-and-paste. No SQL, filter, dp2, camera or CLI logic was rewritten.

**The four sockets:**
- `log(message, level)` replaces the ~130 direct `_async_log` calls; `log_parts(parts)` carries
  the one multicolor log line (recording-timeout summary) that a single string would flatten;
  `state(event, payload)` replaces the ~30 `self.after(...)` UI updates, reduced to 7 named
  events; `ask(kind, payload)` replaces the blocking dialogs (`messagebox`) including the
  "already tagged demos" prompt, which no longer hand-rolls a `threading.Event`.
- Under Tkinter, `App` wires these to its existing widgets and renderers (`_async_log`,
  `_emit_demo_log_entry`, `_reset_btns`, `_show_preview`) — none of them were rewritten.

**Isolation is enforced by a test, not by discipline:**
- New `tests/test_engine_isolation.py`: `csdm/engine/` must import no Tkinter module, and the
  engine methods must contain none of the 13 forbidden UI patterns (`self.after(`, `messagebox`,
  `filedialog`, `self.v[`, …). Also new: `tests/test_engine_ports.py`. 86 → 106 tests passing.
- The two remaining direct widget reads in engine code (`cs2_send_to_back` in `_exec`,
  `tag_enabled` in `_show_preview_impl`) now read the config dict instead.

**Moved, not changed:** `CSDM_RUNTIME_CFG_NAME` / `CSDM_RUNTIME_BLOCK_START` /
`CSDM_RUNTIME_BLOCK_END` moved to `csdm/static_data.py` (the engine cannot import the main file
without a cycle). The main file re-imports them, so existing call sites still work.

---

## [v207]

### Added / Changed: "terminal / HUD" visual overhaul

**What changed:** The interface has a new, denser look — industrial-terminal style: thin-line grid, square corners, everything in a monospace font, uppercase labels. No feature changed — this is purely appearance.

**Font:**
- The app now auto-picks the best installed monospace font (JetBrains Mono → Fira Code → Cascadia Mono → Consolas). A `ui_font_family` setting can force a specific one.
- Technical: `FONT_MONO/SM/DESC` are now *named* Tk fonts built by `init_fonts()`; ~30 hard-coded font tuples were centralised. Fixed a garbage-collection trap that deleted the named fonts (strong refs kept in `_FONTS`).

**No more rounded corners:**
- Tabs, comboboxes, scrollbars and the demo list were drawn by Windows with rounded corners. They are now flat and square.
- `apply_ttk_style()` (`clam` theme) centralises all ttk styling in one place, called at startup and on every theme change — replaces two duplicated blocks.

**Grid & borders:**
- Each section card now has a full thin border (instead of a single line under the title) and reads like a grid cell. Accent stripe 3→1px, arrows `▾/▸` → `[-]/[+]`.
- The RUN-button bar and the console are framed with a thin border.
- New `BentoGrid` container: the Settings tab switches to 2 columns when the pane is wide enough (over 720px; otherwise 1 column — so nothing changes at normal size). Video and Capture stay single-column.

**Typography & density:**
- Field labels, tabs (CAPTURE/TAGS/VIDEO/SETTINGS) and buttons (RUN/PREVIEW/STOP/KILL) are uppercase. Tighter margins and spacing. Descriptions prefixed with `// `.
- New "Terminal" background theme (bluish black) alongside Dark / AMOLED / Deep Blue / White.

**HUD elements:**
- Bracketed header segments: `[DB:OK] 12P·5T`, `[PLAYER:NAME]`, `[v207]`. Log counters `[E:2] [W:5]`. Batch progress as a block bar `▰▰▰▱▱ 12/17`.
- Dark window title bar on Windows (follows the theme; silent elsewhere).

**Not done:** the "terminal key" buttons (T3.3) — the style dict meant to drive them (`_BTN_KW`) was in fact never applied to any widget, so it would have no effect.

**Tests:** 84 → 86, all green (new `progress_bar` helper covered). New style constants in `csdm/ui_kit.py`, `terminal` preset in `csdm/theme.py`.

---

## [v206]

### Changed: code cleanup and refactor pass (Phase 1.3 + 2.1)

**What changed:** Nothing visible. Same app, same behaviour. The code is just better organised, and the safety net is bigger.

**Cleanup:**
- First line of the file said v204. Real version was v205. Now it points to `APP_VERSION`. One source of truth.
- Two dead methods removed (`_on_res`, `_radio`). Nothing called them.
- Unused imports and dead local variables removed. pyflakes is clean.

**Big functions split into small named pieces:**
- `_query_events` (the SQL query builder): 462 → 270 lines. Each filter now has its own small builder — match type, headshots, teamkills, suicides, mods, date column, map filter.
- `_build_json` (the CSDM recording file): camera builders are now standalone static methods. Before they were closures locked inside the function — impossible to test alone. Now they are tested.
- Weapon lists (`SUICIDE_WEAPONS`, `DELAYED_EFFECT_WEAPONS`) and the CPU codec list moved to `csdm/static_data.py`. Pure data lives in one place.
- Pure helpers (date conversion, duration format, folder names, camera ticks) moved to new `csdm/core_utils.py`.

**Fail Fast:** 20 catch-all `except Exception` narrowed to precise types (dead-widget errors → `TclError`, bad hex/date → `ValueError`). A real bug in these spots now crashes loud instead of hiding.

**Small fix:** one code path closed the persistent DB connection by mistake. Removed — the connection is meant to stay open.

**Tests:** 68 → 84, all green. New tests lock the v194 camera logic (killer switches, victim POV, mate POV, Both-mode timeline) so it can never silently break again.

**Docs:** README said "Tools" tab. Real name is "Settings" since v164. Fixed.

---

## [v205]

### Fixed: theme switch kept stale colours when leaving a collided theme (e.g. AMOLED)

Switching away from a theme whose roles shared the same colour (AMOLED has
background, secondary background and log background all at `#000000`) left some
widgets stuck on the old colour.

**Root cause:** the runtime re-paint maps *old colour → new colour* by value. When
several roles share one value the mapping is ambiguous, so those widgets were
skipped on purpose and kept their old (black) colour.

**Fix:** `_build_theme()` now guarantees every colour in a theme is unique, nudging
exact duplicates by an imperceptible amount (`#000000` → `#000001`). AMOLED still
looks pure black, but each role is now distinct, so the re-paint is never ambiguous
and every widget updates correctly. Added `_nudge_hex` / `_ensure_unique_hex` in
`csdm/theme.py`, covered by new tests.

### Changed: split the single-file monolith into a `csdm/` package (Phase 1.1–1.2)

The application is being reorganised from one ~12.6k-line file into a small
package, one module per responsibility. No user-facing behaviour changes; the
entry point is still `csdm_batch_clips_generator.py`, which re-imports every
moved name so all call sites keep working.

- `csdm/static_data.py` — kill-filter registry + weapon/codec/resolution/match-type tables
- `csdm/config.py` — `DEFAULT_CONFIG`, preset groups, JSON load/save helpers
- `csdm/theme.py` — theme palettes, `_build_theme()`, and the live shared `_THEME` + `_t()` accessor
- `csdm/ui_kit.py` — fonts, spacing constants, shared `_CHK_KW`/`_BTN_KW` styles
- `csdm/widgets.py` — reusable Tk widgets (`ScrollableFrame`, `WrapRow` so far)

Main file reduced from 12,621 to ~11,694 lines so far. Test suite grown to 50 tests, all green.

---

## [v204]

### Improved: Mate POV — replace body-point loop with single eye check; tighten max dist

**Body-point loop removed.** At ≤550 u the angular spread from head to legs is under 6°, so testing 3 separate points added no filtering value over a single centre check. Replaced with one check against the victim's eye position (`Z + 54`, CS2 standing eye height). Simpler, equally accurate.

**Max dist 3000 → 550 u.** Beyond ~550 Hammer units, the probability of a clear same-floor LOS drops sharply. Tight engagement range only.

**Constants removed:** `_MATE_POV_BODY_HEIGHTS`, `_MATE_POV_MIN_VISIBLE`
**Constant added:** `_MATE_POV_EYE_HEIGHT = 54`

---

## [v203]

### Fixed: Mate POV — obstacle/floor filtering to reject blocked LOS

Mate POV was accepting teammates on different floors, looking through ceilings, or barely glancing toward the victim — producing useless clips.

**Root cause:** LOS check was purely angle-based with very loose parameters. No geometry filter existed for floor/ceiling blocking.

**Changes:**

- `_MATE_POV_FOV_HALF_DEG` tightened: `45°` → `20°` — victim must be clearly in the mate's view, not at the edge
- `_MATE_POV_MIN_VISIBLE` raised: `2` → `3` — all three body points (head/chest/legs) must be inside the FOV cone
- `_MATE_POV_MAX_DIST` reduced: `5000` → `3000` Hammer units — distant mates almost always have walls between them
- `_MATE_POV_MIN_DIST = 80` (new) — reject mates clipping into or directly on top of the victim
- `_MATE_POV_MAX_Z_DELTA = 300` (new) — reject if height difference > 300 units (≈ 2.5 player heights); filters different-floor mates where a ceiling/floor would block LOS
- `_MATE_POV_MAX_ELEVATION = 30.0°` (new) — reject if the required elevation angle to look from mate to victim exceeds 30°; steep angles strongly indicate the mate is on a different level
- `health` added to `parse_ticks` columns — dead players (health ≤ 0) are now excluded from mate candidates; health column absence (older demos) is handled gracefully

**Note:** BSP ray-casting is not available via demoparser2. These geometric filters eliminate the most common false-positive cases (different floors, extreme distances, glancing angles) but cannot detect walls on the same level.

---

## [v202]

### Fixed: map column detection — `map_name` lives in `demos` table, not `matches`

CSDM stores `map_name` in the `demos` table (a sibling table to `matches`, sharing the same `checksum` PK). Previous code only searched `matches`, so map data was never found.

**Revamp:**
- New static `_detect_map_col(schema)` — single source of truth for detection. Checks `matches` first (backward compat), then falls back to `demos` via `LEFT JOIN demos d ON d.checksum = m.checksum`. Candidates list (`_MAP_COL_CANDIDATES`) is a class-level constant.
- `demos` table now included in the schema fetch at connect time.
- `_map_alias` ("m" or "d") and `_map_join` (JOIN clause or "") stored on the instance alongside `_map_col`. All SQL that references the map column uses these — kills query, rounds query, manual mode query.
- Distinct map fetch reads from the owning table directly (`demos` or `matches`), no join needed for `SELECT DISTINCT`.
- Manual mode query rebuilt using `map_alias` and `map_join` — no more `_find_col` fallback, no dead code.

---

## [v201]

### Fixed: timeout formula; Added: MAP FILTER section; Fixed: map column always visible

**Timeout**: Formula simplified to `max(content × 3, 60s)`. No per-seq or flat overhead. For a 24s demo: 72s = 1m12s. For very short content: 60s floor. User-configured minimum still acts as a floor via `max(user, auto)`.

**Map filter**: New "MAP FILTER" section in Capture tab, after Match Types. Populated dynamically from DB on connect — no hardcoded maps. Map col and distinct values detected at connect time (not lazily in `_query_events`). Deduplication: maps grouped by display key (stripped prefix + lowercase), so "de_dust2" and "DE_dust2" merge to one checkbox. Selecting a map filters the kills + rounds SQL query (`AND m."map_col" IN (...)`). Section shows "No map column found in DB" and disables the toggle when DB has no map column.

---

## [v200]

### Removed: Workshop DL option; timeout formula tightened

**Workshop DL removed**: `hlae_workshop_download` option removed entirely. `downloadWorkshopMap` was a CSDM config key with no reliable CS2-side auto-download behaviour. The injected `sv_pure 0 + sv_lan 1` blocked Steam Workshop validation (causing potential map loading failures). Removed from DEFAULT_CONFIG, PRESET_KEYS, bool_keys, UI, `_inject_cs_runtime_cfg`, `_build_hlae_launch_tokens`, and `_build_json`.

**Timeout formula**: Changed from `×3 + 10s/seq + 180s` to `×2.5 + 10s/seq + 60s`. For a 24s/1-seq demo: was 4m22s → now 2m10s. Timeout log line now colored: duration in orange, content in green, seq count in blue.

---

## [v198]

### Bump

No new features. Version increment to mark a clean checkpoint after v195–v197 fixes.

---

## [v197]

### Fixed: recording timeout now actually fires and adapts to demo complexity

The watchdog that is supposed to kill a stuck recording and retry was effectively broken in two ways:

1. **CS2 kept stdout open after CSDM was killed.** CSDM inherits the stdout pipe and passes it to CS2. Killing CSDM left CS2 alive with the pipe still open, so `readline()` blocked forever — the timeout appeared to do nothing. Fixed by using a synchronous `subprocess.run` for `taskkill /F /IM cs2.exe` so the pipe is guaranteed closed before the watchdog returns.

2. **The timeout was a fixed value, not adapted to the demo.** Setting "15 minutes" works for a short demo but incorrectly kills a demo with 40 clutch sequences. The `recording_timeout` field (minutes) is now a **minimum floor**, not the sole value. The actual per-demo timeout is calculated automatically from sequence data: `(total clip game-time / timescale) × 3  +  10s per sequence  +  3 min flat`. The computed value is logged so you can see what was used. Setting the field to 0 uses the auto value alone; setting it to a number forces at least that many minutes.

**Technical details:**
- `_exec` watchdog: `subprocess.Popen(["taskkill"...])` → `subprocess.run(["taskkill"...], timeout=15)` — synchronous kill guarantees the pipe closes.
- Per-demo timeout replaces the old single `_rec_timeout_s = user_minutes × 60`. Formula: `(_sum_clip_s / _timescale) * 3 + len(seqs) * 10 + 180`. Accounts for slow-motion factor (`hlae_slow_motion`), sequence count, and clutch full-window sequences (which have baked-in tick ranges that can span entire rounds). `_user_timeout_s` from config is applied as `max(user, auto)` when non-zero.
- Timeout field tooltip updated: 0 = auto-calculated, non-zero = minimum floor.

---

## [v196]

### Fixed: player names back in deathnotices, "By config" no longer needs a tag pre-selected, new name override field

**Player names in deathnotices** were always blank — CSDM was receiving `playerName: ""` for every player. Names from the demo file (recorded username) are now used, with a fallback to the database player table. Nothing is forced or overwritten by the script: if the demo has the name, that's what shows. If not, it's empty, same as before but now intentionally.

**"By config" in Tags** no longer requires a tag to be selected first. It now works the same way as the preview: finds all demos matching the current config (player + events + weapons + dates). If a tag *is* selected, the results are additionally filtered to only already-tagged demos — same behaviour as before but no longer mandatory. Also uses the last preview cache when available, so if you already ran a preview you get the result instantly.

**Active player name override** — new "Name override" field in Capture, just below Mate POV. Leave it empty (default) to use whatever name the demo file has. Type a name to force it for the active player in deathnotices only — useful if the recorded username is wrong or you want a cleaner display name.

**Headshot feedback:** no cvar exists in CS2 for this — the dink sound is hardcoded and silent in demo playback. Not implemented.

**Technical details:**
- `_build_json`: `players_opts[].playerName` now uses `_name(psid)` (was always `""`). `_name()` pulls from `_dp2_cache[demo_path]["demo_names"]` first, then `self._player_names` (DB). New `_name_override` variable (from `cfg["player_name_override"]`) replaces `_name(psid)` for active-player entries when set.
- `_tag_search_demos`: removed the `if not active_ids: return` guard. Tag query is now conditional on `active_ids` being non-empty. Config events query re-uses `self._last_preview_data["evts"]` when the cache is populated. Log line includes `(cached)` when the cache is used.
- New config key `player_name_override` (default `""`), added to the `players` preset group. UI: `sentry` entry in Capture section after the Mate POV row.

---

## [v195]

### Fixed: buttons no longer get hidden when resizing the window or the log console

Resize the window or drag the sash between the categories panel and the log — every row of buttons now reorganizes itself into multiple rows instead of getting clipped off-screen.

**Technical details — `WrapRow` and targeted row conversions:**

New `WrapRow` class (`tk.Frame` subclass): positions children via `place()` in a wrapping layout. Measures available width on every `<Configure>` event (16 ms debounce), wraps items to a new row when they no longer fit, and adjusts its own height automatically. Registered in `_WRAP_ROWS` so a global `<ButtonRelease-1>` handler can flush an immediate relayout after any sash drag (50 ms delay to let PanedWindow finish propagating geometry first). OS window-border resize falls back to a 400 ms debounce on `_on_canvas_configure`.

Rows converted to `WrapRow` — related label+control pairs are grouped into sub-frames so a label and its input always wrap together as a unit:
- **Demo picker** (`pick_btns`): Check all / Uncheck all / Check selected / Uncheck selected
- **Capture events** (`ev_row`): Capture label + KILLS / DEATHS BY / ROUNDS toggles
- **Tag range actions** (`plage_actions`): Apply start / Apply end / Apply full range / After range
- **Retries / Delays / Order** (`rg`): five sub-frame groups — Retries, Delay, Demo pause, Timeout, Order (Chrono / Random) — each stays together when wrapping
- **Suicides / TK** (`tk_row`): two sub-frame groups, each with its three radio buttons
- **Headshots** (`hs_row`): label + All / Only / Exclude radios
- **Window mode** (`win_row`): mode radios group + "Send to back on launch" checkbox

Date range split into two fixed rows (`dr1` / `dr2`): From/To entries on row 1, Today/Clear shortcuts on row 2 — shortcuts no longer compete with the date fields for horizontal space.

Pane minimum sizes: `UI_PANE_LEFT_MIN = 380 px`, `UI_PANE_RIGHT_MIN = 200 px`. Enforced in Python via pixel clamping in `_on_splitter_release` (clamps before saving as %) and `_set_sash` (clamps on startup restore). `_clamp_layout_values` percentage bounds updated to `(38, 80)` to match (38 % ≈ 380 px at the 1000 px minimum window width).

---

## [v194]

### Fixed: POV killer selects wrong/random player

**Root causes (two separate bugs):**

1. **`_build_cams_victim` / `_build_cams_both` — dp2 SID mismatch:** The victim/both camera builders were using `_victim_dp2_sid` (a SteamID with the lower 3 bits zeroed due to CS2 entity-handle encoding from `parse_ticks`). CSDM's CS2 path looks up `playerSteamId` with strict equality against `players.steam_id` in its database — the entity-handle-encoded SID never matched, so `spec_player` was never called and CS2 showed a random player. Fixed by using the DB SteamID (`victim_sid`) directly.

2. **`_build_cams_killer` — overcomplicated tick iteration:** The previous implementation generated one camera entry per "camera tick" (start, pre-kill, post-kill) and started the camera on `anchor_sid` (the primary registered player) rather than the actual killer. If the primary player wasn't the killer, the camera would be pointed at the wrong person before each kill. Also, unnecessary complexity from stacking multiple prior fixes. Replaced with a clean, minimal implementation: one entry at `seq["start_tick"]` pointing to the first killer, plus one entry per subsequent killer change — directly mirroring what CSDM generates internally for highlights.

**Also removed:** The `_victim_dp2_sid` stamp from `_mate_pov_filter` (dead code — it was never a valid SteamID for CSDM).

---

## [v193]

### Fixed: Category boxes (Sec cards) overlap the console on small windows

**What changed:** The left panel's section cards now properly collapse when the window is made small — the console can no longer push them off-screen or cause overlap.

**Why it happened:** `tk.Canvas` without an explicit `height` defaults to ~264px on Windows. Every `ScrollableFrame` hosts a Canvas as its scroll viewport, so each scrollable tab inherited that 264px minimum geometry request. When the window was made short, the layout system had to satisfy that minimum, which could cause the log area to overlap or clip the category sections above it.

**Technical details:**
Added `height=1` to the Canvas inside `ScrollableFrame.__init__`. This collapses its geometry request to 1px so the layout is entirely governed by available space and pack weights rather than the widget's natural size floor. Scrolling still works normally — `height=1` only removes the artificial minimum; the canvas expands to fill its container via `pack(fill="both", expand=True)`.

---

## [v192]

### Fixed: Console too tall hides the Run/Preview/Stop buttons (superseded by v193)

Attempted fix via `height=1` on `tk.Text`. Correctly identified the geometry-request pattern but targeted the wrong widget — the root cause was the `ScrollableFrame` Canvas default height.

---

## [v191]

### Improved: Code quality pass — naming, error handling, docstrings, config migration

**What changed:** A batch of housekeeping improvements based on a full code review. Nothing user-visible — this is all about making the codebase cleaner and easier to maintain.

**Changes:**
- `_alog` / `_alog_parts` renamed to `_async_log` / `_async_log_parts` — the "a" prefix was ambiguous; "async" is unambiguous
- Bare `except Exception: pass` replaced with `except tk.TclError: pass` in all widget-lifecycle contexts (theme changes, tooltip destroy, focus checks, wraplength updates); file I/O handlers narrowed to `except (OSError, ValueError)` and `except OSError`; page-jump input narrowed to `except ValueError`
- Docstrings added to `desc_label`, `sentry`, `scombo`, `mlabel`, `hchk` — all were missing return-type documentation
- Config migrations extracted from `load_config` into a dedicated `_migrate_config(saved, cfg)` function with version comments per migration block — future renames/type changes have a clear home

**Technical details:**
`_migrate_config` is a pure function (no side effects) called once during load. Existing migration logic is unchanged — it was just lifted out and annotated. Each block now has a comment indicating which version introduced the breaking change, making it easier to decide when old migrations can eventually be dropped. Hot-loop `cfg.get()` audit confirmed `_apply_db_postfilters` already caches all config reads before its inner loops.

---

## [v190]

### Fixed: Window drag no longer sluggish

**What changed:** Window movement is instant again. Removed the async log pump that was introduced to keep the window responsive during preview — it was causing more problems than it solved by injecting recurring timer callbacks into the event loop.

**Technical details:**
Removed `_log_pump`, `_drain_log_buffer_once`, `_log_buf`/`_log_buf_lock`, and the 50ms recurring `after()` timer. `_alog` and `_alog_parts` now post directly via `after(0, ...)` per message — the original, simpler approach. The pump was added to batch log writes during heavy preview output, but the recurring timer fired on the main thread even when idle, interfering with Windows' modal drag loop. Window freezing during active preview is normal Tkinter behavior and doesn't need workarounds.

---

## [v189]

### Fixed: Window movement lag (partial — superseded by v190)

Attempted adaptive log pump: 50ms when buffer non-empty, 250ms when idle. Still left a recurring timer running, which didn't fully resolve the drag issue.

---

## [v188]

### Fixed: Tag range dates not showing after DB migration

**What changed:** When calculating date range for tagged demos, if your demo files were moved or deleted from disk, the UI would show "dates undetermined". Now it correctly falls back to the database timestamp.

**Technical details:**
The `_tag_calc_range` query was only fetching demo paths and checksums — the date column from `matches` was missing. When demo files became inaccessible, the code had no fallback date source, so sorting and date extraction failed. Now the query includes the date column and populates `_demo_dates` so `_demo_sort_key()` has a DB date to fall back to.

---

## [v187]

### Added: Export and import tag assignments

**What changed:** New **Transfer** section in Tags panel with two buttons:
- **📤 Export** — Save all your tags and tagged demos to a portable JSON file
- **📥 Import** — Load tags from a JSON file (matching by checksum)

**How to use:**
- Export captures your tag definitions (name + color) and which demos are tagged
- Import into another CSDM database — only demos with matching checksums are tagged; missing tags are created automatically with their original colors
- Perfect for migrating your tags between databases or backups

**Technical details:**
Demos are matched by checksum (not filename), so your tags transfer correctly even if demo paths changed. The import dialog shows missing tags and lets you choose which ones to create. Uses idempotent inserts so re-importing is safe.

---

## [v186]

### Cleaned up: ~300 lines of dead code removed

**What changed:** Removed unused methods, dead loops, and copy-pasted code that served no purpose. The app is now ~3% smaller and easier to maintain.

**Cleaned up:**
- 3 unreferenced methods (`_select_by_label`, `_cfg_scalar`, `_tag_search_last_tagged`)
- Dead simulation loop that computed but never stored values
- Duplicate weapon label branches and redundant condition checks
- Unused variables and overly-broad exception catches

---

## [v185]

### Performance: Optimization and DRY cleanup

**What changed:** Faster database filter processing. Kill modifiers now use caching and shared logic instead of recomputing the same data repeatedly.

**What got faster:**
- Filter detection no longer rebuilds signature tuples 5+ times per kill
- Weapon names are normalized (lowercased/trimmed) once per unique value instead of per-kill
- Duplicate filter logic merged — positive and exclusion paths now share computation

**Technical details:**
Optimized `_apply_db_postfilters`, `_build_filter_badges`, and `_build_clip_badges`. Precomputed lookups (`e_sig`, `e_ksid`, `_norm_wpn`) eliminate redundant string operations in hot loops. Exclusion filter logic reuses cached sig sets from the positive phase.

---

## [v184]

### Fixed: CS2 kept popping to foreground during recording

**What changed:** CS2 now stays behind CSDM during the entire recording. Previously it would return to foreground after a few seconds.

**Why it happened:**
The old code sent CS2 to back once, then stopped. CS2 immediately regained focus. Plus, window matching by title was fragile and unreliable.

**How it's fixed:**
- CS2 is now continuously pushed to back every 500ms (not just once)
- Window matching uses process name detection instead of window title (more reliable)
- The loop stays active for the entire recording duration

---

## [v183]

### Multiple fixes and new features

**Fixed:**
- **Stop button** now cancels preview computations (not just batch runs)
- **Mate POV "Must" mode** could occasionally return active player's POV — tightened precision checks
- **Killer POV** sometimes started on a secondary account before the first kill
- **Death notice names** were outdated — now uses names embedded in the demo itself

**Added:**
- **Recording timeout (minutes)** — Kill hanging recordings and retry automatically
- **Suicide "Only" mode** — Keep only suicide deaths (complements Include/Exclude)
- **Better log messages** — Stop/Kill operations now show timestamp and clear intent

**Changed:**
- **Keyboard shortcuts removed** (F5, F6, Esc) — Use the UI buttons instead
- **French config names→English** (`sauveur`→`savior`, `bourreau`→`bully`) — Backward-compatible, old configs auto-convert

---

## [v182]

### Fixed and improved: Preset UI, logging clarity, and tab organization

**What changed:**
- Quick preset selector added to the top bar with save button
- Duplicate log messages for Mate POV filter removed
- UI tab sections reorganized for better workflow
- Video codec/audio codec controls consolidated into one section
- Fixed exclusion filters being ignored when only `-exclude` was set

**Preset bar:** New dropdown (combobox) + 💾 button in the top header bar — select a preset instantly, save current config to selected name or new preset. `_refresh_preset_list` keeps sidebar and header in sync.

**Logging:** Removed confusing duplicate logs. Mate POV now shows clean `X/N with qualifying mate` message instead of contradictory "0/2 qualifying" + "2 → 2" pair.

**Tab reorganization:**
- Capture tab: Players → Demo Selection → Weapon Filter → Capture & Timing → Kill Filters → Match Types
- Video tab: FINAL ASSEMBLY moved to top, RECORDING SYSTEM to bottom
- **ENCODING section** now consolidates VIDEO CODEC, AUDIO CODEC, and ADVANCED FFMPEG PARAMS

**Technical details:**
- `_dp2_required_sections` now checks both `cfg.get(k)` and `cfg.get(f"{k}_exclude")` so exclusion-only filters don't skip pre-parsing
- `_apply_filter_to_events` has dedicated Mate POV log branch instead of generic log
- ENCODING section structure reduces visual noise by grouping related codec settings

---

## [v181]

### Fixed: Mate POV — SteamID precision loss (complete rewrite)

**Root cause**: `_parse_mate_positions` called `.to_numpy()` on a mixed int/float DataFrame (tick, steamid, X, Y, Z, yaw, pitch, team). NumPy upcasts the entire array to `float64`, which only has 53 bits of mantissa — not enough for 17-digit SteamID64 values. `int(float(76561198347183079))` silently becomes `76561198347183072` (off by 7). Every exact string comparison in `_find_best_mate_sid` was failing because tick_data keys were corrupted.

**What was happening in practice**:
- Victim lookup `tick_data.get(str(victim_sid))` always returned `None` → mate search never ran → camera fell back to raw victim SID → wrong or random player spectated.
- Active-player exclusion (`sid in sids_active`) also failed → wrong mate could be selected.

**Fix — preserve SteamID precision at the source**:

1. **`_parse_mate_positions`** — SteamID column is now extracted via `astype("Int64").astype(str)` while still in pandas (preserving full int64 precision), BEFORE the `.to_numpy()` call that would corrupt it. Numeric columns (positions/angles) go through `.to_numpy()` separately. Tick_data keys now contain correct SteamID64 strings that match the DB.

2. **Fuzzy matching as safety net** — `_find_sid_in_tick(tick_data, db_sid)` and `_fuzzy_sid_in_set(dp2_sid, db_sids_set)` provide tolerance-based lookup (±8) in case any edge case slips through.

3. **`_find_best_mate_sid`** — rewritten to use fuzzy helpers and return `(mate_sid, victim_sid)` tuple so callers always have the correct SID for CSDM.

4. **`_mate_pov_filter`** — stamps `evt["_victim_dp2_sid"]` on every kill for camera fallback.

5. **`_build_cams_victim`** + **`_build_cams_both`** — fallback camera uses `_victim_dp2_sid` instead of raw DB `victim_sid`.

---

## [v180]

### Improved: Clip merging and weapon filter visibility

**What changed:**
- Adjacent kills that are close together now automatically merge into one clip
- Weapon selector now shows how many weapons are currently selected

**Sequence merge gap:** `_build_sequences` now merges two adjacent clip windows not just when they overlap, but also when the gap between them is ≤ your configured Before duration. This matches native CSDM: a kill happening just a few seconds after the first clip ends extends that clip instead of creating a separate one. No new settings — Before duration is the natural tolerance.

**Example:** Before = 5s @ 64 ticks/s → two kills up to 5 seconds apart (after the first clip's after padding) merge into one.

**Weapon filter indicator:** The weapon label now shows `weapons (X / Y selected)` in **orange** whenever a partial filter is active, making it obvious when unexpected weapons are still checked. Shows `weapons (all / Y)` muted when no filter is applied.

---

## [v179]

### Fixed: Workshop auto-download confirmation dialog

The "Auto Workshop DL" checkbox now properly auto-confirms the CSDM workshop download dialog by setting `"downloadWorkshopMap": true` in the CSDM video JSON config (in addition to injecting `sv_pure 0 / sv_lan 1` into CS2). Previously, the dialog would still appear, blocking the batch run.

### Fixed: Mate POV parsing in killer mode

Mate POV was being parsed even when perspective was set to killer, doing expensive position lookups for no reason. Two fixes:

1. **Perspective change resets vars**: Switching to killer POV now explicitly resets `kill_mod_mate_pov` and `kill_mod_mate_pov_req` to `False`.
2. **Filter safety guard**: `_mate_pov_filter` now early-returns in killer mode, preventing silent processing even if the var is stale.

**Scenario fixed**: User checked Mate POV in victim mode, switched to killer POV, then ran Preview — mate POV was still being processed wastefully. Now it resets automatically.

---

## [v178]

### Changed: Preset category selector redesigned — mini-tab columns

Replaced the 4 broad checkboxes (Player, Video, Timing, All) with a granular mini-tab column layout:

- **CAPTURE** tab: Active players, Date range, Filters
- **VIDEO** tab: Mode (HLAE/CS), Output name, Encoding, HLAE options, Physics
- **TIMING** tab: Timing & retry
- **ALL** column: Full config checkbox

**PRESET_KEYS** split into new granular sub-keys: `players`, `date`, `filters`, `mode`, `output_name`, `encoding`, `hlae_opts`, `physics`, `timing` (plus backward-compat aliases `player`, `video` for old presets).

The new UI allows fine-grained control over which settings are saved in each preset. Old presets load correctly via backward-compat path.

---

## [v177]

### Improved: Preset system and One Tap filter, UX refinements

**What changed:**
- Preset saving now uses checkboxes instead of single radio button
- Preset tooltips show all settings at a glance
- One Tap filter now properly enforces headshots via SQL
- "Clear all" in demo picker shows clear feedback

**Preset UI:** Replaced single "Type" radio with four independent checkboxes — **Player + events + filters**, **Video / encoding**, **Timing + robustness**, **All settings** (exclusive). Now you can combine multiple categories in one preset (e.g. Player + Timing). Format changed from `{"type": "..."}` to `{"cats": [...]}` with backward-compat for old presets.

**Preset tooltips:** Hover over any saved preset to see categories saved, key count, and notable settings (player name, perspective, dates, resolution, FPS, encoder, before/after).

**One Tap + headshots:** `kill_mod_one_tap` now adds `AND is_headshot = TRUE` to the SQL query (when headshot column exists), ensuring DB returns only HS kills before dp2 shot-isolation. If `headshots_mode = exclude`, the HS clause is skipped. Warns in log if headshot column is missing.

**Demo picker UX:** When dates are cleared via "Clear all", now shows `— all demos (run Preview to filter)` instead of blank, making it clear an empty picker means no filter (all demos included).

---

## [v176]

### Added: Victim's Mate POV feature

**What changed:** Record kills from the perspective of the victim's teammate with the best view of the action, instead of just following the victim.

**How it works:**
- At each kill tick, teammate positions and view angles are checked (`demoparser2` parse_ticks)
- Teammate qualifies if ≥2 of 3 body points (head/chest/legs) fall within ±45° of their look direction (≈50% body visible)
- Best teammate = smallest angle to kill point; active players excluded from consideration
- LOS is angle-based only (no BSP ray-cast available)

**Two modes:**
- **Optional** (default): Falls back to normal victim/both perspective if no qualifying teammate found
- **★ Must**: Drops clips with no qualifying teammate entirely

**UI:** New "Mate POV" row (Enable + ★ Must checkboxes) in **Capture & Timing** section, below Switch delay slider. Only visible when POV is Victim or Both (Killer mode has no victim phase).

**Camera wiring:**
- Victim mode: single camera target replaced by mate SID when available
- Both mode: victim-phase switch points to mate SID; killer phase unaffected

---

## [v175]

### Fixed: Weapons misclassified into "Other" category

**What changed:** CZ75-Auto and other weapons now appear in correct categories instead of getting lumped into "Other".

**Three-layer fix:**
1. **Prefix indexing** — `_WEAPON_LOOKUP` now stores keys with `weapon_` prefix (`weapon_cz75a`, etc.) so internal game names resolve directly
2. **Prefix stripping** — `_weapon_category` strips leading `weapon_` before lookup (e.g. `weapon_cz75a` → lookup `cz75a` → Pistols)
3. **Substring fallback** — `_WEAPON_SUBSTR_FALLBACK` maps substring variants to categories (`"cz75 auto"`, `"cz75_auto"`, etc. all → Pistols). Covers deagle, glock, usp, awp, etc.
4. **UI cleanup** — Unknown weapons silently skipped from render instead of grouped under confusing "Other" header

---

## [v174]

### Fixed and improved: UI responsiveness, filter reorganization, Both mode

**What changed:**
- Tab switching and window dragging no longer stutter
- WALLBANG and BLIND FIRE filters now run from database (faster)
- Both mode now shows correct POV at clip start
- Switch delay slider shows total clip duration

**UI responsiveness:** Two separate lag fixes:
- **Window drag momentum:** Removed `_on_splitter_release()` call from layout state save — sash snapping now only on actual drag (not after window moves)
- **Tab switching:** Added `<<NotebookTabChanged>>` binding to immediately flush scroll-frame widths when tab becomes visible (instead of 400ms delay)

**Filter reorganization:** WALLBANG and BLIND FIRE now run at database level (no demo parsing needed):
- **🧱 WALLBANG** → `kills.penetrated_objects > 0` (category: dp2 → mods)
- **😵 BLIND FIRE** → `kills.attacker_blinded` (category: dp2 → mods)
- **🪂 AIRBORNE** has no DB equivalent, stays in dp2
- Cleaner `_mod_sql_expr()` helper replaces dead special-case logic

**Both mode fixes:**
- **Wrong POV bug:** `_build_cams_both` was using last-processed kill's killer at start instead of first active player. Now `initial_sid` from `_seq_anchor_sid` is the true starting camera, never placed in timeline. Only switch events go in timeline (victim switches + killer returns)
- **Duration hint:** Added live **"total before: Xs"** label next to Switch delay slider showing sum of BEFORE + Switch delay

**Technical details:**
Window drag momentum was caused by `_remember_layout_state` debounce triggering reflow; now only happens on actual sash-drag. Both mode timeline deduplication fixed by first-write-wins dict (no overwrite).

---

## [v173]

### Fixed: Deathnotice player names show correct names from demo time, not current DB

**What changed:** Player names in CSDM deathnotices now show the names they had when the demo was recorded, not their current/latest name from the database.

**Technical details:**
- `_dp2_parse_demo` now parses player info as `"names"` cache section
- Names stored as `{steamid: name}` map (`demo_names`) in dp2 cache, per-demo
- `_dp2_required_sections` includes "names" so every demo gets minimal parse
- `_build_json` resolves names via `_name(psid)` helper: demo cache first, DB fallback. All `playerName` fields use this helper

---

## [v172]

### Fixed and improved: Theme system, console logging, preview export, resource management

**What changed:**
- Light mode (white theme) now has proper contrast and colors
- Console timestamps stamp each line correctly
- Preview results can be exported as HTML/TXT/JSON
- dp2_threads setting now actually controls core usage
- Ferrari Peek badge displays in correct position
- Injection preview tool shows exactly what gets injected

**Light mode overhaul:**
- White preset softened (`#f8f8f8`, `#e4e4e4`) to reduce harsh contrast
- New `_STATUS_COLOURS_LIGHT` dark-saturated palette for light backgrounds
- `_build_theme` auto-selects light colors when bg preset has `_is_light: True`
- Log tags reapply on theme change so dark↔white switching works correctly

**Console improvements:**
- Timestamps now per-line at write time (`[HH:MM:SS]` prefix in `_log`)
- Removed erroneous live ticking clock from header
- Toggle via **TS** button in log toolbar

**Preview export (📤 Export ▾):**
- **HTML** — standalone dark-themed file with per-clip table (date, demo, filters, tick, playdemo command)
- **TXT** — columnar table + `cmd:` line per clip
- **JSON** — structured array for scripting
- **Filters column** shows actual matched filters per clip (not just active config)

**Resource management:**
- Fixed dp2_threads not being respected — Rayon pool was using all cores regardless
- Set `RAYON_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS`, `OPENBLAS_NUM_THREADS` to "1" at import time
- Result: `dp2_threads = N` now means exactly N cores used

**Added: INJECTION PREVIEW (Tools tab)**
- Collapsible section below PERFORMANCE
- Shows exact args injected into CS2 for current config
- HLAE mode: full `extraArgs` token broken one-per-line
- CS mode: `launch_args` + each `console_cmds` entry
- **⟳ Refresh** button for manual update; auto-sizes (4–12 lines)

**UI fixes:**
- Ferrari Peek dp2_badge moved to main `_hv_row` frame (was hidden inside expandable)

---

### Fixed: Theme change retaining old colours on some widgets

Root cause: `_CHK_KW` and `_BTN_KW` are module-level dicts built at import time with default dark/green values. Any session started with a non-default saved theme would create those widgets (log filter radiobuttons, preset-type radiobuttons, weapon-category checkboxes, autoscroll toggle) with wrong colours. Subsequent `_change_theme` calls could not fix them because the colour_map was keyed on the current theme's values, not the stale defaults.

- **`_apply_theme_globals` now updates `_CHK_KW`/`_BTN_KW` in-place** on every call — startup and runtime both correct.
- **Colour-map collision detection**: if two theme keys share the same old hex value but map to different new values (e.g. amoled `BG == BG2 == #000000`), the ambiguous value is excluded from the generic map rather than producing wrong remapping.
- **`ScrollableFrame.apply_theme()`** added — explicitly sets canvas + inner frame `bg` to `_t("BG")`, bypassing colour_map ambiguity. Handled by `_walk` alongside `Sec`.
- **Log widget** bg changed from hardcoded `"#090909"` to `_t("LOG_BG")` at creation.

---

## [v171]

### Improved: Demo parsing performance and TrueView fallback, UI reorganization

**What changed:**
- Demo parsing is faster with better thread utilization
- TrueView failures now auto-retry instead of failing silently
- Settings sections reorganized for better logical grouping

**Demo parsing speedup:**
- Auto-scaled thread count: `dp2_threads` default now `min(8, max(2, cpu_count))` instead of hardcoded 2
- Better out-of-the-box utilization on multi-core machines
- Vectorized fire/hurt loops: replaced `for row in arr` with pandas `groupby`
- Pandas/numpy operations release GIL during computation, less UI stutter in background

**TrueView fix:**
- Old demos without TrueView cause CSDM CLI to output `Raw files not found`
- Previously logged as dim (non-error) line → no retry → appeared successful but wrong POV
- Now detected as error (logged red)
- If TrueView was ON: auto-retries that demo with `trueView: false` injected, falls back cleanly

**UI reorganization:**
- **"RESOLUTION & FRAMERATE"** → **"RESOLUTION, FRAMERATE & WINDOW"**
- Window mode + Send to back on launch moved from "CS2 EFFECTS" (was wrong logical grouping)
- **Close CS2 after demo** moved from "FINAL ASSEMBLY" to **"IN-GAME OPTIONS"** (controls process behavior, matches TrueView/death notices/X-Ray)

---

## [v170]

### Fixed: Resize and drag interactions still laggy despite debounce

**What changed:** Two-tier resize strategy eliminates reflows mid-interaction while preserving OS-resize support.

**Two-tier approach:**
- **Mouse-driven (sash drag, in-app):** Global `<ButtonRelease-1>` handler flushes all pending canvas width + wraplength updates exactly once on release — zero reflows during drag
- **OS window-border resize:** 400 ms debounce fallback (Tkinter doesn't receive ButtonRelease for OS chrome)

**Technical details:**
50 ms debounce was too short — reflows still triggered mid-drag. `_WRAP_LABELS` registry added: all wraplength-registered labels flushed on release alongside `ScrollableFrame` width updates.

---

## [v169]

### Fixed: Window resize and sash drag cause lag during interaction

**What changed:** Debounced reflow cascade so UI stays responsive during window resizing and sash dragging.

**Problem:** Every pixel of resize triggered synchronous cascade:
```
canvas <Configure> → itemconfigure(inner, width)
  → inner <Configure> → bbox("all") + scrollregion
    → every desc_label <Configure> → wraplength update
```

**Fixes:**
1. **ScrollableFrame debounce:** Canvas `<Configure>` now debounces inner-frame width sync to 50 ms. Entire cascade (reflow + child events) suppressed during drag, fires once when stops
2. **Scrollregion optimization:** Replaced `bbox("all")` traversal with direct Configure event `(0, 0, e.width, e.height)` — O(1) instead of walking all items
3. **Label wraplength:** Debounced to 50 ms via `_bind_wraplength` helper. Codec description labels (`_vcodec_desc`, `_acodec_desc`) share same helper — no duplicate binding

---

## [v168]

### Fixed: Scroll wheel and sash dragging fighting geometry manager

**What changed:**
- Mouse wheel scroll now works on all tabs (not just Capture)
- Sash dragging no longer fights window geometry manager

**Scroll fix:** All `ScrollableFrame` canvases share same screen coords inside `ttk.Notebook`. `contains_point` check was matching all — `_SCROLL_FRAMES[0]` (Capture) always won. Added `winfo_viewable()` guard: returns True only when canvas AND all ancestors mapped (current tab only).

**Sash fix:** `pack_propagate(False)` + `configure(width=N)` made frames fight `ttk.PanedWindow` geometry manager on every drag. Removed both. Minimum size now enforced correctly: `_on_splitter_release` snaps sash to clamped position after drag ends (sashpos reapplied), no interference during

---

## [v167]

### Fixed and improved: Scroll behavior, pane sizing, UI helpers

**What changed:**
- Mouse wheel scroll works on all tabs from first render
- Content fills tab width correctly on resize
- Log pane no longer collapses, console pane collapsible
- UI helper layer refactored to reduce duplicate code

**Scroll fix:** Previous Enter/Leave + recursive _bind_children machinery only worked when mouse physically entered canvas (never happens clicking tab headers). Solution: removed Enter/Leave, added module-level `_SCROLL_FRAMES` registry + single global `bind_all("<MouseWheel>", _global_wheel)` handler. Finds frame under cursor and scrolls it. Text/Listbox/Scale/Treeview widgets excluded (preserve native scroll).

**Content width:** `ScrollableFrame` wasn't resizing inner frame to match canvas width. Added `<Configure>` binding calling `itemconfigure(win_id, width=e.width)`.

**Pane sizing:** `ttk.PanedWindow` had no minimum pane sizes — sash could hide notebook completely. Both panes now have `pack_propagate(False)` constraint preventing collapse.

**UI helpers (DRY):**
- `_sep(parent, pady, padx)` — replaces 12 inline Frame separator calls
- `_chk_tip(parent, label, var, tip, …)` — replaces `hchk + pack + add_tip` 3-liners
- Dynamic `desc_label` with `<Configure>` binding sets `wraplength = max(200, widget_width - 10)` (was hardcoded 700)

---

## [v166]

### Fixed and improved: Match type filtering compatibility, major code cleanup

**What changed:**
- Match type filter now handles both old and new CSDM database formats
- ~180 lines of dead code and duplicate logic removed
- 6 JSON persistence functions replaced with 2 generic helpers
- 11 identical filter wrapper methods eliminated

**Match type fix:** CSDM stores competitive/wingman under different names depending on version (`scrimcomp5v5` vs `competitive`). Databases built with different CSDM versions would silently skip those types. Now: `MATCH_TYPE_DEFS` carries `db_values: list` (not single string). SQL builder flattens into `IN (…)` clause matching both spellings. Tooltip and visibility checks also updated.

**Code cleanup — DRY:**
- `_load_json` / `_save_json` — 6 persistence functions → 2 generic helpers (load_presets, save_presets, etc. now one-liners)
- `_make_highlight_toggle` — shared trace closure extracted from duplicate hchk/hradio logic (~20 lines saved)
- `_cfg_num` — generic numeric reader (cfg_int/cfg_float are thin wrappers)
- `_page_count()` — helper replacing 4 repeated `max(1, (len + ps - 1) // ps)` expressions
- `_validate_run_inputs()` — guard extracted from _run and _dry_run
- `_apply_theme_globals` — replaced 13 manual `global X = _THEME[X]` with loop

**Dead code removed:**
- `_engage_trois_tap`, `_disengage_trois_tap` — no-op methods
- `_on_tag_selected` — never called
- `_refresh_tag_combo` — pass method + 3 call sites
- `_on_trois_tap_toggle`, `_on_one_tap_toggle` — no-op pass methods
- Full HS-lock chain: `_hs_only_is_required` → `_refresh_hs_lock_state` → `_install_hs_lock_watchers` → `_lock_hs_to_only` → `_unlock_hs` (entire unused chain)
- 11 `_apply_*_to_events` one-liner wrappers (all identical delegates; preview path now builds inline lambdas)

---

### Fixed and improved: Widget trace crashes, settings organization, physics timing

**What changed:**
- Fixed crash when theme changes after DB reconnect
- Close CS2 moved to correct settings section
- Corpses no longer fall in fast-motion during recording

**Widget trace crash:** `_refresh_match_type_ui` destroys/recreates checkbox children on every DB connect. But `var.trace_add("write", _update)` closures survived destruction. On next BooleanVar change (theme change, etc.), stale `_update` tried `.config()` on destroyed widget → TclError crash. Fix: `_safe_trace_remove(var, mode, tid)` helper + winfo_exists() guard + `<Destroy>` binding. Self-cleaning regardless of rebuild frequency.

**Settings reorganization:** "Close CS2 after demo" was under RECORDING SYSTEM (wrong — that covers codec/mode). Moved to top of FINAL ASSEMBLY with divider. Correct semantics: closing CS2 is batch-flow concern, not recording-system setting.

**Physics timing:** CS2 inherits residual `host_timescale` from previous session, causing ragdolls to simulate faster. Symptom: corpses fall unnaturally fast. Fix: `demo_timescale 1` now first command in `_common_cs2_injection` (both HLAE and CS mode), resets playback speed to 1× before any physics commands. Tooltip updated with workaround: unchecking `cl_ragdoll_physics_enable` freezes corpses instead.

---

## [v164]

### Fixed and added: Clutch detection in Wingman, match type filtering, cleanup robustness

**What changed:**
- Clutch detection no longer triggers false positives in Wingman
- New match type filter lets you filter by game mode
- Empty folders left behind after clip assembly are now cleaned up properly
- "Tools" tab renamed to "Settings"

**Clutch fix:** Clutch detection built alive-set from kill log only (killer/victim). In Wingman (2v2), a teammate who hadn't killed/died yet was absent → code thought team was alone → false clutch on every round. Fix: `_fetch_all_kills_for_demos` runs second query against `players` table to get per-team roster counts. `_apply_clutch_filter` injects synthetic ghost players (`__ghost_<team>_<i>__`) for unaccounted slots. Best-effort (no crash if players table lacks columns).

**Match type filter:** New **MATCH TYPES** section in Capture & Timing (hidden by default, appears after DB connects). Filter by: 🏆 Premier, 🎯 Competitive, 🤝 Wingman, 🎮 Casual, 💀 Deathmatch, 🎓 Training, 🔫 Arms Race, 💣 Demolition, 🤖 Co-op, ⚡ Skirmish, ↩ Retakes. Master toggle (off = no SQL overhead). Only types in your DB shown (no phantom checkboxes).

**Folder cleanup:** Two bugs fixed:
1. **Wrong root guard** — compared paths against legacy `output_dir` instead of `output_dir_clips`
2. **No upward traversal** — only checked immediate parent, left empty intermediate folders

Solution: `_try_remove_dir(d)` recursive upward walker stops at root or non-empty directory. `visited` set prevents double-visits.

**UI:** "Tools" tab renamed to "Settings"

---

## [v163]

> Internal version bump — no documented changes. Shipped as the baseline before the v164 session.

---

## [v162]

### Fixed and improved: UI button visibility, demo picker, player names, Workshop DL

**What changed:**
- Stop/Kill buttons now visibly light up during recording
- Map column shows up in demo picker correctly
- Death notices show correct player names (not old aliases)
- Auto Workshop DL loads correct map version
- Encoder field removed (always FFmpeg anyway)

**Button visibility:** `_run()` was setting `state="normal"` but leaving `fg=MUTED` → buttons greyed out even while active. Now both get `fg=RED` on activation, reset by `_reset_btns()`.

**Map column bug:** `_map_col` detected inside kills query block but evaluated *after* `map_sel` constructed → always `""` on first query → map column never fetched. Detection moved to before `_build_dsql`, ensuring column included from first query.

**Player names:** `_player_names` used `GROUP BY p.name, p.steam_id ORDER BY p.name` which surfaced arbitrary historical name when player had multiple entries. Changed to `DISTINCT ON (p.steam_id) … ORDER BY steam_id, last_seen DESC NULLS LAST` — now only most recent name per SID.

**Workshop DL fix:** Was using `+cl_downloadfilter all` which downloads current published version from CDN (may be different map entirely). Now uses `+sv_pure 0 +sv_lan 1`: sv_pure 0 disables file validation (loads local version), sv_lan 1 blocks external verification. Requires old map already cached locally. Tooltip updated.

**UI cleanup:** Encoder selector removed from RECORDING SYSTEM (was always "FFmpeg", no alternatives). `encoder` key still written to JSON for compatibility; only System (HLAE/CS) radio buttons shown.

---

## [v161]

### Added: Exclude option on every kill filter

Every kill filter now has an **Exclude** checkbox alongside Enable and ★ Must. Exclude removes all kills that match the filter from results, the inverse of Enable. Enable and Exclude are mutually exclusive per filter — turning one on clears the other. Exclude also clears ★ Must when activated.

**What it means in practice:**

- `💨 SMOKE: Enable` → keep only smoke kills
- `💨 SMOKE: Exclude` → keep everything *except* smoke kills
- Both can be combined with other filters: `🧱 WALLBANG: Enable` + `😵 BLIND FIRE: Exclude` → wallbang kills that are not blind-fire

**UI:** The Exclude hchk appears on every filter row, consistent position after ★ Must. TROIS SHOT's pre-existing Exclude (formerly "no_trois_shot") is folded into the same position. Preview header shows `🚫 badge` for excluded filters. Clip badges show `[🚫badge]` in amber. The "Unselect all" button clears Exclude flags alongside Enable and ★ Must.

**Pipeline — where each category's exclusions are applied:**

| Category | Mechanism |
|---|---|
| **SQL Mods** (SMOKE, NO-SCOPE, VICTIM FLASHED) | `AND NOT col IS TRUE` appended directly to the kills SQL WHERE clause — zero Python overhead, database handles it |
| **dp2 filters** (WALLBANG, AIRBORNE, BLIND FIRE, COLLATERAL, TROIS SHOT, ONE TAP, SPRAY TRANSFER, FERRARI PEEK, FLICK, SAVIOR) | Excluded filters run first on the full kill list; matching kill signatures are collected and stripped before any positive filter runs. Applies in both the batch worker path (`_apply_dp2_modifiers`) and the preview/redo path (`_apply_dp2_filters_to_events`) |
| **DB post-filters** (ENTRY FRAG, ACE, MULTI-KILL, BULLY, ECO FRAG) | Exclusion sig-sets built from the same per-round group logic used for positive detection, then subtracted from `keep_sigs`. Works in all three logic modes (ANY/ALL/MIXED). Exclusion-only mode (no positive filter active, only exclusions) is handled — starts from all kill sigs and subtracts |

Excluded kills are stripped upstream, so `_apply_global_filter_gate_events` naturally ignores them — no changes needed there.

**Technical details:**

- `_NO_AUTO_EXCLUDE` set at module level: `kill_mod_no_trois_shot` (already has its own mechanism) and `kill_mod_trois_tap` (always a positive-only filter) are excluded from auto-generation
- `_FILTER_CONFIG_DEFAULTS`, `_FILTER_BOOL_KEYS`, and `_FILTER_PRESET_PLAYER_KEYS` all auto-derive `key_exclude` entries from the registry loop — adding a new filter in `KILL_FILTER_REGISTRY` automatically gets an Exclude option with no extra code
- `_clear_kill_filters` clears all three suffixes (`""`, `"_req"`, `"_exclude"`) in one loop

---


## [v160]

### Fixed: demo compatibility warning — correct CS2 breaking updates

The previous implementation (v159) was wrong on two levels: it checked for CS:GO `HL2DEMO` headers (which never appear in CSDM's CS2-only database), then switched to an age-based heuristic (also wrong — CS2 demo compatibility has nothing to do with file age).

The correct behaviour: CS2 has had specific **hard breaking engine updates** that make all demos recorded before them completely unplayable on any current CS2 version, regardless of age. These are not gradual; they are binary breaks.

**Known hard breaks now encoded in `_CS2_DEMO_BREAKS`:**
- **July 28 2025 — AnimGraph2**: Valve replaced the entire animation engine with AnimGraph2. Every demo recorded before this date is broken on CS2 ≥ 1.40.8.9. Workaround: downgrade CS2 via Steam beta depot to ≤ 1.40.8.8.
- **February 6 2024 — major format update**: The demo file format changed substantially, breaking parsers and causing playback crashes on all subsequent CS2 versions.

`_check_demo_compat(demo_path)` is now an instance method (uses the existing cached `_get_demo_ts`) that checks the demo's recorded timestamp against each break's cutoff date, newest-first. Returns `{'status': 'ok'|'warn'|'missing', 'break': label, 'tip': explanation}`. Adding future breaking updates is one entry in `_CS2_DEMO_BREAKS`.

Warned demos appear yellow in the picker. Hovering shows a popup naming the breaking update and explaining the workaround.

### Added: map column fetched in rounds query and manual mode

The map name is now populated from all three query paths (kills, rounds, manual mode picker), not just kills. Manual mode uses a `_find_col` lookup as a local fallback if `_map_col` hasn't been detected yet (e.g. when opening the picker before running a preview).

---

## [v159]

### Added: player list — full page navigation

The pagination bar now has four buttons instead of two:

- **◀◀** — jump to page 1
- **◀** — previous page
- **`[N]`** — direct page entry (editable, press Enter or Tab to jump). Syncs automatically with every page change. Invalid input resets to the current page.
- **▶** — next page
- **▶▶** — jump to last page

The label beside the entry shows `/ 14  (110)` (total pages, total count). All far buttons disable and go muted when already at the boundary.

### Added: demo picker — map column

A **Map** column (80 px, non-stretching) appears between Date and Demo in the treeview. The map name is fetched from the `matches` table via `_find_col` against `["map_name", "game_map", "map", "level_name", "server_map"]`. Common CS2 map prefixes (`de_`, `cs_`, `ar_`, etc.) are stripped for brevity. The column is populated in the kills SQL query (no extra round-trip), also in the rounds query and manual mode picker. The cache (`_demo_map_cache`) clears on DB reconnect; `_map_col` re-detects automatically.

### Added: demo picker — CS2 compatibility warning (initial, superseded by v160)

> Note: the HL2DEMO/age-based approach in v159 was incorrect. See v160 for the correct implementation.

---

## [v158]

### Changed: UI revamp — collapsible sections, unified spacing, redesigned chrome

**`Sec` — collapsible section cards.** Every section (PLAYER, CAPTURE & TIMING, KILL FILTERS, etc.) is now a collapsible card. Clicking the header collapses or expands the body. The header has a 3 px orange left accent stripe, bold title, and a `▾`/`▸` toggle arrow. `Sec` is a drop-in replacement for the old `LabelFrame` — all existing widget creation code is unchanged.

**UI spacing constants.** Six `UI_*` constants at the top of the module replace all hardcoded padding values. `UI_SEC_PADX = 14`, `UI_SEC_PADY = 8`, `UI_SEC_GAP = 6` apply uniformly to every section on every tab. The tab scroll inner frame uses `padx=0` so sections fill edge-to-edge. All 25 individual `sec.pack(pady=(...))` calls were stripped — the `Sec.pack()` default handles it.

**Header bar.** Replaced the `" >> " CSDM  Batch vXXX` row with a clean `BG2` bar, 4 px orange left stripe, compact DB status on the right.

**Run bar.** Two-px orange accent line at top. `▶ RUN` (accent bg) | divider | `🔍 Preview` (blue) | divider | `⏸ Stop` / `⛔ Kill` (muted until active). Summary line separated by 1 px border.

**Log panel.** Left accent stripe matches sections. Tighter filter controls.

**Sliders.** Value label uses bold Consolas in ORANGE, fixed-width, right-aligned.

**`hchk` / `hradio`.** `padx` 8→10, `pady` 3→4 — slightly more pill breathing room.

**Theme walker.** `_apply_theme_to_widgets` calls `sec.apply_theme()` on every `Sec` instance it encounters, so collapsible header colours update correctly on theme change.

---

## [v157]

### **🎯 CLUTCH — Complete rewrite. The previous implementation was not functional.**

The clutch feature existed in the codebase since v82 but had been rewritten, patched, and re-patched across more than a dozen versions without ever reaching a working state. This version replaces the entire mechanism from scratch with a clean, reliable implementation.

**What changed for users:**

- Clutch detection now actually works. Enable the 🎯 CLUTCH toggle, pick your size filter (1v1 to 1v5), choose **Kills only** or **Full clutch** mode, optionally check **Wins only** — and you get clips.
- **Kills only** — one clip per kill made during the clutch, using the normal Before/After window. Same behaviour as the regular Kills capture, but restricted to the clutch phase only.
- **Full clutch** — one continuous clip from the exact tick you became last alive until the last kill of the round. Before/After sliders are ignored; the clip spans the entire clutch sequence.
- Size filter: leave all boxes unchecked to capture every clutch, or check specific sizes (1v1, 1v3, etc.) to restrict.
- **Wins only**: only rounds where you killed all remaining opponents are included.
- Clutch is stackable with all other kill filters — other filters narrow the kill set first, clutch restricts to the clutch phase last.

**Technical details:**

The old implementation tried to infer team state from which players appeared as killers in the kills table — missing teammates who hadn't made a kill yet. It also had a separate `_query_clutch_events` DB function with round-bracket logic, side normalisation bugs, winner column detection issues, and was tightly coupled to a `clutch_group` field that multiple downstream filter stages silently dropped.

The new implementation:

- Is a **pure post-query filter** (`_apply_clutch_filter`) applied after all existing DB filters inside `_query_events`. No schema changes. No new DB queries beyond one all-kills fetch per batch.
- Fetches all kills for all relevant demos in one SQL query (`_fetch_all_kills_for_demos`), groups them by round using `round_number` if available or a tick-heuristic fallback.
- Walks kills chronologically per round, maintains a per-team alive-set, and detects the exact tick when the tracked player becomes last alive. Records clutch size and whether the player won.
- Handles DB schemas with or without team/side columns. Without team data, falls back to a SID-set heuristic (player's SIDs vs everyone else).
- Stores `round_tick_min`/`round_tick_max` per clutch window to resolve round-key mismatches between the all-kills query (which may have `round_number`) and the main kills query (which does not).
- `_build_sequences` patched to honour `_seq_start_tick`/`_seq_end_tick` overrides on events, enabling exact-boundary full-clutch clips without touching the Before/After sliders.
- Fully removable: integration points are a guarded call in `_query_events`, an `if/else` branch in `_build_sequences` (safe when keys absent), and a badge branch in `_build_clip_badges`. None break if the clutch block is deleted.

---

### Renamed: "Full round" → "Full clutch"

The old label implied the clip covered the entire CS round (up to 115 seconds). It covers the clutch phase only. Renamed everywhere: UI radio button, config value (`"full_clutch"`), log headers, docstrings.

---

### UI: CAPTURE and TIMING sections merged into CAPTURE & TIMING

Two adjacent sections with tightly related settings merged into one, reducing scrolling and visual noise.

---

### Fixed: ROUNDS capture not working

`cfg["events_rounds"]` was a direct dict key access inside `_query_events`. A missing key (config loaded from disk before the Rounds toggle existed) raised a `KeyError` silently swallowed by `except Exception: pass` — no rounds, no error. Changed to `cfg.get("events_rounds")`. Same fix applied to `cfg["events_kills"]` and `cfg["events_deaths"]`.

---

### Fixed: pre-existing crash in `_worker` — `seqs` was unreachable dead code

`seqs = self._build_sequences(...)` and `t0_seq = time.time()` were placed inside the `if events is None: ... continue` block — completely unreachable. Yet `seqs` and `t_seq` were used immediately after, causing `NameError` on every demo with events. Moved to the correct position after the guard.

---

### Improved: player list pagination

The DB search listbox previously showed 4 rows — all players were loaded but almost none were visible. Replaced with an 8-row paginated display:

- **◀ / ▶** buttons navigate pages.
- `p.2/14 (110 total)` label shows current position.
- Searching always resets to page 1.
- `_select_by_label` jumps to the correct page automatically.
- `_on_lb_select` maps listbox row index to the correct absolute position in the full filtered list.

---

### Fixed: already-tagged demos — picker not updated on "No" answer

Choosing **No** in the already-tagged dialog correctly skipped those demos but left them checked (✓) in the picker. On the next Run they were queued again.

Both **No** and **Cancel** now call a shared `_uncheck_in_picker()` helper that unchecks the already-tagged demos immediately, updates row visuals (✕, greyed text), and refreshes the selection counter. **Yes** leaves the picker unchanged.

---

## [v156]

### Fixed: `_build_clip_badges` — `[ROUND]` badge `NameError` if clutch removed

The `[ROUND]` condition referenced `clutch_events` by name. If the clutch block were deleted, this would raise `NameError`. Rewritten as `not (kill_events or death_events or clutch_events)` — removing clutch terms reduces naturally to the original condition without a dangling name.

---

## [v155]

### Fixed: already-tagged dialog — duplicate inner functions

Cancel and No branches each defined identical `_uncheck_tagged` / `_uncheck_skipped` inner functions. Deduplicated into one `_uncheck_in_picker(paths)` helper called from both.

---

## [v154]

### Added: clutch filter wired into `_query_events`; config keys, UI, and preset support

Clutch filter runs after `_apply_db_postfilters`, gated behind `cfg.get("clutch_enabled")`. Config keys: `clutch_enabled`, `clutch_wins_only`, `clutch_mode`, `clutch_1v1`–`clutch_1v5`. All clutch keys in `PRESET_KEYS["player"]`. UI: master toggle, Wins only, Kills only / Full clutch radio, 1v1–1v5 checkboxes, greyed sub-controls when master is off.

---

## [v153]

### Added: `_fetch_all_kills_for_demos` and `_apply_clutch_filter`

Core clutch detection methods. Both are self-contained and zero-overhead when `clutch_enabled` is False.

### Fixed: `_build_sequences` — `_seq_start_tick`/`_seq_end_tick` override support

Events carrying these keys use them directly as clip boundaries. Normal events (keys absent) hit the unchanged `else` branch.

---

## [v152] *(was v143.8)*

### Fixed: clutch — zero results with TEAM_A / TEAM_B format

`_norm_side("TEAM_A")` returned unrecognised value → hardcoded fallback `"T"` → no victim matched. Fix: detection reads raw `killer_team_name` as `player_team`, classifies by direct string equality. Works for CT/T, TEAM_A/TEAM_B, any scheme.

**Validated:** 23 true 1v3 clutches found across 310 matches, 13 remaining after Win Only.

---

## [v151] *(was v143.6)*

### Fixed: clutch size always reported as 1v5

`op_team_sz − dead_before` = 5 when player kills all opponents alone (deaths happen after last-alive tick, so `dead_before = 0`). Fix: `clutch_size = len(opponent_death) − dead_before`.

---

## [v150] *(was v143.5)*

### Fixed: correct timeline-based last-alive algorithm

Old algorithm required all 4 teammates dead before the player's **first kill** — wrong if the player kills before teammates die. New: `last_alive_tick` = tick of (N−1)th teammate death. Player confirmed in clutch if they have at least one kill strictly after `last_alive_tick`.

---

## [v149] *(was v143.4)*

### Fixed: diagnostic logging; TROIS SHOT/ONE TAP/TROIS TAP decoupled; HS auto-lock removed

Step-by-step diagnostic logging in `_query_clutch_events`. Three dp2 filters made fully independent — automatic coupling removed. Headshot mode always user-controlled.

---

## [v148] *(was v143.3)*

### Fixed: `_norm_side` NameError; missing victim_side inference

`_norm_side()` defined in Step 5, called in Step 2b → `NameError` swallowed silently. When `victim_team_name` absent, `v_side` inferred as opposite of `k_side` (CT↔T).

---

## [v147] *(was v143.2)*

### Fixed: clutch — clean-room rewrite; scroll bugs fixed

New team-size-aware last-alive algorithm using victim deaths only. Peak unique victim SIDs per side infers team size. `bind_all("<MouseWheel>")` replaced with per-widget bindings; scroll on log console and demo list restored.

---

## [v146] *(was v143.1)*

### Fixed: clutch events dropped by four filter stages

Systematic audit: `_apply_global_filter_gate_events`, `_apply_filter_to_events`, `_union`/`mixed` merge loops, and all dp2 worker logic modes all silently dropped clutch events. Fixed in all cases: clutch events separated before logic, unconditionally re-appended at every exit point. `_stamp_mf` skips clutch events.

---

## [v145] *(was v143.0)*

### Fixed: clutch false positives — invisible teammates; configurable ONE TAP window

`all_teammates` built from victims only → teammate who killed but hadn't died was invisible. Fix: includes anyone on player's side appearing as killer **or** victim. `kill_mod_one_tap_s` config key (default 2s) replaces hardcoded tick window.

---

## [v144] *(was v143.0 base)*

### Fixed: clutch 1v0 artefact; require_win as ★ Must

Unconditional `if clutch_size < 1: continue` guard added. Data artefacts (empty round, missing DB rows) always discarded regardless of size filter setting.

---

## [v143] *(was v133.42)*

### Fixed: 1v0 clutch artefact included in "all sizes" mode

`allowed_sizes` empty (all-sizes mode) skipped the size filter → `clutch_size = 0` logged as valid.

---

## [v142] *(was v133.41)*

### Fixed: `require_win` silently ignored when rounds table unavailable; `_norm_side` maps win_reason values

Empty `round_brackets` → `round_winner = None` → guard never fires → Win Only did nothing. `_norm_side` now maps `ct_win`, `bomb_defused`, `t_win`, `target_bombed`, etc.

---

## [v141] *(was v133.40)*

### Fixed: clutch clips never generated when Kills + Clutch both active

Deduplication sig-set dropped clutch versions of kills that already existed. Replaced with `sig→index` dict; existing events stamped with clutch fields in-place.

---

## [v140] *(was v133.39)*

### Fixed: clutch header colour; scroll stops on child widgets; clutch events dropped by `_apply_db_postfilters`

Clutch header used `mlabel` (gray) instead of `slabel` (accent). `<Leave>` checks pointer position before unbinding. `_apply_db_postfilters` now separates and re-appends clutch events unconditionally.

---

## [v139] *(was v133.38)*

### Fixed: `KeyError: 'kill_mod_hv_one_shot'` on startup

Sub-option bool in `extra_config` not in `_FILTER_BOOL_KEYS` → no `BooleanVar` created. `bool_keys`/`int_keys` now auto-derive sub-option entries from `extra_config` fields.

---

## [v138] *(was v133.37)*

### Architecture: Kill Filter Registry

Single `KILL_FILTER_REGISTRY` of `FilterDef` NamedTuples. Kill filter UI: ~340 → ~130 lines (−62%). Adding a filter = one `FilterDef(...)` entry.

---

## [v137] *(was v133.36)*

### Changed: demo picker rework; UI polish

Native multi-select + **✓ Check selected** / **✕ Uncheck selected** buttons. dp2 badge always at far right. Filter name labels use `flabel`, section headers use `slabel`.

---

## [v136] *(was v133.35)*

### Fixed: DB connection leak; SyntaxError from prior session

`try/finally: conn.close()` in `_connect_and_load`. Indentation error repaired.

---

## [v135] *(was v133.34)*

### Fixed: OOM crash on large batches; log widget growing unbounded; tempfile cleanup

LRU eviction on dp2 cache (max 150 demos). `_LOG_MAX_LINES = 8000`. Tempfile `os.path.exists` check moved inside lambda.

---

## [v134] *(was v133.33)*

### Changed: "Minimize on launch" → "Send to back on launch"

`SetWindowPos(HWND_BOTTOM)` instead of minimize. Config key: `cs2_minimize` → `cs2_send_to_back`.

---

## [v133]

### Fixed: camera/player targeting for multi-player batches

Active player order deterministic. Sequence anchor targets first relevant active player.

---

## [v132]

### Fixed: regression rollback in global filter gate

Kill-filter gating restored to kill-event-only enforcement.

---

## [v131]

### Fixed: filter gate applied to KILLS and DEATHS; CS2 minimize once per batch

---

## [v130]

### Fixed: `hlaeOptions` always included in HLAE recording payload

---

## [v129]

### Fixed: recording system normalisation hardening

---

## [v128]

### Fixed: collateral over-detection — stricter same-shot validation

---

## [v127]

### Fixed: wallbang/collateral semantic split; dp2 death-flag helper DRY refactor

---

## [v126]

### Fixed: per-demo filter badges fail-closed — no false-positive tagging when dp2 evidence missing

---

## [v125]

### Fixed: global non-★ OR semantics — adding a filter expands results, not narrows

---

## [v124]

### Changed: logic mode selectors removed; fixed model always used

---

## [v123]

### Fixed: `🚫🎲 Exclude` acts as exclusion gate first in combined scenarios

---

## [v122]

### Added: kill filters "Unselect all" button

---

## [v121]

### Changed: "DEATHS BY" tooltip updated

---

## [v120]

### Changed: unified kill filters logic selector; DB modifiers under Situation

---

## [v119]

### Fixed: headshots auto-lock context-aware

---

## [v118]

### Changed: dp2 pre-parse section-aware; `_dp2_required_sections(cfg)` as single source of truth

---

## [v117]

### Fixed: AT LEAST ONE logic across Mods + dp2 — cross-engine OR union

---

## [v116]

### Fixed: Enable + ★ Must conflict — `_wire_enable_must` bidirectional coupling

---

## [v115]

### Fixed: UI freeze during dp2 pre-parse (batched log pump, 50ms drain); WALLBANG/AIRBORNE/BLIND/COLLATERAL skipped during pre-parse

---

## [v114]

### Added: MIXED logic mode; ★ Must checkboxes; `_split_required_optional` DRY helper

---

## [v113]

### Removed: "Output: video" radio (hardcoded). Fixed: accent button colour on theme switch.

---

## [v112]

### Fixed: WALLBANG/AIRBORNE/BLIND FIRE/COLLATERAL via demoparser2 `player_death` fields

---

## [v111]

### Added: UI theme system — background presets, accent presets, custom hex, persists across sessions

---

## [v110]

### Fixed: "Modifiers not found" warning fires at most once per session per unique missing set

---

## [v109]

### Changed: headshots filter — tri-state radio (All/Only/Exclude), independent of Mods

---

## [v108]

### Fixed: clip badges per-kill accurate; `_mf` tagging across all three filter stages; `_DP2_FILTER_DEFS` single source of truth

---

## [v107]

### Changed: filter context badges appended after content badge; `_FILTER_BADGE_DEFS` DRY

---

## [v106]

### Changed: clip badges content-aware; structured multi-line preview header

---

## [v105]

### Added: logic mode selector per kill filter category; `_apply_dp2_filters_to_events` DRY

---

## [v104]

### Changed: DRY demo log entry builders (Preview and Run share same rendering)

---

## [v103]

### Fixed: preview log shows clip badges

---

## [v102]

### Added: resizable UI layout (window size, split %, Remember layout)

---

## [v101]

### Added: log badge indicators; `Badges: ON/OFF` toggle (Ctrl+B)

---

## [v100]

### Changed: VirtualDub and image export modes removed; output hardcoded to video

---

## [v99]

### Added: CS mode vanilla injection; Steam library autodetection; Game Speed % slider; strict config parsers

---

## [v98]

### Fixed: Ferrari Peek approach window 3s → 1s

---

## [v97]

### Changed: section names (CAPTURE / KILL FILTERS / TIMING / DEMO SELECTION); Mods per-line layout

---

## [v96]

### Fixed: demo picker double-toggle; clutch options placement; player sort by name/date

---

## [v95]

### Changed: Ferrari Peek — three-condition logic (isolated shot, moving before, resumes after)

---

## [v94]

### Changed: Stop/Kill refactor with tag rollback; event styled toggle buttons; SAUVEUR → SAVIOR

---

## [v93]

### Changed: clutch custom range removed; Blind Fire into Mods row; BOURREAU → BULLY; `dp2_badge()` DRY

---

## [v92]

### Added: 9 new kill modifiers (Entry Frag, Ace, Multi-Kill, Bully, Eco Frag, Blind Fire, Ferrari Peek, Flick, Sauveur)

---

## [v91]

### Fixed: `_effective_before` perspective leak; "Full round" → "Full clutch" (first attempt)

---

## [v90]

### Changed: header active player label mirrors Capture tab in real time

---

## [v89]

### Performance: `_ts_cache`, `_col_cache`, persistent DB connection, sort removal, `_spray_transfer_filter` O(shots); last French strings translated

---

## [v88]

### Performance (preliminary): same as v89 core optimisations, first introduced here

---

## [v87]

### Added: 🔫 Spray Transfer; Demo picker with Manual mode; TROIS SHOT weapon lock removed

---

## [v86]

### Fixed: stale DEFAULT_CONFIG comment; inaccurate recording system tooltip

---

## [v85]

### Changed: clutch detection rewritten — real last-alive detection using all kills per match

---

## [v84]

### Fixed: `clutch_require_win` was a stub; side normalisation for all CT/T schema variants

---

## [v83]

### Fixed: CS2 EFFECTS not injected in CS recording mode

---

## [v82]

### Added: 🤝 CLUTCH mode — initial implementation (grouped kills, later corrected)

---

## [v81]

### Fixed: inaccurate CS mode tooltip

---

## [v80]

### Fixed: incorrect CS mode descriptions (startmovie, not interactive)

---

## [v79]

### Added: Fix scope FOV checkbox (`+mirv_fov handleZoom enabled 1`)

---

## [v78]

### Fixed: CS/HLAE UI bleed; HLAE section hidden in CS mode; extended per-demo logging

---

## [v77]

### Changed: demoparser2 architecture — single parse entry point, partial persistent cache, unified key scheme

---

## [v76]

### Fixed: ONE TAP / TROIS TAP always returned 0 — weapon-specific shot index

---

## [v75]

### Added: `_one_tap_filter`, `_no_trois_shot_filter`, `_trois_tap_filter` implemented; full English translation

---

## [v74]

### Added: TROIS TAP auto-toggle; DP2 threads slider; per-demo parse cache; tag selection persisted; full UI English translation

---

## [v73]

> Included in v74 — never shipped standalone.

---

## [v72]

### Fixed: "Both" perspective — `victim_pre_s` not counted in clip duration

---

## [v71]

### Changed: cumulative dp2 modifiers — `elif` chains → independent `if` blocks

---

## [v70]

### Changed: POV Victim simplified; "Both" takes over killer→victim transition logic

---

## [v69]

### Added: `APP_VERSION` constant; POV Victim rework with `victim_pre_s`

---

## [v68]

### Added: NO LUCKY SHOT; LUCKY TAP; Minimize watcher simplified

---

## [v67]

### Removed: `stop_guard_event`

---

## [v66]

### Added: ONE TAP modifier (demoparser2); tickrate removed from UI

---

## [v65]

### Fixed: LUCKY SHOT thresholds recalibrated (old values unreachable in real data)

---

## [v64]

### Fixed: LUCKY SHOT — `user_` prefix, match window, matching logic

---

## [v63]

### Fixed: LUCKY SHOT unchecks weapon category; preview applies TROIS SHOT in background thread

---

## [v62]

### Added: LUCKY SHOT modifier (demoparser2) — initial implementation

---

## [v61]

### Fixed: Minimize on launch briefly shows CS2; polling 500ms → 100ms; 60s timeout

---

## [v60]

### Changed: Resolution & Framerate — definition × ratio × custom free entry

---

## [v59]

### Fixed: modifier not found in DB — fail-closed (returns empty, not all clips)

---

## [v58]

### Added: Tags TAG RANGE section (Calculate range, Apply start/end, Full, After)

---

## [v57]

### Fixed: 📅 uses config ∩ tags intersection

---

## [v56]

### Added: "By config" — config ∩ DB tags intersection

---

## [v55]

### Fixed: extra args overwritten before injection; enhanced logging

---

## [v54]

### Added: separate output folders (raw, concatenated, assembled)

---

## [v53]

### Fixed: `noSpectatorUi` injection; Tags tab moved; grey colours brightened

---

## [v47]

### Added: "🔍 By config" restored; "📅" separated

---

## [v46]

### Changed: "Concatenate sequences" moved to FINAL ASSEMBLY

---

## [v45]

### Changed: Tags output to console; window size 1600×900

---

## [v44]

### Added: weapon icons; hover tooltips; auto-tag multi-tags; X-Ray in Video tab

---

## [v43]

### Added: CS2 window mode; Minimize CS2 on launch; CS2 monitoring thread

---

## [v42]

### Added: "Since last tag" / "📅 By config"; already-tagged demos dialog

---

## [v41]

### Changed: Capture tab condensed; `_tag_search_last_tagged`

---

## [v40]

### Fixed: Workshop map download blocking — auto-accept checkbox

---

## [v39]

### Added: Kill modifiers section (Smoke, No-scope, Wallbang, Airborne, Flash-assisted, Collateral); `hchk` helper

---

## [v38]

### Added: Encoding preset (CPU); Teamkills 3-state; reorder saved players; tag colour swatch

---

## [v37]

### Fixed: presets section misplaced; preset radio buttons overflowing

---

## [v36]

### Fixed: `showKill` logic for victim/spec perspectives

---

## [v35]

### Fixed: POV Victim camera — three distinct bugs

---

## [v34]

### Added: weapon categories reorganised; `DELAYED_EFFECT_WEAPONS`; `victim_death_tick` detection

---

## [v33]

### Fixed: mkv container; `#` in filename; `-movflags` on mkv/avi

---

## [v32]

### Fixed: DB status header showing raw debug info

---

## [v31]

### Changed: 5 tabs → 4 tabs; active player state restored on startup

---

## [v30]

### Fixed: assembly audio/video drift

---

## [v29]

### Fixed: no audio in clips — missing `recordAudio`/`playerVoicesEnabled` fields

---

## [v28]

### Added: X-Ray option; saved assembly names

---

## [v27]

> `snd_mute_losefocus` hypothesis retracted. Real fix in v29.

---

## [v26]

### Changed: version bump; `PlayerSearchWidget` docstring

---

## [v6]

### Changed: weapons loaded from DB dynamically

---

## [v5]

### Fixed: `column m.date does not exist` — PostgreSQL reserved word, quoted at runtime

---

## [v4]

### Added: auto-connect on startup; `PlayerSearchWidget`; config auto-save; 3-tab layout

---

## [v3]

### Fixed: two `TclError` crashes on startup

---

## [v2]

### Added: tkinter GUI; batch loop in daemon thread; launch validation

---

## [v1]

### Added: initial CLI batch script
