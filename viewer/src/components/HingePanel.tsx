import type { HingeConfig, HingeSide, UnitSystem } from '../types.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface HingePanelProps {
  hingeConfig: HingeConfig;
  setHingeConfig: React.Dispatch<React.SetStateAction<HingeConfig>>;
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  thickness: number;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  styles: Record<string, React.CSSProperties>;
}

export function HingePanel({
  hingeConfig, setHingeConfig,
  showAdvanced, setShowAdvanced,
  thickness,
  toDisplay, fromDisplay, inputStep,
  styles,
}: HingePanelProps) {
  return (
    <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ ...styles.label, minWidth: 0, fontWeight: 700 }}>Hinges</span>
        <input type="checkbox" checked={hingeConfig.enabled}
          onChange={(e) => setHingeConfig(prev => ({ ...prev, enabled: e.target.checked }))} />
      </div>
      {hingeConfig.enabled && (<>
        <div style={styles.selector}>
          <label style={styles.label}>Side:</label>
          <select value={hingeConfig.side}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, side: e.target.value as HingeSide }))}
            style={{ ...styles.select, flex: 'none', width: 80 }}>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
        <div style={styles.selector}>
          <label style={styles.label}>Count:</label>
          <input type="number" value={hingeConfig.count} min={2} max={5}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, count: Math.max(2, Math.min(5, Number(e.target.value))) }))}
            onFocus={(e) => e.currentTarget.select()}
            style={{ ...styles.numberInput, width: 50 }} />
        </div>
        <div style={styles.selector}>
          <label style={styles.label}>Edge Dist:</label>
          <CommitNumberInput value={toDisplay(hingeConfig.edgeDistance)} step={inputStep}
            onCommit={(v) => setHingeConfig(prev => ({ ...prev, edgeDistance: fromDisplay(v) }))}
            style={styles.numberInput} />
        </div>
        <div style={styles.selector}>
          <label style={styles.label}>Equidistant:</label>
          <input type="checkbox" checked={hingeConfig.equidistant}
            onChange={(e) => setHingeConfig(prev => ({ ...prev, equidistant: e.target.checked }))} />
        </div>
        {!hingeConfig.equidistant && (
          Array.from({ length: hingeConfig.count }).map((_, i) => (
            <div key={i} style={styles.selector}>
              <label style={styles.label}>Hinge {i + 1}:</label>
              <CommitNumberInput value={toDisplay(hingeConfig.positions[i] ?? 0)} step={inputStep}
                onCommit={(v) => {
                  const newPos = [...hingeConfig.positions];
                  newPos[i] = fromDisplay(v);
                  setHingeConfig(prev => ({ ...prev, positions: newPos }));
                }}
                style={styles.numberInput} />
            </div>
          ))
        )}
        <button style={{ ...styles.bulkBtn, marginTop: 4, marginBottom: 4 }}
          onClick={() => setShowAdvanced(prev => !prev)}>
          {showAdvanced ? 'Hide' : 'Show'} Advanced
        </button>
        {showAdvanced && (<>
          <div style={styles.selector}>
            <label style={styles.label}>Cup Dia:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.cupDia)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDia: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Cup Depth:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.cupDepth)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDepth: Math.min(fromDisplay(v), thickness) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Boring Dist:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.cupBoringDist)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupBoringDist: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Mount Dia:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.mountDia)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDia: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Mount Depth:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.mountDepth)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDepth: Math.min(fromDisplay(v), thickness) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Mt Spacing:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.mountSeparation)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountSeparation: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Mt Inset:</label>
            <CommitNumberInput value={toDisplay(hingeConfig.mountInset)} step={inputStep}
              onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountInset: fromDisplay(v) }))}
              style={styles.numberInput} />
          </div>
          <div style={styles.selector}>
            <label style={styles.label}>Mt on Front:</label>
            <input type="checkbox" checked={hingeConfig.mountOnFront}
              onChange={(e) => setHingeConfig(prev => ({ ...prev, mountOnFront: e.target.checked }))} />
          </div>
        </>)}
      </>)}
    </div>
  );
}
