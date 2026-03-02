import { useEffect } from 'react';
import type { UseConfigDataResult } from '../hooks/useConfigData.js';
import { ConfigureMatrix } from './configure/ConfigureMatrix.js';
import type { RawToolGroup, TextureManifest } from '../types.js';

interface ConfigurePanelProps {
  toolGroups: RawToolGroup[];
  configData: UseConfigDataResult;
  textureManifest: TextureManifest | null;
  onClose: () => void;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}

export function ConfigurePanel({ toolGroups, configData, textureManifest, onClose, toDisplay, fromDisplay, inputStep }: ConfigurePanelProps) {
  const { matrix, loading, error, addStyle, renameStyle, removeStyle, updateParam, reorderStyles, paramOrder, reorderParams } = configData;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0' }}>
          Door Style Configuration
        </span>
        <span style={{ fontSize: 11, color: '#666688' }}>
          Default Profile
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      {/* Content */}
      {loading && (
        <div style={{ padding: 20, color: '#8888aa', fontSize: 12 }}>Loading...</div>
      )}
      {error && (
        <div style={{ padding: 20, color: '#ff6666', fontSize: 12 }}>Error: {error}</div>
      )}
      {!loading && (
        <ConfigureMatrix
          styles={matrix}
          toolGroups={toolGroups}
          onParamChange={updateParam}
          onRenameStyle={renameStyle}
          onRemoveStyle={removeStyle}
          onAddStyle={addStyle}
          onReorderStyles={reorderStyles}
          paramOrder={paramOrder}
          onReorderParams={reorderParams}
          textureManifest={textureManifest}
          toDisplay={toDisplay}
          fromDisplay={fromDisplay}
          inputStep={inputStep}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#1a1a2e',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderBottom: '1px solid #335577',
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8888aa',
  fontSize: 20,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
};
