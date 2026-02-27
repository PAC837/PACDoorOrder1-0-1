import { useState } from 'react';
import type { DoorGraphData, OperationVisibility, ToolVisibility, UnitSystem } from '../types.js';
import { formatUnit } from '../types.js';

interface OperationOverlayProps {
  graph?: DoorGraphData;
  visibility: OperationVisibility;
  onToggle: (operationId: number) => void;
  toolVisibility: ToolVisibility;
  onToggleTool: (operationId: number, toolIndex: number) => void;
  onSetAllTools: (operationId: number, toolCount: number, visible: boolean) => void;
  units: UnitSystem;
}

/**
 * Right-side overlay panel listing all CNC operations on the selected door.
 * Each operation has a checkbox to toggle 3D visibility.
 */
export function OperationOverlay({ graph, visibility, onToggle, toolVisibility, onToggleTool, onSetAllTools, units }: OperationOverlayProps) {
  const [expandedOps, setExpandedOps] = useState<Record<number, boolean>>({});

  if (!graph || graph.operations.length === 0) return null;

  const toggleExpand = (opId: number) => {
    setExpandedOps((prev) => ({ ...prev, [opId]: !prev[opId] }));
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Operations</h3>
      {graph.operations.map((op) => {
        const isVisible = visibility[op.operationId] === true;
        const isExpanded = expandedOps[op.operationId] ?? false;
        const hasCNCTool = op.tools.some((t) => t.isCNCDoor);

        return (
          <div key={op.operationId} style={styles.opCard}>
            {/* Header row with checkbox */}
            <div style={styles.opHeader}>
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => onToggle(op.operationId)}
                  style={styles.checkbox}
                />
                <span style={{
                  ...styles.opType,
                  color: op.flipSideOp ? '#ff6b6b' : '#6bffb8',
                }}>
                  {op.flipSideOp ? 'BACK' : 'FRONT'}
                </span>
              </label>
              <button
                onClick={() => toggleExpand(op.operationId)}
                style={styles.expandBtn}
              >
                {isExpanded ? '−' : '+'}
              </button>
            </div>

            {/* Operation info */}
            <div style={styles.opInfo}>
              <div style={styles.opRow}>
                <span style={styles.opLabel}>Group:</span>
                <span>{op.toolGroupName}</span>
              </div>
              <div style={styles.opRow}>
                <span style={styles.opLabel}>Depth:</span>
                <span>{formatUnit(op.depth, units)}</span>
              </div>
              <div style={styles.opRow}>
                <span style={styles.opLabel}>Tools:</span>
                <span>
                  {op.toolCount}
                  {hasCNCTool && <span style={styles.cncBadge}>CNC</span>}
                </span>
              </div>
            </div>

            {/* Expanded tool list */}
            {isExpanded && (
              <div style={styles.toolList}>
                {/* None / All quick buttons */}
                <div style={styles.bulkRow}>
                  <button
                    style={styles.bulkBtn}
                    disabled={!isVisible}
                    onClick={() => onSetAllTools(op.operationId, op.tools.length, false)}
                  >
                    None
                  </button>
                  <button
                    style={styles.bulkBtn}
                    disabled={!isVisible}
                    onClick={() => onSetAllTools(op.operationId, op.tools.length, true)}
                  >
                    All
                  </button>
                </div>
                {op.tools.map((t, ti) => {
                  const toolKey = `${op.operationId}-${ti}`;
                  const isToolVisible = toolVisibility[toolKey] !== false;
                  return (
                    <div key={ti} style={styles.toolRow}>
                      <label style={styles.toolCheckLabel}>
                        <input
                          type="checkbox"
                          checked={isToolVisible}
                          disabled={!isVisible}
                          onChange={() => onToggleTool(op.operationId, ti)}
                          style={styles.toolCheckbox}
                        />
                        <span style={{
                          ...styles.toolName,
                          opacity: isToolVisible && isVisible ? 1 : 0.4,
                        }}>
                          {t.isCNCDoor && <span style={styles.cncStar}>★</span>}
                          {t.toolName}
                        </span>
                      </label>
                      <span style={styles.toolDetail}>
                        D: {formatUnit(t.entryDepth, units)} / O: {formatUnit(t.entryOffset, units)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 16,
    right: 16,
    maxWidth: 300,
    maxHeight: 'calc(100% - 32px)',
    overflowY: 'auto',
    color: '#e0e0e0',
    pointerEvents: 'auto',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 700,
    color: '#ffffff',
    textShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
  opCard: {
    background: 'rgba(26, 26, 46, 0.9)',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 8,
    border: '1px solid #333355',
    backdropFilter: 'blur(8px)',
  },
  opHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: '#6bffb8',
    cursor: 'pointer',
  },
  opType: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.5px',
  },
  expandBtn: {
    background: 'transparent',
    border: '1px solid #555577',
    borderRadius: 4,
    color: '#aaaacc',
    cursor: 'pointer',
    fontSize: '14px',
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  opInfo: {
    fontSize: '12px',
  },
  opRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 0',
    gap: 8,
  },
  opLabel: {
    color: '#8888aa',
    fontWeight: 600,
    flexShrink: 0,
  },
  cncBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    borderRadius: 3,
    background: '#e74c3c33',
    color: '#ff6b6b',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.5px',
  },
  toolList: {
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid #333355',
  },
  bulkRow: {
    display: 'flex',
    gap: 6,
    marginBottom: 6,
  },
  bulkBtn: {
    padding: '2px 10px',
    borderRadius: 4,
    border: '1px solid #555577',
    background: 'rgba(42, 42, 72, 0.8)',
    color: '#aaaacc',
    fontSize: '10px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  toolRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '11px',
    padding: '2px 0',
    gap: 6,
  },
  toolCheckLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
    flex: 1,
    overflow: 'hidden',
  },
  toolCheckbox: {
    accentColor: '#6bffb8',
    cursor: 'pointer',
    flexShrink: 0,
    width: 12,
    height: 12,
  },
  toolName: {
    color: '#ccccdd',
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toolDetail: {
    color: '#8888aa',
    flexShrink: 0,
    fontSize: '10px',
  },
  cncStar: {
    color: '#ff6b6b',
    marginRight: 3,
  },
};
