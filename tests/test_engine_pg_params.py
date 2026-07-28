"""Guard for the PostgreSQL connection seam (chantier 4a1, task 5 review fix).

Finding 1 (critical): no host ever populated `_pg_params`, so `discover_database`
crashed with a bare `KeyError('pg_host')` on every call. `set_pg_params` gives the
engine one validated entry point any host can use to adopt the five identifiers.

Finding 2 (important): both failure paths -- missing/unusable parameters, and the
database refusing the connection -- must surface one readable English sentence,
not a raw KeyError repr or the full psycopg2 traceback text.
"""
import unittest
from unittest import mock

import psycopg2

from csdm.engine.core import EngineMixin, PG_PARAM_KEYS
from csdm.engine.state import EngineStateMixin


class _Host(EngineStateMixin, EngineMixin):
    def __init__(self):
        self.init_engine_state()


class TestSetPgParams(unittest.TestCase):
    def test_adopts_all_five_keys(self):
        host = _Host()
        host.set_pg_params({"pg_host": "h", "pg_port": "5432", "pg_user": "u",
                             "pg_pass": "", "pg_db": "csdm"})
        self.assertEqual(host._pg_params,
                          {"pg_host": "h", "pg_port": "5432", "pg_user": "u",
                           "pg_pass": "", "pg_db": "csdm"})

    def test_empty_password_is_not_treated_as_missing(self):
        host = _Host()
        # Must not raise: pg_pass == "" is a legitimate value, not an absent key.
        host.set_pg_params({"pg_host": "h", "pg_port": "5432", "pg_user": "u",
                             "pg_pass": "", "pg_db": "csdm"})
        self.assertEqual(host._pg_params["pg_pass"], "")

    def test_missing_key_raises_a_readable_sentence(self):
        host = _Host()
        with self.assertRaises(ValueError) as ctx:
            host.set_pg_params({"pg_host": "h", "pg_port": "5432", "pg_user": "u",
                                 "pg_db": "csdm"})  # pg_pass missing entirely
        message = str(ctx.exception)
        self.assertNotIn("KeyError", message)
        self.assertIn("pg_pass", message)


class TestPgConnectFailures(unittest.TestCase):
    def test_no_params_at_all_raises_a_readable_sentence_not_a_keyerror(self):
        """Regression guard for the critical finding: an empty `_pg_params`
        (the state every host starts with) must not surface a bare KeyError."""
        host = _Host()
        with self.assertRaises(Exception) as ctx:
            host.discover_database()
        self.assertNotIsInstance(ctx.exception, KeyError)
        message = str(ctx.exception)
        self.assertIn("pg_host", message)

    def test_operational_error_names_what_was_attempted(self):
        host = _Host()
        host.set_pg_params({"pg_host": "10.0.0.9", "pg_port": "5432", "pg_user": "u",
                             "pg_pass": "x", "pg_db": "csdm"})
        with mock.patch("csdm.engine.core.psycopg2.connect",
                        side_effect=psycopg2.OperationalError(
                            "could not connect to server: Connection refused")):
            with self.assertRaises(Exception) as ctx:
                host._pg_fresh()
        message = str(ctx.exception)
        self.assertIn("10.0.0.9", message)
        self.assertIn("5432", message)
        self.assertIn("csdm", message)

    def test_unusable_port_raises_a_readable_sentence_not_a_bare_valueerror(self):
        host = _Host()
        host.set_pg_params({"pg_host": "h", "pg_port": "not-a-port", "pg_user": "u",
                             "pg_pass": "", "pg_db": "csdm"})
        with self.assertRaises(ValueError) as ctx:
            host._pg_fresh()
        message = str(ctx.exception)
        self.assertIn("pg_port", message)
        self.assertIn("not-a-port", message)


if __name__ == "__main__":
    unittest.main()
