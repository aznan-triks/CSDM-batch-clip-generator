"""The three sockets the engine knows about.

The engine never imports Tkinter and never talks to Electron. It calls these
three callables, injected by whoever starts it:

    log(message, level)          engine -> UI, continuous stream
    state(name, payload)         engine -> UI, typed state change
    ask(kind, message, options)  round trip, BLOCKS until the UI answers

Tkinter wires them to widgets; Electron will wire them to the JSON pipe.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass(frozen=True)
class EnginePorts:
    """Container for the three sockets. Frozen: an engine never rewires itself."""
    log: Callable[..., None]
    state: Callable[..., None]
    ask: Callable[[str, str, list], Optional[str]]


@dataclass
class CollectingPorts:
    """Test double: records every call, answers `ask` from a preloaded queue."""
    answers: list = field(default_factory=list)
    logs: list = field(default_factory=list)
    states: list = field(default_factory=list)
    asks: list = field(default_factory=list)

    def log(self, message, level=""):
        self.logs.append((message, level))

    def state(self, name, payload=None):
        self.states.append((name, payload or {}))

    def ask(self, kind, message, options):
        self.asks.append((kind, message, list(options)))
        return self.answers.pop(0) if self.answers else None

    def as_ports(self):
        return EnginePorts(log=self.log, state=self.state, ask=self.ask)
