"""Run and preview must be validatable with no window."""
import itertools

from csdm.engine.core import EngineMixin


class Host(EngineMixin):
    """A host with the one socket validation uses, and nothing else."""

    def __init__(self):
        self.asked = []

    def ask(self, kind, message, options):
        self.asked.append((kind, message, options))
        return None


def test_event_flags_cover_all_eight_combinations():
    names = ["Kills", "Deaths", "Rounds"]
    for wanted in itertools.chain.from_iterable(
            itertools.combinations(names, n) for n in range(4)):
        flags = EngineMixin.derive_event_flags({"events": list(wanted)})
        assert flags == {
            "events_kills": "Kills" in wanted,
            "events_deaths": "Deaths" in wanted,
            "events_rounds": "Rounds" in wanted,
        }, wanted


def test_event_flags_treat_a_missing_events_key_as_none_selected():
    assert EngineMixin.derive_event_flags({}) == {
        "events_kills": False, "events_deaths": False, "events_rounds": False,
    }


def test_build_run_cfg_adds_the_flags_without_touching_the_caller():
    cfg = {"events": ["Kills"], "crf": 18}
    built = Host().build_run_cfg(cfg)
    assert built["events_kills"] is True
    assert built["crf"] == 18
    assert "events_kills" not in cfg, "the caller's dict must not be mutated"


def test_validation_refuses_a_run_with_no_account():
    host = Host()
    assert host.validate_run_inputs({"steam_ids": [], "events": ["Kills"]}) is False
    assert host.asked[0][0] == "error"
    assert "account" in host.asked[0][1]


def test_validation_refuses_a_run_with_no_event():
    host = Host()
    assert host.validate_run_inputs({"steam_ids": ["76561198"], "events": []}) is False
    assert "event" in host.asked[0][1]


def test_validation_accepts_a_usable_configuration():
    host = Host()
    assert host.validate_run_inputs({"steam_ids": ["76561198"], "events": ["Kills"]}) is True
    assert host.asked == []
