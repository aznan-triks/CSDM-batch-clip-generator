//! The last preview's clip list as export rows and as an HTML, text or JSON file (3.5
//! `csdm/engine/preview_export.py`, `preview_clip_rows`, `preview_export`).

use super::sequences::{hms, player_str, sequence_totals, whole};
use super::{LastPreview, Sequence};
use crate::preview::cfg::on;
use crate::preview::event::Arena;
use crate::EngineError;
use csdm_core::preview::clips::{EXPORT_GENERATED_FORMAT, TXT_COMMAND_INDENT};
use csdm_core::preview::preview;
use csdm_core::registries::registries;
use csdm_core::Settings;
use csdm_db::reads::basename;
use csdm_db::Discovery;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// What the file header says (3.5 `meta`).
#[derive(Debug, Clone)]
pub struct ExportMeta {
    pub generated: String,
    pub player: String,
    pub nb_clips: usize,
    pub total: String,
}

/// `clip_row`: one exported row for clip `index` of `count` in one demo.
pub fn clip_row(arena: &Arena, seq: &Sequence, index: usize, count: usize, demo_path: &str, date_str: &str, cfg: &Settings) -> Value {
    let kills: Vec<_> = seq.events.iter().map(|&id| arena.get(id)).filter(|e| e.get("type").and_then(Value::as_str) == Some("kill")).collect();
    let matched: BTreeSet<&str> = kills.iter().flat_map(|e| e.mf.iter().flatten()).map(String::as_str).collect();
    let reg = &registries().kill_filters;
    let filters: Vec<&str> = if matched.is_empty() {
        reg.iter().filter(|f| on(cfg, &f.key) && !f.hide_ui).map(|f| f.badge.as_str()).collect()
    } else {
        reg.iter().filter(|f| matched.contains(f.key.as_str())).map(|f| f.badge.as_str()).collect()
    };
    let weapon = kills.first().map_or_else(|| json!("—"), |e| e.get("weapon").cloned().unwrap_or_else(|| json!("—")));
    let name = basename(demo_path);
    json!({
        "date": date_str,
        "demo": name,
        "demo_path": demo_path,
        "clip_index": index,
        "clip_count": count,
        "weapon": weapon,
        "filters": filters,
        "tick": seq.start_tick,
        "command": format!("playdemo {name} {}", seq.start_tick),
    })
}

/// `preview_clip_rows`: every clip of the last preview as an export row, demos in picker order.
pub fn preview_clip_rows(last: &LastPreview) -> Vec<Value> {
    let mut rows = Vec::new();
    for dp in &last.demo_order {
        let seqs = &last.seqs[dp];
        let date = last.demo_dates.get(dp).map_or("", String::as_str);
        rows.extend(seqs.iter().enumerate().map(|(i, s)| clip_row(&last.arena, s, i + 1, seqs.len(), dp, date, &last.cfg)));
    }
    rows
}

/// `PREVIEW_EXPORT_FORMATS[fmt]`: (default file name, MIME type).
fn format_entry(fmt: &str) -> Option<(&'static str, &'static str)> {
    let e = preview()["export"]["formats"].get(fmt)?;
    Some((e[0].as_str()?, e[1].as_str()?))
}

/// `preview_export`: the last preview's clip list rendered as `fmt` (html / txt / json), with its
/// default file name; the window writes it.
pub fn preview_export(last: Option<&LastPreview>, disc: &Discovery, fmt: &str) -> Result<Value, EngineError> {
    let (filename, mime) = format_entry(fmt).ok_or_else(|| EngineError::User(format!("unknown preview export format: {fmt:?}")))?;
    let last = last.ok_or_else(|| EngineError::User("Run a PREVIEW first: there is no clip list to export yet.".into()))?;
    let (nb_clips, total_sec, _avg) = sequence_totals(&last.seqs, whole(&last.cfg, "tickrate", None)?);
    if nb_clips == 0 {
        return Err(EngineError::User("The last PREVIEW found no clip: there is nothing to export.".into()));
    }
    let meta = ExportMeta {
        generated: chrono::Local::now().format(EXPORT_GENERATED_FORMAT).to_string(),
        player: player_str(&last.cfg, &disc.names),
        nb_clips,
        total: hms(total_sec),
    };
    let content = render_preview(fmt, &preview_clip_rows(last), &meta)?;
    Ok(json!({"content": content, "filename": filename, "mime": mime, "clips": nb_clips}))
}

/// `render_preview`: the file content for `fmt`.
pub fn render_preview(fmt: &str, rows: &[Value], meta: &ExportMeta) -> Result<String, EngineError> {
    match fmt {
        "html" => Ok(render_html(rows, meta)),
        "txt" => Ok(render_txt(rows, meta)),
        "json" => {
            let doc = json!({
                "generated": meta.generated,
                "player": meta.player,
                "nb_clips": meta.nb_clips,
                "total_duration": meta.total,
                "clips": rows,
            });
            Ok(serde_json::to_string_pretty(&doc).expect("rows are plain JSON"))
        }
        _ => Err(EngineError::User(format!("unknown preview export format: {fmt:?}"))),
    }
}

/// Python `str(v)` of a row cell (text as is).
fn cell(v: &Value) -> String {
    crate::preview::cfg::py_str(v)
}

fn filters_text(row: &Value) -> String {
    let joined = row["filters"].as_array().into_iter().flatten().map(cell).collect::<Vec<_>>().join(", ");
    if joined.is_empty() { "—".into() } else { joined }
}

/// `s[:w].ljust(w)` in characters.
fn fit(s: &str, w: usize) -> String {
    let cut: String = s.chars().take(w).collect();
    let pad = w - cut.chars().count();
    cut + &" ".repeat(pad)
}

fn render_txt(rows: &[Value], meta: &ExportMeta) -> String {
    let col: Vec<usize> = preview()["export"]["txt_columns"].as_array().expect("txt_columns").iter().map(|w| w.as_u64().expect("a width") as usize).collect();
    let headers: Vec<&str> = preview()["export"]["txt_headers"].as_array().expect("txt_headers").iter().map(|h| h.as_str().expect("a header")).collect();
    let sep = "─".repeat(col.iter().sum::<usize>() + col.len() * 2);
    let mut lines = vec![
        format!("CSDM Preview Export — {}", meta.generated),
        format!("Player: {}   |   {} clips   |   {}", meta.player, meta.nb_clips, meta.total),
        sep.clone(),
        headers.iter().zip(&col).map(|(h, w)| fit(h, (*w).max(h.chars().count()))).collect::<Vec<_>>().join("  "),
        sep.clone(),
    ];
    for row in rows {
        let cells = [
            cell(&row["date"]),
            cell(&row["demo"]),
            format!("{}/{}", cell(&row["clip_index"]), cell(&row["clip_count"])),
            cell(&row["weapon"]),
            filters_text(row),
            cell(&row["tick"]),
        ];
        lines.push(cells.iter().zip(&col).map(|(c, w)| fit(c, *w)).collect::<Vec<_>>().join("  "));
        lines.push(format!("  {}cmd: {}", " ".repeat(col[0] + TXT_COMMAND_INDENT), cell(&row["command"])));
    }
    lines.push(sep);
    lines.push(format!("▶ {} clips  |  total {}", meta.nb_clips, meta.total));
    lines.join("\n")
}

/// Python `html.escape(s)` (quotes included).
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            _ => out.push(c),
        }
    }
    out
}

fn render_html(rows: &[Value], meta: &ExportMeta) -> String {
    let body: String = rows
        .iter()
        .map(|row| {
            format!(
                "<tr><td>{}</td><td class='mono'>{}</td><td>{}/{}</td><td>{}</td><td>{}</td><td>{}</td><td class='mono cmd'>{}</td></tr>",
                esc(&cell(&row["date"])),
                esc(&cell(&row["demo"])),
                cell(&row["clip_index"]),
                cell(&row["clip_count"]),
                esc(&cell(&row["weapon"])),
                esc(&filters_text(row)),
                cell(&row["tick"]),
                esc(&cell(&row["command"])),
            )
        })
        .collect();
    let (generated, total, nb_clips, player) = (&meta.generated, &meta.total, meta.nb_clips, esc(&meta.player));
    format!(
        r#"<!DOCTYPE html>
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
<div class="meta">Generated: {generated} · Player: {player} · {nb_clips} clips · {total}</div>
<table>
<thead><tr>
  <th>Date</th><th>Demo</th><th>Clip</th><th>Weapon</th><th>Filters</th><th>Tick</th><th>Command</th>
</tr></thead>
<tbody>
{body}
</tbody>
</table>
<div class="summary">▶ {nb_clips} clips &nbsp;|&nbsp; total {total}</div>
</body></html>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::event::Event;
    use std::collections::BTreeSet;

    fn meta() -> ExportMeta {
        ExportMeta { generated: "2026-11-14 10:00:00".into(), player: "Me <1>".into(), nb_clips: 1, total: "12s".into() }
    }

    fn row() -> Value {
        json!({"date": "01 02 2024", "demo": "a'b.dem", "demo_path": "x", "clip_index": 1, "clip_count": 2, "weapon": null,
               "filters": [], "tick": 640, "command": "playdemo a'b.dem 640"})
    }

    #[test]
    fn rows_take_the_matched_badges_else_the_ticked_filters() {
        let mut a = Arena::default();
        let mut k = Event::default();
        k.set("tick", 700);
        k.set("type", "kill");
        k.set("weapon", "AK-47");
        k.mf = Some(BTreeSet::from(["kill_mod_ace".to_string()]));
        let k = a.add(k);
        let seq = Sequence { start_tick: 500, events: vec![k], ..Default::default() };
        let cfg: Settings = serde_json::from_value(json!({"kill_mod_no_scope": true})).unwrap();
        let r = clip_row(&a, &seq, 1, 3, "C:/d/m.dem", "01 02 2024", &cfg);
        let ace = registries().kill_filters.iter().find(|f| f.key == "kill_mod_ace").unwrap().badge.clone();
        assert_eq!(r["filters"], json!([ace]));
        assert_eq!((r["weapon"].clone(), r["command"].clone()), (json!("AK-47"), json!("playdemo m.dem 500")));
        a.get_mut(k).mf = None;
        let scope = registries().kill_filters.iter().find(|f| f.key == "kill_mod_no_scope").unwrap().badge.clone();
        assert_eq!(clip_row(&a, &seq, 1, 3, "m.dem", "", &cfg)["filters"], json!([scope]));
        let none = Sequence { start_tick: 1, ..Default::default() };
        assert_eq!(clip_row(&a, &none, 1, 1, "m.dem", "", &cfg)["weapon"], json!("—"));
    }

    #[test]
    fn text_export_pads_and_cuts_like_ljust() {
        let txt = render_txt(&[row()], &meta());
        let lines: Vec<&str> = txt.lines().collect();
        assert_eq!(lines[3], "Date          Demo                                  Clip    Weapon              Filters found                   Tick    ");
        assert_eq!(lines[5], "01 02 2024    a'b.dem                               1/2     None                —                               640     ");
        assert_eq!(lines[6], format!("{}cmd: playdemo a'b.dem 640", " ".repeat(16)));
        assert_eq!(lines[8], "▶ 1 clips  |  total 12s");
    }

    #[test]
    fn html_escapes_quotes_and_json_is_indented() {
        let html = render_html(&[row()], &meta());
        assert!(html.contains("<td class='mono'>a&#x27;b.dem</td>") && html.contains("Player: Me &lt;1&gt;"));
        assert!(html.contains("body{font-family:Consolas,monospace;"));
        let j = render_preview("json", &[row()], &meta()).unwrap();
        assert!(j.starts_with("{\n  \"generated\": \"2026-11-14 10:00:00\",\n  \"player\""));
        assert!(render_preview("pdf", &[], &meta()).is_err());
    }
}
