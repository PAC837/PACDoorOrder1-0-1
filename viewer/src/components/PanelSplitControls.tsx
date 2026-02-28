import type { PanelTree, PanelBounds } from '../utils/panelTree.js';
import { addSplitAtLeaf, enumerateSplits, removeSplit, updateSplit, pathsEqual } from '../utils/panelTree.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface PanelSplitControlsProps {
  panelTree: PanelTree;
  setPanelTree: React.Dispatch<React.SetStateAction<PanelTree>>;
  selectedPanels: Set<number>;
  setSelectedPanels: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectedSplitPath: number[] | null;
  onSplitSelect: (path: number[] | null) => void;
  panelBounds?: PanelBounds[];
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
  styles: Record<string, React.CSSProperties>;
}

export function PanelSplitControls({
  panelTree, setPanelTree,
  selectedPanels, setSelectedPanels,
  selectedSplitPath, onSplitSelect,
  panelBounds,
  toDisplay, fromDisplay, inputStep,
  styles,
}: PanelSplitControlsProps) {
  return (
    <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
      <div style={{ fontSize: '11px', color: '#8888aa', marginBottom: 6 }}>
        {selectedPanels.size > 0
          ? `Panel${selectedPanels.size > 1 ? 's' : ''} ${Array.from(selectedPanels).map(i => i + 1).sort((a, b) => a - b).join(', ')} selected`
          : 'Click a panel (Ctrl+click to multi-select)'}
      </div>
      {selectedPanels.size === 1 && panelBounds && (() => {
        const idx = Array.from(selectedPanels)[0];
        const pb = panelBounds[idx];
        if (!pb) return null;
        return (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button
              style={styles.bulkBtn}
              onClick={() => {
                setPanelTree((prev) => addSplitAtLeaf(prev, idx, 'hsplit',
                  (pb.xMin + pb.xMax) / 2, 76.2));
                setSelectedPanels(new Set());
              }}
            >
              Add Mid Rail
            </button>
            <button
              style={styles.bulkBtn}
              onClick={() => {
                setPanelTree((prev) => addSplitAtLeaf(prev, idx, 'vsplit',
                  (pb.yMin + pb.yMax) / 2, 76.2));
                setSelectedPanels(new Set());
              }}
            >
              Add Mid Stile
            </button>
          </div>
        );
      })()}
      {enumerateSplits(panelTree).map((split, si) => {
        const label = split.type === 'hsplit' ? 'Rail' : 'Stile';
        const isSplitSelected = selectedSplitPath !== null && pathsEqual(split.path, selectedSplitPath);
        return (
          <div key={si} style={{
            marginBottom: 4,
            paddingLeft: split.depth * 12 + 4,
            borderLeft: isSplitSelected ? '3px solid #ff8800' : '3px solid transparent',
            background: isSplitSelected ? 'rgba(255, 136, 0, 0.15)' : undefined,
            cursor: 'pointer',
          }} onClick={() => onSplitSelect(split.path)}>
            <div style={styles.selector}>
              <label style={styles.label}>{label} {si + 1} Pos:</label>
              <CommitNumberInput value={toDisplay(split.pos)} step={inputStep} min={0}
                onCommit={(v) => setPanelTree((prev) =>
                  updateSplit(prev, split.path, fromDisplay(v), split.width))}
                style={styles.numberInput} />
            </div>
            <div style={styles.selector}>
              <label style={styles.label}>{label} {si + 1} W:</label>
              <CommitNumberInput value={toDisplay(split.width)} step={inputStep} min={0}
                onCommit={(v) => setPanelTree((prev) =>
                  updateSplit(prev, split.path, split.pos, fromDisplay(v)))}
                style={styles.numberInput} />
              <button style={styles.removeBtn}
                onClick={() => setPanelTree((prev) => removeSplit(prev, split.path))}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
