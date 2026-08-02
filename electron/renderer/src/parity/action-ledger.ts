/**
 * The action parity ledger. Same two-list shape as the settings ledger, and
 * for the same reason: "not ported" and "will never be ported" are different
 * statements, and collapsing them lets a gap hide behind a design decision.
 *
 *  - NO_PORT_BY_DESIGN: the action has no meaning in this shell. Each carries
 *    its reason. This list is stable.
 *  - NOT_YET_PORTED: the action exists in Tkinter and does not exist here yet.
 *    Temporary. It MUST shrink at every chantier and can never grow back --
 *    an id removed from it and later re-added is a regression dressed up as
 *    bookkeeping.
 *
 * Both are checked against docs/INVENTAIRE_ACTIONS.md on every run: an id in
 * neither the inventory nor the interface fails the suite.
 */
export const NO_PORT_BY_DESIGN: Record<string, string> = {
  // Fill during phase 4 from what the audit actually finds.
};

export const NOT_YET_PORTED: Record<string, string> = {
  // Fill during phase 4. Every entry is a promise to someone.
};
