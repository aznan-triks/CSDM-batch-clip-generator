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
from tkinter import ttk

from csdm.theme import _t

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
