# Plan: Komplett-Umbau Placement-System (SP + MP)

## Übersicht
Das alte rundenbasierte Eskalationssystem (1v1→2v2→3v3, Bereit-Button, AI-After-Player) wird durch ein einziges 30s-Live-Placement gefolgt von einem Eliminations-Kampf ersetzt. Hälftiges Feld mit eigener/gegnerischer Zone, gleichzeitiges Platzieren, automatischer Kampfstart, Sieg bei Auslöschung des Gegners.

## SCHRITT 1 — Feldaufteilung

**`src/lib/battleGame.ts`**
- `PLAYER_ROWS` von `[5,6,7]` → `[4,5,6,7]` ändern.
- `ENEMY_ROWS` von `[0,1,2]` → `[0,1,2,3]` ändern.

**`src/components/battle/BattleGrid.tsx`**
- Zone-Tönung in den Zellen-Renderer einbauen: während `phase === 'place_player'` (und immer bei `showZoneColors`), bekommen Reihen 4-7 eine leichte grüne Tönung (`bg-success/10`), Reihen 0-3 leichte rote Tönung (`bg-danger/10`). Im `flipped`-Modus invertiert.
- Bestehende Logik mit `[5,6,7]` und `[0,1,2]` durch `PLAYER_ROWS`/`ENEMY_ROWS`-Konstanten ersetzen (oder direkt 4er-Bereiche hartkodieren).

**`src/pages/Index.tsx`**
- `playerRows` für Drag-Drop von `[5,6,7]` → `[4,5,6,7]` (bzw. `[0,1,2,3]` flipped).

## SCHRITT 2 — Simultanes Live-Placement (30s)

**`src/lib/battleGame.ts`**
- Neue Konstante `PLACE_TIME_LIMIT = 30`.
- `MAX_UNITS` bleibt bestehen, aber neuer Cap: `playerMaxUnits = 9` (Roster-Größe). Eliminations-Modus → keine Eskalation.

**`src/hooks/useBattleGame.ts` (Singleplayer)**
- `phase`-Modell vereinfachen: `'place'` (eine gemeinsame Phase) → `'battle'` → `'game_won'`/`'game_lost'`. `place_player`/`place_enemy`/`round_won`/`round_lost`/`round_draw` werden nicht mehr verwendet, bleiben im Typ erhalten für Rückwärtskompatibilität.
- Beim Mount: KI generiert sofort `generateAIPlacement` und legt Einheiten in einem 10-Sekunden-Fenster gestaffelt (z.B. alle 1.1s eine) auf das Grid. Der Spieler sieht sie live erscheinen.
- 30s-Countdown läuft sofort beim Eintritt in `'place'`. Spieler kann währenddessen platzieren/entfernen.
- Bei `placeTimer === 0` → automatischer Übergang zu `'battle'` (`startBattle()`), kein Bereit-Button mehr.
- `confirmPlacement` entfällt als sichtbare Aktion (Funktion bleibt als no-op für Multiplayer-Kompat).
- `playerMaxUnits = 9` (kein Eskalations-Cap mehr).

**`src/hooks/useMultiplayerGame.ts` (Multiplayer)**
- Statt sequentiellem Placement (P1 platziert blind, P2 reagiert) → simultanes Placement.
- Beide Spieler schreiben ihre Units kontinuierlich nach Supabase (`player1_units` / `player2_units` als JSONB), z.B. bei jedem Place/Remove.
- Realtime-Subscription liest die gegnerischen Units live.
- Host startet den Timer; beide Clients zeigen denselben Countdown (über `room.battle_started_at` oder `placement_started_at` Timestamp).
- Bei Ablauf → beide Clients triggern automatisch `startBattle`.

**Datenbank-Migration**
- Neue Spalte `game_rooms.placement_started_at TIMESTAMPTZ` für synchronisierten Countdown.

## SCHRITT 3 — Automatischer Kampfstart

**`useBattleGame.ts` / `useMultiplayerGame.ts`**
- Beim Timer-Ablauf: kein User-Input nötig, `startBattle()` läuft automatisch.
- KI-Platzierung (SP): innerhalb der ersten 10s zufällig auf den eigenen 4 Reihen. Implementiert via `setInterval`, das eine Einheit pro Tick legt, bis 9 platziert sind. Bestehende `generateAIPlacement` wird verwendet (Random-Pfad bzw. Difficulty-1-Pfad).
- Formationslogik (`FORMATION_MODE`) bleibt vollständig aktiv (keine Änderung am Battle-Tick).

## SCHRITT 4 — Eliminations-Match

**`useBattleGame.ts`**
- `roundNumber`/`playerScore`/`enemyScore` werden nicht mehr für Sieg verwendet.
- Neuer Sieg-Check im `battleTick`: wenn alle gegnerischen Einheiten `dead || hp<=0` → `phase = 'round_won'`, `gameWon = true`, `gameOver = true`. Umgekehrt für Verlust. Bei beidseitiger Auslöschung im selben Tick → Unentschieden.
- Fatigue-System, Overtime, Draw-Offer, `nextRound`, `getMaxUnits` werden im neuen Flow nicht mehr aufgerufen (bleiben im Code).
- Kein Punktezähler-Update mehr.

**`src/pages/Index.tsx`**
- Scoreboard zeigt statt Punkten "Lebendige Einheiten" (z.B. `👤 N vs 💀 M`) ODER blendet Punkte aus und zeigt nur Rundenname "Eliminations-Match".
- "Bereit"-Button und "Nächste Runde"-Button entfernen.
- 30s-Countdown groß oben in der Mitte (eigene Komponente / overlay).
- Gegnerische Einheiten während Placement-Phase mit leicht rotem Overlay (z.B. `bg-danger/20` über dem Sprite). Eigene Aura-Zonen bleiben sichtbar, gegnerische Aura wird NICHT berechnet (Filter in `computeAuraOverlay`).

## Technische Details

### Geänderte Dateien
- `src/lib/battleGame.ts` (Konstanten, ggf. Sieg-Check-Helper)
- `src/hooks/useBattleGame.ts` (kompletter Placement-Flow, KI-Drip, Auto-Start, Eliminations-Sieg)
- `src/hooks/useMultiplayerGame.ts` (Live-Sync, gemeinsamer Timer, Auto-Start)
- `src/components/battle/BattleGrid.tsx` (Zonentönung, Enemy-Overlay während Placement)
- `src/pages/Index.tsx` (UI: Countdown oben, kein Bereit-Button, kein Next-Round-Button, Aura-Filter)
- `supabase/migrations/...` (neue Spalte `placement_started_at`)

### Was nicht angefasst wird
- `src/lib/battleGame.ts` Combat-Engine (Stats, RPS, calcDamage, Formationen)
- `src/lib/auraData.ts` (Aura-Zonen-Logik selbst)
- `src/lib/formations.ts`
- Admin-Interface (`AdminIcons.tsx`)
- `UnitPicker.tsx`

### Risiken
- `useMultiplayerGame.ts` kenne ich noch nicht im Detail — bei der Implementierung lese ich es vollständig.
- Realtime-Throughput: Bei jedem Place/Remove ein DB-Write → bei 30s und 9 Units pro Spieler ~9-20 Writes pro Spieler, unkritisch.
- Bestehende Phasen `round_won`/`round_lost` bleiben für Kompatibilität, werden aber semantisch zu Match-Ende umgenutzt.
