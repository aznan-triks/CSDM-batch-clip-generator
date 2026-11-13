//! Card grid model, toolkit-free (from the ticket 06 prototype, `proto/common/src/grid.rs`).
//! Same rules as 3.5.x's react-grid-layout setup (`shell/SectionList.tsx`): vertical
//! compaction, a moved or resized card pushes what it hits downwards, a resized card
//! keeps its height (`manual`), every other card's height follows its content.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Item { pub id: u32, pub x: i32, pub y: i32, pub w: i32, pub h: i32, pub manual: bool }

/// Pixel geometry of the grid: `cols` columns of `col` px, rows of `row` px, `gap` px between.
#[derive(Clone, Copy, Debug)]
pub struct Geom { pub cols: i32, pub col: f32, pub row: f32, pub gap: f32 }

impl Geom {
    /// Card rectangle in px: (x, y, w, h).
    pub fn rect(&self, it: &Item) -> (f32, f32, f32, f32) {
        let span = |n: i32, unit: f32| n as f32 * unit + (n - 1).max(0) as f32 * self.gap;
        (it.x as f32 * (self.col + self.gap), it.y as f32 * (self.row + self.gap), span(it.w, self.col), span(it.h, self.row))
    }
    /// Pointer travel in px → whole cells (nearest).
    pub fn cells(&self, dx: f32, dy: f32) -> (i32, i32) {
        ((dx / (self.col + self.gap)).round() as i32, (dy / (self.row + self.gap)).round() as i32)
    }
    /// Rows a card needs to show `content_px` of content.
    pub fn rows_for(&self, content_px: f32) -> i32 {
        (((content_px + self.gap) / (self.row + self.gap)).ceil() as i32).max(1)
    }
}

fn hits(a: &Item, b: &Item) -> bool {
    a.id != b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/// Vertical compaction: each card, top to bottom, rises until it touches another.
pub fn compact(items: &mut [Item]) {
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by_key(|&i| (items[i].y, items[i].x, items[i].id));
    let mut placed: Vec<Item> = Vec::with_capacity(items.len());
    for i in order {
        let mut it = items[i];
        while it.y > 0 && !placed.iter().any(|p| hits(&Item { y: it.y - 1, ..it }, p)) { it.y -= 1; }
        while let Some(p) = placed.iter().find(|p| hits(&it, p)) { it.y = p.y + p.h; }
        placed.push(it);
        items[i] = it;
    }
}

/// Moves every card hit by `items[k]` below it, recursively.
fn push_down(items: &mut [Item], k: usize) {
    let me = items[k];
    for j in 0..items.len() {
        if hits(&me, &items[j]) {
            items[j].y = me.y + me.h;
            push_down(items, j);
        }
    }
}

fn index(items: &[Item], id: u32) -> usize { items.iter().position(|i| i.id == id).expect("unknown card id") }

pub fn move_card(items: &mut [Item], id: u32, x: i32, y: i32, cols: i32) {
    let k = index(items, id);
    items[k].x = x.clamp(0, (cols - items[k].w).max(0));
    items[k].y = y.max(0);
    push_down(items, k);
    compact(items);
}

pub fn resize_card(items: &mut [Item], id: u32, w: i32, h: i32, cols: i32) {
    let k = index(items, id);
    items[k].w = w.clamp(1, cols - items[k].x);
    items[k].h = h.max(1);
    items[k].manual = true;
    push_down(items, k);
    compact(items);
}

/// Height follows content unless the user sized the card. Returns true if anything changed.
pub fn fit(items: &mut [Item], id: u32, rows: i32) -> bool {
    let k = index(items, id);
    if items[k].manual || items[k].h == rows { return false; }
    items[k].h = rows;
    // Compaction only (as react-grid-layout on a height change): it walks cards top to
    // bottom, so their order never changes, whatever order the measurements arrive in.
    compact(items);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    const C: i32 = 12;

    /// Starting layout for the prototypes: five cards, two columns of cards on a 12-column grid.
    pub fn demo_layout() -> Vec<Item> {
        let it = |id, x, y, w| Item { id, x, y, w, h: 4, manual: false };
        let mut v = vec![it(1, 0, 0, 5), it(2, 5, 0, 7), it(3, 0, 4, 5), it(4, 5, 4, 7), it(5, 0, 8, 12)];
        compact(&mut v);
        v
    }

    fn get(v: &[Item], id: u32) -> Item { v[index(v, id)] }
    fn no_overlap(v: &[Item]) { for a in v { for b in v { assert!(!hits(a, b), "{a:?} overlaps {b:?}"); } } }

    #[test]
    fn compaction_closes_gaps() {
        let mut v = vec![Item { id: 1, x: 0, y: 5, w: 4, h: 2, manual: false }];
        compact(&mut v);
        assert_eq!(get(&v, 1).y, 0);
    }

    #[test]
    fn moving_onto_a_card_pushes_it_down() {
        let mut v = demo_layout();
        move_card(&mut v, 3, 0, 0, C); // card 3 dropped on card 1's spot
        assert_eq!((get(&v, 3).x, get(&v, 3).y), (0, 0));
        assert_eq!(get(&v, 1).y, get(&v, 3).h);
        no_overlap(&v);
    }

    #[test]
    fn move_is_clamped_to_the_grid() {
        let mut v = demo_layout();
        move_card(&mut v, 1, 50, -3, C);
        assert_eq!((get(&v, 1).x, get(&v, 1).y), (C - get(&v, 1).w, 0));
        no_overlap(&v);
    }

    #[test]
    fn resized_card_keeps_its_height_against_content() {
        let mut v = demo_layout();
        resize_card(&mut v, 2, 6, 9, C);
        assert!(get(&v, 2).manual);
        assert!(!fit(&mut v, 2, 3));
        assert_eq!(get(&v, 2).h, 9);
        no_overlap(&v);
    }

    #[test]
    fn content_height_drives_the_others() {
        let mut v = demo_layout();
        assert!(fit(&mut v, 1, 10));
        assert_eq!(get(&v, 1).h, 10);
        assert_eq!(get(&v, 3).y, 10); // the card below followed
        no_overlap(&v);
    }

    #[test]
    fn transient_measures_never_reorder_cards() {
        // Startup: every card first measured huge (window not sized yet), in any order, then right.
        for order in [[1u32, 2, 3, 4, 5], [5, 4, 3, 2, 1], [4, 2, 3, 5, 1], [3, 5, 1, 4, 2]] {
            let mut v = demo_layout();
            let rank = |v: &[Item]| { let mut ids: Vec<u32> = v.iter().map(|i| i.id).collect(); ids.sort_by_key(|id| (get(v, *id).y, get(v, *id).x)); ids };
            let before = rank(&v);
            for id in order { fit(&mut v, id, 20 + 7 * id as i32); }
            for id in order { fit(&mut v, id, 3); }
            assert_eq!(rank(&v), before, "order {order:?}");
            no_overlap(&v);
        }
    }

    #[test]
    fn geometry_round_trip() {
        let g = Geom { cols: C, col: 100.0, row: 24.0, gap: 12.0 };
        assert_eq!(g.cells(120.0, -40.0), (1, -1));
        assert_eq!(g.rows_for(24.0), 1);
        assert_eq!(g.rows_for(60.0), 2); // 2 rows = 24 + 12 + 24 = 60 px
        assert_eq!(g.rows_for(61.0), 3);
        assert_eq!(g.rect(&Item { id: 0, x: 1, y: 1, w: 2, h: 2, manual: false }), (112.0, 36.0, 212.0, 60.0));
    }
}
