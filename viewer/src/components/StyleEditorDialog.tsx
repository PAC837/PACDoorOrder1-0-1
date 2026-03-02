import { useEffect, useCallback } from 'react';
import { formatMmAsFraction } from '../configParams.js';

interface StyleEditorDialogProps {
  leftStileW: number;
  rightStileW: number;
  topRailW: number;
  bottomRailW: number;
  onPresetSelect: (widthMm: number) => void;
  presets: number[];
  toDisplay: (mm: number) => number;
  units: 'mm' | 'in';
  onClose: () => void;
}

export function StyleEditorDialog({
  leftStileW, rightStileW, topRailW, bottomRailW,
  onPresetSelect, presets, toDisplay, units, onClose,
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
      </div>
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
