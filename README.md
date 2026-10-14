# Ragdoll Ring

Boksen in de browser met actieve ragdoll-physics. Twee boksers houden zichzelf overeind met spierkracht; elke klap is een echte botsing tussen vuist en lichaam. Er zijn geen geanimeerde treffers of gescripte knock-outs: hoe hard iemand geraakt wordt, hoe hij wankelt, valt en weer opstaat, volgt uit de simulatie.

## Spelen

```bash
npm install
npm start          # http://localhost:5173
```

Geen build-stap: `index.html` laadt de bestanden uit `src/` direct. Three.js en Rapier staan in `vendor/` (bijwerken met `npm run vendor`). Alle textures en geluiden worden bij het laden gegenereerd; er zijn geen afbeeldings- of audiobestanden.

## Besturing

| Actie | Toets | Muis |
| --- | --- | --- |
| Bewegen | A D W S of pijltjes | |
| Jab | J | Linkerknop |
| Directe | K | Rechterknop |
| Linkse / rechtse hoek | U / I | |
| Uppercut | L | Middelste knop |
| Lijfstoot | Shift links vasthouden + stoot | |
| Ontwijken links / rechts | Q / E | |
| Dekking / bukken | Spatie / Shift links | |
| Opstaan na een knockdown | snel op stoottoetsen tikken | |
| Pauze / geluid | Esc of P / M | |

Toetsen zijn aan te passen onder **Besturing**. Een gamepad werkt ook (stick bewegen, X Y LB RB A stoten, RT dekking, LT bukken, rechterstick opzij ontwijken, Start pauze).

## Het gevecht

- **Regels:** 3, 6 of 12 rondes van 1:00, 1:30 of 3:00. Het gevecht eindigt met een knock-out (tienstelling), een TKO (drie knockdowns in één ronde of de scheidsrechter die stopt) of een beslissing van drie juryleden (10-point must: clean punching, druk, ringcontrole, verdediging).
- **Impact:** elke treffer wordt doorgerekend als botsing: relatieve snelheid van de vuist, effectieve slagmassa (lichaam, balans, rompdraaiing), trefpunt en hoe goed de verdediger zich schrap zet. Daaruit volgen impuls, lineaire en draaiende hoofdversnelling, en de ernst. Kin, kaak, slaap en lever zijn gevoelig; een hoek draait het hoofd echt weg.
- **Knock-outs:** er is geen minimum aan schade. De kans op wankelen, een knockdown of een knock-out hangt af van ernst ten opzichte van de weerstand (kin, nek, opgebouwde hoofdschade, vermoeidheid, duizeligheid). Een counter op iemand die in je stoot loopt, is het gevaarlijkst. Soorten: flash, counter, opgebouwde schade, uitputting, lijfstoot, TKO, staande TKO.
- **Knockdown en opstaan:** spierspanning en balans vallen weg en het lichaam valt zoals de physics het laat vallen. Opstaan (steunen, knielen, overeind) gaat met dezelfde spieren. Of het lukt voor tien, hangt af van de klap, de conditie en eerdere knockdowns.
- **Conditie:** stamina (explosieve energie), cardio (wat daarvan bereikbaar blijft), armvermoeidheid per arm (tragere stoten, zakkende dekking) en lijfschade (trager herstel). De energiebalk herstelt deels; een deel van elke treffer gaat er blijvend af. Tussen de rondes herstelt de hoek een stuk.
- **Combinaties:** de volgende stoot met de andere hand in de herstelfase van de vorige is goedkoper en sneller, en neemt de draai van de romp mee. Slechte timing kost balans. Geen combo-tellers: het voordeel zit in de physics.
- **Verdediging:** dekking vangt stoten op hoofd en borst (net op tijd = pareren), maar niet de uppercut en niet de hoek naar het lijf. Ontwijken werkt vóór de stoot en weg van de slaande hand. Een gemiste zware stoot trekt je uit balans en laat je even open staan.
- **Tegenstanders:** zes fictieve boksers met elk een stijl (outboxer, pressure fighter, counterpuncher, slugger, swarmer, boxer-puncher) en eigen lichaamseigenschappen. De AI ziet alleen wat een bokser ook ziet, met reactietijd, en onthoudt welke stoten jij graag gooit.
- **Na een knock-out** volgt een herhaling in slowmotion met de meetwaarden uit de simulatie (stoot, trefplek, vuistsnelheid, impuls, hoofdversnelling).
- **Zichtbare schade:** roodheid, blauwe plekken en zwelling op de plek van de treffer, cuts en neusbloed, bloed op handschoenen en canvas, zweet dat de huid laat glanzen. Bloed is uit te zetten.

## Testen

```bash
npm test           # physics, impact, knockdowns, jury en AI-tegen-AI (headless)
npm run e2e        # alle menu's en spelflows in Chromium (Playwright)
```

`npm run e2e` gebruikt de Chromium van Playwright; zet `CHROMIUM_PATH` om een andere te kiezen. Screenshots komen in `tmp/e2e/`.

## Opbouw

- `src/game/` physics en spelregels, los van de weergave (Rapier, vaste stap van 1/120 s)
  - `fighter.js` actieve ragdoll: PD-spieren, balans, IK voor armen en benen, voetstappen, stoten, ontwijken, knockdown en opstaan, conditie
  - `impact.js` botsingsmodel: impuls, hoofdversnelling, trefplekken, weerstand en knock-outkans
  - `match.js` treffers, scheidsrechter (telling, TKO), jury, rondes en uitslag
  - `ai.js` computertegenstander met zes stijlen en drie niveaus
  - `replay.js` ringbuffer voor de herhaling
  - `constants.js` alle afstelwaarden (stoten, impact, vermoeidheid, regels, stijlen, boksers)
- `src/render/` Three.js: arena, boksers, scheidsrechter, effecten, procedurele textures (`textures.js`) en camera
- `src/audio.js` alle geluid live gesynthetiseerd met Web Audio
- `src/input.js`, `src/ui.js`, `src/main.js` invoer, menu's/HUD en de hoofdlus

## Publiceren

`.github/workflows/pages.yml` test elke push en zet `main` op GitHub Pages (zet Pages in de repo-instellingen op "GitHub Actions").
