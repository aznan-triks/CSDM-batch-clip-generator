/**
 * The action parity ledger. Same two-list shape as the settings ledger, and
 * for the same reason: "not ported" and "will never be ported" are different
 * statements, and collapsing them lets a gap hide behind a design decision.
 *
 *  - NO_PORT_BY_DESIGN: the action has no meaning in this shell. Each carries
 *    its reason. This list is stable.
 *  - NOT_YET_PORTED: the action exists in Tkinter and does not exist here yet.
 *    Temporary. It MUST shrink at every chantier and can never grow back —
 *    an id removed from it and later re-added is a regression dressed up as
 *    bookkeeping.
 *  - PORTED_BEHIND_STATE: ported, but its control only mounts behind data or
 *    a state the test cannot create (a DB row, an open dialog, a pending
 *    question). Each names where it mounts; its marker must exist in the
 *    source.
 *
 * Both are checked against docs/INVENTAIRE_ACTIONS.md on every run: an id in
 * neither the inventory nor the interface fails the suite.
 */
export const NO_PORT_BY_DESIGN: Record<string, string> = {
  /* ─── Tooltips & infobulles — CSS title / :hover ─── */
  C6: "Infobulle de preset : tooltip CSS (attribut title ou aria-label)",
  D7: "Infobulle de ligne : tooltip CSS",
  O5: "Infobulles au survol : rendu CSS, pas une action déclenchable",

  /* ─── Tkinter internes — mécaniques Tk sans équivalent UI ─── */
  E4: "Recalcul case de catégorie : Tk checkbutton interne, pas de pendant DOM",
  P8: "Décochage automatique : logique Tk interne sans bouton",

  /* ─── OS / plateforme — géré par le système ou le navigateur ─── */
  F6: "Mois précédent/suivant : input type=date natif du navigateur",
  F7: "Aujourd'hui : bouton natif du date picker HTML",
  F8: "Effacer : bouton natif du date picker HTML",
  F9: "Choisir un jour : clic sur cellule du date picker natif",
  F10: "Fermeture sur perte de focus : comportement natif du date picker",
  M4: "Palette système / OK / Annuler : color picker natif du navigateur",
  O3: "Redimensionner la fenêtre : OS window manager, pas une action applicative",
  N2: "Focus entrant/sortant : comportement HTML implicite, pas un bouton",

  /* ─── Menu contextuel OS — hors de portée du DOM applicatif ─── */
  J8: "Menu contextuel clic droit : rendu OS natif",
  J9: "— Copier la ligne : dans le menu contextuel OS",
  J11: "— Tout sélectionner : dans le menu contextuel OS",
  J13: "— Effacer : dans le menu contextuel OS",

  /* ─── Absorbées par un contrôle générique du registre ─── */
  D6: "Changer de mode de sélection : pas de sélecteur — clic / Ctrl+clic / Maj+clic sur les lignes du DemoPicker (D5) donnent simple / étendu / plage",
  G4: "Bascule « high velocity » : absorbé par le registre — FERRARI PEEK est une ligne de filtre ordinaire (G1)",
  G5: "Bascule « no trois shot » : absorbé par le registre — l'exclusion de TROIS SHOT est la case Exclure générique (G2), v208",
  G6: "Changement de logique ET/OU : retiré en v124 — un modèle fixe, imposé par le moteur (build_run_cfg, fix B)",
  N0: "Ouvrir le sélecteur de joueurs : pas de sélecteur à ouvrir — la liste des joueurs est toujours affichée (Capture › Player)",
};

export const NOT_YET_PORTED: Record<string, string> = {
  /* ── C. Presets ── */
  C1: "Chargement rapide depuis la liste d'en-tête — Navigation par presets non portée",
  C2: "Sauvegarde rapide depuis l'en-tête — Navigation par presets non portée",

  /* ── E. Filtres d'armes ── */
  E3: "Cocher/décocher une catégorie entière — toggle de catégorie non porté",

  /* ── L. Options HLAE ── */
  L4: "Basculer en résolution libre — mode libre non porté",
  L9: "Enregistrer le nom d'assemblage courant — sauvegarde nom assemblage non portée",

  /* ── M. Réglages ── */
  M9: "Bascule « partielle » — injection partielle non portée",
  M10: "Bascule « complète » — injection complète absente ; le marqueur était posé par erreur sur Test & Reload",

  /* ── N. Joueurs ── */
  N5: "Première page — pagination joueurs partielle",
  N8: "Dernière page — pagination joueurs partielle",
  N9: "Aller à une page (Entrée) — saut de page non porté",

  /* ── P. États & dialogues ── */
  P5: "Compteurs de logs par niveau — rendu dans LogConsole (badges), pas un data-action",
};

/**
 * Ported; mounts only behind data or a state the coverage test cannot create
 * (an empty list by default, a DB fetch the test never resolves, a dialog or
 * ask-panel that only opens after a user action). id → where it mounts.
 */
export const PORTED_BEHIND_STATE: Record<string, string> = {
  /* ── C. Presets ── */
  C4: "PresetSection.tsx — bouton Load par preset ; la liste des presets est vide par défaut",

  /* ── D. Sélection de démos ── */
  D5: "DemoPicker.tsx — ligne de démo ; aucune ligne sans liste de démos",

  /* ── E. Filtres d'armes ── */
  E1: "weaponFilter/WeaponFilterCard.tsx — Select all, dans les trois styles ; la carte attend useTables() et la base",
  E2: "weaponFilter/WeaponFilterCard.tsx — Deselect all ; même garde que E1",

  /* ── G. Filtres de kills ── */
  G1: "components/cardstyle/Filter{Matrix,Sentence,Tiles}.tsx — Enable d'une ligne de filtre, dans les trois styles ; la carte attend useTables()",
  G2: "components/cardstyle/Filter{Matrix,Sentence,Tiles}.tsx — Exclude d'une ligne de filtre ; même garde que G1",
  G3: "filterCards/shared.tsx — bouton Clear de Kill Filters ; même garde tables que G1/G2",

  /* ── H. Filtres de match ── */
  H1: "matchTypes/useMatchTypes.tsx — case d'un type de match (3 styles) ; aucune case tant que useTables() n'a pas répondu",
  H2: "mapFilter/useMapFilter.tsx — choix d'une carte (3 styles) ; aucune carte tant que useDatabase() n'a pas répondu",

  /* ── I. Tags ── */
  I3: "tagCards/actions.tsx — puce/tuile de tag ; aucune sans tags chargés",

  /* ── J. Logs ── */
  J5: "LogConsole.tsx — ▼ occurrence suivante ; affiché seulement pendant une recherche (Entrée fait de même)",
  J6: "LogConsole.tsx — ▲ occurrence précédente ; même garde que J5 (Maj+Entrée fait de même)",
  J7: "LogConsole.tsx — bouton Esc (fermer la recherche) ; même garde que J5 (Échap fait de même)",
  J14: "LogConsole.tsx — Export ▾ › Console log › Text (.txt) ; dans le menu, monté seulement une fois ouvert",

  /* ── K. Export ── */
  K2: "LogConsole.tsx — Export ▾ › Preview clip list › HTML ; même garde que J14 (commande export_preview)",
  K3: "LogConsole.tsx — Export ▾ › Preview clip list › Text ; même garde que J14",
  K4: "LogConsole.tsx — Export ▾ › Preview clip list › JSON ; même garde que J14",

  /* ── L. Options HLAE ── */
  L3: "resolution/ResolutionCard.tsx — Segmented des résolutions ; masqué tant que useTables() n'a pas répondu (contrairement au Segmented FPS voisin, qui reste monté avec des options vides)",
  L6: "hlaeOptions/HlaeOptionsCard.tsx — boutons de vitesse rapide (3 styles) ; la carte n'est montée qu'en mode HLAE (recsys)",
  L8: "hlaeOptions/HlaeOptionsCard.tsx — réglage Game Speed (%), 3 styles ; même garde recsys que L6",

  /* ── M. Réglages ── */
  M8: "LogConsole.tsx — Export ▾ › Inspect › CS2 injection preview, écrit dans la console (commande injection_preview) ; même garde que J14",

  /* ── N. Joueurs ── */
  N3: "player/parts.tsx — Segmented de tri par nom ; dans le bloc `{database && (...)}`, monté seulement une fois la base connectée",
  N4: "player/parts.tsx — Segmented de tri par date ; même garde que N3",
  N6: "player/parts.tsx — page précédente ; même garde database que N3/N4",
  N7: "player/parts.tsx — page suivante ; même garde database que N3/N4",
  N10: "player/parts.tsx — ★ sur une ligne de résultat ; la liste de résultats n'est montée qu'une fois la base connectée",
  N12: "player/parts.tsx — × (CloseButton) sur une puce de compte enregistré ; ne s'affiche que si saved_players contient au moins une entrée",
  N13: "player/parts.tsx — ligne de résultat (role=checkbox) ; même garde database que N10",

  /* ── P. États & dialogues ── */
  P4: "LogConsole.tsx — ligne d'état éphémère (flash) ; n'existe que 3 s après un enregistrement, un export ou une erreur",
  P6: "LogConsole.tsx — bouton de choix du panneau #ask-panel ; affiché seulement pendant une question du moteur en cours",
  P7: "LogConsole.tsx — bouton OK d'erreur du panneau #ask-panel ; même garde que P6",
  P9: "ConfirmDialog.tsx — Cancel/Confirm ; rendu par portail seulement pendant une confirmation de suppression en cours",
  P10: "PresetSection.tsx — message de succès après SAVE ; absent tant qu'aucune sauvegarde n'a eu lieu",
};
