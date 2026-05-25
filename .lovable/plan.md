# Spalten-basiertes Placement & Lane-Disziplin

## Ziel
Die Spalte, in der ich platziere, soll genauso wichtig werden wie die Zeile. Aktuell rennen nach 5 Ticks alle Einheiten ins Chaos, egal wo sie standen. Neu: jede Einheit hat eine **Heim-Spalte** (= Spawn-Spalte) und versucht in dieser Spalte vorzurücken, bis ein Gegner in ihr Angriffsmuster läuft (oder klar erreichbar wird).

## Konzept – „Lane Discipline"

Jede Einheit bekommt beim Platzieren ein neues Feld `homeCol: number` (= Spawn-Spalte). Solange die Einheit im **Lane-Modus** ist, gilt:

1. **Zielwahl bevorzugt „Lane-Gegner"** – Gegner in `homeCol` (oder ±toleranz, siehe unten) werden ggü. anderen stark priorisiert.
2. **Bewegung bevorzugt Vorwärts-in-Spalte** – statt „nächster Schritt Richtung beliebigem Target" wird zuerst geprüft, ob es einen legalen Move gibt, der die Spalte hält **und** Richtung Gegner-Hälfte vorrückt. Erst wenn keiner existiert, weicht die Einheit aus.
3. **Lane-Break** – sobald ein Gegner ins eigene `attackPattern` läuft (oder in ≤ N Ticks erreichbar wird), darf die Einheit angreifen / sich darauf zubewegen. Auch wenn die Einheit über mehrere Ticks (z. B. 4) keinen Lane-Move machen kann, schaltet sie auf normales Verhalten zurück (verhindert Festkleben).

## Umgang mit nicht-orthogonalen Bewegungs-Mustern

Das ist der knifflige Teil. Vorschlag: **Lane wird per Spalten-Toleranz definiert, nicht per exakter Spalte.**

- **Toleranz pro Einheit aus `movePattern` ableiten:** `laneTolerance = min(|m.col|)` über alle Moves, die `m.row != 0` enthalten (= kleinste seitliche Verschiebung, die nötig ist, um nach vorne zu kommen).
  - Schildträger / Krieger / Reiter (orthogonal): Toleranz = 0 → strikt geradeaus in Spalte.
  - Magier (diagonal 1, manche 2): Toleranz = 1 → Spalte ±1.
  - Assassine (Sprung-Diagonalen 2): Toleranz = 2 → Spalte ±2 (zickzackt in seinem 5-Spalten-Korridor nach vorn).
  - Statische Einheiten (Obelisk, leeres movePattern): kein Lane-Verhalten, da sie sich eh nicht bewegen.
- Lane-Move-Filter wird dann: „neuer Move ist gültig, wenn `|nc - homeCol| <= laneTolerance` UND `nr` näher an Gegner-Seite (oder gleich, falls schon ganz vorne)".

Ergebnis: Krieger laufen wirklich geradeaus, Magier wackeln nur 1 Spalte raus, Assassine bleiben in ihrem 5-Spalten-Korridor.

## Wann Lane-Modus deaktiviert wird
- Ein Gegner steht in `attackPattern` der Einheit (sofortiger Angriff geht vor).
- Ein Gegner ist näher als `dangerDist = 2` (Notwehr schlägt Lane).
- `laneStuckTicks >= 4` (vier Ticks lang kein legaler Lane-Move möglich) → schaltet permanent auf normales BFS-Verhalten für den Rest des Rounds.
- Einheit hat eigenes spezielles Verhalten, das Lane überschreiben muss: `dragon` (Flieger), `waterwalker` (Wasserpfad), `shadowblade` (Teleport), `terrain-seeker` (Forest/Hill-Hopping), `bomber` (legt Bomben). Diese ignorieren Lane komplett.

## Ziel-Priorisierung (in `pickTarget`)

Neuer Block ganz oben (nach den fixen Lock-Ons wie warrior / banshee):
```
if (unit.homeCol != null && !unit.laneBroken) {
  const laneTol = laneToleranceFor(unit.type);
  const laneEnemies = enemies.filter(e => Math.abs(e.col - unit.homeCol!) <= laneTol);
  if (laneEnemies.length > 0) {
    // bevorzuge den vordersten Lane-Gegner
    laneEnemies.sort(forwardDistFromUnit);
    return laneEnemies[0];
  }
}
```
Erst wenn keine Lane-Gegner existieren → bestehende Logik (column-targeting, frontline, ranged-nearest).

## Bewegungs-Auswahl (in `_selectBestMove`)

Vor dem bestehenden Scoring:
```
if (unit.homeCol != null && !unit.laneBroken && !canAttack(unit, target)) {
  const forward = unit.team === 'player' ? -1 : +1; // P1 läuft nach oben, P2 nach unten
  const laneTol = laneToleranceFor(unit.type);
  const laneMoves = possibleMoves.filter(p =>
    Math.abs(p.col - unit.homeCol!) <= laneTol &&
    Math.sign(p.row - unit.row) === forward
  );
  if (laneMoves.length > 0) {
    // wähle den, der homeCol am nächsten ist, dann am weitesten vorne
    laneMoves.sort((a,b) =>
      Math.abs(a.col - unit.homeCol!) - Math.abs(b.col - unit.homeCol!)
      || (forward * (a.row - b.row))
    );
    unit.laneStuckTicks = 0;
    return laneMoves[0];
  }
  unit.laneStuckTicks = (unit.laneStuckTicks ?? 0) + 1;
  if (unit.laneStuckTicks >= 4) unit.laneBroken = true;
}
```

## Technische Details

### Datenmodell (`battleGame.ts`)
- `Unit` neue Felder: `homeCol?: number`, `laneBroken?: boolean`, `laneStuckTicks?: number`.
- Beim Spawn / `placeUnit` `homeCol = col` setzen.
- Helper `laneToleranceFor(type)` neben `UNIT_DEFS`, ggf. pro Unit überschreibbar (Default = berechnet aus movePattern; Override-Map für Sonderfälle wie `assassin: 2`).

### Lane-Break-Trigger zusätzlich
- In `applyDamage`: wenn Einheit Damage von Gegner außerhalb der Lane bekommt → `laneBroken = true` (Selbstschutz).
- In `pickTarget`: wenn `target` außerhalb Lane-Toleranz liegt UND in `attackPattern` reicht → trotzdem angreifen, aber `laneBroken = true` setzen.

### Ausnahmen (Lane wird ignoriert / `homeCol` nicht gesetzt)
- `dragon`, `waterwalker`, `shadowblade`, `obelisk`, `bomber`, `terrain-seeker`-Verhalten (`mountaineer`, `ranger`, `vulkanit` während Lava-Suche), `cloner`-Klone, `doppelganger`-Phantome.
- Bei diesen wird `homeCol` gar nicht gesetzt → bestehendes Verhalten unverändert.

### Geltungsbereich
- Änderungen rein in `src/lib/battleGame.ts` (Targeting + Movement) und `src/lib/headlessSim.ts` falls dort eine eigene Kopie der Bewegungslogik existiert (kurz prüfen, beide synchron halten).
- Keine UI-Änderungen nötig; Placement bleibt gleich, der Effekt entsteht durch das neue Verhalten.

## Offene Fragen
1. **Lane-Tolerance pro Einheit:** Default aus `movePattern` reicht für die meisten. Soll ich für **Assassine** wirklich Toleranz 2 erlauben (er bleibt im 5-Spalten-Korridor), oder enger (Toleranz 1, kann er aber gar nicht legal bewegen)?
2. **Lane-Break dauerhaft oder zurücksetzbar?** Vorschlag: dauerhaft für den Rest der Combat-Phase – wenn ein Krieger einmal aus seiner Lane raus ist, kämpft er normal weiter. Alternative: nach 3 Ticks ohne Damage wieder „Lane-Snap" zurück.
3. **Reiter / Dash-Einheiten:** Lane respektieren (Dash nur in Spalte) oder von Lane ausnehmen (Dash überall)? Vorschlag: Lane-respektieren – sonst zerschießt der Reiter sofort jede Disziplin.
4. **Heiler / Support (healer, lamb, obelisk-aura-empfänger):** Lane macht für die wenig Sinn. Healer aus Lane ausnehmen?

Sag mir kurz zu 1–4, dann setze ich's um.
