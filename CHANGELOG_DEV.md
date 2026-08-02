# Changelog privé — chantiers & outillage internes (CSDM Batch Clips Generator)

Journal de développement interne. Contient ce qui n'est pas un livrable produit : les chantiers
(Electron, restyle, lifecycle), les outils d'équipe (atlas, e2e, audits), la dette technique et les
étapes non publiées. Le journal public (ce que voit l'utilisateur du logiciel) vit dans `CHANGELOG.md`.

> Ce fichier est destiné à l'équipe / à l'agent de développement — jamais aux release notes publiques.

---

### Caméra de vérification visuelle (e2e) — outillage restyle 6

**Humanised:** A new automated camera watches the real app window — any future CSS change that
shifts pixels by more than 1% is caught on the spot, not a week later. A side-by-side sheet of the
app next to its design mock is generated automatically, so the mandatory visual check (§1 P8) takes
one glance instead of a manual dance.
**Technical:** New `electron/e2e/` suite: Playwright drives the real Electron window (not jsdom),
`harness.mjs` starts Vite + Electron, `shell.spec.mjs` photographs the three-zone shell and matches
against a stored pixel baseline (`pixelmatch`, threshold 1%), `mock.spec.mjs` photographs the V12
mock at the same 1600×900 geometry, and `contact-sheet.mjs` generates the side-by-side HTML. The
Electron e2e suite lives outside vitest (`vitest.config.ts` excludes `e2e/**`) so `npm test`
remains fast and unchanged. `CONTEXT_GUIDE.md` §11 updated to point at the new tool.

### Project atlas (2026-08-02)

Project atlas (2026-08-02): a generated directory of the project's reusable resources, replacing
four hand-maintained inventories that had all drifted out of sync with the code.

### Added
**Humanised:** Before writing any non-trivial change, the assistant now looks up whether a helper,
component, config key, or bridge command already exists by querying a generated file instead of
re-exploring the codebase from scratch or guessing. A safety check now blocks ending a work session
if that file has gone stale.
**Technical:** New `scripts/build_atlas.py` (AST walk over `csdm/` for Python functions/classes,
regex sweep over `electron/renderer/src/**/*.ts(x)` for React components/hooks/exports, `DEFAULT_CONFIG`
import for config keys, `mock-v12.css` selector sweep for the mock's owned class namespace,
`KILL_FILTER_REGISTRY`/`COMMANDS` import for registries, AST walk over `csdm/engine/` for
`self.state(...)` event literals, header-comment sweep over `tests/` and `**/__tests__/**` for what
each guard test forbids) generates `PROJECT_ATLAS.md` (human summary) + `PROJECT_ATLAS.json`
(machine-queried, never read whole) — same generated-never-hand-edited regime as
`theme/mock-v12.css`, guarded by `tests/test_atlas.py` and a `--check` mode wired into a `Stop` hook.
`context_guide.md` §2/§3 lost their hand-maintained file/method/class inventories (about a tenth of
the file) in favour of atlas queries; the invariants and gotchas an analyser cannot derive stayed, two
of them moved into §10 alongside the existing gotcha list. `graphify-out/GRAPH_REPORT.md` (dated
April 13, predates every chantier) dropped out of the `init: full` reading ritual. Backfilled a
missing one-line header on 18 guard test files (17 TypeScript + 1 Python) that had none — the new
atlas test asserting every guard states what it forbids caught them.

The atlas also gained five suspect-not-verdict detectors for context_guide.md §1 (KISS/DRY/Fail-Fast/
HC.1/YAGNI): a `DEFAULT_CONFIG` value rewritten literally elsewhere (1238 hits — mostly common small
integers like window sizes, not distinctive strings), a literal shared unnamed across 2+ files (585),
two functions with an identical body once names are erased (3), an exported symbol with zero usages
outside its own definition (313), and an `except` handler that neither re-raises nor logs (184).
Principles 7 (root cause) and 8 (visual proof) are explicitly left undetected — they're about a way of
working, not text a parser can grade. This is a first mechanical measurement, not a cleanup; acting on
these numbers is a separate future plan.

### Lifecycle A (2026-08-02)

Lifecycle A (2026-08-02): fige les animations quand la fenêtre n'a pas le focus, tue l'arbre de
processus complet à la fermeture du shell (avec confirmation si un run tourne), affiche un bouton
Restart quand le moteur meurt au lieu de rester figé, et verrouille la fenêtre sur sa propre page.
S'appuie sur AUDIT_electron_cycle_de_vie.md (3 corrections par rapport à une analyse antérieure).
Exécuté en continu sur la branche `chantier4a1-headless-db`, 5 phases. Les phases 1-4 livrées (4
commits), la phase 5 (retrait de deux clés de config mortes) arrêtée parce que la migration du
worktree `mystifying-elion-9ea880` n'est pas mergée.

### Added
**Humanised:** L'appli ralentit ses animations quand on travaille dans une autre fenêtre (CS2 par
exemple), et les arrête complètement quand elle est minimisée. Si le moteur Python plante, une
bannière rouge apparaît avec un bouton Restart — plus besoin de tout fermer et rouvrir.
**Technical:** `renderer/src/motion/engine.ts` : `isWindowActive` / `setWindowActive` + porte dans
`effectiveIntensity` (lit `prefersReducedMotion` ET l'activité fenêtre, la préférence système gagne).
`renderer/src/motion/useWindowActivity.ts` : hook `useEffect` écoutant `visibilitychange` + `blur` +
`focus`. `renderer/src/shell/EngineLostBanner.tsx` + `.css` : composant monté dans `AppShell.tsx`,
abonné via `bridge.ts` aux événements `child_exit`/`child_error`/`fatal`, expose un bouton qui
appelle le nouvel IPC `bridge:restart-engine`. `electron/main.js` : handler IPC `restart-engine`
(appelle `killEngine()` puis `startEngine()`), handler `will-navigate` (bloque toute navigation
externe), `setWindowOpenHandler(() => ({ action: "deny" }))`. `electron/lifecycle.js` : module pur
sans `require("electron")` — `buildTreeKillArgs(pid)`, `noteEngineState()`, `engineIsBusy()`,
`resetEngineState()`.

### Changed
**Humanised:** Fermer l'appli tue tout ce qui tourne d'un coup (plus de processus orphelins qui
survivent à la fenêtre). Si une capture est en cours, l'appli demande confirmation avant de fermer,
plutôt que de tuer silencieusement. La fenêtre est plus sûre : elle refuse d'ouvrir des popups et
de quitter sa propre page.
**Technical:** `electron/main.js` : `killEngine()` utilise `taskkill /F /T /PID` (arbre entier) au
lieu de `process.kill()` (signal seul). `shutdownEngine()` : vérifie `engineIsBusy()` → si oui,
`dialog.showMessageBox` synchrone (confirmation) → puis `killEngine()`. Handler `will-navigate` +
`setWindowOpenHandler` dans `createWindow()`. `webPreferences` : `sandbox: true` explicite.
`electron/package.json` : ajout de `lifecycle.js` au tableau `files` (sinon le build portable
plante). `electron/vitest.config.ts` : pattern `__tests__/**/*.test.js` ajouté.

### Fixed
**Humanised:** Rien de cassé par l'utilisateur — tous les problèmes d'audit étaient des ports
incomplets de comportements que le script Python avait depuis le début.
**Technical:** Les trois corrections livrées par rapport à l'analyse antérieure viennent de
l'audit `docs/audits/AUDIT_electron_cycle_de_vie.md` (versé dans le dépôt le 2026-08-02). 17
nouveaux tests (6 windowActivity + 5 lifecycle + 6 EngineLostBanner), garde-fous inchangés.

### Known gaps
- **Phase 5 (clés mortes) non livrée** : `kill_mod_no_trois_shot` est encore lue dans
  `csdm/engine/core.py` (lignes 2830-3041). La clé pilote le filtre d'exclusion TROIS SHOT. La
  migration du worktree `mystifying-elion-9ea880` (qui mappe `kill_mod_no_trois_shot` →
  `kill_mod_trois_shot_exclude`) n'est pas mergée sur cette branche. Seule
  `kill_mod_no_trois_shot_req` est orpheline (jamais lue hors `DEFAULT_CONFIG`). Le plan de la
  phase 5 exige l'arrêt si l'une ou l'autre clé est encore lue — prochaine étape : merger la
  branche de migration.

### Verified
- Electron: 623/623 tests verts (77 suites), typecheck propre
- Python: 274/295 verts (21 échecs préexistants, psycopg2 + atlas, rien touché)
- 4 commits locaux sur `chantier4a1-headless-db`, pas de bump APP_VERSION, pas de git push
- Journal: `VAULT/Journal/2026-08-02-cycle-de-vie-electron-A.md`

