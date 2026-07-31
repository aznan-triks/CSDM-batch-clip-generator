"""The UI toolbox: fonts, spacing and shared styles (Phase 1.2).

Presentation data common to the entry point and to the widget modules. The
fonts and the spacing constants are pure INVARIANTS.

_CHK_KW / _BTN_KW are dictionaries of Tkinter kwargs derived from the theme.
They are built here from the theme in force, then updated IN PLACE
(.update(...)) by the entry point's _apply_theme_globals on every theme change.
Because every module imports the SAME dict object, a widget built with
**_CHK_KW / **_BTN_KW always gets the colours in force.
"""
import tkinter.font as tkfont
from tkinter import ttk

from csdm.theme import _t

# ── Fonts ───────────────────────────────────────────────────────────────────
#  Monospace stack, most modern first, most universal last. The first family
#  actually installed wins (resolve_mono_family). This is the ONLY hardcoded
#  list; the user's own choice goes through the config
#  ("ui_font_family": "auto" | "<forced name>"). HC.1 honoured.
UI_FONT_STACK = ("JetBrains Mono", "Fira Code", "Cascadia Mono", "Consolas")
_UI_FONT_FALLBACK = "Consolas"   # a real invariant: always present on Windows

#  FONT_* are Tk NAMED-FONT names, not tuples. The fonts themselves are created
#  and reconfigured by init_fonts() once the Tk root exists. Because every
#  widget references the same name, changing the family is a single
#  reconfigure() and every widget follows -- live restyling for free.
FONT_MONO    = "csdm_mono"       # 10
FONT_MONO_B  = "csdm_mono_b"     # 10 bold
FONT_SM      = "csdm_sm"         # 9
FONT_SM_B    = "csdm_sm_b"       # 9 bold
FONT_DESC    = "csdm_desc"       # 8
FONT_TITLE_B = "csdm_title_b"    # 13 bold (app header)

#  (name, size, weight) -- the single source the named fonts are built from.
_FONT_SPECS = (
    (FONT_MONO,    10, "normal"),
    (FONT_MONO_B,  10, "bold"),
    (FONT_SM,       9, "normal"),
    (FONT_SM_B,     9, "bold"),
    (FONT_DESC,     8, "normal"),
    (FONT_TITLE_B, 13, "bold"),
)

_MONO_FAMILY = _UI_FONT_FALLBACK   # the family in force (set by init_fonts)
#  Strong references to the named Font objects. REQUIRED: an unreferenced
#  tkinter.font.Font is collected, and collecting it deletes the named font on
#  the Tk side.
_FONTS: dict = {}


def resolve_mono_family(preferred: str = "auto") -> str:
    """The first monospace family actually available.

    `preferred` other than "auto" forces that family if it is installed;
    otherwise the UI_FONT_STACK is walked, and Consolas is the last resort.
    Needs an existing Tk root: tkfont.families() asks the Tk server.
    """
    try:
        available = set(tkfont.families())
    except Exception:
        return _UI_FONT_FALLBACK
    if preferred and preferred != "auto" and preferred in available:
        return preferred
    for fam in UI_FONT_STACK:
        if fam in available:
            return fam
    return _UI_FONT_FALLBACK


def init_fonts(root, family: str = "auto") -> str:
    """Create, or reconfigure, the FONT_* named fonts.

    Call it once the Tk root exists and BEFORE any widget is built. Safe to
    call again at run time to change family. Returns the family actually used.
    """
    global _MONO_FAMILY
    _MONO_FAMILY = resolve_mono_family(family)
    for name, size, weight in _FONT_SPECS:
        f = _FONTS.get(name)
        if f is None:
            f = tkfont.Font(root=root, name=name, family=_MONO_FAMILY, size=size, weight=weight)
            _FONTS[name] = f   # strong ref -> the GC cannot delete the font
        else:
            f.configure(family=_MONO_FAMILY, size=size, weight=weight)
    return _MONO_FAMILY


def apply_ttk_style(root) -> None:
    """Apply the flat, terminal-like ttk style.

    Built on 'clam', the only ttk theme that is fully styleable. This is the
    single source for EVERY ttk widget: Notebook, Combobox, PanedWindow (its
    sash), Scrollbar, Treeview. It reads its colours through _t(), so calling
    it again on a theme change is enough -- no widget can be forgotten.
    """
    BG, BG2, BG3 = _t("BG"), _t("BG2"), _t("BG3")
    BORDER, TEXT, MUTED, ACCENT = _t("BORDER"), _t("TEXT"), _t("MUTED"), _t("ORANGE")
    LOG_BG = _t("LOG_BG")

    s = ttk.Style(root)
    try:
        s.theme_use("clam")
    except Exception:
        pass  # no clam (very rare) -> keep whatever theme is in force

    # Tabs: flat rectangles, 1px border, active = accent text on BG2.
    s.configure("TNotebook", background=BG, borderwidth=0, tabmargins=0)
    s.configure("TNotebook.Tab", background=BG3, foreground=MUTED,
                font=FONT_SM_B, padding=[UI_TTK_TAB_PADX, UI_TTK_TAB_PADY],
                borderwidth=1, bordercolor=BORDER)
    s.map("TNotebook.Tab",
          background=[("selected", BG2)],
          foreground=[("selected", ACCENT)],
          bordercolor=[("selected", BORDER)])

    # Combobox: flat, 1px border, accent arrow, BG3 field.
    s.configure("TCombobox", fieldbackground=BG3, background=BG3, foreground=TEXT,
                arrowcolor=ACCENT, bordercolor=BORDER, lightcolor=BORDER,
                darkcolor=BORDER, insertcolor=TEXT,
                selectbackground=ACCENT, selectforeground="white")
    s.map("TCombobox",
          fieldbackground=[("readonly", BG3), ("disabled", BG)],
          foreground=[("readonly", TEXT), ("disabled", MUTED)],
          background=[("readonly", BG3)],
          bordercolor=[("focus", ACCENT)],
          arrowcolor=[("readonly", ACCENT)])
    # The combobox's own dark drop-down (its internal Listbox).
    root.option_add("*TCombobox*Listbox.background", BG3)
    root.option_add("*TCombobox*Listbox.foreground", TEXT)
    root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", "white")
    root.option_add("*TCombobox*Listbox.font", FONT_SM)

    # PanedWindow : sash = trait fin, poignee reduite.
    s.configure("TPanedwindow", background=BORDER)
    s.configure("Sash", sashthickness=UI_TTK_SASH_W, gripcount=0, background=BORDER,
                bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER)

    # Scrollbars: flat, thin, no arrows.
    for orient in ("Vertical.TScrollbar", "Horizontal.TScrollbar"):
        s.configure(orient, gripcount=0, background=BG3, troughcolor=BG,
                    bordercolor=BORDER, lightcolor=BG3, darkcolor=BG3,
                    arrowcolor=BG, arrowsize=0, width=UI_TTK_SCROLL_W)
        s.map(orient, background=[("active", BORDER)])

    # Treeview (picker de demos) : lignes serrees, en-tetes plats 1px.
    s.configure("DemoPicker.Treeview", background=LOG_BG, fieldbackground=LOG_BG,
                foreground=TEXT, rowheight=UI_TTK_TREE_ROWH, font=FONT_SM,
                borderwidth=0)
    s.configure("DemoPicker.Treeview.Heading", background=BG2, foreground=MUTED,
                font=FONT_DESC, relief="flat", borderwidth=1, bordercolor=BORDER)
    s.map("DemoPicker.Treeview",
          background=[("selected", BORDER)],
          foreground=[("selected", ACCENT)])

# ── Constantes d'espacement UI — source unique de verite ────────────────────
#  Every padx / pady / ipadx / ipady used in more than one place comes from
#  here. Change it here, it changes everywhere.
UI_TAB_PAD    = 10   # outer margin of a scrollable tab's inner frame
UI_SEC_PADX   = 10   # horizontal padding inside a Sec card (densified 14->10)
UI_SEC_PADY   = 8    # vertical padding inside a Sec card
UI_SEC_HDR_PADY = 3  # vertical padding of a Sec header (densified 5->3)
UI_SEC_GAP    = 4    # gap between Sec cards (their 1px borders draw the grid)
UI_SEC_STRIPE_W = 1  # accent stripe left of a Sec header (1px = a grid line)
UI_SEC_GLYPH_OPEN   = "[-]"  # glyphe header Sec deplie (facon terminal)
UI_SEC_GLYPH_CLOSED = "[+]"  # glyphe header Sec replie
UI_LABEL_UPPER = True        # field labels (mlabel) in CAPS, for the HUD look
UI_DESC_PREFIX = "// "       # marks a long description, like a code comment
UI_BENTO_BREAKPOINT = 720    # width in px above which a BentoGrid takes 2 columns
UI_BENTO_GAP = 4             # gap in px between BentoGrid cells
UI_ROW_PAD    = 3    # standard gap between rows of a section (densified 4->3)
UI_BTN_IPADX  = 8    # standard inner horizontal padding of an action button
UI_BTN_IPADY  = 4    # standard inner vertical padding of an action button
UI_ENTRY_IPAD = 6    # inner padding of an entry field
# Minimum width in px of the PanedWindow's two panes. The sash is clamped to
# these on release so neither pane can be crushed.
UI_PANE_LEFT_MIN  = 380   # panneau categories / notebook
UI_PANE_RIGHT_MIN = 200   # panneau console / log

# ── Metrics of the flat "clam" ttk style (the terminal look) ────────────────
UI_TTK_TAB_PADX  = 12   # horizontal padding of a Notebook tab
UI_TTK_TAB_PADY  = 7    # vertical padding of a Notebook tab
UI_TTK_SCROLL_W  = 8    # width of the flat scrollbars
UI_TTK_SASH_W    = 4    # width of the pane divider (the sash)
UI_TTK_TREE_ROWH = 16   # Treeview row height (demo picker, densified 18->16)

# ── Shared style dicts, mutated in place by the theme ───────────────────────
# kwargs for flat checkbuttons and radiobuttons
_CHK_KW = dict(font=FONT_SM, bg=_t("BG2"), fg=_t("MUTED"), activebackground=_t("BG2"),
               activeforeground=_t("ORANGE"), selectcolor=_t("BG3"),
               relief="flat", bd=0, cursor="hand2", highlightthickness=0)
_BTN_KW = dict(relief="flat", bd=0, cursor="hand2", highlightthickness=0,
               activebackground=_t("BORDER"), activeforeground=_t("ORANGE"))


def _contrast_fg(hex_color: str) -> str:
    """Return black or white — whichever is readable on the given background.

    Pure utility (no theme dependency): used for tag-colour previews and any
    swatch whose foreground must stay legible regardless of the chosen colour.
    """
    try:
        h = hex_color.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return "#000000" if (0.299 * r + 0.587 * g + 0.114 * b) > 140 else "#ffffff"
    except (ValueError, TypeError, AttributeError):
        return "#ffffff"
