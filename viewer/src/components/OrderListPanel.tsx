import { useState } from 'react';
import type { UnitSystem } from '../types.js';
import type { OrderItem } from '../App.js';

interface OrderListPanelProps {
  items: OrderItem[];
  onRemoveItem: (id: number) => void;
  units: UnitSystem;
}

function formatDim(mm: number, units: UnitSystem): string {
  if (units === 'in') return `${(mm / 25.4).toFixed(2)}"`;
  return `${mm.toFixed(1)}`;
}

function formatSize(w: number, h: number, t: number, units: UnitSystem): string {
  return `${formatDim(w, units)} \u00D7 ${formatDim(h, units)} \u00D7 ${formatDim(t, units)}`;
}

function getPanelTypeLabel(t: string): string {
  if (t === 'pocket') return 'Flat';
  if (t === 'raised') return 'Raised';
  return 'Glass';
}

export function OrderListPanel({ items, onRemoveItem, units }: OrderListPanelProps) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>No items in order</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Expanded cross-section overlay */}
      {expandedImage && (
        <div style={styles.overlay} onClick={() => setExpandedImage(null)}>
          <img
            src={expandedImage}
            alt="Cross Section"
            style={styles.expandedImage}
          />
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} style={styles.card}>
          {/* Header row: item number + remove button */}
          <div style={styles.cardHeader}>
            <span style={styles.itemNum}>#{item.id}</span>
            <span style={styles.itemSize}>{formatSize(item.doorW, item.doorH, item.thickness, units)}</span>
            <button
              onClick={() => onRemoveItem(item.id)}
              style={styles.removeBtn}
              title="Remove from order"
            >
              {'\u00D7'}
            </button>
          </div>

          {/* Content: cross-section thumbnail + details */}
          <div style={styles.cardBody}>
            {/* Cross-section thumbnail */}
            {item.crossSectionImage && (
              <img
                src={item.crossSectionImage}
                alt="Cross section"
                style={styles.thumbnail}
                onClick={() => setExpandedImage(item.crossSectionImage)}
                title="Click to enlarge"
              />
            )}

            {/* Details grid */}
            <div style={styles.detailsGrid}>
              <DetailRow label="Finish" value={item.textureCategory.charAt(0).toUpperCase() + item.textureCategory.slice(1)} />
              <DetailRow label="Panel" value={getPanelTypeLabel(item.frontPanelType)} />
              <DetailRow label="Style" value={item.styleName} />
              <DetailRow label="Edge" value={item.edgeName} />
              <DetailRow label="Back" value={item.backLabel} />
              <DetailRow label="Type" value={item.doorType} />
              <DetailRow label="Hinges" value={item.hingeSummary} />
              <DetailRow label="Handles" value={item.handleSummary} />
            </div>
          </div>
        </div>
      ))}
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
  container: {
    width: '100%',
    height: '100%',
    background: '#f5f5f5',
    overflowY: 'auto',
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#999',
    fontSize: 14,
  },
  card: {
    background: '#fff',
    borderRadius: 6,
    border: '1px solid #ddd',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: '#f0f4f8',
    borderBottom: '1px solid #e0e0e0',
  },
  itemNum: {
    fontSize: 11,
    fontWeight: 700,
    color: '#555',
  },
  itemSize: {
    fontSize: 11,
    color: '#666',
    flex: 1,
    textAlign: 'right',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#cc4444',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  cardBody: {
    display: 'flex',
    gap: 8,
    padding: 8,
    alignItems: 'flex-start',
  },
  thumbnail: {
    width: 80,
    height: 50,
    objectFit: 'contain',
    borderRadius: 3,
    border: '1px solid #ddd',
    cursor: 'pointer',
    flexShrink: 0,
    background: '#fff',
  },
  detailsGrid: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#888',
    width: 42,
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 10,
    color: '#333',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 100,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  expandedImage: {
    maxWidth: '90%',
    maxHeight: '90%',
    borderRadius: 6,
    border: '2px solid #fff',
    background: '#fff',
  },
};
