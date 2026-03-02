import { useState, useRef, useEffect, useMemo } from 'react';
import type { TextureManifest } from '../../types.js';

interface TextureCheckboxListCellProps {
  manifest: TextureManifest | null;
  selectedPaths: string[];
  onChange: (selectedPaths: string[]) => void;
  onCopyToAll: () => void;
}

interface TextureItem {
  path: string;
  displayName: string;
}

interface TextureGroup {
  category: string;
  brand?: string;
  items: TextureItem[];
}

function stripExt(filename: string): string {
  return filename.replace(/\.jpe?g$/i, '');
}

function buildGroups(manifest: TextureManifest): TextureGroup[] {
  const groups: TextureGroup[] = [];

  // Painted — one group per brand
  if (manifest.categories.painted) {
    const brands = Object.entries(manifest.painted).sort(([a], [b]) => a.localeCompare(b));
    for (const [brand, files] of brands) {
      if (files.length === 0) continue;
      groups.push({
        category: 'Painted',
        brand,
        items: files.map(f => ({
          path: `Painted/${brand}/${f}`,
          displayName: stripExt(f),
        })),
      });
    }
  }

  // Flat categories
  for (const cat of ['Primed', 'Raw', 'Sanded'] as const) {
    const key = cat.toLowerCase() as 'primed' | 'raw' | 'sanded';
    if (manifest.categories[key] && manifest[key].length > 0) {
      groups.push({
        category: cat,
        items: manifest[key].map(f => ({
          path: `${cat}/${f}`,
          displayName: stripExt(f),
        })),
      });
    }
  }

  return groups;
}

function flattenAll(groups: TextureGroup[]): string[] {
  return groups.flatMap(g => g.items.map(i => i.path));
}

export function TextureCheckboxListCell({
  manifest,
  selectedPaths,
  onChange,
  onCopyToAll,
}: TextureCheckboxListCellProps) {
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

  const groups = useMemo(() => (manifest ? buildGroups(manifest) : []), [manifest]);
  const allPaths = useMemo(() => flattenAll(groups), [groups]);

  const toggle = (path: string) => {
    const next = selectedPaths.includes(path)
      ? selectedPaths.filter(p => p !== path)
      : [...selectedPaths, path];
    onChange(next);
  };

  const selectAll = () => onChange([...allPaths]);
  const selectNone = () => onChange([]);

  const count = selectedPaths.length;
  const triggerLabel = !manifest
    ? 'No textures'
    : count === 0
      ? 'All'
      : `${count} selected`;

  // Track which painted categories are collapsed
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const toggleBrand = (key: string) => {
    setCollapsedBrands(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div ref={ref} style={containerStyle}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => manifest && setOpen(o => !o)}
          style={{
            ...triggerStyle,
            ...(!manifest ? { color: '#555577', cursor: 'default' } : {}),
          }}
        >
          {triggerLabel}
          {manifest && <span style={{ marginLeft: 4, fontSize: 8 }}>{open ? '\u25B2' : '\u25BC'}</span>}
        </button>
        {manifest && (
          <button
            type="button"
            onClick={onCopyToAll}
            style={copyAllBtnStyle}
            title="Copy texture selections to all styles"
          >
            {'\u21D2'} All
          </button>
        )}
      </div>

      {open && (
        <div style={dropdownStyle}>
          {/* No textures fallback */}
          {groups.length === 0 && (
            <div style={{ padding: '8px 10px', color: '#666688', fontSize: 11 }}>
              {manifest ? 'No textures found' : 'Configure texture folder in Admin panel'}
            </div>
          )}

          {/* Select All / None */}
          {groups.length > 0 && (
            <div style={actionRowStyle}>
              <button type="button" onClick={selectAll} style={actionBtnStyle}>Select All</button>
              <button type="button" onClick={selectNone} style={actionBtnStyle}>Select None</button>
            </div>
          )}

          {/* Grouped items */}
          {groups.map((group, gi) => {
            const brandKey = group.brand ? `${group.category}/${group.brand}` : group.category;
            const isPainted = !!group.brand;
            const isCollapsed = collapsedBrands.has(brandKey);

            // Show category header for first group of each category
            const showCatHeader = gi === 0 || groups[gi - 1].category !== group.category;

            return (
              <div key={brandKey}>
                {/* Category header */}
                {showCatHeader && (
                  <div style={categoryHeaderStyle}>
                    {group.category.toUpperCase()}
                  </div>
                )}

                {/* Brand sub-header (painted only) */}
                {isPainted && (
                  <div
                    style={brandHeaderStyle}
                    onClick={() => toggleBrand(brandKey)}
                  >
                    <span style={{ fontSize: 9 }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                    {' '}{group.brand}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666688' }}>
                      {group.items.filter(i => selectedPaths.includes(i.path)).length}/{group.items.length}
                    </span>
                  </div>
                )}

                {/* Texture checkboxes */}
                {!isCollapsed && group.items.map(item => (
                  <label
                    key={item.path}
                    style={{
                      ...itemStyle,
                      paddingLeft: isPainted ? 28 : 20,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPaths.includes(item.path)}
                      onChange={() => toggle(item.path)}
                      style={{ marginRight: 6 }}
                    />
                    <span style={{ fontSize: 11 }}>{item.displayName}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — match CheckboxListCell dark theme exactly
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
};

const triggerStyle: React.CSSProperties = {
  flex: 1,
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

const copyAllBtnStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#8888aa',
  fontSize: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 10,
  minWidth: 320,
  maxHeight: 360,
  overflowY: 'auto',
  background: '#1e1e3a',
  border: '1px solid #335577',
  borderRadius: 4,
  marginTop: 2,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '6px 8px',
  borderBottom: '1px solid #252545',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 3,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#aaaacc',
  fontSize: 10,
  cursor: 'pointer',
};

const categoryHeaderStyle: React.CSSProperties = {
  padding: '6px 8px 2px',
  fontSize: 10,
  fontWeight: 600,
  color: '#8888aa',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderTop: '1px solid #335577',
};

const brandHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px 3px 12px',
  fontSize: 11,
  fontWeight: 500,
  color: '#aaaacc',
  cursor: 'pointer',
  userSelect: 'none',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 8px 3px 20px',
  cursor: 'pointer',
  color: '#e0e0e0',
};
