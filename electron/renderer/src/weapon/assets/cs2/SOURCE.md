# CS2 weapon icons

Extracted from the game by [`Juknum/counter-strike-icons`][repo] (`cs2/panorama/images/icons/equipment/`),
fetched 2026-07-31.

**All Counter-Strike assets are the property of Valve Corporation.** That repository states it is
"intended for community and educational use only", and this window is exactly that: a private tool
that reads the user's own CS2 demos. The call to vendor them was the user's, made explicitly, and
was the open question `PLAN_ELECTRON.md` and `docs/ui-restyle-mockups/_ETAT_ET_REPRISE.md` both
left to them.

## What was changed on the way in

Nothing about the shapes. The files were checked to contain no `<script>`, no external `href`, no
embedded `<image>` and no event handler -- vector paths only -- and then reduced:

- XML declaration, DOCTYPE, Illustrator comments and metadata removed
- `width`/`height` dropped so `viewBox` drives the scale
- `fill` attributes dropped so the colour comes from CSS
- coordinates rounded to two decimals (they are drawn at 32px tall)

585 kB -> 461 kB. They are loaded as URLs and painted through a CSS mask, so they never enter the
JavaScript bundle and they still follow the accent.

`world.svg` was fetched and discarded: it is an empty 32x32 frame. "World" is the database's
pseudo-weapon for world damage, and it falls back to a class silhouette.

[repo]: https://github.com/Juknum/counter-strike-icons
