import { useEffect, useCallback } from 'react';
import type { HandleConfig, DoorPartType, HandlePlacement } from '../types.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface HandleAdvancedDialogProps {
  handleConfig: HandleConfig;
  setHandleConfig: React.Dispatch<React.SetStateAction<HandleConfig>>;
  doorPartType: DoorPartType;
  savedSep: number;
  setSavedSep: React.Dispatch<React.SetStateAction<number>>;
  thickness: number;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  onClose: () => void;
}

export function HandleAdvancedDialog({
  handleConfig, setHandleConfig,
  doorPartType, savedSep, setSavedSep,
  thickness, toDisplay, fromDisplay, inputStep,
  onClose,
}: HandleAdvancedDialogProps) {
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
          <span style={{ fontWeight: 700, fontSize: 14 }}>Handle Settings</span>
          <button onClick={onClose} style={closeBtnStyle} title="Close">{'\u2715'}</button>
        </div>

        {/* Separation (handle mode only) */}
        {handleConfig.holeSeparation > 0 && (
          <div style={fieldRow}>
            <label style={labelStyle}>Separation:</label>
            <CommitNumberInput value={toDisplay(handleConfig.holeSeparation)} step={inputStep} min={0}
              onCommit={(v) => {
                const mm = fromDisplay(v);
                setHandleConfig(prev => ({ ...prev, holeSeparation: mm }));
                if (mm > 0) setSavedSep(mm);
              }}
              style={inputStyle} />
          </div>
        )}

        {/* Inset from edge */}
        <div style={fieldRow}>
          <label style={labelStyle}>Inset from Edge:</label>
          <CommitNumberInput value={toDisplay(handleConfig.insetFromEdge)} step={inputStep}
            onCommit={(v) => setHandleConfig(prev => ({ ...prev, insetFromEdge: fromDisplay(v) }))}
            style={inputStyle} />
        </div>

        {/* Door-specific: elevation (for top/bottom/custom placements) */}
        {doorPartType === 'door' &&
          (handleConfig.doorPlacement === 'top' || handleConfig.doorPlacement === 'bottom' || handleConfig.doorPlacement === 'custom') && (
          <div style={fieldRow}>
            <label style={labelStyle}>Elevation:</label>
            <CommitNumberInput value={toDisplay(handleConfig.elevation)} step={inputStep}
              onCommit={(v) => setHandleConfig(prev => ({ ...prev, elevation: fromDisplay(v) }))}
              style={inputStyle} />
          </div>
        )}

        {/* Non-door: placement dropdown */}
        {doorPartType !== 'door' && (<>
          <div style={fieldRow}>
            <label style={labelStyle}>Placement:</label>
            <select value={handleConfig.placement}
              onChange={(e) => setHandleConfig(prev => ({ ...prev, placement: e.target.value as HandlePlacement }))}
              style={selectStyle}>
              <option value="center">Center</option>
              <option value="top-rail">Top Rail</option>
              <option value="two-equidistant">Two Equidistant</option>
            </select>
          </div>
          {handleConfig.placement === 'two-equidistant' && (
            <div style={fieldRow}>
              <label style={labelStyle}>Edge Distance:</label>
              <CommitNumberInput value={toDisplay(handleConfig.twoHandleEdgeDist)} step={inputStep}
                onCommit={(v) => setHandleConfig(prev => ({ ...prev, twoHandleEdgeDist: fromDisplay(v) }))}
                style={inputStyle} />
            </div>
          )}
        </>)}

        <div style={sectionDivider} />

        {/* On Front */}
        <div style={fieldRow}>
          <label style={labelStyle}>On Front:</label>
          <input type="checkbox" checked={handleConfig.onFront}
            onChange={(e) => setHandleConfig(prev => ({ ...prev, onFront: e.target.checked }))} />
        </div>

        {/* Hole specs */}
        <div style={fieldRow}>
          <label style={labelStyle}>Hole Diameter:</label>
          <CommitNumberInput value={toDisplay(handleConfig.holeDia)} step={inputStep}
            onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDia: fromDisplay(v) }))}
            style={inputStyle} />
        </div>

        <div style={fieldRow}>
          <label style={labelStyle}>Cut Through:</label>
          <input type="checkbox" checked={handleConfig.cutThrough}
            onChange={(e) => setHandleConfig(prev => ({
              ...prev,
              cutThrough: e.target.checked,
              ...(e.target.checked ? { holeDepth: thickness } : {}),
            }))} />
        </div>

        <div style={fieldRow}>
          <label style={labelStyle}>Hole Depth:</label>
          <CommitNumberInput
            value={toDisplay(handleConfig.cutThrough ? thickness : handleConfig.holeDepth)}
            step={inputStep}
            disabled={handleConfig.cutThrough}
            onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDepth: Math.min(fromDisplay(v), thickness) }))}
            style={{ ...inputStyle, ...(handleConfig.cutThrough ? { opacity: 0.5 } : {}) }} />
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
  width: 120,
};

const sectionDivider: React.CSSProperties = {
  borderTop: '1px solid #335577',
  margin: '8px 0',
};
