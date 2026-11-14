# Pièges de l'étape « fichiers de démo » de l'aperçu (`preview/dp2`)

Relire avant de toucher à ce dossier. Une ligne par piège : motif → cause + quoi faire (date).

- ⚠️ Écart sur un SteamID lu dans une démo → en 3.5 son texte dépend du type pandas de la colonne : un trou dans une colonne entière la passe en float64 (`7.656119805037565e+16`), et la colonne pyarrow des joueurs (`parse_player_info`) fait échouer `fillna("")` dès qu'un id manque (aucun nom pour la démo) ; mesurer le type réel sur une démo avant de changer un lecteur de `store.rs` (relevé du 2026-11-14 dans les tests) (2026-11-14).
- ⚠️ Un kill suit le sort d'un autre (exclu, marqué, gardé) → 3.5 apparie les kills par (tick, tueur), pas par événement : deux kills du même tueur au même tick partagent leur sort ; garder cette clé `sig` partout (2026-11-14).
- ⚠️ `_mf` différent de 3.5 → les filtres optionnels marquent les mêmes objets que la chaîne ★ (un kill écarté par la chaîne garde la marque optionnelle) ; l'arène reproduit ce partage : ne jamais copier un événement dans ce module, garder l'ordre chaîne puis union (2026-11-14).
- ⚠️ Démo CS2 de 2023 où aucun filtre ne trouve rien → colonnes d'id vides dans la démo : tous les tirs sous l'id "", morts sans tueur ; c'est aussi le résultat de 3.5, pas un défaut du lecteur (2026-11-14).
