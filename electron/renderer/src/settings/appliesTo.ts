/**
 * Which events a registry filter judges -- a pure helper, kept out of the
 * `useTables` hook module so a test that mocks the hook still gets the real
 * rule.
 */
import type { EventCategory, FilterDef } from "./useTables";

/** `def.applies_to`, with Python's own default (`("kill",)`) when absent. */
export function appliesTo(def: FilterDef): EventCategory[] {
  return def.applies_to ?? ["kill"];
}
