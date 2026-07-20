"""Composants Tkinter reutilisables (Phase 1.2 — extraction des widgets).

ScrollableFrame et WrapRow, deplaces depuis le fichier principal. Ils lisent
les couleurs via l'accesseur partage _t() de csdm/theme.py (jamais des
globales), ce qui permet de vivre dans un module separe sans casser la mise
a jour du theme.

Les deux registres ci-dessous listent les instances VIVANTES ; les handlers
globaux de App (molette, redimensionnement) iterent dessus. Ce sont les memes
objets que ceux importes par le fichier principal.
"""
import re
import calendar as cal_mod
from datetime import date, datetime
import tkinter as tk
from tkinter import ttk, filedialog, colorchooser, messagebox

from csdm.theme import _t
from csdm.static_data import TAG_PRESET_COLORS
from csdm.config import load_saved_players, save_saved_players
from csdm.ui_kit import (
    FONT_MONO, FONT_MONO_B, FONT_SM, FONT_SM_B, FONT_DESC,
    UI_SEC_PADX, UI_SEC_PADY, UI_SEC_GAP, UI_SEC_HDR_PADY,
    UI_SEC_STRIPE_W, UI_SEC_GLYPH_OPEN, UI_SEC_GLYPH_CLOSED, UI_LABEL_UPPER,
    UI_DESC_PREFIX, UI_BENTO_BREAKPOINT, UI_BENTO_GAP,
    _contrast_fg,
)

# Registry of all live ScrollableFrame instances — used by the global wheel dispatcher.
_SCROLL_FRAMES: list = []
_WRAP_ROWS:  list = []   # all live WrapRow instances


class ScrollableFrame(tk.Frame):
    """A vertically scrollable frame.

    Registers itself in _SCROLL_FRAMES so the single application-level
    <MouseWheel> handler (installed once in _build_ui) can scroll the frame
    that is currently under the cursor — no per-widget Enter/Leave machinery.
    """
    def __init__(self, parent, **kw):
        super().__init__(parent, **kw)
        self._c = tk.Canvas(self, bg=_t("BG"), highlightthickness=0, bd=0, height=1)
        sb = ttk.Scrollbar(self, orient="vertical", command=self._c.yview)
        self.inner = tk.Frame(self._c, bg=_t("BG"))
        # Use event dimensions directly — avoids the expensive bbox("all") traversal.
        self.inner.bind("<Configure>",
                        lambda e: self._c.configure(scrollregion=(0, 0, e.width, e.height)))
        self._win_id = self._c.create_window((0, 0), window=self.inner, anchor="nw")
        # Debounce width sync: defer inner reflow to 50 ms after the last resize event.
        # This prevents the full widget cascade (inner + all children) from running on
        # every pixel during window resize or sash drag.
        self._width_job = None
        self._pending_width = None
        self._c.bind("<Configure>", self._on_canvas_configure)
        self._c.configure(yscrollcommand=sb.set)
        self._c.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        _SCROLL_FRAMES.append(self)
        self.bind("<Destroy>", self._on_destroy)

    def _on_canvas_configure(self, event):
        self._pending_width = event.width
        # Reschedule: 400 ms fallback for OS-level window resize where no
        # ButtonRelease reaches Tkinter. Sash drags are flushed immediately
        # via _on_release() bound to <ButtonRelease-1> in _build_ui.
        if self._width_job:
            self.after_cancel(self._width_job)
        self._width_job = self.after(400, self._apply_width)

    def _apply_width(self):
        if self._width_job:
            self.after_cancel(self._width_job)
            self._width_job = None
        if self._pending_width is not None:
            self._c.itemconfigure(self._win_id, width=self._pending_width)

    def _on_destroy(self, _event=None):
        try:
            _SCROLL_FRAMES.remove(self)
        except ValueError:
            pass

    def apply_theme(self):
        """Explicitly repaint canvas and inner frame with current BG — bypasses
        colour_map so it works even when old BG collides with another key (e.g. amoled)."""
        try:
            self._c.configure(bg=_t("BG"))
        except tk.TclError:
            pass
        try:
            self.inner.configure(bg=_t("BG"))
        except tk.TclError:
            pass

    def scroll(self, delta):
        self._c.yview_scroll(-1 * (delta // 120), "units")

    def contains_point(self, x_root, y_root):
        """True when screen point (x_root, y_root) is inside this canvas AND it is visible."""
        try:
            if not self._c.winfo_viewable():
                return False
            cx, cy = self._c.winfo_rootx(), self._c.winfo_rooty()
            return cx <= x_root < cx + self._c.winfo_width() and \
                   cy <= y_root < cy + self._c.winfo_height()
        except tk.TclError:
            return False


class WrapRow(tk.Frame):
    """Horizontal list of widgets that wraps into new rows based on available width.

    Children must be created with this WrapRow as their parent.
    Do NOT call .pack() / .grid() on the children — just call row.add(widget)
    and WrapRow positions them via place() in a wrapping layout.

    Usage:
        row = WrapRow(parent, bg=BG2)
        row.pack(fill="x", pady=(4, 0))
        btn = tk.Button(row, text="...", ...)
        row.add(btn)

    WrapRow sets its own height automatically and registers with _WRAP_ROWS so
    the global flush in _on_release also triggers a relayout.
    """

    def __init__(self, parent, gap_x=6, gap_y=4, **kw):
        kw.setdefault("bg", _t("BG2"))
        super().__init__(parent, **kw)
        self.pack_propagate(False)   # height is managed manually via configure()
        self._gap_x  = gap_x
        self._gap_y  = gap_y
        self._items  = []            # ordered child widgets
        self._job    = None
        self.bind("<Configure>", self._schedule)
        self.bind("<Destroy>",   self._on_destroy)
        _WRAP_ROWS.append(self)

    def add(self, widget):
        """Register widget for wrapping layout. Returns widget for chaining."""
        self._items.append(widget)
        self._schedule()
        return widget

    def _schedule(self, _event=None):
        if self._job:
            self.after_cancel(self._job)
        self._job = self.after(16, self._relayout)

    def _relayout(self, *_):
        self._job = None
        avail = self.winfo_width()
        if avail < 10:
            return
        x, y, row_h = 0, 0, 0
        for w in self._items:
            w.update_idletasks()
            rw = w.winfo_reqwidth()
            rh = w.winfo_reqheight()
            if x + rw > avail and x > 0:
                x = 0
                y += row_h + self._gap_y
                row_h = 0
            w.place(x=x, y=y, height=rh)
            x  += rw + self._gap_x
            row_h = max(row_h, rh)
        total = (y + row_h) if self._items else 1
        self.configure(height=total)

    def _on_destroy(self, _e=None):
        try:
            _WRAP_ROWS.remove(self)
        except ValueError:
            pass


_BENTO_GRIDS: list = []   # all live BentoGrid instances


class BentoGrid(tk.Frame):
    """Conteneur responsive : dispose ses cartes en grille 1 ou 2 colonnes.

    1 colonne sous UI_BENTO_BREAKPOINT px, 2 colonnes au-dessus (colonnes
    egales via uniform="bento" -> traits de grille alignes). Re-layout debounce
    sur <Configure> (meme mecanique que WrapRow/ScrollableFrame). Opt-in par
    onglet : les cartes Sec gardent leur API (.grid() deja proxifie).

    Usage:
        bento = BentoGrid(parent)
        bento.pack(fill="both", expand=True)
        sec = Sec(bento, "TITLE"); bento.add(sec)
    """

    def __init__(self, parent, breakpoint_px=UI_BENTO_BREAKPOINT, gap=UI_BENTO_GAP, **kw):
        kw.setdefault("bg", _t("BG"))
        super().__init__(parent, **kw)
        self._cards: list = []
        self._cols = 0          # nb de colonnes courant (0 = pas encore dispose)
        self._laid = -1         # nb de cartes lors du dernier layout
        self._bp = breakpoint_px
        self._gap = gap
        self._job = None
        self.bind("<Configure>", self._schedule)
        self.bind("<Destroy>", self._on_destroy)
        _BENTO_GRIDS.append(self)

    def add(self, card):
        """Enregistre une carte (Sec ou Frame). Retourne la carte pour chainage."""
        self._cards.append(card)
        self._schedule()
        return card

    def _schedule(self, _e=None):
        if self._job:
            self.after_cancel(self._job)
        self._job = self.after(16, self._relayout)

    def _relayout(self, *_):
        self._job = None
        avail = self.winfo_width()
        if avail < 10:
            return
        cols = 2 if avail >= self._bp else 1
        if cols == self._cols and self._laid == len(self._cards):
            return  # ni la largeur ni le nombre de cartes n'ont change
        self._cols = cols
        self._laid = len(self._cards)
        self.columnconfigure(0, weight=1, uniform="bento")
        self.columnconfigure(1, weight=(1 if cols == 2 else 0),
                             uniform=("bento" if cols == 2 else ""))
        for i, card in enumerate(self._cards):
            r, c = (divmod(i, 2) if cols == 2 else (i, 0))
            px = (0, self._gap) if (cols == 2 and c == 0) else (0, 0)
            card.grid(row=r, column=c, sticky="new", padx=px, pady=(0, self._gap))

    def _on_destroy(self, _e=None):
        try:
            _BENTO_GRIDS.remove(self)
        except ValueError:
            pass

    def apply_theme(self):
        try:
            self.configure(bg=_t("BG"))
        except tk.TclError:
            pass


# ════════════════════════════════════════════════════════════════════════════
#  Assistants d'affichage (helpers UI) + info-bulle
#  Deplaces depuis le fichier principal (Phase 1.2). Couleurs via _t().
# ════════════════════════════════════════════════════════════════════════════
def sentry(parent, var, **kw):
    """Styled Entry widget bound to var."""
    return tk.Entry(parent, textvariable=var, font=FONT_MONO, bg=_t("BG3"), fg=_t("TEXT"),
                    insertbackground=_t("ORANGE"), relief="flat", bd=0, highlightthickness=1,
                    highlightbackground=_t("BORDER"), highlightcolor=_t("ORANGE"), **kw)

def scombo(parent, var, values, width=15):
    """Read-only Combobox bound to var."""
    return ttk.Combobox(parent, textvariable=var, values=values, font=FONT_SM, state="readonly", width=width)

def mlabel(parent, text, **kw):
    """Muted-colour small label for field names and secondary text.

    Libelles de champ passes en MAJUSCULES (UI_LABEL_UPPER) pour le look HUD.
    Les chiffres/symboles sont inchanges par .upper() -> compteurs et unites OK.
    """
    if UI_LABEL_UPPER and isinstance(text, str):
        text = text.upper()
    return tk.Label(parent, text=text, font=FONT_SM, fg=_t("MUTED"), bg=_t("BG2"), **kw)

def flabel(parent, text, **kw):
    """Filter name label — slightly brighter than mlabel to distinguish filter names."""
    return tk.Label(parent, text=text, font=FONT_SM, fg=_t("TEXT"), bg=_t("BG2"), **kw)

def slabel(parent, text, **kw):
    """Subcategory section header label — accent-coloured to visually separate sections."""
    return tk.Label(parent, text=text, font=FONT_SM_B,
                    fg=_t("ORANGE"), bg=_t("BG2"), **kw)

def _safe_trace_remove(var, mode, tid):
    """Remove a tkinter variable trace silently — safe to call even if already removed."""
    try:
        var.trace_remove(mode, tid)
    except tk.TclError:
        pass


def _make_highlight_toggle(widget, var, is_active_fn):
    """Shared highlight/dim logic for hchk and hradio widgets."""
    def _update(*args):
        try:
            if not widget.winfo_exists():
                try:
                    var.trace_remove("write", args[2] if len(args) > 2 else args[0])
                except tk.TclError:
                    pass
                return
        except tk.TclError:
            return
        if is_active_fn():
            widget.config(bg=_t("ORANGE2"), fg="white",
                          activebackground=_t("ORANGE"), activeforeground="white",
                          selectcolor=_t("ORANGE2"))
        else:
            widget.config(bg=_t("BG3"), fg=_t("MUTED"),
                          activebackground=_t("BG3"), activeforeground=_t("ORANGE"),
                          selectcolor=_t("BG3"))
    _tid = var.trace_add("write", _update)
    _update()
    widget.bind("<Destroy>", lambda e: _safe_trace_remove(var, "write", _tid))

def hchk(parent, text, var, **kw):
    """Styled Checkbutton with highlight-on-active toggle. Returns the widget."""
    cb_kw = dict(font=FONT_SM, relief="flat", bd=0, cursor="hand2",
                 highlightthickness=0, padx=10, pady=4)
    cb_kw.update(kw)
    cb = tk.Checkbutton(parent, text=text, variable=var, **cb_kw)
    _make_highlight_toggle(cb, var, var.get)
    return cb

def hradio(parent, text, var, value, **kw):
    """Radiobutton with highlight when selected."""
    rb_kw = dict(font=FONT_SM, relief="flat", bd=0, cursor="hand2",
                 highlightthickness=0, padx=10, pady=4)
    rb_kw.update(kw)
    rb = tk.Radiobutton(parent, text=text, variable=var, value=value, **rb_kw)
    _make_highlight_toggle(rb, var, lambda: var.get() == value)
    return rb

_WRAP_LABELS: list = []   # all labels registered via _bind_wraplength

def _bind_wraplength(lbl):
    """Debounced <Configure> binding that keeps a label's wraplength = widget width.

    400 ms fallback for OS window resize; sash/in-app drags are flushed
    immediately via the global <ButtonRelease-1> handler in _build_ui.

    The apply function guards against re-entrancy: it only calls w.config() when
    the computed value actually differs from the current one, preventing the
    <Configure> → _apply → <Configure> feedback loop that caused continuous redraws.
    """
    _job = [None]
    def _apply(w=lbl):
        _job[0] = None
        try:
            new_wrap = max(200, w.winfo_width() - 10)
            if int(w.cget("wraplength") or 0) != new_wrap:
                w.config(wraplength=new_wrap)
        except tk.TclError:
            pass
    def _schedule(e, w=lbl):
        if _job[0]:
            w.after_cancel(_job[0])
        _job[0] = w.after(400, _apply)
    lbl.bind("<Configure>", _schedule)
    _WRAP_LABELS.append((_apply, lbl))
    lbl.bind("<Destroy>", lambda e, a=_apply, w=lbl: _WRAP_LABELS.remove((a, w))
             if (a, w) in _WRAP_LABELS else None)

def desc_label(parent, text):
    """Return a muted descriptive Label with automatic wraplength binding.

    Prefixe // facon commentaire de code (UI_DESC_PREFIX), sans double-prefixe.
    """
    if isinstance(text, str) and UI_DESC_PREFIX and not text.startswith(UI_DESC_PREFIX):
        text = UI_DESC_PREFIX + text
    lbl = tk.Label(parent, text=text, font=FONT_DESC, fg=_t("DESC_COLOR"), bg=_t("BG2"),
                   anchor="w", justify="left")
    _bind_wraplength(lbl)
    return lbl

def _sep(parent, pady=(6, 4), padx=0):
    """Horizontal rule between UI sub-sections."""
    tk.Frame(parent, height=1, bg=_t("BORDER")).pack(fill="x", pady=pady, padx=padx)

def _chk_tip(parent, label, var, tip, anchor="w", pady=2, **kw):
    """hchk + pack + add_tip in one call."""
    cb = hchk(parent, label, var, **kw)
    cb.pack(anchor=anchor, pady=pady)
    if tip:
        add_tip(cb, tip)
    return cb

# ═══════════════════════════════════════════════════════
#  Lightweight tooltip — replaces inline desc_labels
# ═══════════════════════════════════════════════════════
class Tooltip:
    """Hover tooltip widget. Use add_tip(widget, text)."""
    def __init__(self, widget, text):
        self._widget = widget
        self._text   = text
        self._tip    = None
        widget.bind("<Enter>",  self._show, add="+")
        widget.bind("<Leave>",  self._hide, add="+")
        widget.bind("<Destroy>", lambda e: self._hide(), add="+")

    def _show(self, event=None):
        if self._tip or not self._text:
            return
        x = self._widget.winfo_rootx() + self._widget.winfo_width() + 4
        y = self._widget.winfo_rooty()
        self._tip = tw = tk.Toplevel(self._widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        tw.attributes("-topmost", True)
        tk.Label(tw, text=self._text, font=FONT_DESC, fg=_t("TEXT"),
                 bg="#2a2a2a", relief="flat", bd=0,
                 padx=8, pady=4, wraplength=340, justify="left").pack()

    def _hide(self, event=None):
        if self._tip:
            try:
                self._tip.destroy()
            except tk.TclError:
                pass
            self._tip = None

def add_tip(widget, text):
    """Attach a tooltip to widget if text is non-empty."""
    if text:
        Tooltip(widget, text)

def dp2_badge(parent):
    """Blue 'demoparser2' label with a shared tooltip — attach with .pack()."""
    lbl = tk.Label(parent, text="demoparser2", font=FONT_DESC, fg=_t("BLUE"), bg=_t("BG2"))
    add_tip(lbl, "Requires: pip install demoparser2")
    return lbl


# ════════════════════════════════════════════════════════════════════════════
#  Carte de section pliable + champ de chemin (Phase 1.2)
# ════════════════════════════════════════════════════════════════════════════
class Sec(tk.Frame):
    """Collapsible section card — drop-in replacement for the old LabelFrame Sec.

    Children packed/gridded into a Sec instance go into the body (content area).
    The header with toggle arrow is a sibling frame managed internally.

    Usage is identical to the old Sec:
        sec = Sec(parent, "MY SECTION")
        sec.pack(fill="x")
        tk.Label(sec, text="hello").pack()   # goes into the body, correct
    """

    def __init__(self, parent, title, collapsed=False, **kw):
        # _wrapper holds the header + this body frame. Bordure complete 1px
        # (highlightthickness, sans bd -> aucun decalage de layout) : la carte
        # se lit comme une cellule de grille.
        self._wrapper = tk.Frame(parent, bg=_t("BG"), bd=0,
                                 highlightthickness=1,
                                 highlightbackground=_t("BORDER"),
                                 highlightcolor=_t("BORDER"))

        # ── Header ────────────────────────────────────────────────────────────
        self._hdr = tk.Frame(self._wrapper, bg=_t("BG2"), cursor="hand2")
        self._hdr.pack(fill="x")

        self._stripe = tk.Frame(self._hdr, width=UI_SEC_STRIPE_W, bg=_t("ORANGE"))
        self._stripe.pack(side="left", fill="y")

        self._arrow = tk.Label(self._hdr, text=UI_SEC_GLYPH_OPEN,
                               font=FONT_SM_B,
                               bg=_t("BG2"), fg=_t("ORANGE"),
                               padx=UI_SEC_PADX // 2, pady=UI_SEC_HDR_PADY)
        self._arrow.pack(side="left")

        self._title_lbl = tk.Label(self._hdr, text=title.upper(),
                                   font=FONT_SM_B,
                                   bg=_t("BG2"), fg=_t("ORANGE"),
                                   anchor="w", pady=UI_SEC_HDR_PADY)
        self._title_lbl.pack(side="left", fill="x", expand=True)

        self._sep = tk.Frame(self._wrapper, height=1, bg=_t("BORDER"))
        self._sep.pack(fill="x")

        # ── Body = this Frame ─────────────────────────────────────────────────
        kw.setdefault("bg", _t("BG2"))
        kw.setdefault("padx", UI_SEC_PADX)
        kw.setdefault("pady", UI_SEC_PADY)
        super().__init__(self._wrapper, **kw)
        tk.Frame.pack(self, fill="x")   # pack body into wrapper

        self._open = not collapsed
        self._title = title

        # Bind header click to toggle
        for w in (self._hdr, self._arrow, self._title_lbl, self._stripe):
            w.bind("<Button-1>", self._toggle)

        if collapsed:
            self._collapse_now()

    # ── Pack / grid / place — proxy to wrapper ────────────────────────────────

    def pack(self, **kw):
        kw.setdefault("pady", (0, UI_SEC_GAP))
        self._wrapper.pack(**kw)

    def pack_forget(self):
        self._wrapper.pack_forget()

    def grid(self, **kw):
        self._wrapper.grid(**kw)

    def grid_forget(self):
        self._wrapper.grid_forget()

    def place(self, **kw):
        self._wrapper.place(**kw)

    # ── Collapse / expand ─────────────────────────────────────────────────────

    def _toggle(self, *_):
        if self._open:
            self._collapse_now()
        else:
            self._expand_now()

    def _collapse_now(self):
        self._open = False
        self._arrow.config(text=UI_SEC_GLYPH_CLOSED)
        self._sep.pack_forget()
        tk.Frame.pack_forget(self)

    def _expand_now(self):
        self._open = True
        self._arrow.config(text=UI_SEC_GLYPH_OPEN)
        self._sep.pack(fill="x")
        tk.Frame.pack(self, fill="x")

    # ── Theme update ──────────────────────────────────────────────────────────

    def apply_theme(self):
        try: self._wrapper.config(bg=_t("BG"), highlightbackground=_t("BORDER"),
                                  highlightcolor=_t("BORDER"))
        except tk.TclError: pass
        try: self._hdr.config(bg=_t("BG2"))
        except tk.TclError: pass
        try: self._stripe.config(bg=_t("ORANGE"))
        except tk.TclError: pass
        try: self._arrow.config(bg=_t("BG2"), fg=_t("ORANGE"))
        except tk.TclError: pass
        try: self._title_lbl.config(bg=_t("BG2"), fg=_t("ORANGE"))
        except tk.TclError: pass
        try: self._sep.config(bg=_t("BORDER"))
        except tk.TclError: pass
        try: self.config(bg=_t("BG2"))
        except tk.TclError: pass

class PathField(tk.Frame):
    def __init__(self, parent, label, desc, var, mode="file"):
        super().__init__(parent, bg=_t("BG2"))
        mlabel(self, label, anchor="w").pack(fill="x")
        if desc:
            tk.Label(self, text=desc, font=FONT_DESC, fg=_t("DESC_COLOR"), bg=_t("BG2"), anchor="w").pack(fill="x")
        row = tk.Frame(self, bg=_t("BG2"))
        row.pack(fill="x", pady=(3, 0))
        tk.Entry(row, textvariable=var, font=FONT_MONO, bg=_t("BG3"), fg=_t("TEXT"), insertbackground=_t("ORANGE"),
                 relief="flat", bd=0, highlightthickness=1, highlightbackground=_t("BORDER"),
                 highlightcolor=_t("ORANGE")).pack(side="left", fill="x", expand=True, ipady=6, ipadx=8)

        def browse():
            p = (filedialog.askopenfilename(filetypes=[("Exe", "*.exe;*.cmd"), ("All files", "*.*")])
                 if mode == "file" else filedialog.askdirectory())
            if p:
                var.set(p)

        tk.Button(row, text=" ... ", command=browse, font=FONT_SM, bg=_t("BG3"), fg=_t("MUTED"), relief="flat",
                  cursor="hand2", activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
                  highlightthickness=0, bd=0).pack(side="left", padx=(4, 0), ipady=6, ipadx=4)


# ════════════════════════════════════════════════════════════════════════════
#  Calendrier, dialogues (couleur / tags manquants) et champ de date (Phase 1.2)
# ════════════════════════════════════════════════════════════════════════════
class CalendarPopup(tk.Toplevel):
    def __init__(self, parent, callback, initial_date=None):
        super().__init__(parent)
        self.overrideredirect(True)
        self.configure(bg=_t("BORDER"))
        self.callback = callback
        self.attributes("-topmost", True)
        today = date.today()
        self._year = initial_date.year if initial_date else today.year
        self._month = initial_date.month if initial_date else today.month
        self._today = today
        inner = tk.Frame(self, bg=_t("BG2"), padx=6, pady=6)
        inner.pack(padx=1, pady=1)
        nav = tk.Frame(inner, bg=_t("BG2"))
        nav.pack(fill="x", pady=(0, 6))
        tk.Button(nav, text="◀", font=FONT_DESC, bg=_t("BG3"), fg=_t("TEXT"), relief="flat",
                  bd=0, cursor="hand2", width=3, command=self._prev).pack(side="left")
        self._title = tk.Label(nav, text="", font=FONT_SM_B, bg=_t("BG2"), fg=_t("ORANGE"))
        self._title.pack(side="left", fill="x", expand=True)
        tk.Button(nav, text="▶", font=FONT_DESC, bg=_t("BG3"), fg=_t("TEXT"), relief="flat",
                  bd=0, cursor="hand2", width=3, command=self._next).pack(side="right")
        hdr = tk.Frame(inner, bg=_t("BG2"))
        hdr.pack(fill="x")
        for d in ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"):
            tk.Label(hdr, text=d, font=FONT_DESC, fg=_t("MUTED"), bg=_t("BG2"), width=4).pack(side="left")
        self._grid = tk.Frame(inner, bg=_t("BG2"))
        self._grid.pack(fill="x")
        self._draw()
        qr = tk.Frame(inner, bg=_t("BG2"))
        qr.pack(fill="x", pady=(6, 0))
        tk.Button(qr, text="Today", font=FONT_DESC, bg=_t("BG3"), fg=_t("GREEN"), relief="flat",
                  bd=0, cursor="hand2", command=lambda: self._select(today)).pack(side="left", padx=2)
        tk.Button(qr, text="Clear", font=FONT_DESC, bg=_t("BG3"), fg=_t("RED"), relief="flat",
                  bd=0, cursor="hand2", command=lambda: self._select(None)).pack(side="right", padx=2)
        self.bind("<FocusOut>", lambda e: self.after(100, self._check_focus))
        self.focus_set()
        self.update_idletasks()
        self.geometry(f"+{parent.winfo_rootx()}+{parent.winfo_rooty() + parent.winfo_height()}")

    def _check_focus(self):
        try:
            if self.focus_get() is None or not str(self.focus_get()).startswith(str(self)):
                self.destroy()
        except tk.TclError:
            pass

    def _prev(self):
        self._month -= 1
        if self._month < 1:
            self._month = 12; self._year -= 1
        self._draw()

    def _next(self):
        self._month += 1
        if self._month > 12:
            self._month = 1; self._year += 1
        self._draw()

    def _draw(self):
        for w in self._grid.winfo_children():
            w.destroy()
        MFR = ["", "January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]
        self._title.config(text=f"{MFR[self._month]} {self._year}")
        for ri, week in enumerate(cal_mod.monthcalendar(self._year, self._month)):
            for ci, day in enumerate(week):
                if day == 0:
                    tk.Label(self._grid, text="", width=4, bg=_t("BG2")).grid(row=ri, column=ci)
                else:
                    d = date(self._year, self._month, day)
                    is_t = d == self._today
                    tk.Button(self._grid, text=str(day), width=4, font=FONT_DESC,
                              bg=_t("ORANGE") if is_t else _t("BG3"), fg="white" if is_t else _t("TEXT"),
                              relief="flat", bd=0, cursor="hand2",
                              activebackground=_t("ORANGE2"), activeforeground="white",
                              command=lambda dd=d: self._select(dd)).grid(row=ri, column=ci, padx=1, pady=1)

    def _select(self, d):
        self.callback(d)
        self.destroy()

# ═══════════════════════════════════════════════════════
#  Color Picker Dialog
# ═══════════════════════════════════════════════════════
class ColorPickerDialog(tk.Toplevel):
    def __init__(self, parent, initial_color="#f97316"):
        super().__init__(parent)
        self.title("Choose a color")
        self.configure(bg=_t("BG2"))
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        self.result = None
        self._color = initial_color
        mlabel(self, "Quick colors").pack(anchor="w", padx=12, pady=(12, 4))
        gf = tk.Frame(self, bg=_t("BG2"))
        gf.pack(padx=12)
        for i, c in enumerate(TAG_PRESET_COLORS):
            tk.Button(gf, bg=c, width=3, height=1, relief="flat", bd=0, cursor="hand2",
                      activebackground=c, highlightthickness=2, highlightbackground=_t("BG2"),
                      command=lambda cc=c: self._pick(cc)).grid(row=i // 5, column=i % 5, padx=2, pady=2)
        _sep(self, pady=8, padx=12)
        pr = tk.Frame(self, bg=_t("BG2"))
        pr.pack(fill="x", padx=12)
        mlabel(pr, "Preview:").pack(side="left")
        self._preview = tk.Label(pr, text="  TAG  ", font=FONT_MONO_B,
                                 bg=initial_color, fg=_contrast_fg(initial_color), padx=12, pady=4)
        self._preview.pack(side="left", padx=(8, 0))
        self._hex_var = tk.StringVar(value=initial_color)
        self._hex_var.trace_add("write", self._on_hex)
        tk.Entry(pr, textvariable=self._hex_var, font=FONT_MONO, bg=_t("BG3"), fg=_t("TEXT"), width=10,
                 insertbackground=_t("ORANGE"), relief="flat", highlightthickness=1,
                 highlightbackground=_t("BORDER"), highlightcolor=_t("ORANGE")).pack(side="left", padx=(8, 0), ipady=4)
        br = tk.Frame(self, bg=_t("BG2"))
        br.pack(fill="x", padx=12, pady=(10, 12))
        tk.Button(br, text="System picker...", font=FONT_SM, bg=_t("BG3"), fg=_t("BLUE"), relief="flat",
                  bd=0, cursor="hand2", command=self._sys).pack(side="left")
        tk.Button(br, text="  OK  ", font=FONT_SM, bg=_t("ORANGE"), fg="white", relief="flat",
                  bd=0, cursor="hand2", activebackground=_t("ORANGE2"),
                  command=self._ok).pack(side="right", ipady=4, ipadx=8)
        tk.Button(br, text="Cancel", font=FONT_SM, bg=_t("BG3"), fg=_t("MUTED"), relief="flat",
                  bd=0, cursor="hand2", command=self.destroy).pack(side="right", padx=(0, 8), ipady=4, ipadx=8)
        self.update_idletasks()
        self.geometry(
            f"+{parent.winfo_rootx() + parent.winfo_width() // 2 - self.winfo_width() // 2}+{parent.winfo_rooty() + 50}")
        self.wait_window()

    def _pick(self, c):
        self._color = c; self._hex_var.set(c); self._upd()

    def _on_hex(self, *_):
        v = self._hex_var.get().strip()
        if re.match(r'^#[0-9a-fA-F]{6}$', v):
            self._color = v; self._upd()

    def _upd(self):
        try:
            self._preview.config(bg=self._color, fg=_contrast_fg(self._color))
        except tk.TclError:
            pass

    def _sys(self):
        r = colorchooser.askcolor(color=self._color, parent=self, title="Color")
        if r and r[1]:
            self._color = r[1]; self._hex_var.set(r[1]); self._upd()

    def _ok(self):
        self.result = self._color; self.destroy()

class TagImportMissingDialog(tk.Toplevel):
    """Lists tags that exist in the import file but are absent from the current DB.
    User can choose which ones to create (pre-checked by default) before import proceeds.

    result:
      None        → user cancelled (abort import)
      set of str  → tag names to create (empty set = create none, continue import)
    """
    def __init__(self, parent, missing_names, tag_defs):
        super().__init__(parent)
        self.result = None
        self.title("Missing tags — import")
        self.configure(bg=_t("BG2"))
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        mlabel(self,
               f"{len(missing_names)} tag(s) not found in this database:").pack(
            anchor="w", padx=12, pady=(12, 4))

        sf = tk.Frame(self, bg=_t("BG2"))
        sf.pack(fill="x", padx=12, pady=(0, 4))

        self._checks = {}
        for name in sorted(missing_names):
            color = (tag_defs.get(name) or {}).get("color") or "#f97316"
            var = tk.BooleanVar(value=True)
            self._checks[name] = var
            row = tk.Frame(sf, bg=_t("BG2"))
            row.pack(fill="x", pady=2)
            tk.Checkbutton(row, variable=var, bg=_t("BG2"), fg=_t("TEXT"),
                           activebackground=_t("BG2"), activeforeground=_t("TEXT"),
                           selectcolor=_t("BG3")).pack(side="left")
            tk.Label(row, bg=color, width=2, height=1,
                     relief="flat").pack(side="left", padx=(4, 0))
            tk.Label(row, text=name, font=FONT_SM, bg=_t("BG2"),
                     fg=_t("TEXT")).pack(side="left", padx=(6, 0))
            tk.Label(row, text=color, font=FONT_DESC, bg=_t("BG2"),
                     fg=_t("MUTED")).pack(side="left", padx=(4, 0))

        _sep(self, pady=6, padx=12)

        br = tk.Frame(self, bg=_t("BG2"))
        br.pack(fill="x", padx=12, pady=(0, 12))
        tk.Button(br, text="Create selected", font=FONT_SM, bg=_t("GREEN"), fg="#000000",
                  relief="flat", bd=0, cursor="hand2", activebackground="#6ee7b7",
                  command=self._ok).pack(side="left", ipady=4, ipadx=8)
        tk.Button(br, text="Skip all", font=FONT_SM, bg=_t("BG3"), fg=_t("MUTED"),
                  relief="flat", bd=0, cursor="hand2",
                  command=self._skip).pack(side="left", padx=(8, 0), ipady=4, ipadx=8)
        tk.Button(br, text="Cancel import", font=FONT_SM, bg=_t("RED"), fg="white",
                  relief="flat", bd=0, cursor="hand2", activebackground="#fca5a5",
                  command=self.destroy).pack(side="right", ipady=4, ipadx=8)

        self.update_idletasks()
        self.geometry(
            f"+{parent.winfo_rootx() + parent.winfo_width() // 2 - self.winfo_reqwidth() // 2}"
            f"+{parent.winfo_rooty() + 80}")
        self.wait_window()

    def _ok(self):
        self.result = {n for n, v in self._checks.items() if v.get()}
        self.destroy()

    def _skip(self):
        self.result = set()
        self.destroy()

# ═══════════════════════════════════════════════════════
#  Widgets
# ═══════════════════════════════════════════════════════
class DateField(tk.Frame):
    def __init__(self, parent, label, var, **kw):
        super().__init__(parent, bg=_t("BG2"), **kw)
        mlabel(self, label).pack(fill="x")
        row = tk.Frame(self, bg=_t("BG2"))
        row.pack(fill="x", pady=(3, 0))
        self._var = var
        self._entry = tk.Entry(row, textvariable=var, font=FONT_MONO, bg=_t("BG3"), fg=_t("TEXT"),
                               insertbackground=_t("ORANGE"), relief="flat", bd=0, highlightthickness=1,
                               highlightbackground=_t("BORDER"), highlightcolor=_t("ORANGE"), width=14)
        self._entry.pack(side="left", ipady=5, ipadx=6)
        tk.Button(row, text="\U0001f4c5", font=FONT_SM, bg=_t("BG3"), fg=_t("ORANGE"), relief="flat",
                  bd=0, cursor="hand2", activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
                  highlightthickness=0, command=self._open).pack(side="left", padx=(4, 0), ipady=4, ipadx=4)

    def _open(self):
        init = None
        s = self._var.get().strip()
        if s:
            try:
                init = datetime.strptime(s, "%d-%m-%Y").date()
            except ValueError:
                pass
        CalendarPopup(self._entry, self._cb, initial_date=init)

    def _cb(self, d):
        self._var.set("" if d is None else d.strftime("%d-%m-%Y"))



# ════════════════════════════════════════════════════════════════════════════
#  Selecteur de joueurs multi-selection (Phase 1.2)
# ════════════════════════════════════════════════════════════════════════════
class PlayerSearchWidget(tk.Frame):
    """
    Player system v26 — multi-selection:
    • Saved accounts are the source of truth.
    • Click an account to toggle it. Multiple accounts can be active
      simultaneously — all their kills/deaths are included in the query.
    • The DB list below is only for finding and registering players.
    """

    def __init__(self, parent, on_change=None, **kw):
        super().__init__(parent, bg=_t("BG2"), **kw)
        self._all_players   = []          # [(label, sid, name, last_seen), …] — base DB
        self._filtered      = []
        self._sort_key      = "name"      # "name" | "date"
        self._sort_rev      = False
        self._lb_sid        = ""
        self._lb_name       = ""
        self._lb_label      = ""
        self._saved_players = load_saved_players()
        self._active_sids   = set()       # source of truth (may contain multiple)
        self._active_names  = {}          # {sid: name}
        self._on_change     = on_change
        self._PAGE_SIZE     = 8           # rows visible at once in the DB list
        self._page          = 0           # current page index

        # Enable all saved accounts by default
        for p in self._saved_players:
            self._active_sids.add(p["steam_id"])
            self._active_names[p["steam_id"]] = p["name"]

        sp_frame = tk.LabelFrame(
            self,
            text="  ★ REGISTERED ACCOUNTS — click to enable/disable  ",
            bg=_t("BG2"), fg=_t("ORANGE"), font=FONT_SM_B,
            relief="flat", bd=1, highlightthickness=1,
            highlightbackground=_t("BORDER"), padx=8, pady=6)
        sp_frame.pack(fill="x", pady=(0, 6))

        self._saved_frame = tk.Frame(sp_frame, bg=_t("BG2"))
        self._saved_frame.pack(fill="x")

        self._active_lbl = tk.Label(sp_frame, text="", font=FONT_DESC,
                                     fg=_t("MUTED"), bg=_t("BG2"), anchor="w")
        self._active_lbl.pack(fill="x", pady=(5, 0))

        sp_btns = tk.Frame(sp_frame, bg=_t("BG2"))
        sp_btns.pack(fill="x", pady=(4, 0))
        tk.Button(sp_btns,
                  text="★ Register selection below",
                  font=FONT_DESC, bg=_t("BG3"), fg=_t("GREEN"), relief="flat",
                  cursor="hand2", bd=0, highlightthickness=0,
                  activeforeground=_t("ORANGE"), activebackground=_t("BG3"),
                  command=self._save_lb_selection).pack(side="left")

        self._refresh_saved_display()

        tk.Frame(self, bg=_t("BORDER"), height=1).pack(fill="x", pady=(6, 4))
        tk.Label(self,
                 text="DB SEARCH  —  select then ★ to register",
                 font=FONT_DESC, fg=_t("DESC_COLOR"), bg=_t("BG2"), anchor="w").pack(fill="x")

        sr = tk.Frame(self, bg=_t("BG2"))
        sr.pack(fill="x", pady=(4, 0))
        self._placeholder = "Search by name or Steam ID…"
        self._search_entry = tk.Entry(
            sr, font=FONT_MONO, bg=_t("BG3"), fg=_t("MUTED"),
            insertbackground=_t("ORANGE"), relief="flat", bd=0,
            highlightthickness=1, highlightbackground=_t("BORDER"), highlightcolor=_t("ORANGE"))
        self._search_entry.pack(side="left", fill="x", expand=True, ipady=7, ipadx=8)
        self._search_entry.insert(0, self._placeholder)
        self._search_entry.bind("<FocusIn>",    self._on_search_focus_in)
        self._search_entry.bind("<FocusOut>",   self._on_search_focus_out)
        self._search_entry.bind("<KeyRelease>", self._on_search_key)
        self._count_lbl = tk.Label(sr, text="", font=FONT_DESC, bg=_t("BG2"), fg=_t("MUTED"))
        self._count_lbl.pack(side="right", padx=(6, 0))

        # Sort + page controls
        ctrl_row = tk.Frame(self, bg=_t("BG2"))
        ctrl_row.pack(fill="x", pady=(3, 0))
        mlabel(ctrl_row, "Sort:").pack(side="left")
        self._sort_name_btn = tk.Button(
            ctrl_row, text="Name ↑", font=FONT_DESC, bg=_t("BG3"), fg=_t("ORANGE"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=lambda: self._set_sort("name"))
        self._sort_name_btn.pack(side="left", padx=(4, 0), ipady=2, ipadx=4)
        self._sort_date_btn = tk.Button(
            ctrl_row, text="Date", font=FONT_DESC, bg=_t("BG3"), fg=_t("MUTED"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=lambda: self._set_sort("date"))
        self._sort_date_btn.pack(side="left", padx=(4, 0), ipady=2, ipadx=4)
        add_tip(self._sort_date_btn, "Sort by last match date (most recent first).")

        # Pagination controls (right side of same row)
        # Layout (right-to-left pack): ▶▶  ▶  [entry]  ◀  ◀◀  label
        self._pg_lbl = tk.Label(ctrl_row, text="", font=FONT_DESC, bg=_t("BG2"), fg=_t("MUTED"))
        self._pg_lbl.pack(side="right", padx=(4, 0))

        # Last page
        self._pg_last_btn = tk.Button(
            ctrl_row, text="▶▶", font=FONT_DESC, bg=_t("BG3"), fg=_t("MUTED"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=self._page_last)
        self._pg_last_btn.pack(side="right", padx=(2, 0), ipady=2, ipadx=4)

        # Next page
        self._pg_next_btn = tk.Button(
            ctrl_row, text="▶", font=FONT_DESC, bg=_t("BG3"), fg=_t("MUTED"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=self._page_next)
        self._pg_next_btn.pack(side="right", padx=(2, 0), ipady=2, ipadx=4)

        # Direct page entry
        self._pg_entry_var = tk.StringVar(value="1")
        self._pg_entry = tk.Entry(
            ctrl_row, textvariable=self._pg_entry_var,
            font=FONT_DESC, bg=_t("BG3"), fg=_t("TEXT"),
            insertbackground=_t("ORANGE"), relief="flat", bd=0,
            highlightthickness=1, highlightbackground=_t("BORDER"),
            highlightcolor=_t("ORANGE"), width=3, justify="center")
        self._pg_entry.pack(side="right", padx=(2, 0), ipady=2)
        self._pg_entry.bind("<Return>", self._page_jump)
        self._pg_entry.bind("<FocusOut>", self._page_jump)
        add_tip(self._pg_entry, "Type a page number and press Enter to jump directly.")

        # Previous page
        self._pg_prev_btn = tk.Button(
            ctrl_row, text="◀", font=FONT_DESC, bg=_t("BG3"), fg=_t("MUTED"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=self._page_prev)
        self._pg_prev_btn.pack(side="right", padx=(2, 0), ipady=2, ipadx=4)

        # First page
        self._pg_first_btn = tk.Button(
            ctrl_row, text="◀◀", font=FONT_DESC, bg=_t("BG3"), fg=_t("MUTED"),
            relief="flat", bd=0, cursor="hand2", highlightthickness=0,
            activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
            command=self._page_first)
        self._pg_first_btn.pack(side="right", padx=(2, 0), ipady=2, ipadx=4)

        self._lb = tk.Listbox(
            self, font=FONT_MONO, bg=_t("BG3"), fg=_t("MUTED"),
            selectbackground=_t("BG3"), selectforeground=_t("TEXT"),
            activestyle="none", relief="flat", bd=0,
            highlightthickness=1, highlightbackground=_t("BORDER"),
            height=self._PAGE_SIZE,
            exportselection=False)
        self._lb.pack(fill="x", pady=(4, 0))
        self._lb.bind("<<ListboxSelect>>", self._on_lb_select)

        self._lb_sel_lbl = tk.Label(
            self, text="", font=FONT_DESC, fg=_t("MUTED"), bg=_t("BG2"), anchor="w")
        self._lb_sel_lbl.pack(fill="x", pady=(4, 0))

    def _refresh_saved_display(self):
        for w in self._saved_frame.winfo_children():
            w.destroy()
        if not self._saved_players:
            tk.Label(self._saved_frame,
                     text="No registered account. Search below then ★",
                     font=FONT_DESC, fg=_t("MUTED"), bg=_t("BG2")).pack(anchor="w")
            self._update_active_lbl()
            return
        n = len(self._saved_players)
        for i, p in enumerate(self._saved_players):
            active = p["steam_id"] in self._active_sids
            row_bg = _t("BG3") if active else _t("BG2")
            row = tk.Frame(self._saved_frame, bg=row_bg,
                           highlightthickness=1,
                           highlightbackground=_t("ORANGE") if active else _t("BORDER"))
            row.pack(fill="x", pady=2, ipadx=2, ipady=1)
            # ▲▼ buttons to reorder
            arr = tk.Frame(row, bg=row_bg)
            arr.pack(side="left", padx=(2, 0))
            tk.Button(arr, text="▲", font=FONT_DESC, bg=row_bg, fg=_t("MUTED"),
                      relief="flat", bd=0, cursor="hand2",
                      activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
                      state="normal" if i > 0 else "disabled",
                      command=lambda idx=i: self._move_saved(idx, -1)
                      ).pack(side="top", pady=(0, 1))
            tk.Button(arr, text="▼", font=FONT_DESC, bg=row_bg, fg=_t("MUTED"),
                      relief="flat", bd=0, cursor="hand2",
                      activebackground=_t("BORDER"), activeforeground=_t("ORANGE"),
                      state="normal" if i < n - 1 else "disabled",
                      command=lambda idx=i: self._move_saved(idx, +1)
                      ).pack(side="top")
            prefix = "✓  " if active else "○  "
            tk.Button(
                row,
                text=f"{prefix}{p['name']}  ({p['steam_id']})",
                font=FONT_SM_B if active else FONT_SM,
                bg=row_bg, fg=_t("ORANGE") if active else _t("TEXT"),
                relief="flat", cursor="hand2", bd=0, anchor="w",
                activebackground=_t("BG3"), activeforeground=_t("ORANGE"),
                command=lambda pp=p: self._toggle_saved(pp)
            ).pack(side="left", fill="x", expand=True, ipady=4, ipadx=6)
            tk.Button(
                row, text="✕", font=FONT_DESC,
                bg=row_bg, fg=_t("RED"), relief="flat", bd=0, cursor="hand2",
                activebackground=_t("BORDER"), activeforeground=_t("RED"),
                command=lambda idx=i: self._remove_saved(idx)
            ).pack(side="right", padx=(4, 2))
        self._update_active_lbl()

    def _update_active_lbl(self):
        n = len(self._active_sids)
        if n == 0:
            text = "⚠  No active account — check a player above."
            fg   = _t("RED")
        elif n == 1:
            sid  = next(iter(self._active_sids))
            name = self._active_names.get(sid, sid)
            text = f"Active: {name}  ({sid})"
            fg   = _t("GREEN")
        else:
            names = ", ".join(self._active_names.get(s, s) for s in sorted(self._active_sids))
            text  = f"{n} active: {names}"
            fg    = _t("GREEN")

        self._active_lbl.config(text=text, fg=fg)

        # Header : forme HUD bracketee compacte [PLAYER:NAME] / [PLAYERS:N].
        if n == 0:
            hud = ""
        elif n == 1:
            hud = f"[PLAYER:{self._active_names.get(next(iter(self._active_sids)), '').upper()}]"
        else:
            hud = f"[PLAYERS:{n}]"
        try:
            app = self.winfo_toplevel()
            app._hdr_player_lbl.config(text=hud, fg=fg)
        except tk.TclError:
            pass

    def _toggle_saved(self, p):
        sid = p["steam_id"]
        if sid in self._active_sids:
            self._active_sids.discard(sid)
        else:
            self._active_sids.add(sid)
            self._active_names[sid] = p["name"]
        self._refresh_saved_display()
        if self._on_change:
            self._on_change(p["name"], sid)

    def _save_lb_selection(self):
        if not self._lb_sid:
            messagebox.showinfo("Players",
                "Select a player from the search list first.")
            return
        for p in self._saved_players:
            if p["steam_id"] == self._lb_sid:
                messagebox.showinfo("Players", "This player is already registered.")
                return
        self._saved_players.append({
            "steam_id": self._lb_sid,
            "name":     self._lb_name,
            "label":    self._lb_label,
        })
        save_saved_players(self._saved_players)
        # Auto-activate if it's the first
        if len(self._saved_players) == 1:
            self._active_sids.add(self._lb_sid)
            self._active_names[self._lb_sid] = self._lb_name
            if self._on_change:
                self._on_change(self._lb_name, self._lb_sid)
        self._refresh_saved_display()

    def _remove_saved(self, idx):
        if not (0 <= idx < len(self._saved_players)):
            return
        removed_sid = self._saved_players[idx]["steam_id"]
        self._saved_players.pop(idx)
        save_saved_players(self._saved_players)
        self._active_sids.discard(removed_sid)
        self._active_names.pop(removed_sid, None)
        self._refresh_saved_display()
        if self._on_change:
            self._on_change("", removed_sid)

    def _move_saved(self, idx, direction):
        new_idx = idx + direction
        if not (0 <= new_idx < len(self._saved_players)):
            return
        lst = self._saved_players
        lst[idx], lst[new_idx] = lst[new_idx], lst[idx]
        save_saved_players(lst)
        self._refresh_saved_display()

    def _is_placeholder(self):
        return self._search_entry.cget("fg") == _t("MUTED")

    def _on_search_focus_in(self, *_):
        if self._is_placeholder():
            self._search_entry.delete(0, "end")
            self._search_entry.config(fg=_t("TEXT"))

    def _on_search_focus_out(self, *_):
        if self._search_entry.get().strip() == "":
            self._search_entry.delete(0, "end")
            self._search_entry.insert(0, self._placeholder)
            self._search_entry.config(fg=_t("MUTED"))

    def _on_search_key(self, *_):
        q = "" if self._is_placeholder() else self._search_entry.get()
        self._refresh(q)

    def set_players(self, data, restore_steam_id=""):
        # data: [(label, sid, name, last_seen), ...] — last_seen may be None
        self._all_players = data
        self._refresh("")
        self._count_lbl.config(text=f"{len(data)} players")
        if restore_steam_id:
            for p in self._saved_players:
                if p["steam_id"] == restore_steam_id:
                    if restore_steam_id not in self._active_sids:
                        self._active_sids.add(restore_steam_id)
                        self._active_names[restore_steam_id] = p["name"]
                    self._refresh_saved_display()
                    return

    def _set_sort(self, key):
        if self._sort_key == key:
            self._sort_rev = not self._sort_rev
        else:
            self._sort_key = key
            self._sort_rev = (key == "date")  # date defaults to newest first
        self._update_sort_buttons()
        q = "" if self._is_placeholder() else self._search_entry.get()
        self._refresh(q)

    def _update_sort_buttons(self):
        arrow = "↓" if self._sort_rev else "↑"
        try:
            self._sort_name_btn.config(
                text=f"Name {arrow if self._sort_key == 'name' else ''}".strip(),
                fg=_t("ORANGE") if self._sort_key == "name" else _t("MUTED"))
            self._sort_date_btn.config(
                text=f"Date {arrow if self._sort_key == 'date' else ''}".strip(),
                fg=_t("ORANGE") if self._sort_key == "date" else _t("MUTED"))
        except tk.TclError:
            pass

    def _refresh(self, query=""):
        q = query.strip().lower()
        self._filtered = []

        def _last_seen(entry):
            last = entry[3] if len(entry) > 3 else None
            if last is None:
                return 0
            try:
                if hasattr(last, "timestamp"):
                    return last.timestamp()
                if isinstance(last, (int, float)):
                    v = int(last)
                    return v / 1000 if v > 4_000_000_000 else v
                s = str(last).strip()
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                    try:
                        return datetime.strptime(s[:len(fmt)], fmt).timestamp()
                    except ValueError:
                        continue
            except (ValueError, TypeError, OverflowError, OSError):
                pass
            return 0

        candidates = [
            e for e in self._all_players
            if not q or q in e[0].lower() or q in e[1].lower()
        ]

        if self._sort_key == "date":
            candidates.sort(key=_last_seen, reverse=self._sort_rev)
        else:
            candidates.sort(key=lambda e: e[2].lower(), reverse=self._sort_rev)

        self._filtered = candidates
        self._page = 0
        self._render_page()

    def _page_count(self):
        return max(1, (len(self._filtered) + self._PAGE_SIZE - 1) // self._PAGE_SIZE)

    def _render_page(self):
        """Repopulate the listbox with the current page of _filtered."""
        ps = self._PAGE_SIZE
        total = len(self._filtered)
        n_pages = self._page_count()
        self._page = max(0, min(self._page, n_pages - 1))
        start = self._page * ps
        page_entries = self._filtered[start:start + ps]

        self._lb.delete(0, "end")
        for entry in page_entries:
            self._lb.insert("end", entry[0])

        # Update pagination controls
        if total == 0:
            pg_txt = "0 results"
        elif n_pages == 1:
            pg_txt = f"{total} player{'s' if total != 1 else ''}"
        else:
            pg_txt = f"/ {n_pages}  ({total})"
        try:
            self._pg_lbl.config(text=pg_txt)
            # Sync the page entry box (avoid triggering FocusOut → _page_jump loop)
            self._pg_entry_var.set(str(self._page + 1))
            at_first = self._page == 0
            at_last  = self._page >= n_pages - 1
            for btn, disabled in [
                (self._pg_first_btn, at_first),
                (self._pg_prev_btn,  at_first),
                (self._pg_next_btn,  at_last),
                (self._pg_last_btn,  at_last),
            ]:
                btn.config(
                    fg=_t("MUTED") if disabled else _t("ORANGE"),
                    state="disabled" if disabled else "normal")
        except tk.TclError:
            pass

    def _page_first(self):
        self._page = 0
        self._render_page()

    def _page_prev(self):
        if self._page > 0:
            self._page -= 1
            self._render_page()

    def _page_next(self):
        if self._page < self._page_count() - 1:
            self._page += 1
            self._render_page()

    def _page_last(self):
        self._page = self._page_count() - 1
        self._render_page()

    def _page_jump(self, *_):
        """Jump to the page number typed in the entry field."""
        try:
            target = int(self._pg_entry_var.get().strip()) - 1
            self._page = max(0, min(target, self._page_count() - 1))
            self._render_page()
        except ValueError:
            self._render_page()

    def _on_lb_select(self, *_):
        sel = self._lb.curselection()
        if not sel:
            return
        abs_idx = self._page * self._PAGE_SIZE + sel[0]
        if abs_idx >= len(self._filtered):
            return
        entry = self._filtered[abs_idx]
        label, sid, name = entry[0], entry[1], entry[2]
        self._lb_label, self._lb_sid, self._lb_name = label, sid, name
        self._lb_sel_lbl.config(
            text=f"Selected: {name}  ({sid})  ← ★ to register",
            fg=_t("YELLOW"))

    def get_steam_ids(self):
        return list(self._active_sids)

    def get_steam_id(self):
        if not self._active_sids:
            return ""
        # Priority: registration order
        for p in self._saved_players:
            if p["steam_id"] in self._active_sids:
                return p["steam_id"]
        return next(iter(self._active_sids))

    def get_name(self):
        sid = self.get_steam_id()
        return self._active_names.get(sid, "")

    def get_label(self):
        sid = self.get_steam_id()
        for p in self._saved_players:
            if p["steam_id"] == sid:
                return p.get("label", f"{p['name']}  ({sid})")
        return f"{self._active_names.get(sid, '')}  ({sid})" if sid else ""
