import { useEffect, useCallback } from 'react';
import type { HingeConfig, HingeSide } from '../types.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface HingeAdvancedDialogProps {
  hingeConfig: HingeConfig;
  setHingeConfig: React.Dispatch<React.SetStateAction<HingeConfig>>;
  thickness: number;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  onClose: () => void;
}

export function HingeAdvancedDialog({
  hingeConfig, setHingeConfig,
  thickness, toDisplay, fromDisplay, inputStep,
  onClose,
}: HingeAdvancedDialogProps) {
  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Hinge Settings</span>
          <button onClick={onClose} style={closeBtnStyle} title="Close">{'\u2715'}</button>
        </div>

        {/* Side */}
        <div style={fieldRow}>
          <label style={labelStyle}>Side:</label>
          <select value={hingeConfig.side}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, side: e.target.value as HingeSide }))}
            style={selectStyle}>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>

        {/* Count */}
        <div style={fieldRow}>
          <label style={labelStyle}>Count:</label>
          <input type="number" value={hingeConfig.count} min={2} max={5}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, count: Math.max(2, Math.min(5, Number(e.target.value))) }))}
            style={{ ...inputStyle, width: 50 }} />
        </div>

        {/* Edge Distance */}
        <div style={fieldRow}>
          <label style={labelStyle}>Edge Distance:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.edgeDistance)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, edgeDistance: fromDisplay(v) }))}
            style={inputStyle} />
        </div>

        {/* Equidistant */}
        <div style={fieldRow}>
          <label style={labelStyle}>Equidistant:</label>
          <input type="checkbox" checked={hingeConfig.equidistant}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, equidistant: e.target.checked }))} />
        </div>

        {/* Manual positions (when not equidistant) */}
        {!hingeConfig.equidistant && (
          Array.from({ length: hingeConfig.count }).map((_, i) => (
            <div key={i} style={fieldRow}>
              <label style={labelStyle}>Hinge {i + 1}:</label>
              <CommitNumberInput value={toDisplay(hingeConfig.positions[i] ?? 0)} step={inputStep}
                onCommit={(v) => {
                  const newPos = [...hingeConfig.positions];
                  newPos[i] = fromDisplay(v);
                  setHingeConfig(prev => ({ ...prev, positions: newPos }));
                }}
                style={inputStyle} />
            </div>
          ))
        )}

        <div style={sectionDivider} />

        {/* Cup specs */}
        <div style={fieldRow}>
          <label style={labelStyle}>Cup Diameter:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.cupDia)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDia: fromDisplay(v) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Cup Depth:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.cupDepth)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDepth: Math.min(fromDisplay(v), thickness) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Boring Distance:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.cupBoringDist)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupBoringDist: fromDisplay(v) }))}
            style={inputStyle} />
        </div>

        <div style={sectionDivider} />

        {/* Mount specs */}
        <div style={fieldRow}>
          <label style={labelStyle}>Mount Diameter:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.mountDia)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDia: fromDisplay(v) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Mount Depth:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.mountDepth)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDepth: Math.min(fromDisplay(v), thickness) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Mount Spacing:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.mountSeparation)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountSeparation: fromDisplay(v) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Mount Inset:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.mountInset)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountInset: fromDisplay(v) }))}
            style={inputStyle} />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Mount on Front:</label>
          <input type="checkbox" checked={hingeConfig.mountOnFront}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, mountOnFront: e.target.checked }))} />
        </div>
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
  minWidth: 280,
  maxWidth: 360,
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

const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 6,
};

const labelStyle: React.CSSProperties = {
  color: '#aaa',
  fontSize: 11,
  minWidth: 100,
};

const inputStyle: React.CSSProperties = {
  width: 70,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  textAlign: 'right',
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  width: 80,
};

const sectionDivider: React.CSSProperties = {
  borderTop: '1px solid #335577',
  margin: '8px 0',
};
