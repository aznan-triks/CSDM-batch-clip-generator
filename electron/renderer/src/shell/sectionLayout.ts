/**
 * Persisted per-tab section order and fold state (ui_sections, one new
 * settings key -- an app preference, never a preset: presets are run
 * configuration, this is display state, decided in conversation 2026-08-01).
 *
 * Reconciliation runs on every read, never on write: a stored id that is no
 * longer declared is dropped, a declared id missing from storage is appended
 * at the end, in declaration order. A card can never disappear because of
 * stale state left by a previous version of a tab.
 */
import { useSetting } from "../settings/store";

interface TabLayout {
  order: string[];
  collapsed: string[];
}

type UiSections = Record<string, TabLayout>;

export interface SectionLayout {
  order: string[];
  isCollapsed(id: string): boolean;
  toggleCollapsed(id: string): void;
  reorder(draggedId: string, targetId: string): void;
}

export function useSectionLayout(tabId: string, defaultOrder: readonly string[]): SectionLayout {
  const [stored, setStored] = useSetting<UiSections>("ui_sections");
  const layout = stored?.[tabId];

  const known = new Set(defaultOrder);
  const storedOrder = (layout?.order ?? []).filter((id) => known.has(id));
  const missing = defaultOrder.filter((id) => !storedOrder.includes(id));
  const order = [...storedOrder, ...missing];
  const collapsed = new Set((layout?.collapsed ?? []).filter((id) => known.has(id)));

  function persist(nextOrder: string[], nextCollapsed: Set<string>): void {
    setStored({ ...(stored ?? {}), [tabId]: { order: nextOrder, collapsed: [...nextCollapsed] } });
  }

  return {
    order,
    isCollapsed(id) {
      return collapsed.has(id);
    },
    toggleCollapsed(id) {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(order, next);
    },
    reorder(draggedId, targetId) {
      if (draggedId === targetId) return;
      const without = order.filter((id) => id !== draggedId);
      const targetIndex = without.indexOf(targetId);
      if (targetIndex === -1) return;
      const next = [...without.slice(0, targetIndex), draggedId, ...without.slice(targetIndex)];
      persist(next, collapsed);
    },
  };
}
