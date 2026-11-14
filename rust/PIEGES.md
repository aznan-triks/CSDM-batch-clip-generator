# Pièges du workspace Rust

Relire avant de toucher à `rust/`. Une ligne par piège : motif → cause + quoi faire (date).

- ⚠️ `cargo` introuvable → il est dans `%USERPROFILE%\.cargo\bin`, hors PATH : l'appeler par son chemin complet depuis PowerShell (`verify.ps1` le trouve seul) (2026-11-14).
- ⚠️ Test de parité « could not run » ou import `psycopg2` en échec → le `python` du PATH (3.15) n'a pas les dépendances de 3.5 : poser `CSDM_REFERENCE_PYTHON` (ici `C:/Python314/python.exe`) (2026-11-14).
- ⚠️ Fichier de données restauré mais le binaire garde l'ancienne version → `Copy-Item` garde la date du fichier copié, cargo ne recompile pas un `include_str!` dont la date n'a pas bougé : toucher le fichier après toute restauration (`(Get-Item f).LastWriteTime = Get-Date`) ou restaurer par `git checkout` (2026-11-14).
- ⚠️ Nouveau fichier absent de `git status` → `status.showUntrackedFiles=no` dans le `.gitconfig` global de l'utilisateur : lister avec `git status --untracked-files=all`, ajouter par chemins explicites (2026-11-14).
- ⚠️ Contrôle des valeurs en dur muet sur un test, bavard sur du code → il cesse de lire un fichier à la première ligne `#[cfg(test)]` : garder le module de tests en fin de fichier ; un `const`/`static` est exempté jusqu'à la ligne qui finit par `;` (2026-11-14).
- ⚠️ Un mot ordinaire masqué `***` dans le journal ou un événement → le masquage remplace toute occurrence d'un secret connu, or un mot de passe court peut être un mot de noms de clés : sûr, mais ne jamais tester l'absence d'un secret par sous-chaîne d'un texte entier, tester clés et valeurs (2026-11-14).
- ⚠️ Un test lit les vrais réglages → tout test passe un dossier explicite (`SearchPlaces { explicit_root, .. }`, `tempfile`), jamais `SearchPlaces::from_env()` ; une racine explicite coupe toute autre recherche (2026-11-14).
- ⚠️ Mot de passe PostgreSQL en clair dans les presets 3.5 et dans `csdm_config.json` → ne jamais afficher ni copier ces fichiers dans un journal, un test ou un commit ; l'import s'éprouve sur copies (`tests/import_real.rs`, compte seulement) (2026-11-14).
- ⚠️ Test piloté : une sauvegarde différée part entre deux mouvements du pointeur → `egui_kittest` avance de 0,25 s par image par défaut : `with_step_dt(1/60)` (harnais `tests/common`) ; une infobulle demande d'attendre son délai (`Rig::wait`), pas `run()` (2026-11-14).
- ⚠️ Test piloté en mouvement complet : `Harness::run` dépasse ses pas → l'anneau du bouton principal redemande une image à chaque image : `run_steps(n)` quand la porte de mouvement est ouverte (2026-11-14).
- ⚠️ Glisser qui se lâche sans effet → egui oublie `press_origin` sur l'image du relâchement : garder le dernier déplacement dans l'état du geste et l'appliquer au lâcher (`grid.rs::Drag::travel`) (2026-11-14).
- ⚠️ Lignes de console collées → un `LayoutJob` jette tout caractère hors section : chaque caractère (sauts de ligne compris) appartient à une section (test `sections_cover_every_character_so_lines_stay_apart`) (2026-11-14).
- ⚠️ Chaîne brute coupée net (« expected at least one digit in exponent ») → `r#"…"#` se ferme sur le `"#` d'une couleur `"#2563EB"` : `r##"…"##` (2026-11-14).
- ⚠️ Rendu sans fenêtre (`.wgpu()`) : `STATUS_ACCESS_VIOLATION` → DX12 plante sur la machine de dev : le harnais pose `WGPU_BACKEND=gl` (2026-11-14).
- ⚠️ Champ de saisie qui ne reçoit rien en test → `type_text` envoie le texte au focus seulement : cliquer le champ, ou le focaliser comme 3.5 (`autoFocus` de la question, Annuler du dialogue) (2026-11-14).
- ⚠️ « Rien n'est sauvegardé » vérifié par l'absence d'un onglet dans `ui_sections` → la valeur par défaut de 3.5 contient déjà une disposition par onglet : comparer à `settings::defaults(None)["ui_sections"]` (2026-11-14).
