import { useEffect, useCallback } from 'react';
import { formatMmAsFraction } from '../configParams.js';
import type { DoorTypeDefaultsValue } from '../configParams.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface StyleEditorDialogProps {
  leftStileW: number;
  rightStileW: number;
  topRailW: number;
  bottomRailW: number;
  onPresetSelect: (widthMm: number) => void;
  presets: number[];
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  units: 'mm' | 'in';
  doorTypeDefaults: DoorTypeDefaultsValue;
  onDoorTypeDefaultsChange: (value: DoorTypeDefaultsValue) => void;
  onClose: () => void;
}

export function StyleEditorDialog({
  leftStileW, rightStileW, topRailW, bottomRailW,
  onPresetSelect, presets, toDisplay, fromDisplay, inputStep, units,
  doorTypeDefaults, onDoorTypeDefaultsChange, onClose,
}: StyleEditorDialogProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const fmt = (mm: number) => units === 'in' ? formatMmAsFraction(mm) : `${toDisplay(mm)}mm`;

  // Check if all four widths are the same (to highlight active preset)
  const allEqual = leftStileW === rightStileW && rightStileW === topRailW && topRailW === bottomRailW;
  const currentWidth = allEqual ? leftStileW : null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Style Editor</span>
          <button onClick={onClose} style={closeBtnStyle} title="Close">{'\u2715'}</button>
        </div>

        {/* Door diagram */}
        <div style={diagramContainer}>
          {/* Top rail label */}
          <div style={topLabel}>TR: {fmt(topRailW)}</div>

          <div style={doorFrame}>
            {/* Left stile label */}
            <div style={leftLabel}>
              <span style={verticalText}>LS: {fmt(leftStileW)}</span>
            </div>

            {/* Left stile */}
            <div style={stileStyle} />

            {/* Center column: top rail + panel + bottom rail */}
            <div style={centerColumn}>
              <div style={railStyle} />
              <div style={panelStyle}>
                <span style={{ color: '#556688', fontSize: 11 }}>Panel</span>
              </div>
              <div style={railStyle} />
            </div>

            {/* Right stile */}
            <div style={stileStyle} />

            {/* Right stile label */}
            <div style={rightLabel}>
              <span style={verticalText}>RS: {fmt(rightStileW)}</span>
            </div>
          </div>

          {/* Bottom rail label */}
          <div style={bottomLabel}>BR: {fmt(bottomRailW)}</div>
        </div>

        {/* Presets */}
        {presets.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: '#aaa', fontSize: 11, marginBottom: 6 }}>Stile/Rail Presets:</div>
            <div style={presetRow}>
              {presets.map((mm) => {
                const isActive = currentWidth !== null && Math.abs(currentWidth - mm) < 0.01;
                return (
                  <button
                    key={mm}
                    onClick={() => onPresetSelect(mm)}
                    style={{
                      ...presetBtn,
                      ...(isActive ? presetBtnActive : {}),
                    }}
                  >
                    {formatMmAsFraction(mm)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {presets.length === 0 && (
          <div style={{ marginTop: 12, color: '#666688', fontSize: 11, textAlign: 'center' }}>
            No presets configured for this style
          </div>
        )}

        {/* Door Type Defaults */}
        <div style={{ marginTop: 16, borderTop: '1px solid #335577', paddingTop: 12 }}>
          <div style={{ color: '#aaa', fontSize: 11, marginBottom: 8 }}>Door Type Defaults:</div>
          <DoorTypeRow label="Door" stile={doorTypeDefaults.door.stile} rail={doorTypeDefaults.door.rail}
            onStileChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, door: { ...doorTypeDefaults.door, stile: mm } })}
            onRailChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, door: { ...doorTypeDefaults.door, rail: mm } })}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          <DoorTypeRow label="Drawer" stile={doorTypeDefaults.drawer.stile} rail={doorTypeDefaults.drawer.rail}
            onStileChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, drawer: { ...doorTypeDefaults.drawer, stile: mm } })}
            onRailChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, drawer: { ...doorTypeDefaults.drawer, rail: mm } })}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          <DoorTypeRow label="Reduced" stile={doorTypeDefaults['reduced-rail'].stile} rail={doorTypeDefaults['reduced-rail'].rail}
            onStileChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, 'reduced-rail': { ...doorTypeDefaults['reduced-rail'], stile: mm } })}
            onRailChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, 'reduced-rail': { ...doorTypeDefaults['reduced-rail'], rail: mm } })}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          <DoorTypeRow label="End Panel" stile={doorTypeDefaults['end-panel'].stile} rail={doorTypeDefaults['end-panel'].rail}
            onStileChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, 'end-panel': { ...doorTypeDefaults['end-panel'], stile: mm } })}
            onRailChange={mm => onDoorTypeDefaultsChange({ ...doorTypeDefaults, 'end-panel': { ...doorTypeDefaults['end-panel'], rail: mm } })}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          <div style={dtSubRow}>
            <span style={dtSubLabel}>Bottom Rail</span>
            <CommitNumberInput
              value={toDisplay(doorTypeDefaults['end-panel'].bottomRail)}
              onCommit={v => onDoorTypeDefaultsChange({ ...doorTypeDefaults, 'end-panel': { ...doorTypeDefaults['end-panel'], bottomRail: fromDisplay(v) } })}
              step={inputStep} min={0} style={dtInput}
            />
          </div>
          <div style={{ height: 1, background: '#335577', margin: '6px 0' }} />
          <div style={dtRow}>
            <span style={dtLabel}>Slab</span>
            <span style={dtFieldLabel}>Min W</span>
            <CommitNumberInput
              value={toDisplay(doorTypeDefaults.slab.minWidth)}
              onCommit={v => onDoorTypeDefaultsChange({ ...doorTypeDefaults, slab: { ...doorTypeDefaults.slab, minWidth: fromDisplay(v) } })}
              step={inputStep} min={0} style={dtInput}
            />
            <span style={dtFieldLabel}>Min L</span>
            <CommitNumberInput
              value={toDisplay(doorTypeDefaults.slab.minLength)}
              onCommit={v => onDoorTypeDefaultsChange({ ...doorTypeDefaults, slab: { ...doorTypeDefaults.slab, minLength: fromDisplay(v) } })}
              step={inputStep} min={0} style={dtInput}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DoorTypeRow({ label, stile, rail, onStileChange, onRailChange, toDisplay, fromDisplay, inputStep }: {
  label: string; stile: number; rail: number;
  onStileChange: (mm: number) => void; onRailChange: (mm: number) => void;
  toDisplay: (mm: number) => number; fromDisplay: (val: number) => number; inputStep: number;
}) {
  return (
    <div style={dtRow}>
      <span style={dtLabel}>{label}</span>
      <span style={dtFieldLabel}>Stile</span>
      <CommitNumberInput value={toDisplay(stile)} onCommit={v => onStileChange(fromDisplay(v))} step={inputStep} min={0} style={dtInput} />
      <span style={dtFieldLabel}>Rail</span>
      <CommitNumberInput value={toDisplay(rail)} onCommit={v => onRailChange(fromDisplay(v))} step={inputStep} min={0} style={dtInput} />
    </div>
  );
}

// --- Styles ---

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: 8,
  padding: '16px 20px',
  minWidth: 320,
  maxWidth: 420,
  border: '1px solid #335577',
  color: '#e0e0e0',
  fontSize: 12,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: '1px solid #335577',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#999',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
};

const diagramContainer: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};

const topLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#88aacc',
  marginBottom: 2,
};

const bottomLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#88aacc',
  marginTop: 2,
};

const doorFrame: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
};

const leftLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 50,
};

const rightLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 50,
};

const verticalText: React.CSSProperties = {
  writingMode: 'vertical-rl',
  textOrientation: 'mixed',
  fontSize: 11,
  color: '#88aacc',
  whiteSpace: 'nowrap',
};

const stileStyle: React.CSSProperties = {
  width: 24,
  height: 140,
  background: '#2a3a55',
  border: '1px solid #445577',
};

const centerColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const railStyle: React.CSSProperties = {
  width: 120,
  height: 24,
  background: '#2a3a55',
  border: '1px solid #445577',
};

const panelStyle: React.CSSProperties = {
  width: 120,
  height: 92,
  background: '#1e2a40',
  border: '1px solid #334466',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const presetRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const presetBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  cursor: 'pointer',
};

const presetBtnActive: React.CSSProperties = {
  background: '#3366aa',
  borderColor: '#5588cc',
  color: '#fff',
};

const dtRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 3,
};

const dtSubRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 3,
  marginLeft: 72,
};

const dtLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#b0b8cc',
  width: 68,
  flexShrink: 0,
};

const dtSubLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#8890a4',
  width: 68,
  flexShrink: 0,
};

const dtFieldLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#667788',
  width: 28,
  textAlign: 'right',
  flexShrink: 0,
};

const dtInput: React.CSSProperties = {
  width: 60,
  padding: '3px 5px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  textAlign: 'right',
  flexShrink: 0,
};
