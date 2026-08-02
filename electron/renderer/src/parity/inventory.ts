import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The action inventory, READ from the document rather than copied into code.
 *
 * Same discipline as the settings coverage guard, which reads DEFAULT_CONFIG
 * from Python on every run: a list transcribed by hand is a list that drifts,
 * and a parity check that drifts is worse than none -- it reassures wrongly.
 *
 * Node-only: this module is imported by tests, never by the renderer bundle.
 */
const INVENTORY = path.join(
  __dirname,
  "..", "..", "..", "..", // parity -> src -> renderer -> electron -> repo root
  "docs",
  "INVENTAIRE_ACTIONS.md",
);

export interface ActionEntry {
  id: string;
  family: string;
  label: string;
  origin: string;
  removed: boolean;
}

/** Rows look like: `| D3 | Cocher la sélection | \`_demo_picker_set_selected(True)\` |` */
const ROW = /^\|\s*(\*\*)?([A-P]\d+)(\*\*)?\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;

export function readActionInventory(): ActionEntry[] {
  const text = readFileSync(INVENTORY, "utf8");
  const entries: ActionEntry[] = [];
  let family = "";

  for (const line of text.split(/\r?\n/)) {
    // Stop before the "Couverture par le pont" section — its table rows
    // reuse action IDs and would produce duplicates. The plan warned about
    // this; the uniqueness test in inventory.test.ts catches it if the
    // boundary moves.
    if (/^## Couverture/.test(line)) break;

    const heading = /^##\s+([A-P])\s+—\s+(.+)$/.exec(line);
    if (heading) {
      family = heading[2];
      continue;
    }
    const row = ROW.exec(line);
    if (!row) continue;
    const [, , id, , label, origin] = row;
    entries.push({
      id,
      family,
      label: label.replace(/\*\*/g, "").trim(),
      origin: origin.replace(/`/g, "").trim(),
      removed: /supprim/i.test(label),
    });
  }

  if (entries.length === 0) {
    // Fail fast: an empty parse would make every downstream check vacuous.
    throw new Error(`no action rows parsed from ${INVENTORY} -- has its table format changed?`);
  }
  return entries;
}
