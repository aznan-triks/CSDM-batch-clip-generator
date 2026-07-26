"""The state an engine host must provide.

`EngineMixin` reads these attributes but never creates them. Under Tkinter they
were set in `App.__init__`; a host without a window has no `App`, so the contract
lives here instead — one place, checked by a test.
"""
import threading

# name -> factory. A factory, not a value: two hosts must never share a dict.
ENGINE_STATE_DEFAULTS = {
    "_db_schema": dict,
    "_db_col_types": dict,
    "_db_maps": list,
    "_map_col": lambda: None,
    "_map_alias": lambda: "m",
    "_map_join": lambda: "",
    "_date_col": lambda: None,
    "_date_col_type": lambda: "",
    "_demo_checksums": dict,
    "_demo_dates": dict,
    "_demo_map_cache": dict,
    "_demo_picker_state": dict,
    "_ts_cache": dict,
    "_col_cache": dict,
    "_db_conn": lambda: None,
    "_dp2_cache": dict,
    "_dp2_cache_lock": threading.Lock,
    "_dp2_verbose": lambda: False,
    "_player_names": dict,
    "_tags_list": list,
    "_tags_schema": dict,
    "_tags_active": set,
    "_running": lambda: False,
    "_stop_after_current": lambda: False,
    "_kill_triggered": lambda: False,
    "_proc": lambda: None,
    "_tagged_this_batch": list,
    "_warned_missing_mods": set,
    "_clutch_roster_sizes": dict,
    "_current_demo": lambda: "",
    "_last_raw_not_found": lambda: False,
    "_pg_params": dict,
}


class EngineStateMixin:
    """Gives a host every attribute the engine expects, with neutral values."""

    def init_engine_state(self, pg_params=None):
        for name, factory in ENGINE_STATE_DEFAULTS.items():
            setattr(self, name, factory())
        if pg_params is not None:
            self._pg_params = dict(pg_params)
