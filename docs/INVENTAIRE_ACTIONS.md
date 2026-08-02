# INVENTAIRE DES ACTIONS — livrable bloquant de D1 (PLAN_ELECTRON)

> Extrait du code v299 le 2026-08-02 (session 4a1, phase 1 du plan C — parité actions).
> Source : les 93 `command=` du fichier principal, les 27 de `csdm/widgets.py`, les
> 16 `bind()` non triviaux et les 19 `messagebox`.
>
> **Usage** : chaque ligne = une case à cocher de la recette avant livraison Electron (R1).
> Une action absente de l'UI Electron = livraison refusée.
>
> Ne recense **pas** les 121 réglages (couverts par le test de couverture de D20) ni les
> mécaniques internes de Tk (scrollbars `.set`/`.yview`, `<Destroy>`, `<Enter>`/`<Leave>`,
> `<Configure>`) qui n'existeront pas sous Electron.

---

## A — Barre de run (4)

| # | Action | Origine |
|---|---|---|
| A1 | RUN — lancer la génération | `_run` |
| A2 | PREVIEW — dry run + liste de clips | `_dry_run` |
| A3 | STOP — arrêt gracieux | `_handle_stop` |
| A4 | KILL — arrêt brutal | `_kill_now` |

## B — Base de données (1)

| # | Action | Origine |
|---|---|---|
| B1 | Connecter + charger (joueurs, armes, schéma) | `_connect_and_load` (3 points d'appel) |

## C — Presets (5)

| # | Action | Origine |
|---|---|---|
| C1 | Chargement rapide depuis la liste d'en-tête | `_quick_preset_load` (`<<ComboboxSelected>>`) |
| C2 | Sauvegarde rapide depuis l'en-tête | `_quick_preset_save` |
| C3 | Sauvegarder un preset (onglet Settings) | `_save_preset` |
| C4 | Charger un preset nommé | `_load_preset(name)` |
| C5 | Supprimer un preset nommé | `_delete_preset(name)` |
| C6 | Infobulle de preset au survol | `_preset_tooltip` |

## D — Sélection des démos (7)

| # | Action | Origine |
|---|---|---|
| D1 | Tout cocher | `_demo_picker_set_all(True)` |
| D2 | Tout décocher | `_demo_picker_set_all(False)` |
| D3 | Cocher la sélection | `_demo_picker_set_selected(True)` |
| D4 | Décocher la sélection | `_demo_picker_set_selected(False)` |
| D5 | Cocher/décocher une ligne au clic | `_on_demo_tree_click` (`<Button-1>`) |
| D6 | Changer de mode de sélection | `_on_picker_mode_change` |
| D7 | Infobulle de ligne au survol | `<Motion>` sur `_demo_tree` |

## E — Filtre armes (4)

| # | Action | Origine |
|---|---|---|
| E1 | Tout sélectionner | `_weapons_select_all` |
| E2 | Tout désélectionner | `_weapons_deselect_all` |
| E3 | Cocher/décocher une catégorie entière | `_toggle_category(cat)` |
| E4 | Recalcul de la case de catégorie | `_update_cat_var(cat)` |

## F — Dates (5)

| # | Action | Origine |
|---|---|---|
| F1 | Ouvrir le calendrier « depuis » | `_open_cal(date_from)` |
| F2 | Ouvrir le calendrier « jusqu'à » | `_open_cal(date_to)` |
| F3 | Plages prédéfinies | `_set_date_range(key)` |
| F4 | Vider les deux dates | lambda l.1887 |
| F5 | « Jusqu'à » = aujourd'hui | lambda l.1882 |

### F bis — Calendrier popup (5)

| # | Action | Origine |
|---|---|---|
| F6 | Mois précédent / suivant | `_prev` / `_next` |
| F7 | Aujourd'hui | `_select(today)` |
| F8 | Effacer | `_select(None)` |
| F9 | Choisir un jour | `_select(dd)` |
| F10 | Fermeture sur perte de focus | `<FocusOut>` |

## G — Filtres de kill (6)

| # | Action | Origine |
|---|---|---|
| G1 | Activer un filtre (× N filtres du registre) | `_make_enable_cmd` |
| G2 | Exclure un filtre (× N filtres) | `_make_excl_cmd` |
| G3 | Tout désélectionner | `_clear_kill_filters` |
| G4 | Bascule « high velocity » | `_on_hv_toggle` |
| G5 | Bascule « no trois shot » | `_on_no_trois_shot_toggle` |
| G6 | Changement de logique ET/OU | `_on_kill_logic_change`, `_on_logic_mode_change` |

## H — Types de match & map (2)

| # | Action | Origine |
|---|---|---|
| H1 | Cocher/décocher un type de match | `_on_match_type_toggle` |
| H2 | Cocher/décocher une map | `_on_map_filter_toggle` |

## I — Tags (16)

| # | Action | Origine |
|---|---|---|
| I1 | Créer un tag (dialogue) | `_create_new_tag_dialog` |
| I2 | Supprimer un tag | `_delete_tag_ui` |
| I3 | Cocher/décocher un tag | `_tag_toggle(id)` |
| I4 | Tout décocher | `_tags_deselect_all` |
| I5 | Chercher les démos par tag | `_tag_search_by_tag` |
| I6 | Chercher les démos | `_tag_search_demos` |
| I7 | Calculer la plage | `_tag_calc_range` |
| I8 | Appliquer — début de plage | `_tag_apply_range_start` |
| I9 | Appliquer — fin de plage | `_tag_apply_range_end` |
| I10 | Appliquer — plage entière | `_tag_apply_range_full` |
| I11 | Appliquer — après la plage | `_tag_apply_range_after` |
| I12 | Appliquer à la sélection | `_tag_apply_selected` |
| I13 | Appliquer à tout | `_tag_apply_all` |
| I14 | Retirer de la sélection | `_tag_remove_selected` |
| I15 | Exporter les tags | `_tags_export` |
| I16 | Importer les tags | `_tags_import` |
| I17 | Dialogue « tags manquants à l'import » : OK / Ignorer / Annuler | `TagImportMissingDialog` |

## J — Console de logs (13)

| # | Action | Origine |
|---|---|---|
| J1 | Filtrer les logs | `_apply_log_filter` |
| J2 | Afficher/masquer les horodatages | `_toggle_log_timestamps` |
| J3 | Afficher/masquer les badges (`Ctrl+B`) | `_toggle_log_badges` |
| J4 | Ouvrir la recherche (`Ctrl+F`) | `_log_search_open` |
| J5 | Occurrence suivante (`Entrée`) | `_log_search_next` |
| J6 | Occurrence précédente | `_log_search_prev` |
| J7 | Fermer la recherche (`Échap`) | `_log_search_close` |
| J8 | Menu contextuel (clic droit) | `_log_right_click` |
| J9 | — Copier la ligne | `_log_copy_line` |
| J10 | — Copier la sélection | `_log_copy_sel` |
| J11 | — Tout sélectionner | lambda l.6662 |
| J12 | — Tout copier | `_log_copy_all` |
| J13 | — Effacer | `_clear_log` |
| J14 | Enregistrer les logs dans un fichier | `_log_save` |

## K — Export de la prévisualisation (4)

| # | Action | Origine |
|---|---|---|
| K1 | Ouvrir le menu d'export | `_show_export_menu` |
| K2 | Exporter en HTML | `_export_preview_html` |
| K3 | Exporter en texte | `_export_preview_txt` |
| K4 | Exporter en JSON | `_export_preview_json` |

## L — Vidéo & encodage (10)

| # | Action | Origine |
|---|---|---|
| L1 | Changer le codec vidéo | `_on_vcodec` |
| L2 | Changer le codec audio | `_on_acodec` |
| L3 | Choisir une résolution prédéfinie | `_on_res_structured` |
| L4 | Basculer en résolution libre | `_on_res_custom_toggle` |
| L5 | Changer la perspective | `_on_perspective_change` |
| L6 | Changer la vitesse de jeu | `_on_game_speed_var` |
| L7 | Changer le système d'enregistrement | `_on_recsys_change` |
| L8 | Régler le ralenti HLAE | slider l.3054 |
| L9 | Enregistrer le nom d'assemblage courant | `_asm_save_current_name` |
| L10 | Supprimer un nom d'assemblage | `_asm_delete_name` |

## M — Réglages, thème & disposition (11)

| # | Action | Origine |
|---|---|---|
| M1 | Choisir un fond | `_make_bg_cmd` |
| M2 | Choisir un accent | `_make_ac_cmd` |
| M3 | Choisir une couleur d'accent libre | `_pick_custom_accent` → `ColorPickerDialog` |
| M4 | — Palette système / OK / Annuler du sélecteur | `_sys` / `_ok` / `destroy` |
| M5 | Appliquer la disposition | `_apply_layout_vars` |
| M6 | Disposition automatique | `_auto_layout` |
| M7 | Réinitialiser la disposition | `_reset_layout_defaults` |
| M8 | Rafraîchir l'aperçu d'injection | `_refresh_injection_preview` |
| M9 | Bascule « partielle » | `_on_partial_toggle` |
| M10 | Bascule « complète » | `_on_full_toggle` |
| M11 | Régler le curseur dp2 | slider l.6117 |
| M12 | Parcourir un chemin (× N champs de chemin) | `PathField.browse` |

## N — Sélecteur de joueurs (12)

| # | Action | Origine |
|---|---|---|
| N0 | Ouvrir le sélecteur de joueurs | `PlayerPicker._open` |
| N1 | Saisir une recherche | `_on_search_key` |
| N2 | Focus entrant / sortant du champ | `_on_search_focus_in` / `_out` |
| N3 | Trier par nom | `_set_sort("name")` |
| N4 | Trier par date | `_set_sort("date")` |
| N5 | Première page | `_page_first` |
| N6 | Page précédente | `_page_prev` |
| N7 | Page suivante | `_page_next` |
| N8 | Dernière page | `_page_last` |
| N9 | Aller à une page (`Entrée`) | `_page_jump` |
| N10 | Cocher/décocher un joueur enregistré | `_toggle_saved` |
| N11 | Monter / descendre un joueur | `_move_saved` |
| N12 | Retirer un joueur | `_remove_saved` |
| N13 | Sélectionner dans la liste | `_on_lb_select` / `_save_lb_selection` |

## O — Fenêtre & navigation (5)

| # | Action | Origine |
|---|---|---|
| O1 | Changer d'onglet | `<<NotebookTabChanged>>` |
| O2 | Déplacer le séparateur | `_on_splitter_release` |
| O3 | Redimensionner la fenêtre (mémorisation) | `_on_window_configure` → `_remember_layout_state` |
| O4 | Replier/déplier une section | `Sec._toggle` (`<Button-1>` sur l'en-tête) |
| O5 | Infobulles au survol | `Tooltip` (× N widgets) |

## P — États et retours (pas des clics, mais de la parité)

| # | Comportement | Origine |
|---|---|---|
| P1 | Boutons désactivés pendant une exécution | `_reset_btns`, `stop_btn.config(state=…)` |
| P2 | Libellé de progression `▰▰▰▱▱ n/total` | `progress_bar` + `progress_lbl` |
| P3 | Ligne de résumé (nb clips, durée, couleur d'état) | `_summary_lbl` |
| P4 | Message éclair dans les logs | `_log_flash` |
| P5 | Compteurs de logs par niveau | `_update_log_counts` |
| P6 | **Question en cours d'exécution** : « ces démos sont déjà taguées, continuer ? » | `messagebox.askyesnocancel` l.10224 |
| P7 | Messages d'erreur (showerror) — validation, tags, export, import, preset | `messagebox.showerror` (× 15 occurrences) |
| P8 | Décochage automatique dans le sélecteur après réponse | `_uncheck_in_picker` |
| P9 | Confirmation de suppression (tag, preset) | `messagebox.askyesno` l.4007, l.4515 |
| P10 | Messages d'information (succès, info) | `messagebox.showinfo` (× 5 occurrences) |

---

## Total

Compter : `grep -cE "^\| [A-Z][0-9]+" docs/INVENTAIRE_ACTIONS.md`
(réparties en 16 familles). Ne pas recopier le nombre — HC.1 §12.

Les entrées **P6** et **P9** (`askyesno`/`askyesnocancel`) sont celles qui imposent une
**réponse utilisateur** (troisième prise du pont), en plus des logs et des événements
d'état prévus par D19.

---

## Couverture par le pont — chantier 4a

Les actions suivantes sont désormais joignables par un hôte **sans fenêtre**, chacune par une
commande du pont JSON, prouvée en sous-processus (`tests/test_bridge_e2e.py`) :

| # | Action | Commande | Méthode moteur |
|---|---|---|---|
| A1 | RUN | `start_run` | `EngineMixin.start_run` |
| A2 | PREVIEW | `start_preview` | `EngineMixin.start_preview` |
| C1 / C4 | Charger un preset | `load_preset` | `csdm.config.preset_payload` |
| C2 / C3 | Sauvegarder un preset | `save_preset` | `csdm.config.build_preset` |
| C5 | Supprimer un preset | `delete_preset` | — |
| — | Lire / écrire la configuration | `load_config` / `save_config` | — |
| — | Se connecter à la base et la découvrir | `connect_db` | `EngineMixin.discover_database` |

A3 (STOP), A4 (KILL) et l'annulation de prévisualisation étaient déjà couvertes en v213.

**P7** (erreurs de validation avant lancement) ne passe plus par `messagebox` : la validation
vit dans `EngineMixin.validate_run_inputs` et sort par la prise `ask`, donc la même erreur
s'affiche dans une fenêtre Tkinter comme dans la fenêtre Electron.
