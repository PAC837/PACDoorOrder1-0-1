import type { HandleConfig, DoorPartType, HandlePlacement, DoorHandlePlacement } from '../types.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface HandlePanelProps {
  handleConfig: HandleConfig;
  setHandleConfig: React.Dispatch<React.SetStateAction<HandleConfig>>;
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  doorPartType: DoorPartType;
  savedSep: number;
  setSavedSep: React.Dispatch<React.SetStateAction<number>>;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  styles: Record<string, React.CSSProperties>;
}

export function HandlePanel({
  handleConfig, setHandleConfig,
  showAdvanced, setShowAdvanced,
  doorPartType, savedSep, setSavedSep,
  toDisplay, fromDisplay, inputStep,
  styles,
}: HandlePanelProps) {
  return (
    <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ ...styles.label, minWidth: 0, fontWeight: 700 }}>Handle</span>
        <input type="checkbox" checked={handleConfig.enabled}
          onChange={(e) => setHandleConfig(prev => ({ ...prev, enabled: e.target.checked }))} />
      </div>
      {handleConfig.enabled && (<>
        <div style={styles.selector}>
          <label style={styles.label}>Type:</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              style={{ ...styles.bulkBtn, ...(handleConfig.holeSeparation > 0 ? { background: '#2a4a6e', color: '#fff' } : {}) }}
              onClick={() => setHandleConfig(prev => ({ ...prev, holeSeparation: savedSep || 101.6 }))}
            >Handle</button>
            <button
              style={{ ...styles.bulkBtn, ...(handleConfig.holeSeparation === 0 ? { background: '#2a4a6e', color: '#fff' } : {}) }}
              onClick={() => {
                if (handleConfig.holeSeparation > 0) setSavedSep(handleConfig.holeSeparation);
                setHandleConfig(prev => ({ ...prev, holeSeparation: 0 }));
              }}
            >Knob</button>
          </div>
        </div>
        {handleConfig.holeSeparation > 0 && (
          <div style={styles.selector}>
            <label style={styles.label}>Separation:</label>
            <CommitNumberInput value={toDisplay(handleConfig.holeSeparation)} step={inputStep} min={0}
              onCommit={(v) => {
                const mm = fromDisplay(v);
                setHandleConfig(prev => ({ ...prev, holeSeparation: mm }));
                if (mm > 0) setSavedSep(mm);
              }}
              style={styles.numberInput} />
          </div>
        )}
        <div style={styles.selector}>
          <label style={styles.label}>Inset:</label>
          <CommitNumberInput value={toDisplay(handleConfig.insetFromEdge)} step={inputStep}
            onCommit={(v) => setHandleConfig(prev => ({ ...prev, insetFromEdge: fromDisplay(v) }))}
            style={styles.numberInput} />
        </div>
        {doorPartType === 'door' ? (<>
          <div style={styles.selector}>
            <label style={styles.label}>Position:</label>
            <select value={handleConfig.doorPlacement}
              onChange={(e) => setHandleConfig(prev => ({ ...prev, doorPlacement: e.target.value as DoorHandlePlacement }))}
              style={{ ...styles.select, flex: 'none', width: 100 }}>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          {handleConfig.doorPlacement !== 'middle' && (
            <div style={styles.selector}>
              <label style={styles.label}>Elevation:</label>
              <CommitNumberInput value={toDisplay(handleConfig.elevation)} step={inputStep}
                onCommit={(v) => setHandleConfig(prev => ({ ...prev, elevation: fromDisplay(v) }))}
                style={styles.numberInput} />
            </div>
          )}
        </>) : (<>
          <div style={styles.selector}>
            <label style={styles.label}>Placement:</label>
            <select value={handleConfig.placement}
              onChange={(e) => setHandleConfig(prev => ({ ...prev, placement: e.target.value as HandlePlacement }))}
              style={{ ...styles.select, flex: 'none', width: 140 }}>
              <option value="center">Center</option>
              <option value="top-rail">Top Rail</option>
              <option value="two-equidistant">Two Equidistant</option>
            </select>
          </div>
          {handleConfig.placement === 'two-equidistant' && (
            <div style={styles.selector}>
              <label style={styles.label}>Edge Dist:</label>
              <CommitNumberInput value={toDisplay(handleConfig.twoHandleEdgeDist)} step={inputStep}
                onCommit={(v) => setHandleConfig(prev => ({ ...prev, twoHandleEdgeDist: fromDisplay(v) }))}
                style={styles.numberInput} />
            </div>
          )}
        </>)}
        <div style={styles.selector}>
          <label style={styles.label}>On Front:</label>
          <input type="checkbox" checked={handleConfig.onFront}
            onChange={(e) => setHandleConfig(prev => ({ ...prev, onFront: e.target.checked }))} />
        </div>
        <button style={{ ...styles.bulkBtn, marginTop: 4, marginBottom: 4 }}
          onClick={() => setShowAdvanced(prev => !prev)}>
          {showAdvanced ? 'Hide' : 'Show'} Advanced
        </button>
        {showAdvanced && (<>
          <div style={styles.selector}>
            <label style={styles.label}>Hole Dia:</label>
            <CommitNumberInput value={toDisplay(handleConfig.holeDia)} step={inputStep}
              onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDia: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Hole Depth:</label>
            <CommitNumberInput value={toDisplay(handleConfig.holeDepth)} step={inputStep}
              onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDepth: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
        </>)}
      </>)}
    </div>
  );
}
