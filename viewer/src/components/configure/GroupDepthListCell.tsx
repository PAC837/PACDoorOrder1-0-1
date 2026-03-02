import { useState, useRef, useEffect } from 'react';
import { CommitNumberInput } from '../CommitNumberInput.js';

interface GroupDepthListCellProps {
  items: { id: number; label: string }[];
  entries: Array<{ groupId: number; depth: number }>;
  onChange: (entries: Array<{ groupId: number; depth: number }>) => void;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}

export function GroupDepthListCell({ items, entries, onChange, toDisplay, fromDisplay, inputStep }: GroupDepthListCellProps) {
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

  const entryMap = new Map(entries.map(e => [e.groupId, e.depth]));

  const toggleGroup = (id: number) => {
    if (entryMap.has(id)) {
      onChange(entries.filter(e => e.groupId !== id));
    } else {
      onChange([...entries, { groupId: id, depth: 3.175 }]); // default 1/8"
    }
  };

  const updateDepth = (id: number, depth: number) => {
    onChange(entries.map(e => e.groupId === id ? { ...e, depth } : e));
  };

  const count = entries.length;

  return (
    <div ref={ref} style={containerStyle}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={triggerStyle}
      >
        {count > 0 ? `${count} group${count !== 1 ? 's' : ''}` : 'None'}
        <span style={{ marginLeft: 4, fontSize: 8 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div style={dropdownStyle}>
          {entries.length > 0 && (
            <div
              style={{ ...itemStyle, borderBottom: '1px solid #335577', cursor: 'pointer', color: '#cc8888' }}
              onClick={() => { onChange([]); setOpen(false); }}
            >
              <span style={{ fontSize: 11 }}>None (clear all)</span>
            </div>
          )}
          {items.length === 0 && (
            <div style={{ padding: '6px 8px', color: '#666688', fontSize: 11 }}>No groups available</div>
          )}
          {items.map(item => {
            const checked = entryMap.has(item.id);
            const depth = entryMap.get(item.id) ?? 3.175;
            return (
              <div key={item.id} style={itemStyle}>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGroup(item.id)}
                    style={{ marginRight: 6 }}
                  />
                  <span style={{ fontSize: 11, flex: 1 }}>{item.label}</span>
                </label>
                {checked && (
                  <CommitNumberInput
                    value={toDisplay(depth)}
                    onCommit={(v) => updateDepth(item.id, fromDisplay(v))}
                    step={inputStep}
                    min={0}
                    style={{
                      ...depthInputStyle,
                      ...(depth > 12.7 ? depthWarningStyle : {}),
                    }}
                    title={depth > 12.7 ? 'Warning: depth exceeds 1/2"' : 'Depth'}
                  />
                )}
              </div>
            );
          })}
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
  minWidth: 320,
  maxHeight: 280,
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
  gap: 6,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  color: '#e0e0e0',
  flex: 1,
  minWidth: 0,
};

const depthInputStyle: React.CSSProperties = {
  width: 64,
  padding: '2px 4px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  textAlign: 'right',
  flexShrink: 0,
};

const depthWarningStyle: React.CSSProperties = {
  borderColor: '#cc8833',
  background: '#3a2a1e',
};
