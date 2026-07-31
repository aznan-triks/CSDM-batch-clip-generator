"""The theme system: palettes, and building a theme from them (Phase 1.1).

PURE DATA plus `_build_theme`. The LIVE variables (_THEME, BG, BG2, ...) and
their update still live in the entry point: some 640 places read them as module
globals, and moving them would mean replacing every one of those reads with an
accessor -- a refactor of its own. Only what has NO live dependency lives here.
"""

# Background presets — each defines the full bg family
_BG_PRESETS = {
    "dark":    {"BG": "#0e0e0e", "BG2": "#141414", "BG3": "#1a1a1a",
                "BORDER": "#252525", "TEXT": "#e0e0e0", "MUTED": "#999999",
                "DESC_COLOR": "#888888", "LOG_BG": "#090909"},
    "amoled":  {"BG": "#000000", "BG2": "#000000", "BG3": "#0a0a0a",
                "BORDER": "#1a1a1a", "TEXT": "#e0e0e0", "MUTED": "#888888",
                "DESC_COLOR": "#777777", "LOG_BG": "#000000"},
    "deepblue":{"BG": "#0a0f1e", "BG2": "#0d1526", "BG3": "#111d35",
                "BORDER": "#1a2a4a", "TEXT": "#cdd6f4", "MUTED": "#7a8fba",
                "DESC_COLOR": "#6a7faa", "LOG_BG": "#080d18"},
    "white":   {"BG": "#f0f0f0", "BG2": "#f8f8f8", "BG3": "#e4e4e4",
                "BORDER": "#cccccc", "TEXT": "#1a1a1a", "MUTED": "#555555",
                "DESC_COLOR": "#666666", "LOG_BG": "#fafafa", "_is_light": True},
    # Industrial terminal look: a very dark blue-black, a BORDER contrasted
    # enough for the 1px grid to show, a greenish MUTED. Pairs with a green or
    # cyan accent.
    "terminal":{"BG": "#0a0c10", "BG2": "#0d1015", "BG3": "#12161c",
                "BORDER": "#2a3038", "TEXT": "#c8d3cc", "MUTED": "#6f8a78",
                "DESC_COLOR": "#5c7566", "LOG_BG": "#070a0d"},
}

# Semantic accent colours — accent + darker shade
_ACCENT_PRESETS = {
    "green":    {"ACCENT": "#22c55e", "ACCENT2": "#16a34a"},
    "blue":     {"ACCENT": "#3b82f6", "ACCENT2": "#2563eb"},
    "orange":   {"ACCENT": "#f97316", "ACCENT2": "#ea580c"},
    "purple":   {"ACCENT": "#a855f7", "ACCENT2": "#9333ea"},
    "red":      {"ACCENT": "#ef4444", "ACCENT2": "#dc2626"},
    "cyan":     {"ACCENT": "#06b6d4", "ACCENT2": "#0891b2"},
    "pink":     {"ACCENT": "#ec4899", "ACCENT2": "#db2777"},
    "yellow":   {"ACCENT": "#eab308", "ACCENT2": "#ca8a04"},
}

# Status colours — dark-mode variants (pastels readable on dark bg)
_STATUS_COLOURS = {
    "GREEN":  "#86efac",
    "RED":    "#f87171",
    "YELLOW": "#fde68a",
    "BLUE":   "#93c5fd",
}

# Light-mode variants — saturated/dark enough for contrast on white
_STATUS_COLOURS_LIGHT = {
    "GREEN":  "#15803d",
    "RED":    "#b91c1c",
    "YELLOW": "#b45309",
    "BLUE":   "#1d4ed8",
}

def _nudge_hex(hex_str: str) -> str:
    """Return a hex colour differing by 1 unit — visually imperceptible.

    Used to break exact duplicates within a theme. +1 normally; -1 at the
    very top (#ffffff) so the result is always a valid, different colour.
    """
    n = int(hex_str.lstrip("#"), 16)
    n = n + 1 if (n & 0xFF) < 0xFF else n - 1
    return f"#{n:06x}"


def _ensure_unique_hex(theme: dict) -> dict:
    """Guarantee every value in the theme is unique (in place) and return it.

    Why this matters: the runtime re-paint maps OLD colour -> NEW colour by
    value. If two roles share the same value (e.g. amoled BG == BG2 == LOG_BG
    == #000000), the map is ambiguous when LEAVING that theme, so those
    widgets are skipped and keep the old colour. Nudging duplicates by an
    imperceptible amount keeps every role distinct, so the map is never
    ambiguous. The first occurrence keeps its exact value; only later
    duplicates are nudged.
    """
    seen: set = set()
    for key, val in theme.items():
        v = val.lower()
        while v in seen:
            v = _nudge_hex(v)
        seen.add(v)
        theme[key] = v
    return theme


def _build_theme(bg_name: str, accent_name_or_hex: str) -> dict:
    """Build a complete theme dict from a bg-preset name and accent name or raw hex.

    Returns a flat dict with all colour keys used throughout the UI. All values
    are guaranteed unique (see _ensure_unique_hex) so runtime theme switches
    re-paint every widget reliably.
    """
    bg = _BG_PRESETS.get(bg_name, _BG_PRESETS["dark"])
    if accent_name_or_hex in _ACCENT_PRESETS:
        ac = _ACCENT_PRESETS[accent_name_or_hex]
        accent  = ac["ACCENT"]
        accent2 = ac["ACCENT2"]
    else:
        # Raw hex from custom colour picker
        accent  = accent_name_or_hex if accent_name_or_hex.startswith("#") else "#22c55e"
        # Derive darker shade: darken by ~20%
        try:
            h = accent.lstrip("#")
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            r2, g2, b2 = int(r * 0.72), int(g * 0.72), int(b * 0.72)
            accent2 = f"#{r2:02x}{g2:02x}{b2:02x}"
        except ValueError:
            accent2 = accent
    sc = _STATUS_COLOURS_LIGHT if bg.get("_is_light") else _STATUS_COLOURS
    assembled = {
        "BG":        bg["BG"],
        "BG2":       bg["BG2"],
        "BG3":       bg["BG3"],
        "BORDER":    bg["BORDER"],
        "TEXT":      bg["TEXT"],
        "MUTED":     bg["MUTED"],
        "DESC_COLOR":bg["DESC_COLOR"],
        "LOG_BG":    bg["LOG_BG"],
        "ORANGE":    accent,
        "ORANGE2":   accent2,
        "GREEN":     sc["GREEN"],
        "RED":       sc["RED"],
        "YELLOW":    sc["YELLOW"],
        "BLUE":      sc["BLUE"],
    }
    return _ensure_unique_hex(assembled)


# ── The LIVE theme, shared between modules ──────────────────────────────────
#  _THEME is the one dictionary of colours in force. apply_theme() mutates it
#  IN PLACE (clear + update) and never reassigns it, so every module that
#  imported _THEME or _t holds the same object and sees the same values after a
#  theme change. That is what makes it possible to extract widgets into other
#  files without breaking the colour update.
_THEME: dict = _build_theme("dark", "green")


def _t(key: str) -> str:
    """The theme colour in force for one key, e.g. _t('BG')."""
    return _THEME[key]


def apply_theme(bg_name: str, accent: str) -> dict:
    """Rebuild the theme and update _THEME IN PLACE. Returns _THEME.

    Mutating in place is deliberate: do NOT reassign _THEME, or every other
    module would keep holding the old dictionary.
    """
    new = _build_theme(bg_name, accent)
    _THEME.clear()
    _THEME.update(new)
    return _THEME
