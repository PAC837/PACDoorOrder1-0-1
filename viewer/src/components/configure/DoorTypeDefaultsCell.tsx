import { useState, useRef, useEffect } from 'react';
import type { DoorTypeDefaultsValue } from '../../configParams.js';
import { CommitNumberInput } from '../CommitNumberInput.js';

interface DoorTypeDefaultsCellProps {
  value: DoorTypeDefaultsValue;
  onChange: (value: DoorTypeDefaultsValue) => void;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}

export function DoorTypeDefaultsCell({ value, onChange, toDisplay, fromDisplay, inputStep }: DoorTypeDefaultsCellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const updateStileRail = (key: 'door' | 'drawer' | 'reduced-rail' | 'end-panel', field: 'stile' | 'rail' | 'bottomRail', mm: number) => {
    const prev = value[key] as { stile: number; rail: number; bottomRail?: number };
    onChange({ ...value, [key]: { ...prev, [field]: mm } });
  };

  const updateSlab = (field: 'minWidth' | 'minLength', mm: number) => {
    onChange({ ...value, slab: { ...value.slab, [field]: mm } });
  };

  return (
    <div ref={ref} style={containerStyle}>
      <button type="button" onClick={() => setOpen(o => !o)} style={triggerStyle}>
        Defaults
        <span style={{ marginLeft: 4, fontSize: 8 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div style={dropdownStyle}>
          {/* Door */}
          <FrameRow
            label="Door"
            stile={value.door.stile}
            rail={value.door.rail}
            onStileChange={mm => updateStileRail('door', 'stile', mm)}
            onRailChange={mm => updateStileRail('door', 'rail', mm)}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          {/* Drawer */}
          <FrameRow
            label="Drawer"
            stile={value.drawer.stile}
            rail={value.drawer.rail}
            onStileChange={mm => updateStileRail('drawer', 'stile', mm)}
            onRailChange={mm => updateStileRail('drawer', 'rail', mm)}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          {/* Reduced */}
          <FrameRow
            label="Reduced"
            stile={value['reduced-rail'].stile}
            rail={value['reduced-rail'].rail}
            onStileChange={mm => updateStileRail('reduced-rail', 'stile', mm)}
            onRailChange={mm => updateStileRail('reduced-rail', 'rail', mm)}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          {/* End Panel */}
          <FrameRow
            label="End Panel"
            stile={value['end-panel'].stile}
            rail={value['end-panel'].rail}
            onStileChange={mm => updateStileRail('end-panel', 'stile', mm)}
            onRailChange={mm => updateStileRail('end-panel', 'rail', mm)}
            toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
          />
          <div style={subRowStyle}>
            <span style={subLabelStyle}>Bottom Rail</span>
            <CommitNumberInput
              value={toDisplay(value['end-panel'].bottomRail)}
              onCommit={v => updateStileRail('end-panel', 'bottomRail', fromDisplay(v))}
              step={inputStep} min={0} style={inputStyle}
            />
          </div>

          <div style={separatorStyle} />

          {/* Slab */}
          <div style={rowStyle}>
            <span style={labelStyle}>Slab</span>
            <span style={fieldLabelStyle}>Min W</span>
            <CommitNumberInput
              value={toDisplay(value.slab.minWidth)}
              onCommit={v => updateSlab('minWidth', fromDisplay(v))}
              step={inputStep} min={0} style={inputStyle}
            />
            <span style={fieldLabelStyle}>Min L</span>
            <CommitNumberInput
              value={toDisplay(value.slab.minLength)}
              onCommit={v => updateSlab('minLength', fromDisplay(v))}
              step={inputStep} min={0} style={inputStyle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* Reusable row for door types with stile + rail inputs */
function FrameRow({ label, stile, rail, onStileChange, onRailChange, toDisplay, fromDisplay, inputStep }: {
  label: string;
  stile: number;
  rail: number;
  onStileChange: (mm: number) => void;
  onRailChange: (mm: number) => void;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={fieldLabelStyle}>Stile</span>
      <CommitNumberInput
        value={toDisplay(stile)}
        onCommit={v => onStileChange(fromDisplay(v))}
        step={inputStep} min={0} style={inputStyle}
      />
      <span style={fieldLabelStyle}>Rail</span>
      <CommitNumberInput
        value={toDisplay(rail)}
        onCommit={v => onRailChange(fromDisplay(v))}
        step={inputStep} min={0} style={inputStyle}
      />
    </div>
  );
}

const containerStyle: React.CSSProperties = { position: 'relative' };

const triggerStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 10,
  minWidth: 340,
  background: '#1e1e3a',
  border: '1px solid #335577',
  borderRadius: 4,
  marginTop: 2,
  padding: '4px 0',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 8px',
  gap: 4,
};

const subRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '1px 8px 3px',
  gap: 4,
  marginLeft: 68,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#b0b8cc',
  width: 64,
  flexShrink: 0,
};

const subLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#8890a4',
  width: 64,
  flexShrink: 0,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#667788',
  width: 28,
  textAlign: 'right',
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  width: 56,
  padding: '2px 4px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  textAlign: 'right',
  flexShrink: 0,
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: '#335577',
  margin: '4px 8px',
};
