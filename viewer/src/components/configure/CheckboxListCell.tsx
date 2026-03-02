import { useState, useRef, useEffect } from 'react';

interface CheckboxListCellProps {
  items: { id: number; label: string }[];
  selectedIds: number[];
  onChange: (selectedIds: number[]) => void;
}

export function CheckboxListCell({ items, selectedIds, onChange }: CheckboxListCellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: number) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    onChange(next);
  };

  const count = selectedIds.length;

  return (
    <div ref={ref} style={containerStyle}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={triggerStyle}
      >
        {count > 0 ? `${count} selected` : 'None'}
        <span style={{ marginLeft: 4, fontSize: 8 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div style={dropdownStyle}>
          {items.length === 0 && (
            <div style={{ padding: '6px 8px', color: '#666688', fontSize: 11 }}>No items</div>
          )}
          {items.map(item => (
            <label key={item.id} style={itemStyle}>
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => toggle(item.id)}
                style={{ marginRight: 6 }}
              />
              <span style={{ fontSize: 11 }}>{item.label}</span>
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
  zIndex: 10,
  minWidth: 280,
  maxHeight: 240,
  overflowY: 'auto',
  background: '#1e1e3a',
  border: '1px solid #335577',
  borderRadius: 4,
  marginTop: 2,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '#e0e0e0',
};
