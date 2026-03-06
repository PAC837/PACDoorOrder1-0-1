import { useState } from 'react';
import type { OrderItem } from '../App.js';
import type { UnitSystem, RenderMode } from '../types.js';
import { ElevationViewer } from './ElevationViewer.js';

interface ItemViewerModalProps {
  item: OrderItem;
  units: UnitSystem;
  onClose: () => void;
}

function fmtDim(mm: number, units: UnitSystem): string {
  if (units === 'in') return `${(mm / 25.4).toFixed(2)}"`;
  return `${mm.toFixed(1)} mm`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.chip}>
      <span style={styles.chipLabel}>{label}</span>
      <span style={styles.chipValue}>{value}</span>
    </div>
  );
}

export function ItemViewerModal({ item, units, onClose }: ItemViewerModalProps) {
  const [renderMode, setRenderMode] = useState<RenderMode>('solid');

  const panelTypeLabel = item.frontPanelType === 'pocket' ? 'Flat' : item.frontPanelType === 'raised' ? 'Raised' : 'Glass';

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Top bar */}
        <div style={styles.topBar}>
          <div style={styles.chipRow}>
            <InfoChip label="Sel" value={item.selectionLabel} />
            <InfoChip label="Style" value={item.styleName} />
            <InfoChip label="Finish" value={capitalize(item.textureCategory)} />
            <InfoChip label="Panel" value={panelTypeLabel} />
            {item.edgeName !== 'None' && <InfoChip label="Edge" value={item.edgeName} />}
            {item.backLabel !== 'None' && <InfoChip label="Back" value={item.backLabel} />}
            <InfoChip label="Type" value={item.doorType} />
            {item.hingeSummary !== 'None' && <InfoChip label="Hinges" value={item.hingeSummary} />}
            {item.handleSummary !== 'None' && <InfoChip label="Handle" value={item.handleSummary} />}
            <InfoChip label="W×H" value={`${fmtDim(item.doorW, units)} × ${fmtDim(item.doorH, units)}`} />
            <InfoChip label="QTY" value={String(item.qty)} />
            <InfoChip label="Price" value={`$${item.price.toFixed(2)}`} />
            <InfoChip label="Subtotal" value={`$${(item.qty * item.price).toFixed(2)}`} />
            {item.note && <InfoChip label="Note" value={item.note} />}
          </div>
          <button onClick={onClose} style={styles.closeBtn} title="Close">×</button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {/* Left: elevation view */}
          <div style={styles.elevationPane}>
            <ElevationViewer
              door={item.activeDoor}
              units={units}
              panelTree={item.panelTree}
              handleConfig={item.handleConfig}
              hingeConfig={item.hingeConfig}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
              overrideLeftStileW={item.leftStileW}
              overrideRightStileW={item.rightStileW}
              overrideTopRailW={item.topRailW}
              overrideBottomRailW={item.bottomRailW}
            />
          </div>

          {/* Right: cross-section + detail summary */}
          <div style={styles.rightPane}>
            {/* Cross-section */}
            <div style={styles.xsecWrapper}>
              <div style={styles.sectionTitle}>Cross Section</div>
              {item.crossSectionImage ? (
                <img
                  src={item.crossSectionImage}
                  alt="Cross section"
                  style={styles.xsecImage}
                />
              ) : (
                <div style={styles.xsecPlaceholder}>No cross-section captured</div>
              )}
            </div>

            {/* Detail table */}
            <div style={styles.detailTable}>
              <div style={styles.sectionTitle}>Door Details</div>
              <DetailRow label="Style" value={item.styleName} />
              <DetailRow label="Finish" value={capitalize(item.textureCategory)} />
              <DetailRow label="Panel" value={panelTypeLabel} />
              <DetailRow label="Edge" value={item.edgeName} />
              <DetailRow label="Back" value={item.backLabel} />
              <DetailRow label="Type" value={item.doorType} />
              <DetailRow label="Width" value={fmtDim(item.doorW, units)} />
              <DetailRow label="Height" value={fmtDim(item.doorH, units)} />
              <DetailRow label="Thickness" value={fmtDim(item.thickness, units)} />
              <DetailRow label="Hinges" value={item.hingeSummary} />
              <DetailRow label="Handle" value={item.handleSummary} />
              <DetailRow label="L Stile" value={fmtDim(item.leftStileW, units)} />
              <DetailRow label="R Stile" value={fmtDim(item.rightStileW, units)} />
              <DetailRow label="Top Rail" value={fmtDim(item.topRailW, units)} />
              <DetailRow label="Bot Rail" value={fmtDim(item.bottomRailW, units)} />
              {item.note && <DetailRow label="Note" value={item.note} />}
              <div style={styles.priceLine}>
                <span style={styles.priceLabel}>Price / door</span>
                <span style={styles.priceValue}>${item.price.toFixed(2)}</span>
              </div>
              <div style={styles.priceLine}>
                <span style={styles.priceLabel}>Qty × Subtotal</span>
                <span style={{ ...styles.priceValue, fontWeight: 700 }}>
                  {item.qty} × ${(item.qty * item.price).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '90vw',
    height: '90vh',
    background: '#fff',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
  },

  // Top bar
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: '#f0f4f8',
    borderBottom: '1px solid #ccc',
    flexShrink: 0,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    flex: 1,
    overflow: 'hidden',
  },
  chip: {
    display: 'flex',
    gap: 2,
    alignItems: 'center',
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: 3,
    padding: '1px 5px',
  },
  chipLabel: {
    fontSize: 9,
    color: '#888',
    fontWeight: 600,
  },
  chipValue: {
    fontSize: 10,
    color: '#333',
    fontWeight: 500,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 20,
    fontWeight: 700,
    color: '#666',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },

  // Content area
  content: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  elevationPane: {
    flex: 1,
    overflow: 'hidden',
    borderRight: '1px solid #e0e0e0',
  },
  rightPane: {
    width: 220,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    padding: 8,
    gap: 12,
  },

  // Cross-section
  xsecWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    paddingBottom: 2,
    borderBottom: '1px solid #e8e8e8',
  },
  xsecImage: {
    width: '100%',
    height: 80,
    objectFit: 'contain',
    border: '1px solid #e0e0e0',
    borderRadius: 4,
    background: '#fff',
  },
  xsecPlaceholder: {
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    color: '#bbb',
    border: '1px dashed #e0e0e0',
    borderRadius: 4,
  },

  // Detail table
  detailTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 4,
    padding: '1px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  detailLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: 600,
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 10,
    color: '#333',
    textAlign: 'right' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  priceLine: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '3px 0',
    borderTop: '1px solid #e0e0e0',
    marginTop: 4,
  },
  priceLabel: {
    fontSize: 11,
    color: '#555',
  },
  priceValue: {
    fontSize: 11,
    color: '#0088cc',
  },
};
