# Plan: Drei neue Einheiten

## 1. Sprengmeister (`bomber`) – Rot
- **Stats:** 70 HP, 0 ATK, Cooldown 3, Move 8-Richtungen 1 Feld, kein Angriffsmuster (leer).
- **Mechanik (KI):** Bewegt sich Richtung nächstem Gegner; legt **alle 3 Ticks** auf das Feld unter sich eine Bombe (`bombs: { row, col, fuse: 2, dmg: 35, ownerTeam }[]` in `GameState`).
- **Explosion:** nach 2 Ticks → 3×3 um Bombenfeld, 35 Damage (Team-fremd; eigene Einheiten immun). Kein Feuer-Overlay.
- **Ring-Animation:** neues Event `bomb_explode` mit `centerRow/Col`. CSS-Keyframe: Ring startet klein gelb am Bombenfeld, skaliert auf 3×3-Größe, Farbverlauf gelb → rot → schwarz, ~600 ms, ein einzelner expandierender Ring.
- **Special alle 12 Ticks (`bombSpecialTimer`):** Für **jeden lebenden Gegner** wird genau auf dessen Position eine Bombe geworfen (`fuse: 1`, `dmg: 35`, 3×3 AoE). Visuelle Wurf-Animation (`bomb_throw` Event von Sprengmeister → Zielzelle, kurze Parabel), dann normale Ring-Explosion im nächsten Tick.

## 2. Obelisk (`obelisk`) – Grün
- **Stats:** 150 HP, 0 ATK, Cooldown 0, **bewegt sich nicht** (movePattern leer, neues Flag `static: true` oder einfach leeres Pattern), attackPattern leer.
- **Dauerhafter Plus-Aura (4 Felder ↑↓←→ direkt adjacent):** Klasse `cell-obelisk-aura` – pulsierendes helles Weiß-Gelb mit niedriger Opacity. Allys, die in einer Aura-Zelle stehen, bekommen den Buff sofort (immer aktiv, refresh jeden Tick).
- **Strahl alle 3 Ticks (`obeliskBeamTimer`), 2 Ticks aktiv:** Plus expandiert auf alle Felder in 4 Richtungen bis Rand. Klasse `cell-obelisk-beam`.
- **Buff für getroffene Verbündete:** `obeliskBuff: number` (Ticks, 3). Während aktiv: +30% Damage, `cooldown` Soft-Cap = 1 (in Attack-Reset). Konstante Aura → Buff refresht jeden Tick auf 3.
- **Visuals:** Emoji 🗿 oder neuer Icon-Slot.

## 3. Schattenpriester (`shadowpriest`) – Rot (passt thematisch; oder grün – default rot)
- **Stats:** 80 HP, **10 ATK** (Standard), Cooldown **3** (durch Stacks → 2 mit jedem 3er-Stack? Klärung unten), Move diagonal 1 Feld, Attack orthogonal bis 2 Felder.
- **Fluch-Stacks:** Neues Unit-Feld `curseStacks?: number` auf jedem getroffenen Ziel. Pro Treffer +1.
- **Bei 3 Stacks (einmalig getriggert, dann Flag `cursed: true`):**
  - Ziel verliert **sofort 30% seines aktuellen HP**.
  - Ziel bekommt **−50% Attack** (permanenter Mul `curseAtkMul = 0.5`).
  - Ziel kann nicht mehr geheilt werden (`unhealable: true`) – wird in Heal-Logik (Healer, Vampir-Lifesteal, Lamm-Tod-Heal) geprüft.
- **Seelenraub alle 8 Ticks (`soulHarvestTimer`):** Zähle alle lebenden Gegner mit `cursed: true`. Pro solchem Gegner: Schattenpriester selbst bekommt **+5 ATK permanent** (oder bis Match-Ende; permanent solange am Leben) und **Cooldown wird auf 2 reduziert** (einmaliger Step, min 1).
- **KI:** zielt bevorzugt Gegner mit höchsten Stacks (`switch_to_highest_stack`).
- **Visual:** dunkel-violetter Fluch-Ring um Zielzelle solange `curseStacks > 0`, intensiver bei 3 Stacks (Klasse `cell-cursed-3`).

## Tech-Details
- `battleGame.ts`:
  - `UnitType` um `'bomber' | 'obelisk' | 'shadowpriest'` erweitern.
  - `UNIT_COLOR_GROUPS`, `UNIT_DEFS` ergänzen.
  - `Unit` Felder: `curseStacks`, `cursed`, `unhealable`, `curseAtkMul`, `obeliskBuff`, `bombFuseTimer` (Sprengmeister-Cooldown bis nächste Bombe), `bombSpecialTimer`, `obeliskBeamTimer`, `soulHarvestTimer`, `permAtkBonus`.
  - `GameState` neu: `bombs: { row, col, fuse, dmg, ownerTeam }[]`.
  - Neue Tick-Phasen: `processBombTick` (decrement fuse → bei 0 Explosion + Event + Damage), Obelisk-Aura-Apply, Obelisk-Beam-Trigger, Soul-Harvest, Sprengmeister-Place-Bomb, Sprengmeister-Special-Wurf.
  - Heal-Funktionen: skip Targets mit `unhealable`.
- `battleEvents.ts`: Event-Typen ergänzen (`bomb_throw`, `bomb_explode`, `obelisk_beam`, `curse_apply`, `curse_burst`, `soul_harvest`).
- `BattleGrid.tsx`: Render der `bombs` (kleines 💣 mit Fuse-Anzeige), Ring-Explosion-Overlay, Aura/Beam-Zell-Klassen, Fluch-Overlay; Event-Handling für Wurf-Trajektorien (CSS-Translate von Quelle → Ziel).
- `index.css`: Keyframes `bomb-ring-explode` (gelb→rot→schwarz, scale 0.2→3), `obelisk-aura-pulse`, `obelisk-beam-glow`, `curse-pulse`, `curse-burst`.
- `UnitGlyph` / Roster: 3 neue Emojis (💣, 🗿, 🕯️ oder ähnlich).

## Offene Fragen (kurz)
1. Schattenpriester-Farbe: rot (default) ok?
2. Bei Sprengmeister-Bombe auf eigenes Feld: trifft die 3×3 auch ihn selbst, wenn er nicht rechtzeitig wegläuft? (Vorschlag: Allys immun, also nein.)
3. Obelisk-Beam: stoppt der Strahl an Hindernissen (Wasser/Berg/Einheiten) oder geht er durch? (Vorschlag: geht durch – reiner Buff, kein Damage.)
4. Schattenpriester +5 ATK alle 8 Ticks: pro Triggertick **einmal** +5 (egal wie viele cursed Gegner) oder **pro cursed Gegner** +5? Du hast beides angedeutet – Vorschlag: **+5 pro cursed Gegner zum Trigger-Zeitpunkt**.
