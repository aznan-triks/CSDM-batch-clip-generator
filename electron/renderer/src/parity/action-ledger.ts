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
};

export const NOT_YET_PORTED: Record<string, string> = {
  /* ── B. Base de données ── */
  B1: "Connecter + charger (joueurs, armes, schéma) — le connect existe, le chargement complet non",

  /* ── C. Presets ── */
  C1: "Chargement rapide depuis la liste d'en-tête — Navigation par presets non portée",
  C2: "Sauvegarde rapide depuis l'en-tête — Navigation par presets non portée",
  C4: "Charger un preset nommé — le bouton existe mais dépend de la liste d'en-tête",

  /* ── D. Sélection de démos ── */
  D5: "Cocher/décocher une ligne au clic — le handleRowClick existe mais la sélection visuelle diffère",
  D6: "Changer de mode de sélection — mode single/range/extended non porté",

  /* ── E. Filtres d'armes ── */
  E1: "Tout sélectionner — bouton présent mais non rendu sans données DB",
  E2: "Tout désélectionner — idem",
  E3: "Cocher/décocher une catégorie entière — toggle de catégorie non porté",

  /* ── F. Filtres de date ── */
  F2: "Ouvrir le calendrier « jusqu'à » — DateField réutilisé, porté via F1",

  /* ── G. Filtres de kills ── */
  G1: "Activer un filtre (× N filtres du registre) — FilterRow porté mais pas tous les filtres",
  G2: "Exclure un filtre (× N filtres) — FilterRow porté mais pas tous les filtres",
  G3: "Tout désélectionner — bouton présent mais non rendu sans données DB",
  G4: "Bascule « high velocity » — filtre spécial kill non porté",
  G5: "Bascule « no trois shot » — filtre spécial kill non porté",
  G6: "Changement de logique ET/OU — logique combinée des filtres non portée",

  /* ── H. Filtres de match ── */
  H1: "Cocher/décocher un type de match — rendu depuis la DB, non vérifiable sans données",
  H2: "Cocher/décocher une map — rendu depuis la DB, non vérifiable sans données",

  /* ── I. Tags ── */
  I3: "Cocher/décocher un tag — le chip toggle existe mais le rendu dépend des données",

  /* ── J. Logs ── */
  J4: "Ouvrir la recherche (Ctrl+F) — barre de recherche non portée dans la console HTML",
  J5: "Occurrence suivante (Entrée) — dépend de J4",
  J6: "Occurrence précédente — dépend de J4",
  J7: "Fermer la recherche (Échap) — dépend de J4",
  J14: "Enregistrer les logs dans un fichier — export fichier non porté",

  /* ── K. Export ── */
  K2: "Exporter en HTML — l'export HTML existe mais le menu Export est partiel",
  K3: "Exporter en texte — export TXT non porté",
  K4: "Exporter en JSON — export JSON non porté",

  /* ── L. Options HLAE ── */
  L1: "Changer le codec vidéo — sélecteur de codec non porté",
  L2: "Changer le codec audio — sélecteur de codec audio non porté",
  L3: "Choisir une résolution prédéfinie — résolutions prédéfinies non portées",
  L4: "Basculer en résolution libre — mode libre non porté",
  L5: "Changer la perspective — sélecteur de perspective non porté",
  L6: "Changer la vitesse de jeu — les boutons quick existent mais HlaeOptionsSection n'est monté qu'en mode HLAE",
  L7: "Changer le système d'enregistrement — sélecteur recording system non porté",
  L8: "Régler le ralenti HLAE — sliders slow motion non portés",
  L9: "Enregistrer le nom d'assemblage courant — sauvegarde nom assemblage non portée",

  /* ── M. Réglages ── */
  M1: "Choisir un fond — sélecteur de thème (ground) non porté",
  M2: "Choisir un accent — les swatches existent, le select est non vérifiable sans rendu complet",
  M3: "Choisir une couleur d'accent libre — color input natif présent via le label Custom",
  M8: "Rafraîchir l'aperçu d'injection — preview HLAE non porté",
  M9: "Bascule « partielle » — injection partielle non portée",
  M11: "Régler le curseur dp2 — slider dp2 non porté",

  /* ── N. Joueurs ── */
  N0: "Ouvrir le sélecteur de joueurs — PlayerPicker non porté",
  N1: "Saisir une recherche — champ de recherche joueurs non porté",
  N3: "Trier par nom — tri du sélecteur joueurs non porté",
  N4: "Trier par date — tri du sélecteur joueurs non porté",
  N5: "Première page — pagination joueurs partielle",
  N6: "Page précédente — bouton présent, non vérifiable sans données DB",
  N7: "Page suivante — bouton présent, non vérifiable sans données DB",
  N8: "Dernière page — pagination joueurs partielle",
  N9: "Aller à une page (Entrée) — saut de page non porté",
  N10: "Cocher/décocher un joueur enregistré — bouton présent, dépend des données DB",
  N11: "Monter / descendre un joueur — réordonnancement non porté",
  N12: "Retirer un joueur — suppression joueur enregistré non portée",
  N13: "Sélectionner dans la liste — sélection liste de résultats non portée",

  /* ── O. Interface ── */
  O2: "Déplacer le séparateur — le split handle existe, l'action DOM est mousedown sans data-action",

  /* ── P. États & dialogues ── */
  P1: "Boutons désactivés pendant une exécution — état implicite, pas un bouton",
  P2: "Libellé de progression — rendu dans WeaponBand, pas un data-action",
  P3: "Ligne de résumé — rendu dans WeaponBand, pas un data-action",
  P4: "Message éclair dans les logs — rendu dans LogConsole, pas un data-action",
  P5: "Compteurs de logs par niveau — rendu dans LogConsole (badges), pas un data-action",
  P6: "Question en cours d'exécution — le panneau ask est porté, l'état d'exécution Tk diffère",
  P7: "Messages d'erreur (showerror) — le panneau ask est porté, le dialogue Tk diffère",
  P9: "Confirmation de suppression (tag, preset) — le panneau ask est porté, le dialogue Tk diffère",
  P10: "Messages d'information (succès, info) — le panneau ask est porté, le dialogue Tk diffère",
};
