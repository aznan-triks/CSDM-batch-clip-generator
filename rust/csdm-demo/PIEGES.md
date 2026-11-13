# Pièges de `csdm-demo`

Relire avant de toucher au crate ou à `rust/vendor/`. Une ligne par piège : motif → cause + quoi faire (date).

- ⚠️ Montée du parseur qui ne compile plus (`missing field … in ParserInputs`) → l'amont ajoute des réglages sans prévenir (v0.42 : `parse_weapons`) : lire `src/python/src/lib.rs` du nouveau tag et reprendre la valeur que chaque appel de la liaison Python y met, jamais deviner (2026-11-14).
- ⚠️ `player_ticks(&[])` renvoie toute la partie → règle du parseur (aucun tick demandé = tous) : l'appelant ne l'appelle jamais sans tick, comme 3.5 (2026-11-14).
- ⚠️ Panique du parseur imprimée sur la sortie d'erreur alors qu'elle est bien rattrapée → c'est le crochet de panique par défaut : l'app (sans console) peut poser `std::panic::set_hook` ; ne jamais passer `panic = "abort"` dans un profil, `catch_unwind` cesserait de rattraper (2026-11-14).
- ⚠️ Script de référence Python qui panique sur `pyarrow` introuvable → `python -I` coupe les paquets utilisateur où `pyarrow` est installé : lancer `rust/tools/dp2_reference.py` sans `-I` (2026-11-14).
- ⚠️ Colonne lue « par sous-chaîne » dans un DataFrame demoparser2 → les colonnes y sont triées par ordre alphabétique : 3.5 lisait `assister_yaw` en croyant lire l'angle du tueur ; en Rust, nommer le champ exact (2026-11-14).
- ⚠️ Écart « entier contre flottant » au banc golden → pandas met en float64 une colonne entière qui a des trous (`team_num`, `health`) : écart de type listé, valeur égale (2026-11-14).
