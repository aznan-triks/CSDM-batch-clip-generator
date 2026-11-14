//! Why a preview or run came back empty (3.5 `_query_stage_counts`, `explain_empty_result`).

use crate::event::{Level, StateName};
use crate::preview::cfg::py_str;
use crate::preview::Ports;
use crate::EngineError;
use csdm_core::migrate::truthy;
use csdm_core::preview::preview;
use csdm_core::Settings;
use serde_json::{json, Map, Value};

/// Python `==` between JSON values: `True == 1`, `9 == 9.0`.
fn py_eq(a: &Value, b: &Value) -> bool {
    let num = |v: &Value| match v {
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Number(n) => n.as_f64(),
        _ => None,
    };
    match (a, b) {
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(u, v)| py_eq(u, v)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, u)| y.get(k).is_some_and(|v| py_eq(u, v))),
        _ => match (num(a), num(b)) {
            (Some(x), Some(y)) => x == y,
            _ => a == b,
        },
    }
}

/// `label.format_map(_BlankFormat(cfg))`: `{key}` reads the setting, "…" when unset or empty.
fn fill_label(label: &str, cfg: &Settings) -> String {
    let mut out = String::new();
    let mut rest = label;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open..].find('}') else { break };
        out.push_str(&rest[..open]);
        let key = &rest[open + 1..open + close];
        out.push_str(&cfg.get(key).filter(|v| truthy(v)).map_or_else(|| "…".to_string(), py_str));
        rest = &rest[open + close + 1..];
    }
    out + rest
}

/// `_query_stage_counts`: the database query's stages switched off, then put back one by one (the
/// user's value of each stage that is on), stopping at the first that leaves nothing. `count` =
/// `_count_query_events`: the events the query returns for a raw settings map.
fn query_stage_counts(cfg: &Settings, count: &mut dyn FnMut(&Settings) -> Result<usize, EngineError>) -> Result<Vec<(String, usize)>, EngineError> {
    let table = &preview()["empty_result"];
    let stages: Vec<(&str, &Map<String, Value>)> = table["stages"]
        .as_array()
        .expect("empty_result stages")
        .iter()
        .map(|s| (s["label"].as_str().expect("a stage label"), s["neutral"].as_object().expect("a stage's neutral settings")))
        .collect();
    let mut current = cfg.clone();
    for (_, neutral) in &stages {
        current.extend(neutral.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    let mut rows = vec![(table["base_label"].as_str().expect("base_label").to_string(), count(&current)?)];
    if rows[0].1 == 0 {
        return Ok(rows);
    }
    for (label, neutral) in &stages {
        if neutral.iter().all(|(k, v)| py_eq(cfg.get(k).unwrap_or(v), v)) {
            continue;
        }
        current.extend(neutral.keys().filter_map(|k| cfg.get(k).map(|v| (k.clone(), v.clone()))));
        rows.push((fill_label(label, cfg), count(&current)?));
        if rows.last().is_some_and(|r| r.1 == 0) {
            return Ok(rows);
        }
    }
    // Every stage alone kept something: a setting outside the list, or dates meeting undated demos.
    rows.push((table["rest_label"].as_str().expect("rest_label").to_string(), 0));
    Ok(rows)
}

/// `explain_empty_result` with the query count given: `cfg` is the run cfg, `counts` the caller's
/// funnel (database query first). Logs the funnel, raises it as the summary, returns
/// `{"headline", "hint", "stages": [{"label", "count"}]}`.
pub fn explain_empty_result_with(
    ports: &dyn Ports,
    cfg: &Settings,
    counts: &[(String, usize)],
    count: &mut dyn FnMut(&Settings) -> Result<usize, EngineError>,
) -> Result<Value, EngineError> {
    let stages = if counts.first().is_none_or(|c| c.1 == 0) { query_stage_counts(cfg, count)? } else { counts.to_vec() };
    let zero = stages.iter().position(|s| s.1 == 0).unwrap_or(stages.len() - 1);
    let label = &stages[zero].0;
    let (headline, hint) = if zero == 0 {
        (
            "No clips: the database holds no event for this player with these event types.".to_string(),
            "Check the selected player, or tick other event types (Capture & Timing > Event Type).".to_string(),
        )
    } else {
        (format!("No clips: {label} removed the last {} events.", stages[zero - 1].1), format!("Loosen {label} to get clips."))
    };
    let stages = &stages[..=zero];
    ports.log("  No clips. Events left after each step:", Level::Warn);
    for (step, n) in stages {
        ports.log(&format!("    {n:>6}  {step}"), Level::Dim);
    }
    ports.log(&format!("  → {hint}"), Level::Info);
    ports.state(StateName::Summary, json!({"text": headline, "level": "muted"}));
    Ok(json!({"headline": headline, "hint": hint, "stages": stages.iter().map(|(s, n)| json!({"label": s, "count": n})).collect::<Vec<_>>()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::CollectPorts;

    fn cfg(v: Value) -> Settings {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn a_funnel_that_reaches_zero_names_the_step() {
        let ports = CollectPorts::default();
        let counts = [("database query".to_string(), 12), ("Kill Filters checked in the demo files".to_string(), 0), ("★ Must / optional filter rules".to_string(), 0)];
        let r = explain_empty_result_with(&ports, &Settings::new(), &counts, &mut |_| panic!("no query when the funnel has events")).unwrap();
        assert_eq!(r["headline"], "No clips: Kill Filters checked in the demo files removed the last 12 events.");
        assert_eq!(r["stages"].as_array().unwrap().len(), 2);
        assert_eq!(ports.logs.lock().unwrap()[1].0, "        12  database query");
        assert_eq!(ports.states.lock().unwrap()[0].1["level"], "muted");
    }

    #[test]
    fn an_empty_query_is_split_into_its_stages() {
        // Base count 5, the date stage keeps 3, Ally / Enemy is off (no query), weapons leave 0.
        let c = cfg(json!({"date_from": "01-01-2024", "date_to": "", "event_ally": true, "event_enemy": 1, "weapons": ["awp"], "headshots_mode": "all"}));
        let mut seen: Vec<Settings> = Vec::new();
        let mut answers = vec![5, 3, 0].into_iter();
        let ports = CollectPorts::default();
        let counts = [("database query".to_string(), 0)];
        let r = explain_empty_result_with(&ports, &c, &counts, &mut |s| {
            seen.push(s.clone());
            Ok(answers.next().unwrap())
        })
        .unwrap();
        let labels: Vec<&str> = r["stages"].as_array().unwrap().iter().map(|s| s["label"].as_str().unwrap()).collect();
        assert_eq!(labels, [preview()["empty_result"]["base_label"].as_str().unwrap(), "date range 01-01-2024 → … (Demo Selection)", "Weapon Filter"]);
        assert_eq!(r["headline"], "No clips: Weapon Filter removed the last 3 events.");
        assert_eq!((seen[0]["weapons"].clone(), seen[0]["date_from"].clone()), (json!([]), json!("")));
        assert_eq!((seen[2]["weapons"].clone(), seen[2]["date_from"].clone()), (json!(["awp"]), json!("01-01-2024")));
    }

    #[test]
    fn nothing_for_the_player_at_all() {
        let ports = CollectPorts::default();
        let r = explain_empty_result_with(&ports, &Settings::new(), &[("database query".into(), 0)], &mut |_| Ok(0)).unwrap();
        assert_eq!(r["headline"], "No clips: the database holds no event for this player with these event types.");
        assert_eq!(r["stages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn python_equality() {
        assert!(py_eq(&json!(true), &json!(1)) && py_eq(&json!(2.0), &json!(2)) && !py_eq(&json!("1"), &json!(1)));
    }
}
