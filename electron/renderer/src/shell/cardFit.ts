/**
 * How tall a card's content really is, in the grid's fine rows.
 *
 * A card's content height is not a constant: it depends on the card style
 * (timeline / sentence / tiles) and on the width the pane gives it. A fixed
 * default row count (`ui_sections` in csdm/config.py) fits one style at one
 * width and scrolls or leaves a gap everywhere else (fix/cards-fit-style,
 * e2e/card-fit-proof.mjs). SectionList asks this module instead, for every
 * card the user has not resized by hand.
 *
 * Only layout reads, never a write: no measuring pass that toggles a class
 * and reads back, so a ResizeObserver callback can call it without dirtying
 * layout (no thrash loop).
 */

/**
 * Fine rows needed to show `px` of card: `rows * rowHeight + (rows - 1) * gap`
 * must reach it. Half a pixel of slack so a height the grid itself produced
 * (and that measures back with subpixel noise) maps back to the same row
 * count instead of creeping up one row per measurement.
 */
export function rowsFor(px: number, rowHeight: number, gap: number): number {
  return Math.max(1, Math.ceil((px - 0.5 + gap) / (rowHeight + gap)));
}

/**
 * The boxes a body actually lays out: its element children, with any
 * `display: contents` wrapper (SettingControl's `.setting`, which wraps a
 * whole card's content in some cards) replaced by its own children -- such a
 * wrapper has no box to measure or to observe.
 */
export function layoutChildren(parent: Element): HTMLElement[] {
  const boxes: HTMLElement[] = [];
  for (const child of parent.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (getComputedStyle(child).display === "contents") boxes.push(...layoutChildren(child));
    else boxes.push(child);
  }
  return boxes;
}

/**
 * The bottom of `child` inside `scroller`, from the scroller's padding edge,
 * margin included. Offsets, not bounding rects, whenever the scroller is the
 * child's offset parent (Card's `.sb` is `position: relative`): an ancestor's
 * transform -- a tab's entrance animation -- scales rects but not offsets.
 */
function childBottom(child: HTMLElement, scroller: HTMLElement, style: CSSStyleDeclaration): number {
  const margin = parseFloat(style.marginBottom) || 0;
  if (child.offsetParent === scroller) return child.offsetTop + child.offsetHeight + margin;
  const top = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
  return child.getBoundingClientRect().bottom - top + margin;
}

/**
 * Rows the grid item `node` needs so its `.sb-scroll` body neither scrolls nor
 * sits empty below its content. `null` when there is nothing trustworthy to
 * measure:
 *   - the card is not laid out (its tab is hidden: `display: none`);
 *   - a body child grows to fill the card (PlayerSection: its list scrolls
 *     inside it by design) -- such a card has no natural height, its extent
 *     would just echo the card's own, so its height stands -- unless the
 *     body overflows, in which case the card grows by the overflow.
 */
export function naturalRows(node: HTMLElement, rowHeight: number, gap: number): number | null {
  const scroller = node.querySelector(".sb-scroll");
  if (!(scroller instanceof HTMLElement)) return null;
  if (node.offsetHeight === 0 || scroller.clientWidth === 0) return null;

  let extent = 0;
  for (const child of layoutChildren(scroller)) {
    const style = getComputedStyle(child);
    if (style.position === "absolute" || style.position === "fixed" || style.display === "none") continue;
    if (parseFloat(style.flexGrow) > 0) {
      // A filling body has no natural height, but one that still overflows
      // (its fixed parts outgrew the card) says by how much: grow by that.
      const overflow = scroller.scrollHeight - scroller.clientHeight;
      return overflow > 0 ? rowsFor(node.offsetHeight + overflow, rowHeight, gap) : null;
    }
    extent = Math.max(extent, childBottom(child, scroller, style));
  }
  extent += parseFloat(getComputedStyle(scroller).paddingBottom) || 0;

  // Everything around the body -- header, separator, borders -- is the card's
  // height minus the body's; the body always takes what is left (Card.css).
  const chrome = node.offsetHeight - scroller.clientHeight;
  return rowsFor(chrome + extent, rowHeight, gap);
}
