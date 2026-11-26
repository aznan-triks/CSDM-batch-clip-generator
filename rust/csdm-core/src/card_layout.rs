//! One tab's card layout as stored in `ui_sections[tab]` (schema v5), toolkit-free.
//!
//! Port of 3.5's `shell/sectionLayout.ts` (stored shape, reconciliation, fold with
//! `hPrev`, write-back that keeps `hPrev`/`manual`) and `shell/defaultLayout.ts`
//! (the derived reference layout). Placement itself is `crate::grid`.
//! Units: `x`/`w` in columns of `ui_card_block_size` px, `y`/`h` in rows of `ui_card_row_height` px.

use crate::grid::Item;
use crate::settings::reference;
use crate::ui_values::{COLS_SCALE_V3_TO_V4, DEFAULT_CARD_COLS, DEFAULT_CARD_ROWS, LAYOUT_HALF_STEP_VERSION, LEGACY_LAYOUT_VERSION, REEXPAND_DEFAULT_ROWS};
use serde_json::{json, Map, Value};

/// A card's rectangle and the two marks the grid library never knew about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Slot { pub x: i32, pub y: i32, pub w: i32, pub h: i32, pub h_prev: Option<i32>, pub manual: bool, pub user_resized: bool }

/// A card a tab declares: its id and whether it spans the full width (the mock's `wide`).
#[derive(Clone, Copy, Debug)]
pub struct Decl<'a> { pub id: &'a str, pub wide: bool }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TabLayout {
    /// One slot per declared card, in declaration order.
    pub slots: Vec<(String, Slot)>,
    pub collapsed: Vec<String>,
}

/// The reference layout: reading order, `wide` = full width, else `DEFAULT_CARD_COLS`, wrap when full.
pub fn default_slots(declared: &[Decl], cols: i32) -> Vec<Slot> {
    let columns = cols.max(1);
    let (mut cx, mut cy, mut row_h) = (0, 0, 0);
    let mut out = Vec::with_capacity(declared.len());
    for d in declared {
        let w = (if d.wide { columns } else { DEFAULT_CARD_COLS }).clamp(1, columns);
        let h = DEFAULT_CARD_ROWS;
        if cx + w > columns {
            cx = 0;
            cy += row_h;
            row_h = 0;
        }
        out.push(Slot { x: cx, y: cy, w, h, h_prev: None, manual: false, user_resized: false });
        cx += w;
        row_h = row_h.max(h);
        if cx >= columns {
            cx = 0;
            cy += row_h;
            row_h = 0;
        }
    }
    out
}

fn num(o: &Map<String, Value>, k: &str) -> Option<i64> {
    o.get(k).and_then(|v| v.as_f64()).filter(|f| f.is_finite()).map(|f| f as i64)
}

/// Reconciles a stored tab layout with the cards the tab declares. Never resets:
/// a readable slot is kept (clamped into `cols`), a missing one takes its reference place.
pub fn migrate(raw: Option<&Value>, declared: &[Decl], cols: i32) -> TabLayout {
    let empty = Map::new();
    let tab = raw.and_then(Value::as_object).unwrap_or(&empty);
    let stored = tab.get("cards").and_then(Value::as_object).unwrap_or(&empty);
    let version = num(tab, "v").unwrap_or(LEGACY_LAYOUT_VERSION);
    let half_step = version < LAYOUT_HALF_STEP_VERSION; // v2/v3 counted 96 px columns
    let reference_slots = default_slots(declared, cols);
    let mut slots = Vec::with_capacity(declared.len());
    for (k, d) in declared.iter().enumerate() {
        let s = stored.get(d.id).and_then(Value::as_object);
        let read = s.and_then(|s| Some((num(s, "x")?, num(s, "y")?, num(s, "w")?, num(s, "h")?)));
        let mut slot = match read {
            Some((x, y, w, h)) => {
                let scale = if half_step { COLS_SCALE_V3_TO_V4 } else { 1 };
                Slot { x: x as i32 * scale, y: y as i32, w: w as i32 * scale, h: h as i32, h_prev: None, manual: false, user_resized: false }
            }
            None => reference_slots[k],
        };
        slot.w = slot.w.clamp(1, cols.max(1));
        slot.x = slot.x.clamp(0, (cols - slot.w).max(0));
        slot.y = slot.y.max(0);
        slot.h = slot.h.max(1);
        slot.h_prev = s.and_then(|s| num(s, "hPrev")).filter(|h| *h >= 1).map(|h| h as i32);
        slot.user_resized = s.and_then(|s| s.get("userResized")) == Some(&Value::Bool(true));
        slot.manual = slot.user_resized || s.and_then(|s| s.get("manual")) == Some(&Value::Bool(true));
        slots.push((d.id.to_string(), slot));
    }
    let collapsed = tab
        .get("collapsed")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|id| declared.iter().any(|d| d.id == *id)).map(String::from).collect())
        .unwrap_or_default();
    TabLayout { slots, collapsed }
}

impl TabLayout {
    pub fn slot(&self, id: &str) -> Option<&Slot> {
        self.slots.iter().find(|(i, _)| i == id).map(|(_, s)| s)
    }

    pub fn is_collapsed(&self, id: &str) -> bool {
        self.collapsed.iter().any(|c| c == id)
    }

    /// Folds or unfolds a card. Folding remembers the height (`hPrev`); unfolding gives it back.
    pub fn toggle_collapsed(&mut self, id: &str, collapsed_rows: i32) {
        let folded = self.is_collapsed(id);
        let Some((_, slot)) = self.slots.iter_mut().find(|(i, _)| i == id) else { return };
        if folded {
            slot.h = slot.h_prev.take().unwrap_or(REEXPAND_DEFAULT_ROWS);
            self.collapsed.retain(|c| c != id);
        } else {
            slot.h_prev = Some(slot.h);
            slot.h = collapsed_rows.max(1);
            self.collapsed.push(id.to_string());
        }
    }

    /// The grid model's items; an item's `id` is the card's index in `slots`.
    pub fn items(&self) -> Vec<Item> {
        self.slots.iter().enumerate().map(|(k, (_, s))| Item { id: k as u32, x: s.x, y: s.y, w: s.w, h: s.h, manual: s.manual, user_resized: s.user_resized }).collect()
    }

    /// Writes back the rectangles a finished gesture produced. `hPrev` survives; `manual` and
    /// `userResized` are kept, and set on a card whose height the gesture changed by hand.
    pub fn save_items(&mut self, items: &[Item], resized: Option<u32>) {
        for it in items {
            let (_, slot) = &mut self.slots[it.id as usize];
            let height_changed = resized == Some(it.id) && slot.h != it.h;
            let user_resized = slot.user_resized || (it.user_resized && height_changed);
            let manual = slot.manual || (it.manual && height_changed) || user_resized;
            *slot = Slot { x: it.x, y: it.y, w: it.w, h: it.h, h_prev: slot.h_prev, manual, user_resized };
        }
    }

    /// The stored JSON shape, stamped with the current schema version.
    pub fn to_json(&self) -> Value {
        let mut cards = Map::new();
        for (id, s) in &self.slots {
            let mut o = json!({"x": s.x, "y": s.y, "w": s.w, "h": s.h});
            if let Some(p) = s.h_prev { o["hPrev"] = json!(p); }
            if s.manual { o["manual"] = json!(true); }
            if s.user_resized { o["userResized"] = json!(true); }
            cards.insert(id.clone(), o);
        }
        json!({"v": reference().ui_sections_version, "cards": cards, "collapsed": self.collapsed})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARDS: [Decl; 4] = [
        Decl { id: "a", wide: false },
        Decl { id: "b", wide: false },
        Decl { id: "log", wide: true },
        Decl { id: "c", wide: false },
    ];

    #[test]
    fn reference_layout_reads_left_to_right_and_wide_takes_the_row() {
        let s = default_slots(&CARDS, 15);
        assert_eq!((s[0].x, s[0].y, s[0].w), (0, 0, 6));
        assert_eq!((s[1].x, s[1].y, s[1].w), (6, 0, 6));
        assert_eq!((s[2].x, s[2].y, s[2].w), (0, DEFAULT_CARD_ROWS, 15), "wide card drops below and spans");
        assert_eq!((s[3].x, s[3].y), (0, 2 * DEFAULT_CARD_ROWS));
    }

    #[test]
    fn reference_layout_fits_a_narrow_pane() {
        let s = default_slots(&CARDS, 4);
        assert!(s.iter().all(|s| s.w <= 4 && s.x == 0));
    }

    #[test]
    fn missing_or_unreadable_slots_take_their_reference_place() {
        let raw = json!({"v": 5, "cards": {"a": {"x": 1, "y": 2, "w": 3, "h": 4}, "b": "junk"}});
        let l = migrate(Some(&raw), &CARDS, 15);
        assert_eq!(l.slot("a"), Some(&Slot { x: 1, y: 2, w: 3, h: 4, h_prev: None, manual: false, user_resized: false }));
        assert_eq!(l.slot("b").unwrap().x, default_slots(&CARDS, 15)[1].x);
        assert_eq!(l.slots.len(), CARDS.len());
    }

    #[test]
    fn stored_slots_are_clamped_into_the_current_columns_without_saving() {
        let raw = json!({"v": 5, "cards": {"a": {"x": 10, "y": 0, "w": 9, "h": 4}}});
        let l = migrate(Some(&raw), &CARDS, 6);
        assert_eq!((l.slot("a").unwrap().x, l.slot("a").unwrap().w), (0, 6));
        assert_eq!(raw["cards"]["a"]["w"], json!(9), "the stored value is untouched");
    }

    #[test]
    fn pre_v4_columns_are_doubled() {
        let raw = json!({"v": 3, "cards": {"a": {"x": 1, "y": 3, "w": 4, "h": 14}}});
        let s = *migrate(Some(&raw), &CARDS, 20).slot("a").unwrap();
        assert_eq!((s.x, s.w, s.y, s.h), (2, 8, 3, 14));
    }

    #[test]
    fn fold_remembers_and_restores_the_height() {
        let mut l = migrate(None, &CARDS, 15);
        let h = l.slot("b").unwrap().h;
        l.toggle_collapsed("b", 2);
        assert!(l.is_collapsed("b"));
        assert_eq!((l.slot("b").unwrap().h, l.slot("b").unwrap().h_prev), (2, Some(h)));
        let back = migrate(Some(&l.to_json()), &CARDS, 15);
        assert_eq!(back, l, "fold survives a save and reload");
        l.toggle_collapsed("b", 2);
        assert_eq!((l.slot("b").unwrap().h, l.slot("b").unwrap().h_prev), (h, None));
    }

    #[test]
    fn write_back_keeps_marks_and_marks_a_hand_resized_height() {
        let mut l = migrate(None, &CARDS, 15);
        l.toggle_collapsed("a", 2);
        let mut items = l.items();
        items[1].h += 3;
        items[1].manual = true;
        items[1].user_resized = true;
        l.save_items(&items, Some(1));
        assert!(l.slot("b").unwrap().manual);
        assert_eq!(l.slot("a").unwrap().h_prev, Some(DEFAULT_CARD_ROWS), "hPrev survives a write-back");
        let mut items = l.items();
        items[3].x = 7;
        l.save_items(&items, None);
        assert!(!l.slot("c").unwrap().manual, "a move never marks a height");
    }

    #[test]
    fn json_round_trip_and_version_stamp() {
        let l = migrate(None, &CARDS, 15);
        let j = l.to_json();
        assert_eq!(j["v"], json!(reference().ui_sections_version));
        assert_eq!(migrate(Some(&j), &CARDS, 15), l);
    }

    #[test]
    fn unknown_collapsed_ids_are_dropped() {
        let raw = json!({"v": 5, "cards": {}, "collapsed": ["a", "gone", 3]});
        assert_eq!(migrate(Some(&raw), &CARDS, 15).collapsed, vec!["a".to_string()]);
    }
}
