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
