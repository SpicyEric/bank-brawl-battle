# Plan: Multiplayer auf SP-Parität bringen

## Ziel
Multiplayer soll sich exakt wie der Einzelspieler-Modus anfühlen — gleiche Bewegungen, Aura, Buffs, Buttons (Schrei/Flanke/Opfer/Aufgeben/Spionage). Raum-Erstellung/Beitritt bleibt unangetastet.

## Änderungen

### 1. Doppelgänger-Nerf (klein)
`src/lib/battleGame.ts` → `spawnDoppelgangerPhantoms`: Phantom-HP/maxHp = 20, attack = 10. Bleibt sofort angreifbar (`phantom: 0`).

### 2. Spionage hebt eigene Aura-Anzeige auf (SP + MP)
`src/components/battle/BattleGrid.tsx`: Während `spying` aktiv ist, die grünen Aura-Overlays (+2/+3) des eigenen Boards ausblenden, damit nur das gespiegelte Gegner-Feld sichtbar ist.

### 3. Multiplayer: Gleichzeitiges Bauen statt Alternierend
`src/hooks/useMultiplayerGame.ts` umstellen:
- Entfernen: `placingPlayer`, `placingPhase` ('first'/'second'), `getDeterministicFirstPlacer`, `first_placement_done`-Broadcast.
- Neu: Beide Spieler bauen parallel mit eigenem 60s-Timer (`MULTI_PLACE_TIME_LIMIT` → 60 oder neuer Constant).
- Bereit-Flag pro Spieler über `updateRoom` (`player1_ready`, `player2_ready` existieren bereits).
- Broadcast `placement_ready` → wenn beide ready ODER beide Timer abgelaufen → Host startet Battle.
- Host sammelt beide Unit-Listen aus DB-Feldern (`player1_units`, `player2_units`), baut finales Grid, broadcastet `battle_start` mit komplettem Grid.
- Wer bereit ist, sieht „Warten auf Gegner…" — kann aber nicht mehr bauen.

### 4. Multiplayer: Spionage-Button
- Neuer Broadcast `spy_request` ist nicht nötig — Spy zeigt nur lokal das gegnerische Feld an. Während Battle: gegnerisches Grid ist bereits im State (`grid` ist gespiegelt für Guest). Während Bauphase: Gegner-Bauten müssen live via Broadcast `placement_update` (throttled, alle ~1s) propagiert werden, sonst hat Spy nichts zu zeigen.
- Beim Klick: 3s lang gespiegelte Gegnerseite anzeigen, dann zurück. Logik analog zu SP.

### 5. Multiplayer: Aktive Buttons (Schrei/Flanke/Opfer/Aufgeben)
- `useMultiplayerGame` exportiert dieselben Funktionen wie SP: `warCry`, `focusFire` (Flanke?), `sacrifice`, `shieldWall`, `surrenderRound`. Großteils schon vorhanden — sicherstellen, dass jede über Broadcast zum Gegner gespiegelt wird.
- `surrenderRound` neu: Broadcast `surrender` → Gegner bekommt Punkt, Host beendet Runde.
- `src/pages/Index.tsx`: UI ist generisch via `game`-Prop — keine Änderung nötig, sofern MP-Hook dieselben Callbacks bereitstellt.

### 6. Terrain-Hintergrund-Sync
`src/lib/battleGame.ts` → `generateTerrain` nutzt evtl. `Math.random`. Im MP muss der Host das Terrain inkl. Sand/Gras-Wahl generieren und per `terrain`-Broadcast (existiert) an Guest schicken. Sicherstellen, dass der Untergrund-Typ (Sand vs. Wiese) Teil des Grid-States ist und nicht clientseitig zufällig neu gewählt wird. `BattleGrid` darf den Hintergrund nicht aus `Math.random()` wählen — falls doch, in `Cell` ein Feld `biome` ergänzen und vom Host gesetzt synchronisieren.

## Technische Details

**Bereit-Sync-Flow:**
```
Spieler1 klickt Bereit → updateRoom({player1_ready:true}) + Broadcast 'ready'
Spieler2 klickt Bereit → updateRoom({player2_ready:true}) + Broadcast 'ready'
Host-Effect beobachtet beide Ready-Flags ODER Timer=0 →
  liest player1_units + player2_units aus DB →
  baut Grid (eigene Einheiten in PLAYER_ROWS, Gegner-Einheiten gespiegelt in ENEMY_ROWS) →
  Broadcast 'battle_start' mit serialisiertem Grid
```

**Spy-Bauphase:** alle 1.5s `placement_snapshot` broadcasten mit aktuellen `playerUnits` (serialisiert). Guest cached das in `opponentBuildSnapshot` und Spy rendert daraus.

## Reihenfolge der Implementation
1. Doppelgänger-Nerf + Spy-Aura-Fix (kleine, isolierte Edits)
2. MP: gleichzeitiges Bauen + Ready-Sync
3. MP: Spy-Snapshot-Broadcast
4. MP: Buttons-Parität prüfen + Surrender
5. Terrain-Sync verifizieren

## Risiko
Raumerstellung/Beitritt (`Multiplayer.tsx`, `multiplayer.ts`) bleibt unangetastet. Nur `useMultiplayerGame.ts` wird substanziell umgebaut.
