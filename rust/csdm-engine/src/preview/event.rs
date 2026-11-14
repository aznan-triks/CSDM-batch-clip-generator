//! Preview events: the 3.5 event dicts, held in one arena per preview (T3 Conception, row 25).
//!
//! 3.5 puts the same dict object in several lists (a demo's list, filter results, sequences) and
//! mutates it in place (`_mf`, `_mate_pov_sid`, `_grp`): every list sees the change. Here a list holds
//! [`EventId`]s into the [`Arena`], so a mutation through one id reaches every list that holds it,
//! and a copy (`dict(e)` in 3.5) is a new id ([`Arena::clone_event`]).

use indexmap::IndexMap;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub type EventId = usize;

/// Demo path → its events, in 3.5 dict order (`evts` in 3.5).
pub type DemoEvents = IndexMap<String, Vec<EventId>>;

/// One event: every key 3.5 puts in the dict, in insertion order, plus `_mf` apart (a set in 3.5).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Event {
    /// Every key but `_mf`.
    pub fields: Map<String, Value>,
    /// `_mf`, the filters that matched this event; `None` = the key is absent.
    pub mf: Option<BTreeSet<String>>,
}

impl Event {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.fields.get(key)
    }

    pub fn set(&mut self, key: &str, value: impl Into<Value>) {
        self.fields.insert(key.to_string(), value.into());
    }

    /// `e["tick"]`: every 3.5 event has an integer tick.
    pub fn tick(&self) -> i64 {
        self.fields.get("tick").and_then(Value::as_i64).expect("every preview event has an integer tick")
    }

    /// `e.get("type", "kill")`.
    pub fn kind(&self) -> &str {
        self.fields.get("type").and_then(Value::as_str).unwrap_or("kill")
    }

    /// `str(e.get(key, ""))`: an absent key reads as "", a present `None` as "None" (Python).
    pub fn text(&self, key: &str) -> String {
        self.fields.get(key).map_or_else(String::new, super::cfg::py_str)
    }

    /// `_stamp_mf` for one event: adds `key` to `_mf` (kills only, as 3.5).
    pub fn stamp_mf(&mut self, key: &str) {
        if self.kind() == "kill" {
            self.mf.get_or_insert_with(BTreeSet::new).insert(key.to_string());
        }
    }

    /// The event as the preview payload carries it: its keys, then `_mf` as a sorted list.
    pub fn to_json(&self) -> Value {
        let mut out = self.fields.clone();
        if let Some(mf) = &self.mf {
            out.insert("_mf".into(), Value::Array(mf.iter().map(|k| Value::String(k.clone())).collect()));
        }
        Value::Object(out)
    }
}

/// Every event of one preview.
#[derive(Debug, Default, Clone)]
pub struct Arena {
    events: Vec<Event>,
}

impl Arena {
    pub fn add(&mut self, event: Event) -> EventId {
        self.events.push(event);
        self.events.len() - 1
    }

    pub fn get(&self, id: EventId) -> &Event {
        &self.events[id]
    }

    pub fn get_mut(&mut self, id: EventId) -> &mut Event {
        &mut self.events[id]
    }

    /// 3.5 `dict(e)`: a new event with the same keys. 3.5's copy is shallow (the `_mf` set object is
    /// shared); every 3.5 copy site drops the original right after, so a deep copy is the same.
    pub fn clone_event(&mut self, id: EventId) -> EventId {
        let copy = self.events[id].clone();
        self.add(copy)
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

/// `sum(len(v) for v in evts.values())`.
pub fn count(evts: &DemoEvents) -> usize {
    evts.values().map(Vec::len).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_mutation_reaches_every_list_and_a_copy_does_not() {
        let mut arena = Arena::default();
        let mut e = Event::default();
        e.set("tick", 10);
        let id = arena.add(e);
        let lists = [vec![id], vec![id]];
        let copy = arena.clone_event(id);
        arena.get_mut(lists[0][0]).stamp_mf("kill_mod_ace");
        assert_eq!(arena.get(lists[1][0]).to_json(), json!({"tick": 10, "_mf": ["kill_mod_ace"]}));
        assert_eq!(arena.get(copy).to_json(), json!({"tick": 10}));
    }

    #[test]
    fn only_kills_are_stamped() {
        let mut e = Event::default();
        e.set("tick", 1);
        e.set("type", "damage_actor");
        e.stamp_mf("dmg_mod_big_hit");
        assert_eq!(e.mf, None);
    }
}
