# Slot-Machine Roster mit Handicap

Komplette Neugestaltung von `/roster` (SP + MP) als Casino-Slot-Machine. Bestehende Unit-Daten, `UNIT_TYPES`, Aura-Logik, Kampfflow bleiben unverändert.

## 1. Screen-Umbau `src/pages/UnitRoster.tsx`

Komplett ersetzt (alter Picker/Slot-Code entfällt). Aufbau:

```text
┌─────────────────────────────────────┐
│ ←  Stelle deinen Trupp auf          │
├─────────────────────────────────────┤
│ Handicap  ● ● ●                     │
├─────────────────────────────────────┤
│   Links     Mitte     Rechts        │
│  ┌────┐   ┌────┐    ┌────┐          │
│  │ ?  │   │ ?  │    │ ?  │          │
│  └────┘   └────┘    └────┘          │
│   …3×3 Slot-Grid mit Icon/Name/HP   │
├─────────────────────────────────────┤
│       [   Drehen!   ]               │
└─────────────────────────────────────┘
```

**State-Maschine**

- `idle` → Button „Drehen!" (groß, primary)
- `spinning` → Walzen rotieren Icons schnell durch (`setInterval ~60 ms`, Random aus `UNIT_TYPES`); Button wird „Stopp!" (rot)
  - 1. Tap → linke Spalte stoppt (3 Slots nacheinander mit ~120 ms Delay), „Klonk"-Sound pro Slot
  - 2. Tap → mittlere Spalte stoppt
  - 3. Tap → rechte Spalte stoppt, Fanfare-Sound
- `stopped` → zwei Buttons: „Neu drehen +1 Handicap" (links, secondary, disabled wenn `handicap === 3`) und „Bestätigen" (rechts, success/grün)

**Ziehen ohne Duplikate**: einmaliger `shuffle(UNIT_TYPES).slice(0, 9)` beim Start jedes Spins. Während des Drehens werden zufällige Icons angezeigt; beim Stoppen jeder Spalte werden die zuvor gezogenen Final-Units in die Slots dieser Spalte gesetzt (Reihenfolge: Spalten-Spalten-Spalten, Top-Bottom).

**Handicap-Dots**: 3 Kreise oben links, leuchten rot je nach `handicap`-Wert (0–3). Kein „X/9"-Zähler mehr rechts oben.

## 2. Sound (`src/lib/sfx.ts`)

Drei neue Web-Audio-Funktionen:
- `sfxSlotSpin()` — looped Klick-Rattern (kurze Square-Wave-Pulse, gestartet/gestoppt manuell)
- `sfxSlotKlonk()` — kurzer Tief-Frequenz-Pop (~80 ms)
- `sfxSlotFanfare()` — kurze 3-Ton-Aufwärts-Sequenz

## 3. Handicap-Übergabe an `/game`

**Single-Player**: URL wird erweitert um `&handicap=N`:
`/game?roster=archer,…&handicap=2`

**Multiplayer**: neue Spalten in `game_rooms`:
- `player1_handicap integer not null default 0`
- `player2_handicap integer not null default 0`

Beim „Bestätigen" wird `updateRoom(roomId, { [rosterField]: slots, [readyField]: true, [handicapField]: handicap })` aufgerufen. `Index.tsx` (`MultiplayerGame`) liest beide Handicaps aus dem Room.

## 4. Per-Round Limit-Anpassung

Aktuelle Logik in `useBattleGame.ts` und `useMultiplayerGame.ts` (`getRoundUnitLimit` → 9/11/13/15/17). Wir erweitern beide auf `getRoundUnitLimit(round, handicap) = max(1, base - handicap)`. Handicap wird per Hook-Option reingereicht (`useBattleGame({ handicap })`, `useMultiplayerGame({ …, ownHandicap, opponentHandicap })`).

Im Picker (`UnitPicker`) werden die letzten `handicap` Einträge des Rosters mit Schloss-Icon + ausgegraut dargestellt und sind nicht wählbar. Hinweis oberhalb des Pickers: „Du hast X von 9 Einheiten zur Verfügung" mit `X = 9 - handicap`.

## 5. Pre-Match-Overview (nur MP)

Kurzer Splash-Screen (2–3 s, automatisch weiter) direkt vor dem ersten Placement, der beide Spielerinfos zeigt:

```text
Spieler A: 9 Einheiten — kein Handicap
Spieler B: 7 Einheiten — Handicap ●●○
```

Implementiert als überlagerndes Modal in `Index.tsx`, das beim ersten Mount erscheint und durch Tap oder Timeout schließt.

## 6. Migration

```sql
ALTER TABLE public.game_rooms
  ADD COLUMN player1_handicap integer not null default 0,
  ADD COLUMN player2_handicap integer not null default 0;
```

Keine neuen Tabellen, keine RLS-Änderungen nötig (Policies decken alle Spalten ab). Alte Rooms laufen mit `handicap = 0` weiter.

## 7. Aufräumen

- `LONG_PRESS_MS`, Picker-Grid, `selectedUnit`, `handleSlotClick` werden aus `UnitRoster.tsx` entfernt.
- `UnitInfoModal` bleibt nicht mehr nötig auf diesem Screen (Info-Long-Press entfällt).
- Bestehende Routen, MP-Subscribe-Logik (`subscribeToRoom`, `getRoomById`), Navigation zu `/game` bleiben strukturell gleich.

## Technische Details

- Spinner-Animation: `useEffect` mit `setInterval` startet beim Wechsel nach `spinning`, schreibt pro Spalte einen zufälligen `UnitType` ins Display-State. Beim Stop einer Spalte werden für deren 3 Slots final festgelegte Werte gesetzt (mit kleinem `setTimeout`-Versatz für sequenzielles „Einrasten").
- Determinismus: Nur die 9 finalen Einheiten zählen — was während der Animation flackert ist rein optisch.
- Mobile: Buttons groß genug für Touch, Layout passt in 390×844 ohne Scroll.

## Reihenfolge der Umsetzung

1. Migration für `game_rooms.player1_handicap` / `player2_handicap`
2. SFX-Funktionen erweitern
3. `UnitRoster.tsx` komplett neu
4. `useBattleGame` + `useMultiplayerGame` um `handicap` erweitern
5. `Index.tsx`: Handicap aus URL/Room lesen, an Hooks weitergeben, Overview-Splash (MP), Picker-Sperrung der letzten Einheiten
6. Test im Preview (SP-Flow + MP-Flow)
