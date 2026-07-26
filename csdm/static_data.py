"""Donnees de reference statiques — extrait du fichier principal (Phase 1.1).

Tout ici est de la DONNEE PURE (registre de filtres, categories d'armes,
codecs, resolutions, seuils, types de match). Aucune dependance vivante :
pas de couleurs de theme, pas d'etat runtime. Les filtres referencent les
methodes de App uniquement par leur NOM (chaine de caracteres), jamais par
appel direct — donc ce module n'importe pas App et peut etre lu seul.
"""

from typing import NamedTuple, Optional, List as _List

# ═══════════════════════════════════════════════════════════════════════════════
#  Kill Filter Registry — single source of truth
# ═══════════════════════════════════════════════════════════════════════════════
#
# Every kill modifier is declared exactly ONCE here.
# All other structures (DEFAULT_CONFIG entries, bool_keys,
# PRESET_KEYS, _FILTER_BADGE_DEFS, _DP2_FILTER_DEFS, _MOD_COLS,
# needs_dp2, and UI rows) are DERIVED from this registry.
#
# To ADD a filter:  add one FilterDef entry.
# To REMOVE one:   delete its entry.
# To CHANGE it:    edit its entry — nothing else needs updating.

class FilterDef(NamedTuple):
    key:          str
    label:        str            # UI label (flabel), e.g. "💨 SMOKE:"
    badge:        str            # short badge text, e.g. "💨 SMOKE"
    category:     str            # "mods" | "dp2" | "db"
    tip:          str            # tooltip
    sql_cols:     Optional[list] = None  # mods: candidate DB columns
    dp2_filter:   Optional[str]  = None  # dp2: per-demo App method name
    dp2_apply:    Optional[str]  = None  # dp2: dict-level App method name
    dp2_log:      Optional[str]  = None  # dp2: log prefix
    dp2_result:   Optional[str]  = None  # dp2: log result word
    dp2_skip:     Optional[str]  = None  # dp2: log skip word
    special:      Optional[str]  = None  # "trois_shot"|"trois_tap"|"one_tap"|"high_velocity"
    hide_ui:      bool           = False # True → no standalone row (rendered by another)
    extra_config: Optional[dict] = None  # extra DEFAULT_CONFIG entries for this filter
    camera_fn:    Optional[str]  = None  # App method: (demo_path, event, cfg) → override camera SID or None


KILL_FILTER_REGISTRY: _List[FilterDef] = [
    # ── SQL-backed Mods ──────────────────────────────────────────────────
    FilterDef("kill_mod_through_smoke",  "💨 SMOKE:",         "💨 SMOKE",      "mods",
        "Kill through a smoke grenade (DB column — fast, no demoparser2 needed).",
        sql_cols=["is_through_smoke", "through_smoke"]),
    FilterDef("kill_mod_no_scope",       "🔭 NO-SCOPE:",      "🔭 NOSCOPE",    "mods",
        "No-scope kill — sniper only (DB column).",
        sql_cols=["is_no_scope", "no_scope"]),
    FilterDef("kill_mod_assisted_flash", "⚡ VICTIM FLASHED:","⚡ VIC.FLASH",  "mods",
        "Victim was blinded by a flashbang (DB column).",
        sql_cols=["is_assisted_flash", "assisted_flash"]),
    # ── DB-backed mods (CSDM stores these columns in the kills table) ────
    FilterDef("kill_mod_wall_bang",      "🧱 WALLBANG:",      "🧱 WALLBANG",   "mods",
        ("Kill where the bullet penetrated at least one obstacle.\n"
         "Uses kills.penetrated_objects > 0  or  kills.has_penetrated / kills.penetrated.\n"
         "Falls back to demoparser2 if no matching column is found in the DB."),
        sql_cols=["penetrated_objects", "has_penetrated", "penetrated"],
        dp2_filter="_wall_bang_dp2_filter",     dp2_apply="_apply_wall_bang_dp2_to_events",
        dp2_log="🧱 WALLBANG",  dp2_result="wallbang",    dp2_skip="0 WALLBANG"),
    FilterDef("kill_mod_attacker_blind", "😵 BLIND FIRE:",    "😵 BLIND",      "mods",
        ("Bullet fired while the killer was blinded by a flashbang.\n"
         "Uses kills.attacker_blinded / kills.is_attacker_blinded / kills.attacker_blind.\n"
         "Falls back to demoparser2 if no matching column is found in the DB."),
        sql_cols=["attacker_blinded", "is_attacker_blinded", "attacker_blind",
                  "is_blinded", "attackerblind"],
        dp2_filter="_attacker_blind_dp2_filter",dp2_apply="_apply_attacker_blind_dp2_to_events",
        dp2_log="😵 BLIND FIRE",dp2_result="blind fire",  dp2_skip="0 BLIND FIRE"),
    # ── dp2-only — no DB equivalent ──────────────────────────────────────
    FilterDef("kill_mod_airborne",       "🪂 AIRBORNE:",      "🪂 AIR",        "dp2",
        ("Bullet fired while the killer was in the air (not on ground).\n"
         "Uses player_death.attackerinair — demoparser2 required, not stored in CSDM DB."),
        dp2_filter="_airborne_dp2_filter",      dp2_apply="_apply_airborne_dp2_to_events",
        dp2_log="🪂 AIRBORNE",  dp2_result="airborne",    dp2_skip="0 AIRBORNE"),
    FilterDef("kill_mod_collateral",     "🎯 COLLATERAL:",    "🎯 COLLAT.",    "dp2",
        ("Single bullet penetrated and killed multiple players in the same shot chain.\n"
         "Uses player_death.penetrated + shot grouping via demoparser2."),
        dp2_filter="_collateral_dp2_filter",    dp2_apply="_apply_collateral_dp2_to_events",
        dp2_log="🎯 COLLATERAL",dp2_result="collateral",  dp2_skip="0 COLLATERAL"),
    # ── dp2 — weapon_fire-based filters ─────────────────────────────────
    FilterDef("kill_mod_trois_shot",     "🎲 TROIS SHOT:",    "🎲 TROIS SHOT", "dp2",
        ("Lucky kills on precision weapons — detected via demoparser2.\n\n"
         "Per-weapon logic:\n"
         "  Deagle / R8   bloom > 0.015 (not a stationary aimed shot)\n"
         "  AWP / SSG 08  unscoped at shot time\n"
         "  SCAR-20 / G3SG1  unscoped OR bloom > 0.010 OR moving\n\n"
         "Enable = keep only lucky kills. Exclude = keep only precise kills on these weapons.\n"
         "⚠ Enable and Exclude are mutually exclusive."),
        dp2_filter="_trois_shot_filter",        dp2_apply="_apply_trois_shot_to_events",
        dp2_log="🎲 TROIS SHOT",dp2_result="TROIS SHOT",  dp2_skip="0 TROIS SHOT",
        special="trois_shot"),
    FilterDef("kill_mod_no_trois_shot",  "🚫🎲 EXCLUDE:",     "🚫🎲 Exclude",  "dp2",
        ("Inverse of TROIS SHOT — removes lucky kills on these weapons.\n"
         "When combined with other dp2 filters, acts as an exclusion gate first."),
        dp2_filter="_no_trois_shot_filter",     dp2_apply="_apply_no_trois_shot_to_events",
        dp2_log="🚫🎲 Exclude", dp2_result="precise",     dp2_skip="0 EXCLUDE",
        hide_ui=True),  # rendered inside TROIS SHOT row
    FilterDef("kill_mod_trois_tap",      "🎯🎲 TROIS TAP:",   "🎯🎲 TROIS TAP","dp2",
        ("TROIS SHOT + ONE TAP: lucky isolated headshot.\n"
         "Must be a headshot, qualify as lucky, and have no other shot within 2s.\n"
         "HS is auto-forced only when active logic guarantees HS-only output."),
        dp2_filter=None, dp2_apply=None,   # always exclusive, handled separately
        dp2_log="🎯🎲 TROIS TAP",dp2_result="TROIS TAP",  dp2_skip="0 TROIS TAP",
        special="trois_tap"),
    FilterDef("kill_mod_one_tap",        "🎯 ONE TAP:",       "🎯 ONE TAP",    "dp2",
        ("Isolated single-shot headshot — no other shot within N seconds before or after.\n"
         "HS is auto-forced only when active logic guarantees HS-only output."),
        dp2_filter="_one_tap_filter",           dp2_apply="_apply_one_tap_to_events",
        dp2_log="🎯 ONE TAP",   dp2_result="one tap",     dp2_skip="0 ONE TAP",
        special="one_tap",
        extra_config={"kill_mod_one_tap_s": 2}),
    FilterDef("kill_mod_spray_transfer", "🔫 SPRAY TRANSFER:","🔫 SPRAY",      "dp2",
        ("≥2 enemies killed in one continuous spray (no trigger release).\n"
         "Auto weapons only: AK-47, M4A4/M4A1-S, Galil AR, FAMAS, SG 553, AUG, SMGs, M249, Negev, CZ75."),
        dp2_filter="_spray_transfer_filter",    dp2_apply="_apply_spray_transfer_to_events",
        dp2_log="🔫 SPRAY",     dp2_result="spray transfer",dp2_skip="0 SPRAY"),
    FilterDef("kill_mod_high_velocity",  "🏎 FERRARI PEEK:",  "🏎 FERRARI",    "dp2",
        ("Moving peek that kills on a single shot then immediately resumes.\n"
         "Approach speed ≥ threshold, one shot, resumes movement within 2s.\n"
         "CS2 run speeds: knife 250 · pistols 240 · AK-47 215 · AWP 200 u/s"),
        dp2_filter="_high_velocity_filter",     dp2_apply="_apply_high_velocity_to_events",
        dp2_log="🏎 FERRARI PEEK",dp2_result="counter-strafe",dp2_skip="0 FERRARI PEEK",
        special="high_velocity",
        extra_config={"kill_mod_hv_one_shot": True, "kill_mod_high_vel_thr": 100}),
    FilterDef("kill_mod_flick",          "↩ FLICK:",          "↩ FLICK",       "dp2",
        ("Kill preceded by a large view-angle change (~0.5s before kill tick).\n"
         "Default: 50°. Lower = catch smaller corrections, raise = extreme flicks only."),
        dp2_filter="_flick_filter",             dp2_apply="_apply_flick_to_events",
        dp2_log="↩ FLICK",      dp2_result="flick",       dp2_skip="0 FLICK",
        extra_config={"kill_mod_flick_deg": 50}),
    FilterDef("kill_mod_savior",        "🛡 SAVIOR:",        "🛡 SAVIOR",     "dp2",
        ("Kill an enemy who was actively damaging a teammate in the ~2s prior.\n"
         "Captures last-second rescues."),
        dp2_filter="_savior_filter",           dp2_apply="_apply_savior_to_events",
        dp2_log="🛡 SAVIOR",    dp2_result="savior",      dp2_skip="0 SAVIOR"),
    # ── DB post-filters ──────────────────────────────────────────────────
    FilterDef("kill_mod_entry_frag",     "🚀 ENTRY FRAG:",    "🚀 ENTRY",      "db",
        "First kill of the round (earliest tick), regardless of side."),
    FilterDef("kill_mod_ace",            "🃏 ACE:",           "🃏 ACE",         "db",
        "Rounds where the player eliminated all 5 opponents alone."),
    FilterDef("kill_mod_multi_kill",     "⚡ MULTI-KILL:",    "⚡ MULTI",       "db",
        "N or more kills in one round within the time window.",
        extra_config={"kill_mod_multi_kill_n": 3, "kill_mod_multi_kill_s": 12}),
    FilterDef("kill_mod_bully",       "💀 BULLY:",         "💀 BULLY",       "db",
        ("Kill the same opponent for the Nth time in the match.\n"
         "e.g. From kill #3 = captured from the 3rd time you kill the same player."),
        extra_config={"kill_mod_bully_n": 3}),
    FilterDef("kill_mod_eco_frag",       "💰 ECO FRAG:",      "💰 ECO",         "db",
        ("Pistol kill against a full-buy opponent (rifle / sniper / LMG).\n"
         "Falls back to all pistol kills if victim_weapon column is missing.")),
    # ── Camera modifier — not a kill filter, rendered in Capture & Timing ────
    FilterDef("kill_mod_mate_pov",       "👥 MATE POV:",      "👥 MATE POV",   "dp2",
        ("Record from the victim's teammate who has the best angular view of the kill.\n"
         "Uses demoparser2 player positions + view angles at kill tick.\n"
         "Filters: victim eye clearly in view (±20°), alive mate, same floor (Z ≤300 u),\n"
         "elevation ≤30°, distance 80–550 u. No BSP ray-cast — walls not detected.\n"
         "★ Must = skip clips with no qualifying teammate."),
        dp2_filter="_mate_pov_filter",
        dp2_apply=None,
        dp2_log="👥 MATE POV", dp2_result="mate pov", dp2_skip="0 mate POV",
        camera_fn="_mate_pov_camera_sid",
        hide_ui=True),   # rendered in Capture & Timing, not in Kill Filters
]

# ── Derived structures (auto-generated — DO NOT EDIT, edit KILL_FILTER_REGISTRY) ──

# All registry keys (including hide_ui entries)
KILL_FILTER_KEYS_ALL: _List[str] = [f.key for f in KILL_FILTER_REGISTRY]
# Primary keys (visible in UI)
KILL_FILTER_KEYS: _List[str] = [f.key for f in KILL_FILTER_REGISTRY if not f.hide_ui]
# Short display labels dict
KILL_FILTER_LABELS: dict = {f.key: f.badge for f in KILL_FILTER_REGISTRY}
# SQL-backed mod candidate columns dict
KILL_FILTER_SQL_COLS: dict = {f.key: f.sql_cols
    for f in KILL_FILTER_REGISTRY if f.category == "mods" and f.sql_cols}
# DEFAULT_CONFIG additions (auto-built from registry)
_FILTER_CONFIG_DEFAULTS: dict = {}
# Keys that must NOT get an auto-generated _exclude entry
_NO_AUTO_EXCLUDE = {"kill_mod_no_trois_shot", "kill_mod_trois_tap"}
for _f in KILL_FILTER_REGISTRY:
    _FILTER_CONFIG_DEFAULTS[_f.key] = False
    _FILTER_CONFIG_DEFAULTS[f"{_f.key}_req"] = False
    if _f.key not in _NO_AUTO_EXCLUDE and not _f.hide_ui:
        _FILTER_CONFIG_DEFAULTS[f"{_f.key}_exclude"] = False
    if _f.extra_config:
        _FILTER_CONFIG_DEFAULTS.update(_f.extra_config)
# bool_keys additions (all filter enable + _req + _exclude flags + bool extra_config sub-keys)
_FILTER_BOOL_KEYS: _List[str] = []
for _f in KILL_FILTER_REGISTRY:
    _FILTER_BOOL_KEYS.append(_f.key)
    _FILTER_BOOL_KEYS.append(f"{_f.key}_req")
    if _f.key not in _NO_AUTO_EXCLUDE and not _f.hide_ui:
        _FILTER_BOOL_KEYS.append(f"{_f.key}_exclude")
    if _f.extra_config:
        for _ek, _ev in _f.extra_config.items():
            if isinstance(_ev, bool) and _ek not in _FILTER_BOOL_KEYS:
                _FILTER_BOOL_KEYS.append(_ek)
# PRESET_KEYS player additions
_FILTER_PRESET_PLAYER_KEYS: _List[str] = list(_FILTER_BOOL_KEYS)
for _f in KILL_FILTER_REGISTRY:
    if _f.extra_config:
        for _k in _f.extra_config:
            if _k not in _FILTER_PRESET_PLAYER_KEYS:
                _FILTER_PRESET_PLAYER_KEYS.append(_k)


# ── Video / Audio codecs ──────────────────────────────────────────────────────
VIDEO_CODECS_INFO = {
    "libx264":    "H.264 CPU — Universal, compatible everywhere.",
    "libx265":    "H.265/HEVC CPU — Better compression, slower.",
    "libsvtav1":  "AV1 CPU (SVT) — Modern, excellent compression.",
    "libaom-av1": "AV1 CPU (ref) — Very slow but max quality.",
    "h264_nvenc": "H.264 GPU NVIDIA — Ultra-fast.",
    "hevc_nvenc": "HEVC GPU NVIDIA — H.265 accelerated.",
    "av1_nvenc":  "AV1 GPU NVIDIA — RTX 40xx+.",
    "h264_amf":   "H.264 GPU AMD — Fast (RX 5000+).",
    "hevc_amf":   "HEVC GPU AMD — H.265 accelerated.",
    "av1_amf":    "AV1 GPU AMD — RX 7000+.",
    "libvpx-vp9": "VP9 CPU — Good quality, slow.",
    "prores_ks":  "ProRes — Large files, pro quality.",
    "utvideo":    "UT Video — Lightweight lossless.",
    "rawvideo":   "Raw — Uncompressed raw.",
}
VIDEO_CODECS = list(VIDEO_CODECS_INFO.keys())

# CPU codecs honour FFmpeg's -preset flag; GPU codecs (NVENC/AMF) ignore it.
CPU_VIDEO_CODECS: set = {"libx264", "libx265", "libsvtav1", "libaom-av1",
                         "libvpx-vp9", "prores_ks", "utvideo"}

# ── Runtime-injection CFG constants (moved here in chantier 1: the engine
# needs them and cannot import csdm_batch_clips_generator.py without a cycle) ──
CSDM_RUNTIME_CFG_NAME    = "csdm_batch_runtime.cfg"
CSDM_RUNTIME_BLOCK_START = "// >>> CSDM_BATCH_RUNTIME START >>>"
CSDM_RUNTIME_BLOCK_END   = "// <<< CSDM_BATCH_RUNTIME END <<<"

AUDIO_CODECS_INFO = {
    "libmp3lame": "MP3 — Compatible everywhere.",
    "aac":        "AAC — Better than MP3, modern standard.",
    "pcm_s16le":  "PCM WAV — Raw uncompressed.",
    "libopus":    "Opus — Excellent, especially streaming/voice.",
    "flac":       "FLAC — Compressed lossless.",
}
AUDIO_CODECS = list(AUDIO_CODECS_INFO.keys())


# ── Resolutions / Framerates / Definitions ───────────────────────────────────
RESOLUTIONS = [
    ("1280x720", 1280, 720), ("1920x1080", 1920, 1080),
    ("2560x1440", 2560, 1440), ("3840x2160", 3840, 2160),
]
FRAMERATES = [30, 60, 120, 240, 300]

DEFINITIONS = [
    ("720p",  720),
    ("1080p", 1080),
    ("1440p", 1440),
    ("4K",    2160),
]

ASPECT_RATIOS = [
    ("16:9",  16, 9),
    ("4:3",   4,  3),
    ("21:9",  21, 9),
    ("16:10", 16, 10),
    ("1:1",   1,  1),
]


# ── TROIS SHOT thresholds ─────────────────────────────────────────────────────
# Thresholds calibrated from real demoparser2 data (accuracy_penalty in Source2 radians):
#   precise stationary shot  ≈ 0.004
#   shot while moving        ≈ 0.010–0.025
#   spam (2nd+ rapid shot)   ≈ 0.030–0.050
#
# Per-weapon logic:
#   Deagle / R8   : lucky if acc > 0.015  (not first stationary shot)
#   AWP / SSG 08  : lucky if NOT scoped  (is_scoped False at shot tick)
#   SCAR-20/G3SG1 : lucky if vel > 100 u/s OR acc > 0.012 OR not scoped
TROIS_SHOT_THRESHOLDS = {
    "weapon_deagle":   {"acc": 0.015, "scope": False, "vel": False},
    "weapon_revolver": {"acc": 0.015, "scope": False, "vel": False},
    "weapon_awp":      {"acc": 0.010, "scope": True,  "vel": False},
    "weapon_scar20":   {"acc": 0.010, "scope": True,  "vel": True},
    "weapon_g3sg1":    {"acc": 0.010, "scope": True,  "vel": True},
    "weapon_ssg08":    {"acc": 0.010, "scope": True,  "vel": False},
}

# Mapping CSDM weapon names (lowercase) → demoparser2 internal name
CSDM_TO_DP2_WEAPON = {
    "deagle":         "weapon_deagle",
    "desert eagle":   "weapon_deagle",
    "revolver":       "weapon_revolver",
    "r8 revolver":    "weapon_revolver",
    "awp":            "weapon_awp",
    "scar-20":        "weapon_scar20",
    "scar20":         "weapon_scar20",
    "g3sg1":          "weapon_g3sg1",
    "ssg 08":         "weapon_ssg08",
    "ssg08":          "weapon_ssg08",
    "ssg-08":         "weapon_ssg08",
}

# Tick window for demoparser2 shot matching (~1 second at CS2 64 tick/s)
DP2_TICK_WINDOW = 128


# ── SPRAY TRANSFER ────────────────────────────────────────────────────────────
# Automatic weapons eligible for spray transfer detection.
# A spray transfer = player kills ≥2 victims in one continuous burst
# (no trigger release — no gap > SPRAY_MAX_GAP ticks between weapon_fire events).
SPRAY_TRANSFER_WEAPONS: set = {
    # Rifles (fully automatic)
    "ak47", "m4a1", "m4a1_silencer", "galilar", "famas", "sg556", "aug",
    "ak-47", "m4a4", "m4a1-s", "galil ar", "sg 553",
    # SMGs
    "mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon",
    "mac-10", "mp5-sd", "ump-45", "pp-bizon",
    # Heavy auto
    "m249", "negev",
    # CZ75 (only full-auto pistol)
    "cz75a", "cz75-auto",
}
SPRAY_TRANSFER_WEAPONS_LOWER: set = {w.lower() for w in SPRAY_TRANSFER_WEAPONS}
# ~0.34s at 64tick — generous to handle peeks/lag
SPRAY_MAX_GAP_TICKS = 22


# ── Delayed-effect weapons ────────────────────────────────────────────────────
# DB tick = throw/impact; death may occur much later.  Extra BEFORE time added.
DELAYED_EFFECT_WEAPONS: set = {
    "hegrenade", "incgrenade", "molotov", "inferno",
    "he grenade", "incendiary grenade",
}

# ── Suicide "weapons" ─────────────────────────────────────────────────────────
# weapon_name values the DB uses for suicide deaths (world/fall damage/etc).
SUICIDE_WEAPONS = ("world", "suicide", "world_entity", "trigger_hurt",
                   "fall", "env_fire", "planted_c4")


# ── Tag colour presets ────────────────────────────────────────────────────────
TAG_PRESET_COLORS = [
    "#f97316", "#ef4444", "#eab308", "#22c55e", "#3b82f6",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#6366f1",
    "#0ea5e9", "#84cc16", "#d946ef", "#f59e0b", "#10b981",
    "#6b7280", "#a855f7", "#e11d48", "#0891b2", "#65a30d",
]


# ═══════════════════════════════════════════════════════════════════════════════
#  Weapon Categories for CS2
# ═══════════════════════════════════════════════════════════════════════════════
WEAPON_CATEGORIES = {
    "Pistols": [
        "usp_silencer", "hkp2000", "glock", "p250", "fiveseven",
        "cz75a", "cz75_auto", "tec9", "elite", "deagle", "revolver",
        "usp-s", "p2000", "glock-18", "five-seven", "cz75-auto",
        "tec-9", "dual berettas", "desert eagle", "r8 revolver",
        "USP-S", "P2000", "Glock-18", "P250", "Five-SeveN",
        "CZ75-Auto", "Tec-9", "Dual Berettas", "Desert Eagle", "R8 Revolver",
    ],
    "SMGs": [
        "mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon",
        "mac-10", "mp5-sd", "ump-45", "pp-bizon",
        "MAC-10", "MP9", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon",
    ],
    "Rifles": [
        "ak47", "m4a1", "m4a1_silencer", "galilar", "famas", "sg556", "aug",
        "ak-47", "m4a4", "m4a1-s", "galil ar", "sg 553",
        "AK-47", "M4A4", "M4A1-S", "Galil AR", "FAMAS", "SG 553", "AUG",
    ],
    "Snipers": [
        "awp", "ssg08", "scar20", "g3sg1",
        "ssg 08", "scar-20",
        "AWP", "SSG 08", "SCAR-20", "G3SG1",
    ],
    "Heavy": [
        "nova", "xm1014", "mag7", "sawedoff", "m249", "negev",
        "mag-7", "sawed-off",
        "Nova", "XM1014", "MAG-7", "Sawed-Off", "M249", "Negev",
    ],
    "Knives": [
        "knife", "knife_t", "knife_karambit", "knife_m9_bayonet", "knife_butterfly",
        "knife_push", "knife_tactical", "knife_falchion", "knife_survival_bowie",
        "knife_ursus", "knife_gypsy_jackknife", "knife_stiletto", "knife_widowmaker",
        "knife_skeleton", "knifegg",
        "Knife",
    ],
    "Grenades & Utility": [
        "hegrenade", "incgrenade", "molotov", "inferno",
        "flashbang", "smokegrenade", "decoy",
        "he grenade", "incendiary grenade", "decoy grenade",
        "smoke grenade", "flash",
        "HE Grenade", "Incendiary Grenade", "Molotov", "Decoy Grenade",
        "Flashbang", "Smoke Grenade",
        "weapon_hegrenade", "weapon_incgrenade", "weapon_molotov", "weapon_inferno",
        "weapon_flashbang", "weapon_smokegrenade", "weapon_decoy",
        "SmokeGrenade", "HeGrenade", "IncGrenade",
        "smoke_grenade", "he_grenade", "inc_grenade",
        "frag grenade", "fire bomb", "diversion device", "emp grenade",
    ],
    "C4 / World": [
        "c4", "world", "suicide", "world_entity",
        "C4",
    ],
    "Misc": [
        "taser",
        "Zeus x27",
    ],
}

WEAPON_ICONS = {
    'Pistols': '🔫', 'SMGs': '🔫', 'Rifles': '🎯', 'Snipers': '🎯',
    'Heavy': '💥', 'Knives': '🔪', 'Grenades & Utility': '💣',
    'C4 / World': '💥', 'Misc': '⚡', 'Other': '❓',
}

# Flat lookup built once at load time — O(1) instead of O(n²).
# Also indexes the "weapon_" prefixed form so internal names resolve without extra stripping.
_WEAPON_LOOKUP: dict = {}
for _cat, _weapons in WEAPON_CATEGORIES.items():
    for _w in _weapons:
        _k = _w.lower()
        _WEAPON_LOOKUP[_k] = _cat
        if not _k.startswith("weapon_"):
            _WEAPON_LOOKUP["weapon_" + _k] = _cat

# Substring → category fallback for weapons whose DB name varies (e.g. "CZ75 Auto",
# "weapon_cz75a", "cz75_auto" …).  Checked only when the exact lookup misses.
_WEAPON_SUBSTR_FALLBACK: list = [
    # (substring, category)  — checked in order, first match wins
    ("cz75",    "Pistols"),
    ("glock",   "Pistols"),
    ("deagle",  "Pistols"),
    ("desert",  "Pistols"),   # "desert eagle"
    ("revolver","Pistols"),
    ("usp",     "Pistols"),
    ("p2000",   "Pistols"),
    ("fiveseven","Pistols"),
    ("tec",     "Pistols"),
    ("elite",   "Pistols"),
    ("p250",    "Pistols"),
    ("ak",      "Rifles"),
    ("m4",      "Rifles"),
    ("awp",     "Snipers"),
    ("knife",   "Knives"),
    ("grenade", "Grenades & Utility"),
    ("molotov", "Grenades & Utility"),
    ("smoke",   "Grenades & Utility"),
    ("flash",   "Grenades & Utility"),
]

def _weapon_category(weapon_name: str) -> str:
    key = weapon_name.lower().strip()
    # Strip common "weapon_" prefix used internally
    if key.startswith("weapon_"):
        key = key[7:]
    cat = _WEAPON_LOOKUP.get(key)
    if cat:
        return cat
    # Substring fallback — catches variant spellings not in the exact lookup
    for substr, fallback_cat in _WEAPON_SUBSTR_FALLBACK:
        if substr in key:
            return fallback_cat
    return "Other"


# ── Match type / game mode filter ─────────────────────────────────────────────
# Tuple shape: (db_values, cfg_key, ui_label)
MATCH_TYPE_DEFS: list = [
    (["premier"],                              "match_type_premier",       "🏆 Premier"),
    (["scrimcomp5v5", "competitive"],          "match_type_competitive",   "🎯 Competitive"),
    (["scrimcomp2v2", "wingman"],              "match_type_wingman",       "🤝 Wingman"),
    (["casual"],                               "match_type_casual",        "🎮 Casual"),
    (["deathmatch"],                           "match_type_deathmatch",    "💀 Deathmatch"),
    (["training"],                             "match_type_training",      "🎓 Training"),
    (["new_user_training"],                    "match_type_new_user",      "🎓 New User"),
    (["armsrace"],                             "match_type_armsrace",      "🔫 Arms Race"),
    (["gungameprogressive"],                   "match_type_armsrace_alt",  "🔫 Arms Race (alt)"),
    (["gungametrbomb"],                        "match_type_demolition",    "💣 Demolition"),
    (["cooperative"],                          "match_type_coop",          "🤖 Co-op"),
    (["skirmish"],                             "match_type_skirmish",      "⚡ Skirmish"),
    (["retake"],                               "match_type_retake",        "↩ Retakes"),
]
_MATCH_TYPE_KEY_TO_DB: dict  = {cfg_k: db_vals for db_vals, cfg_k, _ in MATCH_TYPE_DEFS}
_MATCH_TYPE_CFG_KEYS:  list  = [cfg_k for _, cfg_k, _ in MATCH_TYPE_DEFS]
