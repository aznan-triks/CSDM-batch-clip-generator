//! What the console says, as opposed to what the engine sends (3.5 `shell/consoleNarrative.ts`):
//! no protocol prefix, no raw payload; states told in words; the selection recited
//! when an action starts.

use crate::link::Notice;
use csdm_core::Settings;
use csdm_engine::event::{Level, StateName};
use serde_json::Value;

const START: &str = "▶ ";
const DONE: &str = "✓ ";
const WARN: &str = "! ";
const HALT: &str = "⏸ ";

/// One line: coloured runs, and the level that tints the line.
#[derive(Clone, Debug, PartialEq)]
pub struct Narrated {
    pub runs: Vec<(String, Level)>,
    pub level: Level,
}

fn line(runs: Vec<(&str, Level)>, level: Level) -> Narrated {
    Narrated { runs: runs.into_iter().map(|(t, l)| (t.to_string(), l)).collect(), level }
}

fn text(p: &Value, k: &str) -> String {
    p.get(k).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string()
}

/// The line a notice writes, or `None` when the window showing it IS the message.
pub fn narrate(n: &Notice) -> Option<Narrated> {
    use StateName::*;
    match n {
        Notice::Log { message, level } => Some(line(vec![(message, *level)], *level)),
        Notice::LogParts(parts) => Some(Narrated { runs: parts.clone(), level: Level::Plain }),
        Notice::State { name, payload } => match name {
            RunStarted => Some(line(vec![(START, Level::Info), ("run: launching cs2…", Level::Plain)], Level::Info)),
            PreviewStarted => Some(line(vec![(START, Level::Info), ("preview: querying events…", Level::Plain)], Level::Info)),
            StopRequested => Some(line(vec![(HALT, Level::Warn), ("stop requested · closing cs2…", Level::Plain)], Level::Warn)),
            KillRequested => Some(line(vec![(HALT, Level::Warn), ("kill requested", Level::Plain)], Level::Warn)),
            ProcessExited => {
                let name = text(payload, "name");
                let what = format!("{} exited", if name.is_empty() { "process" } else { &name });
                Some(line(vec![(DONE, Level::Ok), (&what, Level::Plain)], Level::Ok))
            }
            Progress => {
                let t = text(payload, "text");
                (!t.is_empty()).then(|| line(vec![(&t, Level::Dim)], Level::Dim))
            }
            Summary => {
                let t = text(payload, "text");
                if t.is_empty() {
                    None
                } else if text(payload, "level") == "muted" {
                    Some(line(vec![(WARN, Level::Warn), (&t, Level::Plain)], Level::Warn))
                } else {
                    Some(line(vec![(&t, Level::Info)], Level::Info))
                }
            }
            Buttons | ButtonsIdle | ButtonsBusy | PreviewReady | DemosUnchecked | DemoEntry => None,
        },
        Notice::Ask(a) => Some(line(vec![(WARN, Level::Warn), (&a.message, Level::Plain)], Level::Warn)),
        Notice::Failed(e) => Some(line(vec![(WARN, Level::Err), (e, Level::Plain)], Level::Err)),
        Notice::Lost => Some(line(vec![(WARN, Level::Err), ("The engine stopped answering. Details are in csdm_errors.log next to the settings; restart the app.", Level::Plain)], Level::Err)),
        Notice::PreviewExport { .. } | Notice::Injection(_) => None,
    }
}

/// The command the mute `csdm>` prompt shows: `None` leaves it as it is.
pub fn prompt_for(n: &Notice) -> Option<&'static str> {
    let Notice::State { name, .. } = n else { return None };
    match name {
        StateName::RunStarted => Some("run --go"),
        StateName::PreviewStarted => Some("run --preview"),
        StateName::StopRequested => Some("stop"),
        StateName::KillRequested => Some("kill"),
        StateName::ProcessExited | StateName::ButtonsIdle => Some(""),
        _ => None,
    }
}

fn list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter(|s| !s.is_empty()).map(String::from).collect()).unwrap_or_default()
}

fn flags(s: &Settings, prefix: &str, skip: impl Fn(&str) -> bool) -> Vec<String> {
    s.iter().filter(|(k, v)| k.starts_with(prefix) && **v == Value::Bool(true) && !skip(k)).map(|(k, _)| k[prefix.len()..].replace('_', " ")).collect()
}

/// The selection, one line per non-empty group, when a run or a preview starts.
pub fn recite_selection(n: &Notice, s: &Settings) -> Vec<Narrated> {
    let Notice::State { name: StateName::RunStarted | StateName::PreviewStarted, .. } = n else { return Vec::new() };
    let on = |k: &str| s.get(k) == Some(&Value::Bool(true));
    let me = s.get("steam_id").and_then(Value::as_str).unwrap_or_default();
    let me_name = s.get("player_name").and_then(Value::as_str).unwrap_or_default();
    let players = list(s.get("steam_ids")).into_iter().map(|id| if id == me && !me_name.is_empty() { me_name.to_string() } else { id }).collect();
    let groups = [
        ("players", players),
        ("events", list(s.get("events"))),
        ("weapons", list(s.get("weapons"))),
        ("maps", if on("map_filter_enabled") { list(s.get("map_filter")) } else { Vec::new() }),
        ("filters", flags(s, "kill_mod_", |k| k.ends_with("_exclude") || k.ends_with("_req"))),
        ("match types", if on("match_type_filter_enabled") { flags(s, "match_type_", |k| k == "match_type_filter_enabled") } else { Vec::new() }),
    ];
    groups
        .into_iter()
        .filter(|(_, picked)| !picked.is_empty())
        .map(|(label, picked)| Narrated { runs: vec![(format!("{label}: "), Level::Dim), (picked.join(", "), Level::Plain)], level: Level::Plain })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state(name: StateName, payload: Value) -> Notice {
        Notice::State { name, payload }
    }

    fn flat(n: &Narrated) -> String {
        n.runs.iter().map(|(t, _)| t.as_str()).collect()
    }

    #[test]
    fn states_are_told_in_words_and_plumbing_is_silent() {
        assert_eq!(flat(&narrate(&state(StateName::PreviewStarted, Value::Null)).unwrap()), "▶ preview: querying events…");
        assert_eq!(flat(&narrate(&state(StateName::ProcessExited, json!({"name": "cs2"}))).unwrap()), "✓ cs2 exited");
        assert!(narrate(&state(StateName::ButtonsBusy, Value::Null)).is_none());
        assert!(narrate(&state(StateName::PreviewReady, json!({"sequences": {}}))).is_none());
        assert!(narrate(&state(StateName::Progress, json!({"text": "  "}))).is_none());
        let muted = narrate(&state(StateName::Summary, json!({"text": "0 clips", "level": "muted"}))).unwrap();
        assert_eq!((flat(&muted), muted.level), ("! 0 clips".to_string(), Level::Warn));
    }

    #[test]
    fn no_line_carries_a_protocol_prefix() {
        let all = [
            Notice::Log { message: "Engine ready".into(), level: Level::Ok },
            Notice::Failed("The database refused the password.".into()),
            state(StateName::RunStarted, Value::Null),
            state(StateName::Summary, json!({"text": "3 clips"})),
        ];
        for n in &all {
            let t = flat(&narrate(n).unwrap());
            for marker in ["[log", "[state", "[result", "id=", "ok=", "{\""] {
                assert!(!t.contains(marker), "{t:?} shows {marker:?}");
            }
        }
    }

    #[test]
    fn selection_is_recited_when_an_action_starts() {
        let mut s = Settings::new();
        s.insert("steam_id".into(), json!("765"));
        s.insert("player_name".into(), json!("me"));
        s.insert("steam_ids".into(), json!(["765", "900"]));
        s.insert("weapons".into(), json!(["awp"]));
        s.insert("map_filter".into(), json!(["mirage"]));
        s.insert("map_filter_enabled".into(), json!(false));
        s.insert("kill_mod_wallbang".into(), json!(true));
        s.insert("kill_mod_wallbang_exclude".into(), json!(true));
        let lines: Vec<String> = recite_selection(&state(StateName::PreviewStarted, Value::Null), &s).iter().map(flat).collect();
        assert_eq!(lines, ["players: me, 900", "weapons: awp", "filters: wallbang"]);
        assert!(recite_selection(&state(StateName::Progress, Value::Null), &s).is_empty());
    }

    #[test]
    fn prompt_follows_the_action() {
        assert_eq!(prompt_for(&state(StateName::RunStarted, Value::Null)), Some("run --go"));
        assert_eq!(prompt_for(&state(StateName::ButtonsIdle, Value::Null)), Some(""));
        assert_eq!(prompt_for(&state(StateName::Progress, Value::Null)), None);
    }
}
