"""The one place an exception becomes the sentence the user reads.

Principle 4 (context_guide.md §1): fail fast inside, clean message outside.
Every boundary where an exception would otherwise reach the screen -- a bridge
command, the preview thread, the run thread -- calls `report()`, which:

  1. writes the full traceback to the error log (kept for bug reports), and
  2. returns one readable sentence that says what happened and what to do.

The screen never receives a traceback, and never a raw exception repr such as
`KeyError: 'x'` or `psycopg2.errors.UndefinedTable: ...`.

Nothing here imports `csdm.config` at module level: config raises `UserError`,
so the dependency must point one way only.
"""
import logging
import logging.handlers
import sys
import threading

import psycopg2


class UserError(ValueError):
    """A failure whose message is already written for the user.

    Raise it wherever the code knows exactly what went wrong and what the user
    can do about it; `user_message` passes its text through untouched. A
    subclass of ValueError so existing `except ValueError` sites keep working.
    """


# HC.1: the error log's shape, named once. Not user settings: nothing in the
# app offers to change them, so they are not DEFAULT_CONFIG keys.
ERROR_LOG = {
    "max_bytes": 1_000_000,   # one file stays small enough to attach to a report
    "backups": 1,             # plus the previous one, nothing older
    "format": "%(asctime)s %(message)s",
}

# Where the user fixes each kind of problem, named once so every message
# points at the same place the Settings tab actually shows.
WHERE = {
    "db": "Settings → PostgreSQL Connection, then click Test & Reload",
    "paths": "Settings → Paths",
}

_LOGGER_LOCK = threading.Lock()
_LOGGER = {"logger": None, "path": None}


def _log_path():
    from csdm.config import error_log_path  # late: config imports this module
    return error_log_path()


def _logger():
    """The error logger, (re)opened on the active config folder's log file."""
    path = _log_path()
    with _LOGGER_LOCK:
        if _LOGGER["logger"] is not None and _LOGGER["path"] == path:
            return _LOGGER["logger"]
        logger = logging.getLogger("csdm.errors")
        logger.propagate = False
        logger.setLevel(logging.ERROR)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(
            path, maxBytes=ERROR_LOG["max_bytes"], backupCount=ERROR_LOG["backups"],
            encoding="utf-8", delay=True)
        handler.setFormatter(logging.Formatter(ERROR_LOG["format"]))
        logger.addHandler(handler)
        _LOGGER.update(logger=logger, path=path)
        return logger


def log_exception(exc, action):
    """Write `exc` with its traceback to the error log. Returns the log path, or None.

    The one broad `except` this module allows: the reporter runs inside an
    error path already, and a log folder that cannot be written must not
    replace the user's real problem with a second one. The traceback then
    goes to stderr, which is where it went before this module existed.
    """
    try:
        _logger().error("while %s", action, exc_info=(type(exc), exc, exc.__traceback__))
        return _LOGGER["path"]
    except Exception:  # noqa: BLE001 -- see docstring
        logging.getLogger("csdm.errors.fallback").error(
            "while %s", action, exc_info=(type(exc), exc, exc.__traceback__))
        print(f"[csdm] error log unavailable; while {action}: {exc!r}", file=sys.stderr)
        return None


def _first_line(exc):
    """The first non-blank line of an exception's text, without driver noise."""
    return next((ln.strip() for ln in str(exc).splitlines() if ln.strip()), "")


def db_connect_message(params, exc):
    """The sentence for a PostgreSQL connection the server refused or never answered.

    `params` are the five pg_* settings that were tried. Recognises the three
    causes a user can fix -- credentials, database name, server unreachable --
    and keeps the driver's first line for anything else.
    """
    server = f"{params['pg_host']}:{params['pg_port']}"
    where = f"{server} (database '{params['pg_db']}')"
    text = str(exc)
    if "password authentication failed" in text or "no password supplied" in text:
        return (f"PostgreSQL at {where} refused user '{params['pg_user']}' with this password. "
                f"Check User and Pass in {WHERE['db']}.")
    if "does not exist" in text and "database" in text:
        return (f"The database '{params['pg_db']}' does not exist on {server}. "
                f"Check Base in {WHERE['db']} -- it must be the database CS Demo Manager uses.")
    if any(s in text for s in ("Connection refused", "timeout expired", "could not translate host",
                               "could not connect", "No route to host", "Network is unreachable")):
        return (f"Cannot reach PostgreSQL at {where}. Check that CS Demo Manager's database server "
                f"is running, and check Host and Port in {WHERE['db']}.")
    return (f"Could not connect to PostgreSQL at {where}: "
            f"{_first_line(exc)}. Check {WHERE['db']}.")


def _os_message(exc):
    name = exc.filename or "the file"
    if isinstance(exc, PermissionError):
        return (f"Windows refused access to {name}. Pick a folder you can write to in "
                f"{WHERE['paths']}, or close the program that is using it.")
    if isinstance(exc, FileNotFoundError):
        return f"{name} was not found. Check the path in {WHERE['paths']}."
    return f"Could not use {name}: {exc.strerror or _first_line(exc)}. Check {WHERE['paths']}."


def _db_schema_message(exc):
    return (f"The CS Demo Manager database is missing something this app reads "
            f"({_first_line(exc)}). Check that Base in {WHERE['db']} is CS Demo Manager's "
            f"database, and that CS Demo Manager is up to date.")


# Ordered: the first matching type wins, so a subclass must come before its base.
_RULES = (
    (UserError, lambda exc, log: str(exc)),
    (psycopg2.errors.UndefinedTable, lambda exc, log: _db_schema_message(exc)),
    (psycopg2.errors.UndefinedColumn, lambda exc, log: _db_schema_message(exc)),
    (psycopg2.OperationalError, lambda exc, log: (
        f"Lost the connection to PostgreSQL. Check that the database server is still "
        f"running, then try again ({WHERE['db']}).")),
    (psycopg2.Error, lambda exc, log: (
        f"The database reported an error: {_first_line(exc)}. Try again; if it keeps "
        f"happening, attach {log or 'the error log'} to a bug report.")),
    (OSError, lambda exc, log: _os_message(exc) if exc.filename else None),
)


def user_message(exc, action, log_path=None):
    """The sentence the screen shows for `exc`, raised while doing `action`.

    `action` is a short gerund phrase ("computing the preview"). Unknown
    exceptions get a generic sentence that names the log file, never their
    own text: that text is written for a programmer.
    """
    for exc_type, build in _RULES:
        if isinstance(exc, exc_type):
            text = build(exc, log_path)
            if text:
                return text
    where = f" Details were saved to {log_path} -- attach that file to a bug report." \
        if log_path else ""
    return f"Unexpected error while {action}.{where}"


def report(exc, action):
    """Log `exc` in full, return the clean sentence for the screen.

    A `UserError` is expected behaviour, not a bug: it is not logged, so the
    log stays a list of things worth reporting.
    """
    log_path = None if isinstance(exc, UserError) else log_exception(exc, action)
    return user_message(exc, action, log_path)
