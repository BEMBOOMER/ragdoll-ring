# Ragdoll Ring

Boksen in de browser met actieve ragdoll-physics. Twee boksers houden zichzelf overeind met spierkracht; elke klap duwt echt tegen het lichaam, dus geen twee knock-outs zijn hetzelfde.

## Spelen

```bash
npm install
npm start          # http://localhost:5173
```

Geen build-stap: `index.html` laadt de bestanden uit `src/` direct. Three.js en Rapier staan in `vendor/` (bijwerken met `npm run vendor`).

## Besturing

| Actie | Toets | Muis |
| --- | --- | --- |
| Bewegen | A D W S of pijltjes | |
| Jab | J | Linkerknop |
| Directe | K | Rechterknop |
| Linkse / rechtse hoek | U / I | |
| Uppercut (gaat door de dekking) | L | Middelste knop |
| Dekking / bukken | Spatie / Shift links | |
| Pauze / geluid | Esc of P / M | |

Toetsen zijn aan te passen onder **Besturing**. Een gamepad werkt ook (stick bewegen, X Y LB RB A stoten, RT dekking, LT bukken, Start pauze).

## Regels

- Best of drie: twee rondes winnen. Een ronde duurt 75 seconden.
- Knock-out wint de ronde direct; na de bel wint wie de meeste energie over heeft.
- Stoten kosten stamina. Moe slaan is zwakker; dekking zakt bij lege stamina.
- Treffers op het hoofd doen het meest, een counter doet 25% extra, een uppercut op een bukkende tegenstander 30% extra.

## Testen

```bash
npm test           # physics, stoten, schade, rondes en een AI-tegen-AI-wedstrijd (headless)
npm run e2e        # alle menu's en spelflows in Chromium (Playwright)
```

`npm run e2e` gebruikt de Chromium van Playwright; zet `CHROMIUM_PATH` om een andere te kiezen. Screenshots komen in `tmp/e2e/`.

## Opbouw

- `src/game/` physics en spelregels, los van de weergave (Rapier, vaste stap van 1/120 s)
  - `fighter.js` actieve ragdoll: PD-spieren, zwaartekrachtcompensatie, IK voor armen en benen, voetstappen, stoten
  - `match.js` ronde-verloop, treffers en schade, hit-stop en slowmotion
  - `ai.js` computertegenstander in drie niveaus
- `src/render/` Three.js: arena met publiek, boksers, impacteffecten en camera
- `src/audio.js` alle geluid wordt live gesynthetiseerd met Web Audio (geen audiobestanden)
- `src/input.js`, `src/ui.js`, `src/main.js` invoer, menu's/HUD en de hoofdlus

## Publiceren

`.github/workflows/pages.yml` test elke push en zet `main` op GitHub Pages (zet Pages in de repo-instellingen op "GitHub Actions").
