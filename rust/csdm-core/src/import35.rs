//! 3.5.x user state → Rust settings, from the four JSON files already parsed
//! (reading them is the engine's job). Pure: nothing is written anywhere.

use crate::error::CoreError;
use crate::migrate::{import_legacy_players, migrate_config};
use crate::settings::{convert, def, defaults, Settings};
use serde_json::{Map, Value};

/// The four 3.5 files, parsed; `None` = file absent.
#[derive(Default)]
pub struct Files {
    pub config: Option<Value>,
    pub presets: Option<Value>,
    pub players: Option<Value>,
    pub asm_names: Option<Value>,
}

#[derive(Debug)]
pub struct Imported {
    /// Every key of the table, migrated and converted to its type.
    pub settings: Settings,
    /// Keys the table does not know (Tkinter leftovers, retired names), kept aside.
    pub unknown: Map<String, Value>,
    /// Presets with `cats`, without credentials or personal keys.
    pub presets: Map<String, Value>,
    pub asm_names: Vec<String>,
    /// What the user must be told (a value replaced by its default). Never holds a value.
    pub notices: Vec<String>,
}

fn not(what: &str, expected: &'static str) -> CoreError {
    CoreError::InvalidShape { what: what.into(), expected }
}

pub fn import(files: &Files, cpu_count: Option<usize>) -> Result<Imported, CoreError> {
    let saved = match &files.config {
        None => Map::new(),
        Some(Value::Object(m)) => m.clone(),
        Some(_) => return Err(not("the settings file", "an object")),
    };
    if files.players.as_ref().is_some_and(|p| !p.is_array()) {
        return Err(not("the players file", "a list"));
    }
    let mut cfg = defaults(cpu_count);
    cfg.extend(saved.clone());
    migrate_config(&saved, &mut cfg);
    import_legacy_players(&mut cfg, files.players.as_ref());

    let base = defaults(cpu_count);
    let (mut settings, mut unknown, mut notices) = (Settings::new(), Map::new(), Vec::new());
    for (key, value) in cfg {
        let Some(d) = def(&key) else {
            unknown.insert(key, value);
            continue;
        };
        let converted = convert(d.ty, &value).unwrap_or_else(|| {
            notices.push(format!("Setting \"{key}\" held a value of the wrong type; its default is used."));
            base[&key].clone()
        });
        settings.insert(key, converted);
    }

    let presets = match &files.presets {
        None => Map::new(),
        Some(p) => crate::presets::normalize(p)?,
    };
    let asm_names = match &files.asm_names {
        None => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|v| v.as_str().map(str::to_string).ok_or_else(|| not("an assembly name", "text")))
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(not("the assembly names file", "a list")),
    };
    Ok(Imported { settings, unknown, presets, asm_names, notices })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn files(config: Value) -> Files {
        Files { config: Some(config), ..Files::default() }
    }

    #[test]
    fn no_file_gives_the_defaults() {
        let i = import(&Files::default(), Some(4)).unwrap();
        let mut d = defaults(Some(4));
        d.insert("saved_players_imported".into(), json!(true));
        assert_eq!(i.settings, d);
        assert!(i.unknown.is_empty() && i.presets.is_empty() && i.notices.is_empty());
    }

    #[test]
    fn values_converted_unknown_kept_wrong_types_reported() {
        let i = import(&files(json!({"pg_port": 5433, "phys_ragdoll_scale": "1.5", "res_aspect": "16:9", "width": "wide", "pg_pass": 7})), None).unwrap();
        assert_eq!(i.settings["pg_port"], json!("5433"));
        assert_eq!(i.settings["phys_ragdoll_scale"], json!(1.5));
        assert_eq!(i.settings["width"], json!(1920));
        assert_eq!(i.unknown["res_aspect"], json!("16:9"));
        assert_eq!(i.notices.len(), 1, "{:?}", i.notices);
        assert!(i.notices[0].contains("\"width\""));
    }

    #[test]
    fn notices_never_carry_the_value() {
        let i = import(&files(json!({"pg_pass": ["secret-value"]})), None).unwrap();
        assert!(i.notices.iter().all(|n| !n.contains("secret-value")));
        assert_eq!(i.settings["pg_pass"], json!(""));
    }

    #[test]
    fn key_order_is_the_table_order() {
        let i = import(&files(json!({"width": 1280, "pg_host": "h"})), None).unwrap();
        let keys: Vec<&String> = i.settings.keys().collect();
        let table: Vec<&String> = crate::settings::reference().settings.iter().map(|d| &d.key).collect();
        assert_eq!(keys, table);
    }

    #[test]
    fn wrong_shapes_fail() {
        assert!(import(&files(json!([])), None).is_err());
        assert!(import(&Files { players: Some(json!({})), ..Files::default() }, None).is_err());
        assert!(import(&Files { asm_names: Some(json!([1])), ..Files::default() }, None).is_err());
    }

    #[test]
    fn presets_lose_the_password() {
        let f = Files { presets: Some(json!({"p": {"cats": ["full"], "data": {"pg_pass": "pw", "pg_user": "u", "crf": 20}}})), ..Files::default() };
        let i = import(&f, None).unwrap();
        assert_eq!(i.presets["p"]["data"], json!({"crf": 20}));
    }
}
