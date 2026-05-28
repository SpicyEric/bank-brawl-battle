
# Plan: Einheiten-Überarbeitung (Beschreibung + echte Kampf-Mechanik)

## Ziel
1. **Beschreibungen** in `UNIT_DEFS` so kürzen, dass nur noch die Eigenschaft drinsteht – **kein Bewegungs-Text mehr**, keine Farb-/Strong-vs/Weak-vs-Zeilen im Modal.
2. **Spezialfähigkeiten** in `battleGame.ts` (deterministischer `battleTick` → gilt automatisch für SP **und** MP, da beide denselben Tick verwenden) so anpassen, dass sie genau das tun, was du beschrieben hast.
3. **UI-Modal**: Farbe/Stark-gegen/Schwach-gegen ausblenden.

## UI-Änderung (einmalig, vor Batch 1)
**`src/components/battle/UnitInfoModal.tsx`**: Die Farb-Badge und die beiden "Stark gegen / Schwach gegen"-Zeilen werden für die normale Lang-Drück-Ansicht entfernt (bzw. `hideColorInfo` per Default `true`). `UNIT_COLOR_GROUPS` bleibt im Code (Fallback für `createUnit`), wird nur im Modal nicht mehr angezeigt.

## Globale Combat-Regel (existiert bereits)
- Mindestschaden 3 ist schon gesetzt (`Math.max(3, ...)` in `calcDamage`). Bleibt.

## Batch 1 – Einheiten 1–10
| Einheit | Neue Beschreibung | Mechanik-Änderung |
|---|---|---|
| **Krieger** | "Profitiert extrem vom Farbsystem: +70% Schaden gegen farblich schwächere Gegner (statt +30%), nur −10% Schaden gegen farblich stärkere (statt −30%)." | In `calcDamage`: wenn `attacker.type==='warrior'`, Farb-Multiplikator override → strong=1.70, weak=0.90 |
| **Assassine** | "Rüstungsdurchdringung: Ignoriert 50% jeder Schadensreduktion des Ziels (z.B. Tank-Aura, Wald, Eisgolem-Buff)." | In `calcDamage`: wenn Angreifer Assassine, wird jeder `dmgTakenMul < 1` per `1 - (1 - mul)*0.5` halbiert. |
| **Drache** | "Flächenangriff: Trifft das Ziel voll, alle Einheiten im 3×3 um das Ziel bekommen 20% des Schadens. Flammen-Animation auf allen Splash-Feldern." | Splash-Wert 30% → 20%; Spin/Brand-Mechanik komplett raus; `BattleEvent` `aoeCells` (3×3 ums Ziel) + Feuer-Pulse-Animation in `BattleGrid` für alle Cells. |
| **Reiter** | "Motivation: Bläst alle 9 Ticks ins Horn – Verbündete im 3×3 um ihn herum bekommen 2 Ticks lang +80% Schaden." | Horn-Radius 5×5→3×3, Buff +100%→+80%, Ziel-Wechsel-Logik raus. |
| **Bogenschütze** | "20% Chance auf kritischen Treffer (+50% Schaden)." | Pfeil-Salve raus; in `calcDamage` für `archer`: RNG 20% → dmg ×1.5. |
| **Frostmagier** | "20% Wahrscheinlichkeit: friert Gegner für 3 Ticks ein (eingefrorene Gegner machen 50% weniger Schaden)." | Frost-Nova raus; Freeze-Chance auf 20% setzen, Freeze-Dauer 3 Ticks, `frozen`-Flag bewirkt 0.5× Outgoing-Damage (Bewegung NICHT mehr blocken). |
| **Schildträger** | "Schwerer Tank." | Aura −20% bleibt nicht (siehe Buff-System, separat). Bindings-Animation bleibt. Keine sonstige Spezialmechanik. |
| **Magier** | "Formationsaufbruch: 10% Chance, das angegriffene Ziel an den oberen Kartenrand (gegnerische Reihe) zu schleudern." | Impulswelle raus; bei jedem Mage-Hit 10% RNG → Ziel an `row=0` (bzw. gespiegelt für P2) in nächstes freies Feld in derselben Spalte teleportieren. Push-Animation via `pushedIds`. |
| **Schamane** | "Greift normal an, aber nur Ziele unter 70% HP bekommen vollen Schaden – sonst nur 3." | `damageBelow70`-Aura existiert evtl. – stattdessen direkt in `calcDamage` für `healer`: `target.hp / maxHp >= 0.7` → return 3, sonst voller Schaden. |
| **Banshee** | "Stirbt einmalig nur scheinbar – steht nach 3 Ticks am nächstmöglichen freien Feld mit 70 HP und 10 ATK wieder auf." | "Runden" → 3 **Ticks**. Respawn-Spot: nächstes freies Feld zum Todesort (BFS), nicht der Original-Spot wenn blockiert. |

## Batch 2 – Einheiten 11–20
| Einheit | Neue Beschreibung | Mechanik |
|---|---|---|
| **Vampir** | "Lifesteal 20% des verursachten Schadens. Fügt jedem Ziel Blutung zu: 10/5/3/1 HP über die nächsten 4 Ticks." | Lifesteal 30%→20% (auch im Buff). Bleeding bleibt. |
| **Vulkanit** | "Setzt das angegriffene Feld in Brand (6 Ticks, 5 Damage pro Tick an Einheiten, die drauf stehen)." | Lava-Plus raus. Nur das **eine** Zielfeld brennt für 6 Ticks à 5 Dmg. Buff überträgt exakt diese Fähigkeit auf gebuffte Einheiten. |
| **Schattenklinge** | "Alle 5 Ticks: teleportiert sich neben einen zufälligen Gegner auf dem 8×8-Feld, schlägt einmal zu, teleportiert sofort zurück – Spot bleibt reserviert." | "Hält max. Abstand"-AI raus, bewegt sich normal. Beim Teleport: alte Position als reservierter Platzhalter (kein anderer kann hin), nach Attack zurück. |
| **Sturmläufer** | "Schneller Angreifer – bringt Tempo in jeden Kampf (Cooldown 1)." | Keine Mechanik-Änderung. |
| **Brandstifter** | "Setzt Ziel in Brand: 4 Ticks lang 3 Damage/Tick. Stapelbar (max ~12 Dmg/Tick). Hinterlässt 6 Ticks brennende Spur (nur Feinde)." | Burn-Damage 5→3, sonst wie bisher. |
| **Blitzmagier** | "Kettenblitz: springt vom Ziel zu Feinden im Radius 2 weiter (30/20/15/10/5%)." | Keine Änderung. Lila/Blitz-Animation zwischen den Cells sicherstellen (`chainCells` Event). |
| **Spiegelkämpfer** | "Reflektiert 30% des erlittenen Schadens an den Angreifer zurück." | Schaden-Wert 30% (war 30%) — Reflektion wird **prozent-genau** zurückgegeben (nicht ×0.3 fix). **Death-Explosion komplett entfernen.** Buff-Reflect 20% bleibt. |
| **Opferlamm** | "Provoziert! Wird immer prioritär anvisiert, sobald in Reichweite. Heilt beim Tod alle Verbündeten um 35% HP." | Cooldown 5→4, Death-Heal 30%→35%, Targeting hart-priorisiert. Nerf-Zone: −20% HP zu Rundenbeginn für Einheiten in Nerf-Reichweite (in `auraEffects.ts` Lamm-Nerf hinzufügen). |
| **Richter** | "Pro gefallenem Verbündeten: +5 ATK permanent in dieser Runde." | +8→+5; Buff +3 ATK pro Tod (statt +5); Nerf −5 ATK pro toter Einheit in derselben Formation. |
| **Eisgolem** | "Schwerer Tank. 25% Chance bei Treffer, Angreifer einzufrieren (50% Schaden für 3 Ticks). Buff: teilt 50% des Schadens mit Verbündetem." | HP 200→180, Cooldown 4→5. Buff "Damage-Share" tatsächlich im Tick umsetzen. Nerf: 20% Selbst-Freeze-Chance bei jeder Attacke. |

## Batch 3 – Einheiten 21–30
| Einheit | Neue Beschreibung | Mechanik |
|---|---|---|
| **Kloner** | "Spawnt alle 6 Ticks einen Klon (max 3) zufällig auf dem 8×8-Schlachtfeld. Klone: 12 HP, 6 ATK." | "Erster sofort"-Logik raus; AI-"hält Abstand" raus. Spawn-Spot: zufälliges freies Feld auf dem 8×8 Combat-Bereich. |
| **Magnetiker** | "Reichweite 2. Wenn Ziel auf Reichweite 1 steht: 19 Damage statt 12. Buff: provoziert + 50% weniger Schaden. Nerf: Cooldown +2." | Pull-Mechanik raus. Nahkampf-Boost (dist≤1 → atk=19) in `calcDamage`. Magnetiker-Buff: provoke + 0.5× incoming. |
| **Spinnenkönigin** | "15% Chance: fängt Ziel im Netz (5 Ticks: kann nicht angreifen, kann sich bewegen)." | Web-Chance 25%→15%; Bewegung wird **nicht** blockiert, nur Angriff. Buff = Gift (2 Dmg/Tick, nicht stapelbar, hält bis Rundenende). Nerf: 10% Chance, dass die Einheit sich selbst einnetzt (5 Ticks keine Attack). |
| **Wasserwandler** | "Keine eigene Spezialfähigkeit. Buff: immun gegen Feuer, +50% Blitz-Schaden." | Tümpel-AI komplett raus, normale ALL_ADJACENT-Bewegung/Angriff. |
| **Doppelgänger** | "Spawnt zu Rundenstart ein Phantom (80 HP, 5 ATK) auf dem 8×8-Schlachtfeld so nah wie möglich am Gegner. Direkt angreifbar." | "5 Ticks unverwundbar" raus, "3 Gegnerlinien"-Spawn → 8×8 nahe Feindzone. |
| **Scharfschütze** | "Greift immer das Ziel mit dem niedrigsten HP an. Reichweite 4. Nerf-Zone: bei Tod 20 Damage an Verbündete in der Nerf-Zone." | Reichweite 3→4, Cooldown 5→6. Death-Trigger neu: −20 HP an alle in Nerf-Reichweite. |
| **Kettentänzer** | "Springt nach dem Treffer zu 1 weiteren Gegner (50% Schaden). Cooldown 3. Buff: gebuffte Verbündete bekommen ebenfalls Ketten-Effekt (50% Schaden auf 1 Nachbarn)." | Bisher 3 Hops à 70% → 1 Hop à 50%; Cooldown 2→3; Lila-Verbindungslinie animieren. Buff-Effekt im Tick implementieren. |
| **Sprengmeister** | "Alle 5 Ticks: Bombe auf Gegner. Explodiert 1 Tick später: 10 Dmg auf Ziel + 3×3 Splash. Buff: Verbündete machen 7 Dmg Splash im 3×3. Nerf: bei Tod 15 Dmg im 3×3." | Bombe-Mechanik vereinfachen: einzelne Bombe auf gewähltes Ziel, 1 Tick Fuse, 10 Dmg + Splash. Buff-Splash 7 implementieren. Nerf-Death-Splash 15 implementieren. |
| **Obelisk** | "Angriff 5, Cooldown 3. Adjacent (3×3) Verbündete: +20% Schaden & Cooldown −1 (nicht stapelbar mit weiteren Obelisken). Kettenblitz bei jedem Angriff (wie Blitzmagier). Nerf: 20% Miss-Chance." | Attack 0→5, CD 0→3, Buff +50%→+20%, CD halbiert→CD−1, Mehrfach-Obelisk-Stack verhindern (Flag pro Tick). Beam-Mechanik raus. |
| **Schattenpriester** | "Attack 12, Cooldown 4. Stack-Effekt: bei 2 Treffern verliert das Ziel sofort 15 HP, macht dauerhaft 50% weniger Schaden und ist nicht mehr heilbar." | Attack 10→12, CD 3→4, Burst 30→15, Debuff 60%→50%, +5-ATK-Trigger raus. Buff (Fluchstack) bleibt. |

## Reihenfolge der Code-Calls (Credit-effizient)

1. **Modal-UI** (eine Datei) → Farbinfo raus.
2. **Batch 1 Commit**: `battleGame.ts` (UNIT_DEFS-Strings + calcDamage/battleTick-Anpassungen) + ggf. `auraEffects.ts` + `BattleGrid.tsx` (Drachen-Flammen) in **einem** Durchgang pro Datei.
3. **Batch 2 Commit**: dito.
4. **Batch 3 Commit**: dito.
5. **Kontrolle**: Nach jedem Batch eine Checkliste hier im Chat (✅ Beschreibung geändert / ✅ Mechanik im `battleTick` greift / ✅ MP-kompatibel weil derselbe Tick), bevor wir zum nächsten Batch gehen.

## Technische Hinweise
- SP & MP nutzen beide `battleTick` aus `battleGame.ts` → eine Änderung dort wirkt automatisch in beiden Modi (siehe Memory: "Deterministic `battleTick` shared between SP and MP").
- Neue Status-Flags (z.B. `frozen`, `bleeding`, `cursed`, `revived`, `phantomSpawned`, `cloneCount`, `webbed`) werden im `Unit`-Interface ergänzt – minimal-invasiv mit optionalen Feldern.
- Animationen: neue Event-Typen ggf. zu `BattleEvent.type` hinzufügen (z.B. `magicianPush`, `vulkaniteBurn`, `chainDancerHop`) – `BattleGrid.tsx` bekommt entsprechende Renderer.
- Globaler Mindestschaden 3 bleibt unverändert.

## Bestätigung am Ende jedes Batches
Ich liste nach jedem Batch klar auf:
- ✅ Beschreibung angepasst
- ✅ Spezial-Effekt im Code (Datei + Funktion)
- ⚠️ Wenn etwas absichtlich noch nicht greift (z.B. weil es einen größeren Refactor bräuchte), explizit als TODO.

Sag Bescheid wenn ich loslegen soll – ich starte dann mit der UI-Anpassung + Batch 1.
