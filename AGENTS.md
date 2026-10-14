# Werkafspraken

- Taal van UI, comments en docs: Nederlands.
- Geen build-stap of framework: plain ES-modules met een import map naar `vendor/`.
- Spellogica in `src/game/` mag niets van de DOM of Three.js weten; zo blijft `npm test` headless.
- Na wijzigingen aan physics, stoten of schade: `npm test`. Na UI-wijzigingen: `npm run e2e`.
- Testhaak in de browser: `window.__game` (`game`, `actions`, `ui`, `renderer`, `audio`, `input`, `settings`).
- Afstemmen van stoten gaat via `PUNCHES` in `src/game/constants.js`; de tests bewaken dat elke stoot raakt en dat jab, linkse hoek en uppercut genoeg schade doen.
- Knock-outs, vermoeidheid en herstel stem je af met `IMPACT`, `KO`, `FATIGUE` en `RECOVERY`. Geen vaste animaties of schadevermenigvuldigers: effecten moeten uit de botsing of de spieren komen.
- Gebruik voor toeval in de spellogica `game.rng`, zodat tests reproduceerbaar blijven.
