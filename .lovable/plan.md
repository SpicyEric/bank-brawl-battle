# Plan: Unit-Verhalten, Statuseffekte & Roster-Modal

## Teil A – Roster Info-Modal (klein, schnell)
- `UnitInfoModal` bekommt einen `hideColorInfo`-Prop.
- Beim Roster wird der Farb-Badge hinter dem Namen ausgeblendet und der "Stark gegen / Schwach gegen"-Block weggelassen (Einheiten sind dort farbneutral).
- Im Kampf bleibt alles wie bisher.

## Teil B – Unit-KI / Targeting (battleGame.ts)
Neues Feld pro Unit-Def: `aiBehavior` mit Werten:
- `lock_on` – Krieger, Sturmläufer: bleibt am gewählten Ziel kleben, wechselt nur bei Tod.
- `switch_each_hit` – Assassin: nach jedem Angriff neues Ziel (nur wenn mehrere Gegner).
- `flying` – Drache: Bewegung ignoriert Blockaden (Einheiten/Terrain außer Wasser-Grenzen).
- `jump_retreat` – Reiter: nach Angriff größtmögliche Distanz zum eben angegriffenen Ziel, dann Ziel-Switch.
- `keep_distance_lock` – Bogenschütze: Lock-on + Bewegung maximiert Distanz unter Beibehaltung der Angriffsreichweite.
- `keep_distance_switch` – Magier: wie oben aber Ziel-Switch nach Angriff.
- `switch_each_hit` für Frostmagier zusätzlich.
- `nearest` – Banshee: immer nächstes Ziel.
- `highest_hp` – Vampir: greift immer Ziel mit höchstem HP an, leichter Lifesteal.
- `center_aoe` – Vulkanit: positioniert sich so, dass max. Gegner adjacent sind, dann AOE.
- `protect_damaged_ally` – Schildträger: bewegt sich neben den am stärksten beschädigten Verbündeten.
- `heal_cluster` – Schamane: positioniert sich für max. Heilung verletzter Verbündeter.
- `hit_and_run` – "Wie"/Berserker: 3 Ticks Distanz halten → nächster Angriff +50%.

Hilfsfunktionen: `findHighestHpEnemy`, `findMaxDistanceTile(target)`, `findCenterTile(enemies)`, `findProtectTile(ally)`, `findHealClusterTile(allies)`.

## Teil C – Statuseffekte
Erweiterung von `BattleUnit`:
- `frozen?: number` (verbleibende Ticks). Während frozen: kein Move, kein Attack. Cell-Overlay blau (`freeze-cell` Klasse, bleibend statt Animation).
- `burning?: { ticks: number; dmgPerTick: number; sourceId: string }` – fünf Damage pro Tick für 4 Ticks (Brennstift). Optisches Feuer-Overlay auf der Zelle.
- `ghost?: { ticksLeft: number }` (Banshee): wird gesetzt wenn `hp ≤ 0` und ghost noch nicht aktiv → Einheit bleibt 3 Ticks aktiv mit +10 ATK, Erscheinung pulsiert/verblasst (`opacity-50 animate-pulse`). Nach 3 Ticks endgültig entfernt.
- `chargedAttack?: boolean` – Hit-and-Run +50%-Flag nach 3 ruhigen Ticks.

Tile-Statuseffekt (neu in `GameState`):
- `lavaTiles: { row: number; col: number; ticksLeft: number; ownerId: string }[]` – 5 Damage pro Tick an gegnerische Einheiten, 2 Ticks aktiv. Verbündete des Vulkanit immun. Erzeugt durch Vulkanit-AOE auf 8 Nachbarfelder.

Tick-Reihenfolge: Status-DOTs (burning, lava) → Frozen-Decrement → Movement (skip frozen) → Attacks (skip frozen) → Ghost-Timer → Cleanup.

## Teil D – Animationen (index.css + BattleGrid)
Neue persistierende Cell-Overlays + Emitter-Events:
- `cell-frozen` – stehender hellblauer Layer mit Schneeflocken-Emoji solange `frozen > 0`.
- `cell-burning` – flackerndes Feuer-Overlay solange `burning.ticks > 0`.
- `cell-lava` – pulsierende Lava-Textur für `lavaTiles`.
- `ghost-active` – Einheit-Emoji mit opacity-50 + `animate-pulse`.
- `lightning-chain` – SVG-Linie zwischen Quelle und Sprungzielen (Blitzmagier), bereits geplant umsetzen.
- `shield-link` – durchgehende Linie zwischen Schildträger und adjacent Verbündeten (im Kampf, nicht nur in Placement).
- `mirror-reflect` – kleiner Glanzpuls + Schadens-Popup beim Spiegelkämpfer.

Events in `battleEvents.ts` erweitern (`freeze_applied`, `burn_applied`, `lava_spawn`, `lightning_chain`, `mirror_reflect`, `ghost_spawn`).

## Teil E – Geplante, aber noch nicht implementierte Einheiten
Alle UNIT_DEFS mit Hinweis "geplant" durchgehen und ihre Spezialfähigkeiten gemäß Beschreibung jetzt scharfschalten (Lightning Chain, Mirror Reflect, Burn, Lava, Ghost, Hit-and-Run, Freeze-Lock-Out etc.).

## Risiken
- `battleTick` wird komplexer; Single- und Multiplayer müssen exakt synchron bleiben.
- Status-Effekte serialisieren (für MP-Sync via Supabase).
- Lavafelder und Ghost-Units brauchen neue Felder im `GameState` → MP-Payload erweitern.

## Reihenfolge
1. Roster-Modal (Teil A) – sofort.
2. Status-Felder + Tile-States in Types (`battleGame.ts`).
3. KI-Verhalten pro Unit umstellen (Teil B).
4. Tick-Logik um Status/DOT/Ghost/Lava erweitern (Teil C).
5. Events & Animations-Klassen (Teil D).
6. Geplante Specials nachziehen (Teil E).
7. Manuelle Verifikation im Preview + Headless Balancing-Test.
