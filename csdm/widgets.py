"""Composants Tkinter reutilisables (Phase 1.2 — extraction des widgets).

ScrollableFrame et WrapRow, deplaces depuis le fichier principal. Ils lisent
les couleurs via l'accesseur partage _t() de csdm/theme.py (jamais des
globales), ce qui permet de vivre dans un module separe sans casser la mise
a jour du theme.

Les deux registres ci-dessous listent les instances VIVANTES ; les handlers
globaux de App (molette, redimensionnement) iterent dessus. Ce sont les memes
objets que ceux importes par le fichier principal.
"""
import tkinter as tk
from tkinter import ttk, filedialog

from csdm.theme import _t
from csdm.ui_kit import (
    FONT_MONO, FONT_SM, FONT_DESC,
    UI_SEC_PADX, UI_SEC_PADY, UI_SEC_GAP,
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
    """Muted-colour small label for field names and secondary text."""
    return tk.Label(parent, text=text, font=FONT_SM, fg=_t("MUTED"), bg=_t("BG2"), **kw)

def flabel(parent, text, **kw):
    """Filter name label — slightly brighter than mlabel to distinguish filter names."""
    return tk.Label(parent, text=text, font=FONT_SM, fg=_t("TEXT"), bg=_t("BG2"), **kw)

def slabel(parent, text, **kw):
    """Subcategory section header label — accent-coloured to visually separate sections."""
    return tk.Label(parent, text=text, font=(FONT_SM[0], FONT_SM[1], "bold"),
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
                except Exception:
                    pass
                return
        except Exception:
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
    """Return a muted descriptive Label with automatic wraplength binding."""
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
        tk.Label(tw, text=self._text, font=("Consolas", 8), fg=_t("TEXT"),
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
        # _wrapper holds the header + this body frame
        self._wrapper = tk.Frame(parent, bg=_t("BG"), bd=0)

        # ── Header ────────────────────────────────────────────────────────────
        self._hdr = tk.Frame(self._wrapper, bg=_t("BG2"), cursor="hand2")
        self._hdr.pack(fill="x")

        self._stripe = tk.Frame(self._hdr, width=3, bg=_t("ORANGE"))
        self._stripe.pack(side="left", fill="y")

        self._arrow = tk.Label(self._hdr, text="▾",
                               font=("Consolas", 9, "bold"),
                               bg=_t("BG2"), fg=_t("ORANGE"),
                               padx=UI_SEC_PADX // 2, pady=5)
        self._arrow.pack(side="left")

        self._title_lbl = tk.Label(self._hdr, text=title.upper(),
                                   font=("Consolas", 9, "bold"),
                                   bg=_t("BG2"), fg=_t("ORANGE"),
                                   anchor="w", pady=5)
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
        self._arrow.config(text="▸")
        self._sep.pack_forget()
        tk.Frame.pack_forget(self)

    def _expand_now(self):
        self._open = True
        self._arrow.config(text="▾")
        self._sep.pack(fill="x")
        tk.Frame.pack(self, fill="x")

    # ── Theme update ──────────────────────────────────────────────────────────

    def apply_theme(self):
        try: self._wrapper.config(bg=_t("BG"))
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
