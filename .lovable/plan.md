# Lane Discipline – Finalisierung nach Antworten

## Entscheidungen (aus User-Antworten)

1. **Assassine:** Lane-Toleranz = 2 (5-Spalten-Korridor). Generelle Regel: Toleranz wird so gesetzt, dass jede Einheit sich tatsächlich nach vorne bewegen kann – keine Einheit darf durch Lane-Filter blockieren.
2. **Lane-Break:** **Dauerhaft** für den Rest der Combat-Phase. Sobald gebrochen → bestehende Logik (z. B. „schwächsten Gegner suchen") greift wieder voll, freie Bewegung.
3. **Reiter / Dash-Einheiten:** Lane **respektieren**. Dash darf nur in der Spalte (innerhalb Toleranz) ausgeführt werden, bis Lane gebrochen ist.
4. **Heiler / Support:** `healer` und `lamb` werden aus Lane-Disziplin **ausgenommen** (kein `laneCol` → exempt). Obelisk ist eh statisch, bleibt exempt.

## Status im Code

Die Grundimplementierung in `src/lib/battleGame.ts` existiert bereits aus dem letzten Schritt:
- `Unit`-Felder `laneCol`, `laneBroken`, `laneStuckTicks`
- `LANE_EXEMPT_TYPES`, `laneToleranceFor`, `isLaneActive`, `forwardSign`
- Lane-Bevorzugung in `findTarget`
- Lane-Move-Filter in `_selectBestMove` mit 4-Tick-Stuck-Break

## Was jetzt noch fertig gemacht wird

### 1. Toleranz-Sanity-Check pro Unit-Typ
- `laneToleranceFor` so anpassen, dass für jeden Typ **mindestens ein Vorwärts-Move im Korridor möglich** ist. Falls die aus `movePattern` abgeleitete Toleranz keinen Move mit `row != 0` zulässt, automatisch hochsetzen.
- Explizite Overrides:
  - `assassin: 2` (bestätigt)
  - `mage: 1`
  - alle orthogonalen (warrior, knight, rider, archer, sniper, tank, frost, chaindancer, banshee, magier-varianten falls orthogonal): `0`
- Sicherstellen, dass keine bewegliche Einheit Toleranz so klein hat, dass sie nie laufen kann (Fallback: Toleranz = kleinste `|col|` aller Vorwärts-Moves).

### 2. Reiter / Dash respektiert Lane
- Im Reiter-Dash-Code (Mehrfach-Schritt) zusätzlich Lane-Filter anwenden, solange `isLaneActive(unit)` true ist: Dash-Zielspalte muss `|col - laneCol| <= tol` einhalten. Falls kein gültiger Dash → normaler Single-Step im Lane-Korridor.
- Sobald Lane gebrochen (siehe Punkt 4) → Dash wieder frei.

### 3. Heiler / Lamb aus Lane ausnehmen
- `LANE_EXEMPT_TYPES` bereits enthält `healer`, `lamb` – verifizieren.
- Sicherstellen, dass `createUnit` für diese Typen `laneCol = null` setzt, damit `isLaneActive` sofort false liefert.

### 4. Lane-Break Trigger schärfen (dauerhaft)
Zusätzlich zu „4 Ticks ohne Lane-Move":
- **Schaden von außerhalb der Lane** → `laneBroken = true` (Notwehr / aktiv im Kampf).
- **Eigener Angriff auf Ziel außerhalb der Lane** (z. B. weil `attackPattern` ein Out-of-Lane-Feld trifft) → `laneBroken = true`.
- **Nahkampfkontakt erfolgt** (`dangerDist <= 1` und Angriff ausgeführt) → `laneBroken = true`.

Einmal `true` → bleibt für Rest der Combat-Phase true. Nach dem Round-Reset wird `laneBroken` auf `false` zurückgesetzt und `laneCol` auf die neue Spawn-Spalte gesetzt.

### 5. Round-Reset
- Beim Start einer neuen Placement→Combat-Phase: für alle (nicht-exempten) Einheiten `laneCol = col`, `laneBroken = false`, `laneStuckTicks = 0` setzen.

### 6. `headlessSim.ts` synchron halten
- Prüfen, ob `headlessSim.ts` eigene Bewegungs-/Targeting-Kopie hat. Falls ja: gleiche Lane-Logik dort spiegeln, damit Balancing-Tool dieselbe Mechanik simuliert.

## Technische Stellen (Dateien)
- `src/lib/battleGame.ts` – Toleranz-Tabelle, Dash-Filter, Lane-Break-Trigger in `applyDamage`/Angriffsausführung, Round-Reset.
- `src/lib/headlessSim.ts` – nur falls dort eigene Movement-Kopie vorhanden.

## Keine UI-Änderungen
Placement-UI bleibt unverändert; Spaltenwahl wirkt jetzt automatisch durch das neue Verhalten.
