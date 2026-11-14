//! What each filter does in the SQL stage beyond what the registry and `preview()["filters"]`
//! say: one entry per registry key (test: exactly one entry per key, and back).

use super::modifiers::{self, EventRule, GroupRule};
use super::postfilters::{self, SigBuilder};

/// One filter's SQL-stage behaviour.
#[derive(Clone, Copy)]
pub struct Sql {
    /// `_EVENT_RULES`: judged on the event's own columns (`preview` flag `event_rule`).
    pub rule: Option<EventRule>,
    /// `_GROUP_RULES`: judged on a group of events (`preview` flag `group_rule`).
    pub group: Option<GroupRule>,
    /// `_apply_db_postfilters` builder (registry category `db`).
    pub db: Option<SigBuilder>,
    /// ONE TAP: forces `headshot = TRUE` in the kills query (`_qe_headshot_sql`).
    pub forces_headshot: bool,
    /// ECO FRAG: the kills query fetches the victim's weapon when the filter is on (`_vwc`).
    pub victim_weapon: bool,
}

const NONE: Sql = Sql { rule: None, group: None, db: None, forces_headshot: false, victim_weapon: false };

pub const BEHAVIOURS: [(&str, Sql); 31] = [
    ("kill_mod_through_smoke", NONE),
    ("kill_mod_no_scope", NONE),
    ("kill_mod_assisted_flash", NONE),
    ("kill_mod_wall_bang", NONE),
    ("kill_mod_attacker_blind", NONE),
    ("kill_mod_airborne", NONE),
    ("kill_mod_collateral", NONE),
    ("kill_mod_trois_shot", NONE),
    ("kill_mod_trois_tap", NONE),
    ("kill_mod_one_tap", Sql { forces_headshot: true, ..NONE }),
    ("kill_mod_spray_transfer", NONE),
    ("kill_mod_high_velocity", NONE),
    ("kill_mod_flick", NONE),
    ("kill_mod_savior", NONE),
    ("kill_mod_entry_frag", Sql { db: Some(postfilters::entry_sigs), ..NONE }),
    ("kill_mod_ace", Sql { db: Some(postfilters::ace_sigs), ..NONE }),
    ("kill_mod_multi_kill", Sql { db: Some(postfilters::multi_sigs), ..NONE }),
    ("kill_mod_bully", Sql { db: Some(postfilters::bully_sigs), ..NONE }),
    ("kill_mod_eco_frag", Sql { db: Some(postfilters::eco_sigs), victim_weapon: true, ..NONE }),
    ("kill_mod_mate_pov", NONE),
    ("dmg_mod_headshot_hit", Sql { rule: Some(modifiers::rule_headshot_hit), ..NONE }),
    ("dmg_mod_body_hit", Sql { rule: Some(modifiers::rule_body_hit), ..NONE }),
    ("dmg_mod_arm_hit", Sql { rule: Some(modifiers::rule_arm_hit), ..NONE }),
    ("dmg_mod_leg_hit", Sql { rule: Some(modifiers::rule_leg_hit), ..NONE }),
    ("dmg_mod_big_hit", Sql { rule: Some(modifiers::rule_big_hit), ..NONE }),
    ("dmg_mod_low_hp", Sql { rule: Some(modifiers::rule_low_hp), ..NONE }),
    ("dmg_mod_multi_nade", Sql { group: Some(modifiers::multi_nade_groups), ..NONE }),
    ("dmg_mod_team_damage", Sql { rule: Some(modifiers::rule_team_damage), ..NONE }),
    ("shot_mod_knife_swing", Sql { rule: Some(modifiers::rule_knife_swing), ..NONE }),
    ("shot_mod_long_spray", Sql { group: Some(modifiers::long_spray_groups), ..NONE }),
    ("shot_mod_run_gun", Sql { rule: Some(modifiers::rule_run_gun), ..NONE }),
];

/// The behaviour of a registry key.
pub fn of(key: &str) -> &'static Sql {
    &BEHAVIOURS.iter().find(|(k, _)| *k == key).unwrap_or_else(|| panic!("filter {key} has no SQL behaviour entry")).1
}

#[cfg(test)]
mod tests {
    use super::*;
    use csdm_core::preview::preview;
    use csdm_core::registries::registries;

    #[test]
    fn one_entry_per_registry_key_and_back() {
        let reg: Vec<&str> = registries().kill_filters.iter().map(|f| f.key.as_str()).collect();
        let ours: Vec<&str> = BEHAVIOURS.iter().map(|(k, _)| *k).collect();
        assert_eq!(reg, ours, "same keys, same order as KILL_FILTER_REGISTRY");
    }

    #[test]
    fn entries_agree_with_the_exported_flags() {
        for f in &registries().kill_filters {
            let flags = &preview()["filters"][&f.key];
            let b = of(&f.key);
            assert_eq!(b.rule.is_some(), flags["event_rule"] == true, "{} event_rule", f.key);
            assert_eq!(b.group.is_some(), flags["group_rule"] == true, "{} group_rule", f.key);
            assert_eq!(b.db.is_some(), f.category == "db", "{} database post-filter", f.key);
        }
    }

    #[test]
    fn position_modifiers_are_the_two_3_5_names() {
        // `_check_modifier` special-cases these two by name; the port derives them from
        // `needs_positions` (+ `sql_cols`), which must keep meaning the same two keys.
        let pos: Vec<&str> = registries()
            .kill_filters
            .iter()
            .filter(|f| preview()["filters"][&f.key]["needs_positions"] == true)
            .map(|f| f.key.as_str())
            .collect();
        assert_eq!(pos, ["kill_mod_no_scope", "kill_mod_airborne"]);
    }
}
