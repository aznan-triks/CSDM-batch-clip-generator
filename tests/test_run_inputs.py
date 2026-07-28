"""Run and preview must be validatable with no window."""
import itertools
import threading

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


class RecordingHost(Host):
    """A host that records what a launch does, without letting a thread run."""

    def __init__(self):
        super().__init__()
        self.logged = []
        self.states = []
        self.workers = []
        self._previewing = False
        self._running = False
        # RecordingHost does not inherit EngineStateMixin, so the flag the real
        # host gets from ENGINE_STATE_DEFAULTS has to be supplied here.
        self._preview_cancel = threading.Event()

    def log(self, message, level="info"):
        self.logged.append((message, level))

    def state(self, name, payload=None):
        self.states.append((name, payload or {}))


def _no_threads(monkeypatch, host):
    """Capture the worker call instead of starting a thread."""
    import threading as _t

    class FakeThread:
        def __init__(self, target=None, args=(), daemon=None):
            host.workers.append((target, args))

        def start(self):
            pass

    monkeypatch.setattr(_t, "Thread", FakeThread)


VALID = {"steam_ids": ["76561198"], "events": ["Kills"]}


def test_start_run_refuses_and_starts_nothing_when_inputs_are_bad(monkeypatch):
    host = RecordingHost()
    _no_threads(monkeypatch, host)
    assert host.start_run({"steam_ids": [], "events": ["Kills"]}) is False
    assert host.workers == []
    assert host._running is False


def test_start_run_arms_the_run_state_and_hands_cfg_to_the_worker(monkeypatch):
    host = RecordingHost()
    _no_threads(monkeypatch, host)
    assert host.start_run(dict(VALID)) is True

    assert host._running is True
    assert host._stop_after_current is False
    assert host._kill_triggered is False
    assert host._tagged_this_batch == []
    assert len(host.workers) == 1
    target, args = host.workers[0]
    assert target == host._worker
    assert args[0]["events"] == ["Kills"]


def test_start_run_disables_run_and_enables_stop_and_kill(monkeypatch):
    host = RecordingHost()
    _no_threads(monkeypatch, host)
    host.start_run(dict(VALID))
    buttons = [p for n, p in host.states if n == "buttons"]
    assert buttons == [{"run": False, "stop": True, "kill": True}]


def test_start_preview_arms_preview_and_clears_the_cancel_flag(monkeypatch):
    host = RecordingHost()
    _no_threads(monkeypatch, host)
    host._preview_cancel.set()
    assert host.start_preview(dict(VALID)) is True

    assert host._previewing is True
    assert host._preview_cancel.is_set() is False
    assert host.workers[0][0] == host._preview_worker


def test_start_preview_labels_the_stop_button_for_a_preview(monkeypatch):
    host = RecordingHost()
    _no_threads(monkeypatch, host)
    host.start_preview(dict(VALID))
    buttons = [p for n, p in host.states if n == "buttons"]
    assert buttons == [{"stop": True, "stop_label": "⏸ Stop Preview"}]
