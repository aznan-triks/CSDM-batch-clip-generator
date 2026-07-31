"""The PostgreSQL identifiers must be live, not copied at three chosen moments.

Regression found reviewing v211 and left in `IMPROVEMENT_SUGGESTIONS.md`:
`_pg`/`_pg_fresh` moved into `EngineMixin` and read `self._pg_params`, a plain
dict the window refilled in exactly three places -- the end of `__init__`,
`_collect_config()` and `_connect_and_load()`. None of the twelve `_pg_fresh()`
call sites (tags, players, maps...) was one of them. `_collect_config` runs from
`_auto_save()` every five seconds, so the staleness window was bounded, but it
was real: changing a host or a password and acting within that second opened
the connection on the old value. Before the chantier 1.5 refactor the read was
always live.

The fix is a Tk trace, so the dict cannot be stale by construction. These tests
use a stand-in for `App` rather than a real window: `App.__init__` builds the
entire interface, and none of that is what is under test here.
"""
import tkinter
import unittest

from csdm.engine.core import PG_PARAM_KEYS


class _Window:
    """The three lines of `App` this behaviour actually needs."""

    _sync_pg_params = None  # bound below from the real implementation
    _watch_pg_params = None

    def __init__(self, root):
        self.v = {key: tkinter.StringVar(master=root, value="") for key in PG_PARAM_KEYS}
        self._pg_params = {}


def _borrow_methods():
    """Take the two methods off `App` without constructing one.

    Importing the entry point is enough to reach them; building an `App` would
    open a window and connect to a database.
    """
    import csdm_batch_clips_generator as app_module

    _Window._sync_pg_params = app_module.App._sync_pg_params
    _Window._watch_pg_params = app_module.App._watch_pg_params


class TestPgParamsStayLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.root = tkinter.Tk()
        except tkinter.TclError as exc:  # no display: nothing to trace
            raise unittest.SkipTest(f"no Tk display: {exc}")
        cls.root.withdraw()
        _borrow_methods()

    @classmethod
    def tearDownClass(cls):
        cls.root.destroy()

    def setUp(self):
        self.window = _Window(self.root)

    def test_the_first_fill_happens_when_watching_starts(self):
        self.window.v["pg_host"].set("localhost")
        self.window._watch_pg_params()
        self.assertEqual(self.window._pg_params["pg_host"], "localhost")

    def test_every_identifier_is_watched(self):
        self.window._watch_pg_params()
        for key in PG_PARAM_KEYS:
            with self.subTest(key=key):
                self.window.v[key].set(f"new-{key}")
                self.assertEqual(
                    self.window._pg_params[key],
                    f"new-{key}",
                    f"{key} was written and `_pg_params` did not follow",
                )

    def test_a_password_change_is_visible_immediately(self):
        # The exact scenario the regression note describes: change it, then act
        # within the second, with no `_collect_config` in between.
        self.window._watch_pg_params()
        self.window.v["pg_pass"].set("first")
        self.assertEqual(self.window._pg_params["pg_pass"], "first")
        self.window.v["pg_pass"].set("second")
        self.assertEqual(self.window._pg_params["pg_pass"], "second")

    def test_it_takes_tk_s_three_trace_arguments_without_complaint(self):
        # Tk calls a write trace with (name, index, mode); a signature that
        # refuses them raises inside the callback, where nothing catches it.
        self.window._watch_pg_params()
        self.window._sync_pg_params("PY_VAR0", "", "w")

    def test_writing_the_dict_writes_no_variable_back(self):
        # `_apply_config` sets these variables; if syncing wrote a variable in
        # turn, that would be an infinite trace loop.
        self.window._watch_pg_params()
        seen = []
        self.window.v["pg_db"].trace_add("write", lambda *a: seen.append(1))
        self.window.v["pg_host"].set("h")
        self.assertEqual(seen, [], "syncing wrote another identifier back")


if __name__ == "__main__":
    unittest.main()
