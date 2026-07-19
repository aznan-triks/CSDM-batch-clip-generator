"""Helpers purs, sans dependance Tkinter/DB (Phase 1.1).

Dates, formats, chemins, ticks camera, generation d'identifiants.
Le fichier principal re-importe chaque nom pour la compatibilite.
"""

import random
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path


# ═══════════════════════════════════════════════════════
#  Date helpers  DD-MM-YYYY <-> YYYY-MM-DD
# ═══════════════════════════════════════════════════════
def iso_to_display(iso_str):
    if not iso_str:
        return ""
    try:
        return datetime.strptime(iso_str.strip(), "%Y-%m-%d").strftime("%d-%m-%Y")
    except ValueError:
        try:
            datetime.strptime(iso_str.strip(), "%d-%m-%Y")
            return iso_str.strip()
        except ValueError:
            return iso_str


def display_to_iso(disp_str):
    if not disp_str or not disp_str.strip():
        return ""
    s = disp_str.strip()
    try:
        return datetime.strptime(s, "%d-%m-%Y").strftime("%Y-%m-%d")
    except ValueError:
        try:
            datetime.strptime(s, "%Y-%m-%d")
            return s
        except ValueError:
            return ""


# ═══════════════════════════════════════════════════════
#  Utilities
# ═══════════════════════════════════════════════════════
def ensure_csdm_dirs():
    home = Path.home(); created = []
    for sub in ("", "virtualdub", "hlae", "ffmpeg"):
        d = home / ".csdm" / sub if sub else home / ".csdm"
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True); created.append(str(d))
    return created


def check_ffmpeg_available():
    w = shutil.which("ffmpeg")
    if w:
        return True, w
    for name in ("ffmpeg.exe", "ffmpeg"):
        c = Path.home() / ".csdm" / "ffmpeg" / name
        if c.exists():
            return True, str(c)
    return False, None


def fmt_duration(seconds):
    s = int(seconds)
    if s < 3600:
        return f"{s // 60}:{s % 60:02d}"
    return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def safe_folder_name(name):
    name = Path(name).stem
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    return name[:100]


def build_camera_ticks(seq, tickrate):
    pre_offset = max(1, tickrate // 2)
    post_offset = max(1, tickrate // 8)
    ticks = {seq["start_tick"]}
    for e in seq["events"]:
        et = e["tick"]
        ticks.add(max(seq["start_tick"], et - pre_offset))
        ticks.add(min(seq["end_tick"], et + post_offset))
    return sorted(ticks)


def _generate_id_for_type(data_type):
    dt = (data_type or "").lower().strip()
    for it in ("bigint", "integer", "int", "int4", "int8", "smallint",
               "int2", "serial", "bigserial", "smallserial"):
        if it in dt:
            return random.randint(100_000_000, 9_999_999_999)
    if "uuid" in dt:
        return str(uuid.uuid4())
    if any(t in dt for t in ("text", "char", "varchar", "character")):
        return str(uuid.uuid4())
    return random.randint(100_000_000, 9_999_999_999)


def _count_kills(events):
    """Count kill-type events in a list."""
    return sum(1 for e in events if e.get("type") == "kill")
