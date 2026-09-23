"""The date filter must read the dates both hosts actually send.

The Electron renderer stores `date_from`/`date_to` exactly as its DateField
shows them (`dd-mm-yyyy`, see electron/renderer/src/components/DateField.tsx
and TagsTab's range buttons); the Tkinter window converts to `yyyy-mm-dd`
before handing its config over. `_qe_epoch_bounds` only parsed `yyyy-mm-dd`,
so every date typed in the Electron app was silently dropped and PREVIEW
scanned every demo.
"""
from datetime import datetime

from csdm.engine.core import EngineMixin


def _midnight(y, m, d):
    return int(datetime(y, m, d, 0, 0, 0).timestamp())


def _end_of_day(y, m, d):
    return int(datetime(y, m, d, 23, 59, 59).timestamp())


def test_display_format_from_the_electron_renderer_is_applied():
    bounds = EngineMixin._qe_epoch_bounds({"date_from": "10-09-2026", "date_to": "12-09-2026"})
    assert bounds == (_midnight(2026, 9, 10), _end_of_day(2026, 9, 12))


def test_iso_format_from_the_tkinter_window_still_works():
    bounds = EngineMixin._qe_epoch_bounds({"date_from": "2026-09-10", "date_to": "2026-09-12"})
    assert bounds == (_midnight(2026, 9, 10), _end_of_day(2026, 9, 12))


def test_empty_bounds_mean_no_filter():
    assert EngineMixin._qe_epoch_bounds({"date_from": "", "date_to": ""}) == (None, None)
    assert EngineMixin._qe_epoch_bounds({}) == (None, None)


def test_unparsable_bound_is_ignored():
    assert EngineMixin._qe_epoch_bounds({"date_from": "not a date"}) == (None, None)
