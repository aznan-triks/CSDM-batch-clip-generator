"""The production host: runs the engine with no window, fed over stdio.

Same shape as `HeadlessHost` in `tests/test_engine_headless.py` -- inherit the
engine mixins, call `init_engine_state()`, wire the four sockets. The test
keeps its own copy on purpose (see the plan): a test host that imports
production code stops proving the contract holds.
"""
import platform
import sys
import threading
import traceback

from csdm.bridge.ports import PipePorts
from csdm.bridge.protocol import LineWriter, MSG_FATAL, MSG_LOG, MSG_RESULT, decode
from csdm.bridge.tables import describe_filters
from csdm.config import (apply_config_dir, build_preset, load_config, load_presets,
                         normalize_presets, preset_payload, probe_config_dir,
                         save_config, save_presets)
from csdm.engine.core import EngineMixin
from csdm.engine.state import EngineStateMixin
from csdm.version import APP_VERSION


class BridgeHost(EngineStateMixin, EngineMixin):
    """Everything an engine host needs, wired to the JSON pipe instead of Tk."""

    def __init__(self, ports):
        self.init_engine_state()
        self.log, self.log_parts = ports.log, ports.log_parts
        self.state, self.ask = ports.state, ports.ask


def _cmd_ping(host, command):
    return {}


def _cmd_hello(host, command):
    """Announce the engine on the log socket and name the build.

    The engine speaks only when spoken to: nothing is written between
    `serve()` starting and the first command, so a freshly opened window shows
    an empty console and reads as broken. This is the greeting that fills it.

    It is a COMMAND rather than something `serve()` emits on its own because
    `main.js` relays to a window that does not exist yet at spawn time and
    drops whatever arrives first. Asking for the banner means the renderer has
    already subscribed by the time it is written, so it cannot be lost.
    """
    settings = load_config()
    host.log(f"CSDM Batch Clips Generator {APP_VERSION} -- engine ready", "ok")
    host.log(f"python {platform.python_version()} | {len(settings)} settings loaded", "dim")
    return {"data": {"app_version": APP_VERSION,
                     "python_version": platform.python_version(),
                     "settings_count": len(settings)}}


def _cmd_describe_filters(host, command):
    """Hand the renderer every static table it needs to build its rows."""
    return {"data": describe_filters()}


def _cmd_demo_logs(host, command):
    for level in ("info", "warn", "err", "ok", "dim"):
        host.log(f"demo log at level {level}", level)
    host.log_parts([("prefix", "dim"), ("value", "ok")])
    host.state("buttons_idle")
    host.state("buttons_busy")
    return {}


def _cmd_demo_ask(host, command):
    answer = host.ask("confirm", "include this clip?", ["T", "include", "skip"])
    host.log(f"received answer: {answer}")
    return {}


def _cmd_tkinter_check(host, command):
    loaded = [m for m in sys.modules if m == "tkinter" or m.startswith("tkinter.")]
    host.log(f"tkinter modules loaded: {'none' if not loaded else loaded}")
    return {}


def _cmd_request_stop(host, command):
    host.request_stop()
    return {}


def _cmd_request_kill(host, command):
    host.request_kill()
    return {}


def _cmd_cancel_preview(host, command):
    host.cancel_preview()
    return {}


def _cmd_connect_db(host, command):
    """Resolve connection settings, read the CSDM database, adopt what it says,
    and hand it to the renderer.

    Settings come from the command's own `pg` object when the renderer
    supplies one (so it can connect before any config file exists), layered
    over the saved configuration (`load_config()`) for whichever of the five
    keys it omits. `set_pg_params` validates the result before anything
    touches the network.

    Exceptions travel: _run_command already turns them into {"ok": false, "error"}.
    """
    params = load_config()
    pg = command.get("pg")
    if isinstance(pg, dict):
        params = {**params, **pg}
    host.set_pg_params(params)
    data = host.discover_database()
    host.apply_discovery(data)
    return {"data": host.discovery_to_json(data)}


def _cmd_list_demos(host, command):
    """Manual mode: hand the renderer every demo a match row points to.

    Requires `connect_db` to have already run -- `list_all_demos` raises a
    readable error otherwise, which `_run_command` turns into
    `{"ok": false, "error": ...}` the same way every other command does.
    """
    return {"data": {"demos": host.list_all_demos()}}


def _cmd_tags_search(host, command):
    """Find demos carrying the given tags, optionally filtered by a run cfg.

    `cfg` is optional: omitted or null runs the plain by-tag lookup, present
    runs the config-filtered search (intersected with `tag_ids` when non-empty).
    """
    tag_ids = command.get("tag_ids") or []
    cfg = command.get("cfg")
    if cfg is not None and not isinstance(cfg, dict):
        raise ValueError("tags_search's `cfg` must be an object or null")
    return {"data": host.search_tagged_demos(tag_ids, cfg)}


def _cmd_tags_calc_range(host, command):
    """Compute the date range spanned by demos carrying every given tag."""
    tag_ids = command.get("tag_ids") or []
    return {"data": host.calc_tag_date_range(tag_ids)}


def _cmd_tags_set_active(host, command):
    """Replace the server-side active-tag selection. An empty list deselects all."""
    tag_ids = command.get("tag_ids") or []
    return {"data": host.set_active_tags(tag_ids)}


def _cmd_tags_apply(host, command):
    """Apply every tag in `tag_names` to every demo in `demo_paths`."""
    tag_names = command.get("tag_names") or []
    demo_paths = command.get("demo_paths") or []
    return {"data": host.apply_tags(demo_paths, tag_names)}


def _cmd_tags_remove(host, command):
    """Remove every tag in `tag_names` from every demo in `demo_paths`."""
    tag_names = command.get("tag_names") or []
    demo_paths = command.get("demo_paths") or []
    return {"data": host.remove_tags(demo_paths, tag_names)}


def _cmd_tag_create(host, command):
    """Create a tag. `tag_name` (not `name` -- that key already carries the
    command's own name on every message)."""
    return {"data": host.create_tag(command.get("tag_name"), command.get("color"))}


def _cmd_tag_delete(host, command):
    """Delete a tag and its assignments."""
    return {"data": host.delete_tag(command.get("tag_id"))}


def _cmd_tags_export(host, command):
    """Write every tag (or only `tag_ids`, when given) and its assignments
    to a JSON file at `path`."""
    path = command.get("path")
    if not path:
        raise ValueError("tags_export needs a `path`")
    return {"data": host.export_tags(path, command.get("tag_ids"))}


def _cmd_tags_import_scan(host, command):
    """Read a tags export file and report which tags it references that
    don't exist in the DB yet. Writes nothing -- pair with
    `tags_import_apply` once the caller has decided what to create."""
    path = command.get("path")
    if not path:
        raise ValueError("tags_import_scan needs a `path`")
    return {"data": host.scan_tag_import(path)}


def _cmd_tags_import_apply(host, command):
    """Create `tags_to_create`, then re-parse `path` and replay its
    assignments."""
    path = command.get("path")
    if not path:
        raise ValueError("tags_import_apply needs a `path`")
    tags_to_create = command.get("tags_to_create") or []
    return {"data": host.apply_tag_import(path, tags_to_create)}


def _cmd_load_config(host, command):
    """Hand the saved configuration to the renderer, migrations already applied."""
    return {"data": load_config()}


def _cmd_save_config(host, command):
    """Write the configuration the renderer holds.

    Fails loudly on a missing or malformed `cfg`: writing a partial
    configuration would silently drop every key the renderer forgot.
    """
    cfg = command.get("cfg")
    if not isinstance(cfg, dict):
        raise ValueError("save_config needs a `cfg` object")
    save_config(cfg)
    return {}


def _cmd_probe_config_dir(host, command):
    """Report the active config folder, and what a switch to `target` would do.

    `target` is optional: omitted (or null) returns the current location with
    `same: true` and an empty `conflicts` list -- a status read for the UI.
    """
    target = command.get("target")
    if target is not None and not isinstance(target, str):
        raise ValueError("probe_config_dir's `target` must be a string or null")
    return {"data": probe_config_dir(target)}


def _cmd_apply_config_dir(host, command):
    """Copy the four JSON files to `target`'s folder and switch the app to it.

    Never moves: the source files stay in place. Existing same-named files at
    the target are backed up (backup-<timestamp>/) before being overwritten.
    """
    target = command.get("target")
    if not isinstance(target, str):
        raise ValueError("apply_config_dir needs a `target` string")
    return {"data": apply_config_dir(target)}


def _cmd_list_presets(host, command):
    return {"data": normalize_presets(load_presets())}


def _cmd_save_preset(host, command):
    """Store one preset. The preset's own name travels as `preset`, not `name`:
    `name` already carries the command's name on every message."""
    preset_name = (command.get("preset") or "").strip()
    if not preset_name:
        raise ValueError("a preset needs a name")
    cats = command.get("cats") or []
    if not cats:
        raise ValueError("select at least one category to include")
    cfg = command.get("cfg")
    if not isinstance(cfg, dict):
        raise ValueError("save_preset needs a `cfg` object")
    presets = load_presets()
    selected_clips = command.get("selected_clips")
    presets[preset_name] = build_preset(cfg, cats, selected_clips)
    save_presets(presets)
    return {"data": normalize_presets(presets)}


def _cmd_load_preset(host, command):
    """Return a preset's values and the keys it is allowed to overwrite."""
    preset_name = command.get("preset")
    presets = load_presets()
    if preset_name not in presets:
        raise ValueError(f"no preset named {preset_name}")
    data, keys, selected_clips = preset_payload(presets[preset_name])
    result = {"data": data, "keys": keys}
    if selected_clips is not None:
        result["selected_clips"] = selected_clips
    return result


def _cmd_delete_preset(host, command):
    """Drop one preset. Refuses a name nobody has, like `load_preset` does:
    silently rewriting the file on a typo reports a deletion that never was."""
    preset_name = command.get("preset")
    presets = load_presets()
    if preset_name not in presets:
        raise ValueError(f"no preset named {preset_name}")
    presets.pop(preset_name, None)
    save_presets(presets)
    return {"data": normalize_presets(presets)}


def _cmd_start_run(host, command):
    """Launch a batch run from the configuration the renderer holds.

    `started` is false when validation refused: the reason has already gone
    out on the `ask` channel, so there is nothing to add here.
    """
    cfg = command.get("cfg")
    if not isinstance(cfg, dict):
        raise ValueError("start_run needs a `cfg` object")
    selected_clips = command.get("selected_clips")
    return {"started": host.start_run(host.build_run_cfg(cfg), selected_clips)}


def _cmd_start_preview(host, command):
    cfg = command.get("cfg")
    if not isinstance(cfg, dict):
        raise ValueError("start_preview needs a `cfg` object")
    return {"started": host.start_preview(host.build_run_cfg(cfg))}


COMMANDS = {
    "ping": _cmd_ping,
    "hello": _cmd_hello,
    "describe_filters": _cmd_describe_filters,
    "start_run": _cmd_start_run,
    "start_preview": _cmd_start_preview,
    "load_config": _cmd_load_config,
    "save_config": _cmd_save_config,
    "probe_config_dir": _cmd_probe_config_dir,
    "apply_config_dir": _cmd_apply_config_dir,
    "list_presets": _cmd_list_presets,
    "save_preset": _cmd_save_preset,
    "load_preset": _cmd_load_preset,
    "delete_preset": _cmd_delete_preset,
    "request_stop": _cmd_request_stop,
    "request_kill": _cmd_request_kill,
    "cancel_preview": _cmd_cancel_preview,
    "demo_logs": _cmd_demo_logs,
    "demo_ask": _cmd_demo_ask,
    "tkinter_check": _cmd_tkinter_check,
    "connect_db": _cmd_connect_db,
    "list_demos": _cmd_list_demos,
    "tags_search": _cmd_tags_search,
    "tags_calc_range": _cmd_tags_calc_range,
    "tags_set_active": _cmd_tags_set_active,
    "tags_apply": _cmd_tags_apply,
    "tags_remove": _cmd_tags_remove,
    "tag_create": _cmd_tag_create,
    "tag_delete": _cmd_tag_delete,
    "tags_export": _cmd_tags_export,
    "tags_import_scan": _cmd_tags_import_scan,
    "tags_import_apply": _cmd_tags_import_apply,
}


def _run_command(host, writer, command):
    """Execute one command in its own thread and send its `result` line.

    Runs off the reader thread: `demo_ask` blocks on an engine socket waiting
    for an answer, and that answer can only arrive if the reader thread is
    free to keep reading lines from stdin. Running commands inline would
    deadlock the exchange the moment a command asks a question.
    """
    command_id = command.get("id")
    name = command.get("name")
    try:
        handler = COMMANDS[name]
    except KeyError:
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": False,
                     "error": f"unknown command: {name}"})
        return
    try:
        payload = handler(host, command) or {}
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": True, **payload})
    except Exception as exc:  # noqa: BLE001 -- fail fast inside, report clean outside
        writer.send({"type": MSG_RESULT, "id": command_id, "ok": False, "error": str(exc)})


def serve(stdin, stdout):
    """Read commands from `stdin`, write protocol lines to `stdout`. Returns an exit code.

    The real `stdout` is captured for the writer before `sys.stdout` is
    replaced with `sys.stderr`. That way a stray `print()` -- today or in ten
    years -- lands in the traces instead of corrupting the protocol pipe.
    """
    writer = LineWriter(stdout)
    ports = PipePorts(writer)
    host = BridgeHost(ports)
    threads = []

    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for raw_line in stdin:
            line = raw_line.rstrip("\n")
            if not line.strip():
                continue
            try:
                message = decode(line)
            except ValueError as exc:
                writer.send({"type": MSG_LOG, "message": f"unreadable line ignored: {exc}",
                             "level": "err"})
                continue

            msg_type = message.get("type")
            if msg_type == "command":
                t = threading.Thread(target=_run_command, args=(host, writer, message))
                t.start()
                threads.append(t)
            elif msg_type == "answer":
                ports.resolve_answer(message.get("id"), message.get("value"))
            else:
                writer.send({"type": MSG_LOG,
                             "message": f"unknown message type ignored: {msg_type}",
                             "level": "err"})
    except Exception as exc:  # noqa: BLE001 -- report the fatal cause before exiting
        writer.send({"type": MSG_FATAL, "error": str(exc), "traceback": traceback.format_exc()})
        for t in threads:
            t.join()
        return 1
    finally:
        sys.stdout = real_stdout

    # Stdin closed: wait for in-flight commands so their `result` line is
    # written before the process exits, or the parent sees a dead pipe first.
    for t in threads:
        t.join()
    return 0
