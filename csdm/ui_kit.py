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
from csdm.theme import _t

# ── Polices ─────────────────────────────────────────────────────────────────
FONT_MONO = ("Consolas", 10)
FONT_SM   = ("Consolas", 9)
FONT_DESC = ("Consolas", 8)

# ── Constantes d'espacement UI — source unique de verite ────────────────────
#  Tous les padx / pady / ipadx / ipady utilises a plusieurs endroits en
#  derivent. Changer ici -> change partout.
UI_TAB_PAD    = 10   # marge exterieure du cadre interne d'onglet scrollable
UI_SEC_PADX   = 14   # marge horizontale du corps de chaque carte Sec
UI_SEC_PADY   = 8    # marge verticale du corps de chaque carte Sec
UI_SEC_GAP    = 6    # ecart vertical entre cartes Sec consecutives
UI_ROW_PAD    = 4    # ecart vertical standard entre lignes d'une section
UI_BTN_IPADX  = 8    # marge interne horizontale standard des boutons d'action
UI_BTN_IPADY  = 4    # marge interne verticale standard des boutons d'action
UI_ENTRY_IPAD = 6    # marge interne des champs de saisie
# Largeurs minimales (px) des deux panneaux du PanedWindow. Le sash est borne
# a ces limites au relachement pour qu'aucun panneau ne soit ecrase.
UI_PANE_LEFT_MIN  = 380   # panneau categories / notebook
UI_PANE_RIGHT_MIN = 200   # panneau console / log

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
