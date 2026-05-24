import { useState, useRef, useCallback } from 'react';
import { UnitType, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS, ColorGroup } from '@/lib/battleGame';
import { UnitInfoModal } from './UnitInfoModal';
import { UnitGlyph } from '@/components/UnitGlyph';
import { getUnitIcon, iconUrl } from '@/lib/unitIcons';


const COLOR_BORDER: Record<ColorGroup, string> = {
  red: 'border-unit-red',
  blue: 'border-unit-blue',
  green: 'border-unit-green',
};
const COLOR_BG: Record<ColorGroup, string> = {
  red: 'bg-unit-red/15',
  blue: 'bg-unit-blue/15',
  green: 'bg-unit-green/15',
};

const SLOT_COLORS: ColorGroup[] = ['red','red','red','green','green','green','blue','blue','blue'];

const LONG_PRESS_MS = 400;

interface UnitPickerProps {
  // Legacy (no roster) mode
  selected: UnitType | null;
  onSelect: (type: UnitType) => void;
  placedCount: number;
  maxUnits: number;
  bannedUnits?: UnitType[];
  fatigue?: Record<string, number>;
  unitTypes?: UnitType[];
  // Slot mode (when roster is given): selection by slot index
  roster?: UnitType[]; // length 9
  selectedSlot?: number | null;
  onSelectSlot?: (slot: number) => void;
  bannedSlots?: number[];
  placedSlots?: number[]; // slots already placed this round
  // Drag-and-drop placement (slot mode)
  onDragHover?: (row: number | null, col: number | null, type: UnitType | null) => void;
  onDragDrop?: (row: number, col: number, slotIdx: number) => void;
}

export function UnitPicker({
  selected, onSelect, placedCount, maxUnits,
  bannedUnits = [], fatigue = {}, unitTypes,
  roster, selectedSlot = null, onSelectSlot, bannedSlots = [], placedSlots = [],
  onDragHover, onDragDrop,
}: UnitPickerProps) {
  const [infoUnit, setInfoUnit] = useState<{ type: UnitType; color?: ColorGroup } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const dragStart = useRef<{ x: number; y: number; idx: number; type: UnitType } | null>(null);
  const draggedSlotIdx = useRef<number | null>(null);
  const lastHover = useRef<{ row: number; col: number } | null>(null);
  const isDragging = useRef(false);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; emoji: string; type: UnitType } | null>(null);

  const startPress = useCallback((type: UnitType) => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setInfoUnit(type);
    }, LONG_PRESS_MS);
  }, []);

  const cancelPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  // ─── Slot mode ───────────────────────────────────────────
  if (roster && roster.length === 9) {

    const findCellAtPoint = (x: number, y: number): { row: number; col: number } | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return null;
      const cellEl = el.closest('[data-cell-row]') as HTMLElement | null;
      if (!cellEl) return null;
      const r = parseInt(cellEl.getAttribute('data-cell-row') || '', 10);
      const c = parseInt(cellEl.getAttribute('data-cell-col') || '', 10);
      if (Number.isNaN(r) || Number.isNaN(c)) return null;
      return { row: r, col: c };
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, idx: number, type: UnitType) => {
      if (bannedSlots.includes(idx) || placedSlots.includes(idx)) return;
      didLongPress.current = false;
      isDragging.current = false;
      dragStart.current = { x: e.clientX, y: e.clientY, idx, type };
      draggedSlotIdx.current = idx;
      // Select immediately so visual state matches
      onSelectSlot?.(idx);
      // Long press → info modal
      longPressTimer.current = setTimeout(() => {
        didLongPress.current = true;
        setInfoUnit(type);
        dragStart.current = null;
      }, LONG_PRESS_MS);
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (!isDragging.current && Math.hypot(dx, dy) > 8) {
        isDragging.current = true;
        cancelPress();
      }
      if (!isDragging.current) return;
      setDragGhost({ x: e.clientX, y: e.clientY, emoji: UNIT_DEFS[dragStart.current.type].emoji, type: dragStart.current.type });
      const cell = findCellAtPoint(e.clientX, e.clientY);
      if (cell) {
        lastHover.current = cell;
        onDragHover?.(cell.row, cell.col, dragStart.current.type);
      } else {
        lastHover.current = null;
        onDragHover?.(null, null, null);
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
      cancelPress();
      const wasDragging = isDragging.current;
      const startInfo = dragStart.current;
      const slotIdx = draggedSlotIdx.current;
      dragStart.current = null;
      draggedSlotIdx.current = null;
      isDragging.current = false;
      setDragGhost(null);
      onDragHover?.(null, null, null);
      if (didLongPress.current) { didLongPress.current = false; return; }
      if (wasDragging && startInfo && slotIdx !== null) {
        const cell = findCellAtPoint(e.clientX, e.clientY);
        if (cell) onDragDrop?.(cell.row, cell.col, slotIdx);
      }
      // Pure tap: slot is already selected from pointerdown — nothing else to do
    };

    const handlePointerCancel = () => {
      cancelPress();
      dragStart.current = null;
      draggedSlotIdx.current = null;
      isDragging.current = false;
      setDragGhost(null);
      onDragHover?.(null, null, null);
    };

    return (
      <>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground text-center">{placedCount}/{maxUnits} platziert · <span className="text-[10px] opacity-60">ziehen = platzieren · halten = Info</span></p>
          <div className="grid grid-cols-3 gap-2">
            {roster.map((type, idx) => {
              const def = UNIT_DEFS[type];
              const color = SLOT_COLORS[idx];
              const isSelected = selectedSlot === idx;
              const isPlaced = placedSlots.includes(idx);
              const isBanned = bannedSlots.includes(idx);
              const disabled = isBanned || isPlaced;
              return (
                <button
                  key={idx}
                  onPointerDown={(e) => handlePointerDown(e, idx, type)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={disabled}
                  className={`p-2 rounded-xl border-2 transition-all text-center relative select-none touch-none ${
                    disabled
                      ? `border-border bg-muted/30 opacity-40 cursor-not-allowed ${isBanned ? 'grayscale' : ''}`
                      : isSelected
                      ? `${COLOR_BORDER[color]} ${COLOR_BG[color]} ring-1 ring-primary`
                      : `border-border ${COLOR_BG[color]}`
                  }`}
                >
                  {(isBanned || isPlaced) && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <span className="text-lg">{isPlaced ? '✓' : '💤'}</span>
                    </div>
                  )}
                  <UnitGlyph type={type} className="block mx-auto w-6 h-6" />
                  <p className="text-[10px] font-semibold text-foreground mt-1">{def.label}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {isBanned ? 'Ermüdet' : isPlaced ? 'Platziert' : <>❤️{def.hp} ⚔️{def.attack}</>}
                  </p>
                  <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full ${
                    color === 'red' ? 'bg-unit-red' : color === 'blue' ? 'bg-unit-blue' : 'bg-unit-green'
                  }`} />
                </button>
              );
            })}
          </div>
        </div>
        {dragGhost && (
          <div className="drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>{getUnitIcon(dragGhost.type) ? <img src={iconUrl(getUnitIcon(dragGhost.type)!)} alt="" className="w-8 h-8" style={{ imageRendering: 'pixelated' }} /> : dragGhost.emoji}</div>
        )}
        {infoUnit && <UnitInfoModal unitType={infoUnit} onClose={() => setInfoUnit(null)} />}
      </>
    );
  }


  // ─── Legacy type-based mode (tutorial, multiplayer) ────────
  const types = unitTypes && unitTypes.length > 0 ? unitTypes : UNIT_TYPES;

  const handleClick = useCallback((type: UnitType) => {
    if (didLongPress.current) { didLongPress.current = false; return; }
    onSelect(type);
  }, [onSelect]);

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center">{placedCount}/{maxUnits} platziert · <span className="text-[10px] opacity-60">gedrückt halten = Info</span></p>
        <div className="grid grid-cols-3 gap-2">
          {types.map(type => {
            const def = UNIT_DEFS[type];
            const color = UNIT_COLOR_GROUPS[type];
            const isSelected = selected === type;
            const isBanned = bannedUnits.includes(type);
            const fatigueLevel = fatigue[type] || 0;
            return (
              <button
                key={type}
                onClick={() => !isBanned && handleClick(type)}
                onTouchStart={() => startPress(type)}
                onTouchEnd={cancelPress}
                onTouchCancel={cancelPress}
                onMouseDown={() => startPress(type)}
                onMouseUp={cancelPress}
                onMouseLeave={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                disabled={isBanned}
                className={`p-2 rounded-xl border-2 transition-all text-center relative select-none ${
                  isBanned
                    ? 'border-border bg-muted/30 opacity-40 cursor-not-allowed grayscale'
                    : isSelected
                    ? `${COLOR_BORDER[color]} ${COLOR_BG[color]} ring-1 ring-primary`
                    : `border-border ${COLOR_BG[color]} hover:${COLOR_BORDER[color]}`
                }`}
              >
                {isBanned && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <span className="text-lg">💤</span>
                  </div>
                )}
                <UnitGlyph type={type} className="block mx-auto w-6 h-6" />
                <p className="text-[10px] font-semibold text-foreground mt-1">{def.label}</p>
                <p className="text-[9px] text-muted-foreground">
                  {isBanned ? 'Ermüdet' : <>❤️{def.hp} ⚔️{def.attack}</>}
                </p>
                {!isBanned && fatigueLevel > 0 && (
                  <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-warning/80 flex items-center justify-center">
                    <span className="text-[7px] font-bold text-warning-foreground">{fatigueLevel}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {infoUnit && <UnitInfoModal unitType={infoUnit} onClose={() => setInfoUnit(null)} />}
    </>
  );
}
