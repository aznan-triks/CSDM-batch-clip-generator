"""An empty result must never be silent (audit finalisation 2026-09-25, axis A).

Two halves: settings that can only ever give zero results are refused before
anything runs (`run_inputs_problem`), and a query that legitimately returns
nothing says which stage removed the last event (`explain_empty_result`).
"""
import pytest

from csdm.engine.core import EngineMixin

# A current (2-axis) config: one account, the Actor perspective.
ACCOUNT = {"steam_ids": ["76561198000000000"], "event_actor": True}


def problem(**settings):
    return EngineMixin.run_inputs_problem({**ACCOUNT, **settings})


# ── certain-zero combinations are refused, naming the setting ────────────────

def test_both_teams_unticked_is_refused_and_names_ally_and_enemy():
    msg = problem(event_ally=False, event_enemy=False)
    assert msg and "Ally" in msg and "Enemy" in msg


def test_both_teams_unticked_still_runs_when_rounds_is_on():
    # Rounds are not filtered by team: they still produce clips.
    assert problem(event_ally=False, event_enemy=False, events=["Rounds"]) is None


def test_both_teams_unticked_still_runs_when_shots_are_on():
    assert problem(event_ally=False, event_enemy=False, event_other=True) is None


def test_no_event_type_is_refused():
    msg = problem(event_lethal=False, event_non_lethal=False, event_other=False)
    assert msg and "event type" in msg.lower()


def test_no_perspective_is_refused_even_with_a_legacy_kills_entry():
    # The old check accepted any non-empty `events` list, "Kills" included.
    msg = problem(event_actor=False, event_target=False, events=["Kills"])
    assert msg and "perspective" in msg


def test_a_legacy_config_still_names_its_perspective_through_events():
    legacy = {"steam_ids": ["76561198000000000"]}
    assert EngineMixin.run_inputs_problem({**legacy, "events": ["Kills"]}) is None
    assert "perspective" in EngineMixin.run_inputs_problem(legacy)


def test_shots_without_actor_are_refused():
    msg = problem(event_actor=False, event_target=True, event_lethal=False,
                  event_other=True)
    assert msg and "Actor" in msg


def test_team_damage_without_ally_is_refused_when_damage_is_the_only_source():
    msg = problem(event_lethal=False, event_non_lethal=True, dmg_mod_team_damage=True,
                  event_ally=False, event_enemy=True)
    assert msg and "TEAM DAMAGE" in msg and "Ally" in msg


def test_team_damage_without_ally_is_not_refused_while_kills_can_still_come():
    assert problem(event_lethal=True, event_non_lethal=True, dmg_mod_team_damage=True,
                   event_ally=False, event_enemy=True) is None


def test_team_damage_with_ally_runs():
    assert problem(event_lethal=False, event_non_lethal=True, dmg_mod_team_damage=True,
                   event_ally=True) is None


def test_optional_team_damage_next_to_a_live_damage_filter_runs():
    assert problem(event_lethal=False, event_non_lethal=True, event_ally=False,
                   dmg_mod_team_damage=True, dmg_mod_big_hit=True) is None


def test_required_team_damage_next_to_a_live_damage_filter_is_refused():
    assert problem(event_lethal=False, event_non_lethal=True, event_ally=False,
                   dmg_mod_team_damage=True, dmg_mod_team_damage_req=True,
                   dmg_mod_big_hit=True)


@pytest.mark.parametrize("date_from,date_to", [
    ("25-09-2026", "01-01-2026"),
    ("2026-09-25", "2026-01-01"),
])
def test_inverted_date_range_is_refused_naming_both_dates(date_from, date_to):
    msg = problem(date_from=date_from, date_to=date_to)
    assert msg and date_from in msg and date_to in msg


def test_same_day_range_is_accepted():
    assert problem(date_from="25-09-2026", date_to="25-09-2026") is None


def test_default_settings_are_accepted():
    assert problem() is None


def test_the_users_real_combination_is_refused_before_querying():
    """The reported bug: MAG-7, both teams unticked -> silent zero."""
    msg = problem(event_actor=True, event_lethal=True, event_ally=False,
                  event_enemy=False, weapons=["MAG-7"], events=["Kills"],
                  date_from="29-03-2026", date_to="25-09-2026")
    assert msg and "Ally" in msg


def test_refusal_travels_to_the_user_through_ask():
    class Host(EngineMixin):
        def __init__(self):
            self.asked = []

        def ask(self, kind, message, options):
            self.asked.append((kind, message))

    host = Host()
    assert host.validate_run_inputs({**ACCOUNT, "event_ally": False,
                                     "event_enemy": False}) is False
    assert host.asked[0][0] == "error" and "Ally" in host.asked[0][1]


# ── a legitimately empty result says which stage emptied it ──────────────────

class FunnelHost(EngineMixin):
    """Engine host whose database is a rule: each active filter shrinks it."""

    def __init__(self, rules):
        self.rules = rules          # [(predicate(cfg), events left)]
        self.queries = 0
        self.logged, self.states = [], []

    def log(self, message, level="info"):
        self.logged.append((message, level))

    def state(self, name, payload=None):
        self.states.append((name, payload))

    def _query_events(self, cfg):
        self.queries += 1
        n = 100
        for applies, left in self.rules:
            if applies(cfg):
                n = min(n, left)
        return {"demo.dem": [{"tick": i, "type": "kill"} for i in range(n)]} if n else {}


USER = {**ACCOUNT, "event_ally": False, "event_enemy": True, "weapons": ["MAG-7"],
        "date_from": "29-03-2026", "date_to": "25-09-2026",
        "match_type_filter_enabled": False, "map_filter_enabled": False,
        "headshots_mode": "all", "suicides_mode": "include", "clutch_enabled": False}


def test_funnel_names_the_stage_that_removed_the_last_event():
    host = FunnelHost([(lambda c: bool(c.get("date_from")), 41),
                       (lambda c: bool(c.get("weapons")), 0)])
    reason = host.explain_empty_result(USER, [("database query", 0)])

    assert [s["count"] for s in reason["stages"]] == [100, 41, 41, 0]
    assert "29-03-2026" in reason["stages"][1]["label"]
    assert reason["stages"][-1]["label"] == "Weapon Filter"
    assert "Weapon Filter" in reason["headline"] and "41" in reason["headline"]
    assert "Weapon Filter" in reason["hint"]


def test_funnel_skips_stages_that_are_already_off():
    host = FunnelHost([(lambda c: bool(c.get("weapons")), 0)])
    host.explain_empty_result(USER, [("database query", 0)])
    # base, date, Ally / Enemy, weapons -- headshots, suicides, match types,
    # maps, filters and clutch are off and cost nothing.
    assert host.queries == 4


def test_funnel_says_when_the_player_has_no_event_at_all():
    host = FunnelHost([(lambda c: True, 0)])
    reason = host.explain_empty_result(USER, [("database query", 0)])
    assert len(reason["stages"]) == 1 and host.queries == 1
    assert "player" in reason["headline"] and "event types" in reason["hint"]


def test_funnel_reuses_the_callers_counts_when_the_query_found_events():
    host = FunnelHost([])
    reason = host.explain_empty_result(USER, [("database query", 12),
                                             ("Kill Filters checked in the demo files", 0),
                                             ("★ Must / optional filter rules", 0)])
    assert host.queries == 0
    assert [s["count"] for s in reason["stages"]] == [12, 0]
    assert "Kill Filters" in reason["headline"]


def test_funnel_is_logged_and_raised_as_the_summary():
    host = FunnelHost([(lambda c: bool(c.get("weapons")), 0)])
    reason = host.explain_empty_result(USER, [("database query", 0)])
    assert ("summary", {"text": reason["headline"], "level": "muted"}) in host.states
    assert any("Weapon Filter" in m for m, _ in host.logged)


def test_funnel_never_blames_nothing_when_every_stage_alone_keeps_events():
    host = FunnelHost([])            # never runs dry stage by stage
    reason = host.explain_empty_result(USER, [("database query", 0)])
    assert reason["stages"][-1]["count"] == 0
    assert reason["stages"][-1]["label"] == EngineMixin._EMPTY_RESULT_REST_LABEL


class PreviewHost(FunnelHost):
    """Runs `_preview_worker` inline with the demo-analysis stages stubbed."""

    def __init__(self, rules):
        super().__init__(rules)
        import threading
        self._preview_cancel = threading.Event()
        self._previewing = True

    def _preparse_dp2(self, cfg, paths):
        pass

    def _apply_dp2_filters_to_events(self, evts, cfg):
        return evts

    def _apply_global_filter_gate_dict(self, evts, cfg):
        return evts

    def _effective_before(self, cfg):
        return 1

    def _build_sequences(self, events, tickrate, before, after):
        return [{"start_tick": 0, "end_tick": 1, "events": events}]


def _ready(host):
    return next(p for n, p in host.states if n == "preview_ready")


def test_empty_preview_carries_its_reason_to_the_interface():
    host = PreviewHost([(lambda c: bool(c.get("weapons")), 0)])
    host._preview_worker(host.build_run_cfg({**USER, "tickrate": 64, "after": 1}))
    reason = _ready(host)["empty_reason"]
    assert reason and reason["stages"][-1]["label"] == "Weapon Filter"


def test_a_preview_with_clips_carries_no_reason():
    host = PreviewHost([])
    host._preview_worker(host.build_run_cfg({**USER, "tickrate": 64, "after": 1}))
    assert _ready(host)["empty_reason"] is None
