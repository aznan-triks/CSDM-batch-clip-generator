"""Boite a outils UI : polices, espacements et styles partages (Phase 1.2).

Donnees de presentation communes au fichier principal et aux modules de
widgets. Les polices et constantes d'espacement sont des INVARIANTS purs.

_CHK_KW / _BTN_KW sont des dictionnaires de kwargs Tkinter derives du theme.
Ils sont construits ici avec le theme courant, puis mis a jour EN PLACE
(.update(...)) par _apply_theme_globals du fichier principal a chaque
changement de theme. Comme tous les modules importent le MEME objet dict,
les widgets crees avec **_CHK_KW / **_BTN_KW recoivent toujours les couleurs
courantes.
"""
import tkinter.font as tkfont
from tkinter import ttk

from csdm.theme import _t

# ── Polices ─────────────────────────────────────────────────────────────────
#  Pile de polices monospace, de la plus moderne a la plus universelle. La
#  premiere reellement installee est retenue (resolve_mono_family). C'est la
#  SEULE liste hardcodee ; le choix utilisateur passe par la config
#  ("ui_font_family": "auto" | "<nom force>"). HC.1 respecte.
UI_FONT_STACK = ("JetBrains Mono", "Fira Code", "Cascadia Mono", "Consolas")
_UI_FONT_FALLBACK = "Consolas"   # invariant : toujours present sous Windows

#  FONT_* sont les NOMS de polices Tk nommees (pas des tuples). Les vraies
#  polices sont creees/reconfigurees par init_fonts() une fois le root Tk pret.
#  Comme tous les widgets referencent le meme nom, changer la famille = un seul
#  reconfigure(), tous les widgets suivent (changement a chaud gratuit).
FONT_MONO    = "csdm_mono"       # 10
FONT_MONO_B  = "csdm_mono_b"     # 10 gras
FONT_SM      = "csdm_sm"         # 9
FONT_SM_B    = "csdm_sm_b"       # 9 gras
FONT_DESC    = "csdm_desc"       # 8
FONT_TITLE_B = "csdm_title_b"    # 13 gras (en-tete appli)

#  (nom, taille, gras) — source unique pour la creation des polices nommees.
_FONT_SPECS = (
    (FONT_MONO,    10, "normal"),
    (FONT_MONO_B,  10, "bold"),
    (FONT_SM,       9, "normal"),
    (FONT_SM_B,     9, "bold"),
    (FONT_DESC,     8, "normal"),
    (FONT_TITLE_B, 13, "bold"),
)

_MONO_FAMILY = _UI_FONT_FALLBACK   # famille resolue courante (maj par init_fonts)
#  Refs fortes vers les objets Font nommes. INDISPENSABLE : un tkinter.font.Font
#  non reference est ramasse par le GC et supprime sa police nommee cote Tk.
_FONTS: dict = {}


def resolve_mono_family(preferred: str = "auto") -> str:
    """Retourne la premiere famille monospace disponible.

    preferred != "auto" -> force cette famille si elle est installee, sinon
    on retombe sur la pile UI_FONT_STACK, puis sur Consolas. Necessite un root
    Tk existant (tkfont.families() interroge le serveur X/Tk).
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
    """Cree (ou reconfigure) les polices nommees FONT_*. A appeler une fois le
    root Tk cree, AVANT toute construction de widget. Rappelable a chaud pour
    changer de famille. Retourne la famille effectivement retenue.
    """
    global _MONO_FAMILY
    _MONO_FAMILY = resolve_mono_family(family)
    for name, size, weight in _FONT_SPECS:
        f = _FONTS.get(name)
        if f is None:
            f = tkfont.Font(root=root, name=name, family=_MONO_FAMILY, size=size, weight=weight)
            _FONTS[name] = f   # ref forte -> empeche le GC de supprimer la police
        else:
            f.configure(family=_MONO_FAMILY, size=size, weight=weight)
    return _MONO_FAMILY


def apply_ttk_style(root) -> None:
    """Applique un style ttk plat facon terminal (theme 'clam', seul entierement
    stylisable). Source unique pour TOUS les widgets ttk : Notebook, Combobox,
    PanedWindow (sash), Scrollbar, Treeview. Lit les couleurs via _t() -> a
    rappeler tel quel a chaque changement de theme (aucun widget « oublie »).
    """
    BG, BG2, BG3 = _t("BG"), _t("BG2"), _t("BG3")
    BORDER, TEXT, MUTED, ACCENT = _t("BORDER"), _t("TEXT"), _t("MUTED"), _t("ORANGE")
    LOG_BG = _t("LOG_BG")

    s = ttk.Style(root)
    try:
        s.theme_use("clam")
    except Exception:
        pass  # clam absent (tres rare) -> on garde le theme courant

    # Onglets : rectangles plats, bordure 1px, actif = texte accent sur BG2.
    s.configure("TNotebook", background=BG, borderwidth=0, tabmargins=0)
    s.configure("TNotebook.Tab", background=BG3, foreground=MUTED,
                font=FONT_SM_B, padding=[UI_TTK_TAB_PADX, UI_TTK_TAB_PADY],
                borderwidth=1, bordercolor=BORDER)
    s.map("TNotebook.Tab",
          background=[("selected", BG2)],
          foreground=[("selected", ACCENT)],
          bordercolor=[("selected", BORDER)])

    # Combobox : plat, bordure 1px, fleche accent, champ BG3.
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
    # Liste deroulante sombre (Listbox interne du combobox).
    root.option_add("*TCombobox*Listbox.background", BG3)
    root.option_add("*TCombobox*Listbox.foreground", TEXT)
    root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", "white")
    root.option_add("*TCombobox*Listbox.font", FONT_SM)

    # PanedWindow : sash = trait fin, poignee reduite.
    s.configure("TPanedwindow", background=BORDER)
    s.configure("Sash", sashthickness=UI_TTK_SASH_W, gripcount=0, background=BORDER,
                bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER)

    # Scrollbars : plates, fines, sans fleches.
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
#  Tous les padx / pady / ipadx / ipady utilises a plusieurs endroits en
#  derivent. Changer ici -> change partout.
UI_TAB_PAD    = 10   # marge exterieure du cadre interne d'onglet scrollable
UI_SEC_PADX   = 14   # marge horizontale du corps de chaque carte Sec
UI_SEC_PADY   = 8    # marge verticale du corps de chaque carte Sec
UI_SEC_GAP    = 4    # ecart vertical entre cartes Sec (les bordures 1px font la grille)
UI_SEC_STRIPE_W = 1  # largeur de la bande accent a gauche du header Sec (1px = trait de grille)
UI_SEC_GLYPH_OPEN   = "[-]"  # glyphe header Sec deplie (facon terminal)
UI_SEC_GLYPH_CLOSED = "[+]"  # glyphe header Sec replie
UI_ROW_PAD    = 4    # ecart vertical standard entre lignes d'une section
UI_BTN_IPADX  = 8    # marge interne horizontale standard des boutons d'action
UI_BTN_IPADY  = 4    # marge interne verticale standard des boutons d'action
UI_ENTRY_IPAD = 6    # marge interne des champs de saisie
# Largeurs minimales (px) des deux panneaux du PanedWindow. Le sash est borne
# a ces limites au relachement pour qu'aucun panneau ne soit ecrase.
UI_PANE_LEFT_MIN  = 380   # panneau categories / notebook
UI_PANE_RIGHT_MIN = 200   # panneau console / log

# ── Metriques du style ttk « clam » (look terminal plat) ────────────────────
UI_TTK_TAB_PADX  = 12   # padding horizontal d'un onglet Notebook
UI_TTK_TAB_PADY  = 7    # padding vertical d'un onglet Notebook
UI_TTK_SCROLL_W  = 8    # largeur des scrollbars plates
UI_TTK_SASH_W    = 4    # largeur de la poignee de separation (sash)
UI_TTK_TREE_ROWH = 18   # hauteur de ligne du Treeview (picker de demos)

# ── Styles partages (mutes en place par le theme) ───────────────────────────
# kwargs pour cases a cocher / radios plates
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
