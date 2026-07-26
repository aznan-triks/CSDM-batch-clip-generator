"""The three sockets the engine knows about.

The engine never imports Tkinter and never talks to Electron. It calls these
three callables, injected by whoever starts it:

    log(message, level)          engine -> UI, continuous stream
    state(name, payload)         engine -> UI, typed state change
    ask(kind, message, options)  round trip, BLOCKS until the UI answers

Tkinter wires them to widgets; Electron will wire them to the JSON pipe.

`log_parts` is the segmented form of `log`: a single multicolor log line made
of several (text, level) runs, instead of one message with one level. It is
still the `log` socket, not a fourth one — Tkinter renders it as a
multicolor line today, and it is already a plain list of tuples, so
chantier 2's JSON transport can serialize it as-is with no extra shape work.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass(frozen=True)
class EnginePorts:
    """Container for the three sockets. Frozen: an engine never rewires itself."""
    log: Callable[..., None]
    state: Callable[..., None]
    ask: Callable[[str, str, list], Optional[str]]
    log_parts: Optional[Callable[[list], None]] = None


@dataclass
class CollectingPorts:
    """Test double: records every call, answers `ask` from a preloaded queue."""
    answers: list = field(default_factory=list)
    logs: list = field(default_factory=list)
    states: list = field(default_factory=list)
    asks: list = field(default_factory=list)
    log_parts_calls: list = field(default_factory=list)

    def log(self, message, level=""):
        self.logs.append((message, level))

    def log_parts(self, parts):
        self.log_parts_calls.append(list(parts))

    def state(self, name, payload=None):
        self.states.append((name, payload or {}))

    def ask(self, kind, message, options):
        self.asks.append((kind, message, list(options)))
        return self.answers.pop(0) if self.answers else None

    def as_ports(self):
        return EnginePorts(log=self.log, state=self.state, ask=self.ask,
                           log_parts=self.log_parts)
