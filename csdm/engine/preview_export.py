"""The last preview's clip list, written out as HTML, text or JSON.

Pure rendering, shared by both hosts: the Tkinter window's "Export ▾" menu
(`csdm_batch_clips_generator.py::_export_preview_*`) and the Electron console,
which asks the engine through the `export_preview` bridge command. The rows
themselves are built by the engine (`EngineMixin.preview_clip_rows`), because
they need what only the engine holds: demo dates, filter badges, sequences.
"""
import html
import json

from csdm.static_data import KILL_FILTER_REGISTRY

# Format -> (default file name, MIME type). The names are the Tkinter window's.
PREVIEW_EXPORT_FORMATS = {
    "html": ("csdm_preview.html", "text/html"),
    "txt": ("csdm_preview.txt", "text/plain"),
    "json": ("csdm_preview.json", "application/json"),
}

# Text layout: column widths and headers (Date, Demo, Clip, Weapon, Filters, Tick).
TXT_COLUMNS = (12, 36, 6, 18, 30, 8)
TXT_HEADERS = ("Date", "Demo", "Clip", "Weapon", "Filters found", "Tick")


def clip_row(seq, index, count, demo_path, demo_name, date_str, cfg):
    """One exported row for clip `index` of `count` in one demo."""
    kill_parts = [e for e in seq.get("events", []) if e.get("type") == "kill"]
    matched = set()
    for e in kill_parts:
        matched |= set(e.get("_mf") or ())
    if matched:
        filters = [f.badge for f in KILL_FILTER_REGISTRY if f.key in matched]
    else:
        filters = [f.badge for f in KILL_FILTER_REGISTRY if cfg.get(f.key) and not f.hide_ui]
    tick = seq.get("start_tick", 0)
    return {
        "date": date_str,
        "demo": demo_name,
        "demo_path": demo_path,
        "clip_index": index,
        "clip_count": count,
        "weapon": kill_parts[0].get("weapon", "—") if kill_parts else "—",
        "filters": filters,
        "tick": tick,
        "command": f"playdemo {demo_name} {tick}",
    }


def render_preview(fmt, rows, meta):
    """The file content for `fmt`. `meta`: generated, player, nb_clips, total."""
    if fmt == "html":
        return _render_html(rows, meta)
    if fmt == "txt":
        return _render_txt(rows, meta)
    if fmt == "json":
        return json.dumps({
            "generated": meta["generated"],
            "player": meta["player"],
            "nb_clips": meta["nb_clips"],
            "total_duration": meta["total"],
            "clips": rows,
        }, ensure_ascii=False, indent=2)
    raise ValueError(f"unknown preview export format: {fmt!r}")


def _render_txt(rows, meta):
    col = TXT_COLUMNS
    sep = "─" * (sum(col) + len(col) * 2)
    lines = [
        f"CSDM Preview Export — {meta['generated']}",
        f"Player: {meta['player']}   |   {meta['nb_clips']} clips   |   {meta['total']}",
        sep,
        "  ".join(h.ljust(w) for h, w in zip(TXT_HEADERS, col)),
        sep,
    ]
    for row in rows:
        cells = (
            row["date"],
            row["demo"],
            f"{row['clip_index']}/{row['clip_count']}",
            row["weapon"],
            ", ".join(row["filters"]) or "—",
            str(row["tick"]),
        )
        lines.append("  ".join(str(c)[:w].ljust(w) for c, w in zip(cells, col)))
        lines.append(f"  {'':>{col[0] + 2}}cmd: {row['command']}")
    lines += [sep, f"▶ {meta['nb_clips']} clips  |  total {meta['total']}"]
    return "\n".join(lines)


def _render_html(rows, meta):
    esc = html.escape
    body = "".join(
        "<tr>"
        f"<td>{esc(row['date'])}</td>"
        f"<td class='mono'>{esc(row['demo'])}</td>"
        f"<td>{row['clip_index']}/{row['clip_count']}</td>"
        f"<td>{esc(str(row['weapon']))}</td>"
        f"<td>{esc(', '.join(row['filters']) or '—')}</td>"
        f"<td>{row['tick']}</td>"
        f"<td class='mono cmd'>{esc(row['command'])}</td>"
        "</tr>"
        for row in rows
    )
    generated, total = meta["generated"], meta["total"]
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8">
<title>CSDM Preview Export — {generated}</title>
<style>
  body{{font-family:Consolas,monospace;background:#0e0e0e;color:#e0e0e0;margin:2rem}}
  h1{{color:#22c55e;font-size:1.1rem;margin-bottom:.4rem}}
  .meta{{color:#888;font-size:.85rem;margin-bottom:1.2rem}}
  table{{border-collapse:collapse;width:100%;font-size:.85rem}}
  th{{background:#1a1a1a;color:#f97316;text-align:left;padding:6px 10px;border-bottom:1px solid #252525}}
  td{{padding:5px 10px;border-bottom:1px solid #181818;vertical-align:top}}
  tr:hover td{{background:#141414}}
  .mono{{font-family:Consolas,monospace}}
  .cmd{{color:#93c5fd;cursor:pointer;user-select:all}}
  .summary{{margin-top:1rem;color:#86efac;font-size:.9rem}}
</style>
</head>
<body>
<h1>CSDM Preview Export</h1>
<div class="meta">Generated: {generated} · Player: {esc(meta['player'])} · {meta['nb_clips']} clips · {total}</div>
<table>
<thead><tr>
  <th>Date</th><th>Demo</th><th>Clip</th><th>Weapon</th><th>Filters</th><th>Tick</th><th>Command</th>
</tr></thead>
<tbody>
{body}
</tbody>
</table>
<div class="summary">▶ {meta['nb_clips']} clips &nbsp;|&nbsp; total {total}</div>
</body></html>"""
