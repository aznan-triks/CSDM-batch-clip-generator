"""The flat Kills/Deaths/Rounds list and the old TK choice, in the engine's 2-axis words.

One mapping for the config migration AND the Tkinter window, which still shows
the flat model (spec review of fix C, 2026-09-15): without it the window's
choices never reached the query.
"""
from types import SimpleNamespace

from csdm.config import legacy_event_axes


def test_kills_is_the_actor_perspective():
    assert legacy_event_axes(["Kills"], "include") == {
        "event_actor": True, "event_target": False, "event_lethal": True,
        "event_ally": True, "event_enemy": True}


def test_deaths_turns_the_target_perspective_on():
    axes = legacy_event_axes(["Deaths"], "include")
    assert (axes["event_actor"], axes["event_target"], axes["event_lethal"]) == (True, True, True)


def test_rounds_alone_asks_for_no_perspective():
    axes = legacy_event_axes(["Rounds"], "include")
    assert (axes["event_actor"], axes["event_target"], axes["event_lethal"]) == (False, False, False)


def test_the_tk_choice_becomes_the_team_sides():
    exclude = legacy_event_axes(["Kills"], "exclude")
    only = legacy_event_axes(["Kills"], "only")
    assert (exclude["event_ally"], exclude["event_enemy"]) == (False, True)
    assert (only["event_ally"], only["event_enemy"]) == (True, False)


def test_an_unknown_tk_choice_leaves_the_ally_side_alone():
    axes = legacy_event_axes(["Kills"], "bogus")
    assert "event_ally" not in axes
    assert axes["event_enemy"] is True


class _Var:
    def __init__(self, value):
        self._value = value

    def get(self):
        return self._value


class _Window:
    """Just what `App._collect_config` reads, no Tk."""

    def __init__(self, events, tk_mode):
        self.v = {"teamkills_mode": _Var(tk_mode), "encoder": _Var("FFmpeg"),
                  "recsys": _Var("HLAE")}
        self.sel_events = {e: _Var(e in events) for e in ("Kills", "Deaths", "Rounds")}
        self.sel_weapons = {}
        self._map_filter_vars = {}
        self.player_search = SimpleNamespace(get_steam_ids=lambda: ["1"],
                                             get_steam_id=lambda: "1", get_name=lambda: "p")

    def _get_active_tag_names(self):
        return []

    @staticmethod
    def _normalize_recsys(value):
        return value


def test_the_tkinter_window_hands_its_choices_to_the_engine():
    from csdm_batch_clips_generator import App
    cfg = App._collect_config(_Window(["Kills", "Deaths"], "only"))
    assert (cfg["event_actor"], cfg["event_target"], cfg["event_lethal"]) == (True, True, True)
    assert (cfg["event_ally"], cfg["event_enemy"]) == (True, False)
