# Textures

Het spel tekent al zijn textures zelf (`src/render/textures.js`). Leg je hier echte afbeeldingen neer en zet je ze in `manifest.json`, dan vervangen die de procedurele versie automatisch. Daarvoor is geen code nodig.

Bedoeld voor realistische textures die met Codex zijn gemaakt of gefotografeerd. Gebruik geen gloed of geverfde lichtvlekken: het licht komt uit de shaders en de lampen in de zaal.

## manifest.json

```json
{
  "skin": { "map": "skin_albedo.jpg", "normalMap": "skin_normal.png" },
  "leather": { "map": "leather_albedo.jpg", "normalMap": "leather_normal.png" },
  "ring": { "map": "canvas_albedo.jpg", "normalMap": "canvas_normal.png", "roughnessMap": "canvas_roughness.jpg" },
  "rope": { "map": "rope_albedo.jpg", "normalMap": "rope_normal.png" },
  "floor": { "map": "floor_albedo.jpg" }
}
```

| Sleutel | Waarvoor | Let op |
| --- | --- | --- |
| `skin` | huiddetail (poriën, vlekjes) | grijswaarden rond 90% wit, tegelbaar. De huidskleur komt van de bokser zelf, schade wordt erbovenop geschilderd. |
| `leather` | handschoenen, schoenen, hoekkussens | grijswaarden, tegelbaar. De kleur komt van het materiaal. |
| `ring` | canvas van de ring (vierkant) | in kleur, inclusief logo en hoeken. |
| `rope` | touwen | grijswaarden, herhaalt over de lengte. |
| `floor` | zaalvloer | in kleur. |

Normal maps volgen de OpenGL-conventie (groen omhoog). Een sleutel die niet in de lijst staat, wordt overgeslagen.
