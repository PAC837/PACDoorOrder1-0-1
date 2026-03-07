import { useState, useCallback } from 'react';
import type { LayoutMapping, SlotPosition, PanelContentId, LayoutPreset, CompactSlotPosition, CompactLayoutMapping } from '../types.js';
import { PANEL_DISPLAY_NAMES, ALL_SLOTS, COMPACT_SLOTS } from '../types.js';

interface LayoutCustomizerProps {
  layoutMapping: LayoutMapping;
  onSwap: (slotA: SlotPosition, slotB: SlotPosition) => void;
  onReset: () => void;
  onClose: () => void;
  layoutPreset: LayoutPreset;
  onPresetChange: (preset: LayoutPreset) => void;
  compactLayoutMapping: CompactLayoutMapping;
  onCompactSwap: (slotA: CompactSlotPosition, slotB: CompactSlotPosition) => void;
  onCompactReset: () => void;
}

/** CSS grid placement for the 5 slots in a 2-col, 6-row mini layout (default). */
const SLOT_GRID: Record<SlotPosition, React.CSSProperties> = {
  'left-top':  { gridColumn: 1, gridRow: '1 / 3' },
  'left-mid':  { gridColumn: 1, gridRow: '3 / 5' },
  'left-bot':  { gridColumn: 1, gridRow: '5 / 7' },
  'right-top': { gridColumn: 2, gridRow: '1 / 4' },
  'right-bot': { gridColumn: 2, gridRow: '4 / 7' },
};

/** CSS grid placement for compact layout: 3-col, 4-row. Left stacked, top-right split, bottom-right full. */
const COMPACT_SLOT_GRID: Record<CompactSlotPosition, React.CSSProperties> = {
  'left-top':       { gridColumn: 1, gridRow: '1 / 3' },
  'left-bot':       { gridColumn: 1, gridRow: '3 / 5' },
  'right-top-left': { gridColumn: 2, gridRow: '1 / 3' },
  'right-top-right':{ gridColumn: 3, gridRow: '1 / 3' },
  'right-bot':      { gridColumn: '2 / 4', gridRow: '3 / 5' },
};

export function LayoutCustomizer({
  layoutMapping, onSwap, onReset, onClose,
  layoutPreset, onPresetChange,
  compactLayoutMapping, onCompactSwap, onCompactReset,
}: LayoutCustomizerProps) {
  const [dragOver, setDragOver] = useState<SlotPosition | null>(null);
  const [compactDragOver, setCompactDragOver] = useState<CompactSlotPosition | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, slot: SlotPosition) => {
    e.dataTransfer.setData('text/plain', slot);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, slot: SlotPosition) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(slot);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetSlot: SlotPosition) => {
    e.preventDefault();
    setDragOver(null);
    const sourceSlot = e.dataTransfer.getData('text/plain') as SlotPosition;
    if (sourceSlot && sourceSlot !== targetSlot) {
      onSwap(sourceSlot, targetSlot);
    }
  }, [onSwap]);

  const handleCompactDragStart = useCallback((e: React.DragEvent, slot: CompactSlotPosition) => {
    e.dataTransfer.setData('text/plain', slot);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleCompactDragOver = useCallback((e: React.DragEvent, slot: CompactSlotPosition) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setCompactDragOver(slot);
  }, []);

  const handleCompactDrop = useCallback((e: React.DragEvent, targetSlot: CompactSlotPosition) => {
    e.preventDefault();
    setCompactDragOver(null);
    const sourceSlot = e.dataTransfer.getData('text/plain') as CompactSlotPosition;
    if (sourceSlot && sourceSlot !== targetSlot) onCompactSwap(sourceSlot, targetSlot);
  }, [onCompactSwap]);

  return (
    <div style={st.backdrop} onClick={onClose}>
      <div style={st.card} onClick={e => e.stopPropagation()}>
        <div style={st.header}>
          <span style={st.title}>Customize Layout</span>
          <button onClick={onClose} style={st.closeBtn}>&times;</button>
        </div>

        {/* Preset toggle */}
        <div style={st.presetRow}>
          <button
            onClick={() => onPresetChange('default')}
            style={{
              ...st.presetBtn,
              ...(layoutPreset === 'default' ? st.presetBtnActive : {}),
            }}
          >
            Default
          </button>
          <button
            onClick={() => onPresetChange('compact')}
            style={{
              ...st.presetBtn,
              ...(layoutPreset === 'compact' ? st.presetBtnActive : {}),
            }}
          >
            Compact
          </button>
          <button
            onClick={() => onPresetChange('simple')}
            style={{
              ...st.presetBtn,
              ...(layoutPreset === 'simple' ? st.presetBtnActive : {}),
            }}
          >
            Simple
          </button>
          <button
            onClick={() => onPresetChange('simple-xs')}
            style={{
              ...st.presetBtn,
              ...(layoutPreset === 'simple-xs' ? st.presetBtnActive : {}),
            }}
          >
            Simple + XS
          </button>
        </div>

        {layoutPreset === 'simple' ? (
          <>
            <p style={st.hint}>Toolbar + Order List only. Click eye icon to view doors.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr 2fr', gap: 4, height: 160 }}>
              <div style={{ ...st.cell, borderColor: '#444466', background: 'rgba(42, 42, 66, 0.6)' }}>
                <span style={st.cellIcon}>{PANEL_ICONS.toolbar}</span>
                <span style={st.cellLabel}>Toolbar</span>
              </div>
              <div style={{ ...st.cell, borderColor: '#444466', background: 'rgba(42, 42, 66, 0.6)' }}>
                <span style={st.cellIcon}>{PANEL_ICONS.orderList}</span>
                <span style={st.cellLabel}>Order List</span>
              </div>
            </div>
          </>
        ) : layoutPreset === 'simple-xs' ? (
          <>
            <p style={st.hint}>Toolbar + Cross Section + Order List. Click eye icon to view doors.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '2fr 1fr 3fr', gap: 4, height: 180 }}>
              <div style={{ ...st.cell, borderColor: '#444466', background: 'rgba(42, 42, 66, 0.6)' }}>
                <span style={st.cellIcon}>{PANEL_ICONS.toolbar}</span>
                <span style={st.cellLabel}>Toolbar</span>
              </div>
              <div style={{ ...st.cell, borderColor: '#444466', background: 'rgba(42, 42, 66, 0.6)' }}>
                <span style={st.cellIcon}>{PANEL_ICONS.crossSection}</span>
                <span style={st.cellLabel}>Cross Section</span>
              </div>
              <div style={{ ...st.cell, borderColor: '#444466', background: 'rgba(42, 42, 66, 0.6)' }}>
                <span style={st.cellIcon}>{PANEL_ICONS.orderList}</span>
                <span style={st.cellLabel}>Order List</span>
              </div>
            </div>
          </>
        ) : layoutPreset === 'default' ? (
          <>
            <p style={st.hint}>Drag panels to swap positions</p>
            <div style={st.grid}>
              {ALL_SLOTS.map(slot => {
                const panelId = layoutMapping[slot];
                const isOver = dragOver === slot;
                return (
                  <div
                    key={slot}
                    draggable
                    onDragStart={e => handleDragStart(e, slot)}
                    onDragOver={e => handleDragOver(e, slot)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, slot)}
                    style={{
                      ...st.cell,
                      ...SLOT_GRID[slot],
                      borderColor: isOver ? '#5599cc' : '#444466',
                      background: isOver ? 'rgba(85, 153, 204, 0.15)' : 'rgba(42, 42, 66, 0.6)',
                    }}
                  >
                    <span style={st.cellIcon}>{PANEL_ICONS[panelId]}</span>
                    <span style={st.cellLabel}>{PANEL_DISPLAY_NAMES[panelId]}</span>
                  </div>
                );
              })}
            </div>
            <div style={st.footer}>
              <button onClick={onReset} style={st.resetBtn}>Reset Layout</button>
            </div>
          </>
        ) : (
          <>
            <p style={st.hint}>Drag panels to swap positions</p>
            <div style={st.compactGrid}>
              {COMPACT_SLOTS.map(slot => {
                const panelId = compactLayoutMapping[slot];
                const isOver = compactDragOver === slot;
                return (
                  <div
                    key={slot}
                    draggable
                    onDragStart={e => handleCompactDragStart(e, slot)}
                    onDragOver={e => handleCompactDragOver(e, slot)}
                    onDragLeave={() => setCompactDragOver(null)}
                    onDrop={e => handleCompactDrop(e, slot)}
                    style={{
                      ...st.cell,
                      ...COMPACT_SLOT_GRID[slot],
                      borderColor: isOver ? '#5599cc' : '#444466',
                      background: isOver ? 'rgba(85, 153, 204, 0.15)' : 'rgba(42, 42, 66, 0.6)',
                    }}
                  >
                    <span style={st.cellIcon}>{PANEL_ICONS[panelId]}</span>
                    <span style={st.cellLabel}>{PANEL_DISPLAY_NAMES[panelId]}</span>
                  </div>
                );
              })}
            </div>
            <div style={st.footer}>
              <button onClick={onCompactReset} style={st.resetBtn}>Reset Layout</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const PANEL_ICONS: Record<PanelContentId, string> = {
  toolbar: '\u2630',       // hamburger menu
  crossSection: '\u2500',  // horizontal line
  canvas3d: '\u25A6',      // square with diagonal fill
  elevation: '\u25A1',     // white square
  orderList: '\u2261',     // identical to (triple bar)
};

const st: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: '#1a1a2e',
    border: '1px solid #444466',
    borderRadius: 12,
    padding: 20,
    width: 380,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 600,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8888aa',
    fontSize: 22,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  presetRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 12,
  },
  presetBtn: {
    flex: 1,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: 'rgba(42, 42, 66, 0.6)',
    color: '#8888aa',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  presetBtnActive: {
    background: 'rgba(85, 119, 170, 0.4)',
    borderColor: '#5577aa',
    color: '#ffffff',
  },
  hint: {
    color: '#8888aa',
    fontSize: 12,
    marginBottom: 14,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'repeat(6, 1fr)',
    gap: 4,
    height: 240,
  },
  compactGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: 'repeat(4, 1fr)',
    gap: 4,
    height: 200,
  },
  cell: {
    border: '2px solid #444466',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    transition: 'border-color 0.15s, background 0.15s',
    userSelect: 'none' as const,
  },
  cellIcon: {
    fontSize: 18,
    color: '#8888aa',
    marginBottom: 2,
  },
  cellLabel: {
    fontSize: 11,
    color: '#ccccdd',
    fontWeight: 500,
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 14,
  },
  resetBtn: {
    background: 'rgba(85, 119, 170, 0.3)',
    border: '1px solid #5577aa',
    borderRadius: 6,
    color: '#aabbdd',
    fontSize: 12,
    padding: '6px 16px',
    cursor: 'pointer',
  },
};
