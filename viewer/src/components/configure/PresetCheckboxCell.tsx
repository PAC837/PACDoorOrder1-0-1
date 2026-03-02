import { useMemo, useState, useRef, useEffect } from 'react';
import { generateEighthInchIncrements, formatMmAsFraction } from '../../configParams.js';

interface PresetCheckboxCellProps {
  minMm: number;
  maxMm: number;
  enabledWidths: number[];
  onChange: (enabledWidths: number[]) => void;
}

export function PresetCheckboxCell({ minMm, maxMm, enabledWidths, onChange }: PresetCheckboxCellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const increments = useMemo(
    () => generateEighthInchIncrements(minMm, maxMm),
    [minMm, maxMm],
  );

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (mm: number) => {
    const next = enabledWidths.includes(mm)
      ? enabledWidths.filter(x => x !== mm)
      : [...enabledWidths, mm].sort((a, b) => a - b);
    onChange(next);
  };

  const selectAll = () => onChange([...increments]);
  const selectNone = () => onChange([]);

  const count = enabledWidths.length;

  return (
    <div ref={ref} style={containerStyle}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={triggerStyle}
      >
        {count > 0 ? `${count}/${increments.length}` : 'None'}
        <span style={{ marginLeft: 4, fontSize: 8 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div style={dropdownStyle}>
          <div style={bulkRow}>
            <button type="button" onClick={selectAll} style={bulkBtn}>All</button>
            <button type="button" onClick={selectNone} style={bulkBtn}>None</button>
          </div>
          {increments.length === 0 && (
            <div style={{ padding: '6px 8px', color: '#666688', fontSize: 11 }}>
              Set min/max first
            </div>
          )}
          {increments.map(mm => (
            <label key={mm} style={itemStyle}>
              <input
                type="checkbox"
                checked={enabledWidths.includes(mm)}
                onChange={() => toggle(mm)}
                style={{ marginRight: 6 }}
              />
              <span style={{ fontSize: 11 }}>{formatMmAsFraction(mm)}</span>
              <span style={{ fontSize: 9, color: '#666688', marginLeft: 4 }}>
                ({mm.toFixed(2)} mm)
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'relative',
};

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
  minWidth: 260,
  zIndex: 10,
  maxHeight: 280,
  overflowY: 'auto',
  background: '#1e1e3a',
  border: '1px solid #335577',
  borderRadius: 4,
  marginTop: 2,
};

const bulkRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '4px 8px',
  borderBottom: '1px solid #335577',
};

const bulkBtn: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#8888aa',
  fontSize: 10,
  cursor: 'pointer',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 8px',
  cursor: 'pointer',
  color: '#e0e0e0',
};
