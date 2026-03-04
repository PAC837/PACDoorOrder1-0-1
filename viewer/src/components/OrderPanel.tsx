import { useState, useEffect, useMemo, useRef } from 'react';
import type { OrderItem } from '../App.js';
import type { UnitSystem } from '../types.js';
import type { ColumnDef } from '../hooks/useOrderColumns.js';
import type { GroupByField } from '../hooks/useGroupByConfig.js';

interface StyleTab {
  key: string;
  label: string;
}

interface OrderPanelProps {
  items: OrderItem[];
  columns: ColumnDef[];
  groupByFields: GroupByField[];
  styleTabs: StyleTab[];
  currentStyleKey: string;
  units: UnitSystem;
  onAddItem: (qty: number, note: string, w: number, h: number) => void;
  onRemoveItem: (id: number) => void;
  onUpdateItem: (id: number, changes: Partial<Pick<OrderItem, 'qty' | 'note' | 'roomName' | 'cabNumber' | 'material' | 'customData'>>) => void;
  onViewItem: (item: OrderItem) => void;
  onStyleTabClick: (styleKey: string) => void;
  onQuickAdd: (h: number, w: number) => void;
  onLoadItem: (item: OrderItem) => void;
}

function fmtDim(mm: number, units: UnitSystem): string {
  if (units === 'in') return `${(mm / 25.4).toFixed(2)}"`;
  return `${mm.toFixed(1)}`;
}

function fmtPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Range selection helper ───────────────────────────────────────────────────

function getRangeIds(fromId: number, toId: number, allRows: OrderItem[]): Set<number> {
  const fromIdx = allRows.findIndex(r => r.id === fromId);
  const toIdx = allRows.findIndex(r => r.id === toId);
  if (fromIdx === -1 || toIdx === -1) return new Set([toId]);
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return new Set(allRows.slice(lo, hi + 1).map(r => r.id));
}

// ── OrderPanel ───────────────────────────────────────────────────────────────

export function OrderPanel({
  items, columns, groupByFields, styleTabs, currentStyleKey, units,
  onAddItem: _onAddItem, onRemoveItem, onUpdateItem, onViewItem, onStyleTabClick,
  onQuickAdd, onLoadItem,
}: OrderPanelProps) {
  const [activeTab, setActiveTab] = useState<'all' | string>(currentStyleKey);
  const [pinnedToAll, setPinnedToAll] = useState(false);

  // Suppress unused warning — onAddItem kept in props for potential future use
  void _onAddItem;

  // Sync active tab to currentStyleKey unless user is pinned to "All"
  useEffect(() => {
    if (!pinnedToAll) setActiveTab(currentStyleKey);
  }, [currentStyleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show visible columns
  const visibleCols = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Grid template: eye + remove + load + visible data columns
  const colTemplate = `22px 18px 18px ${visibleCols.map(c => `${c.width}px`).join(' ')}`;

  // Items for the active tab
  const tabItems = useMemo(() => {
    if (activeTab === 'all') return items;
    return items.filter(i => i.styleName === activeTab);
  }, [items, activeTab]);

  // Active group-by fields (in configured priority order)
  const activeGroupFields = useMemo(() => groupByFields.filter(f => f.active), [groupByFields]);

  // Group tabItems dynamically by the configured fields
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const map = new Map<string, OrderItem[]>();
    for (const item of tabItems) {
      const key = activeGroupFields.length > 0
        ? activeGroupFields.map(f => getGroupFieldValue(item, f.id)).join('||')
        : '__all__';
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(item);
    }
    return order.map(key => {
      const first = map.get(key)![0];
      const header = activeGroupFields.length > 0
        ? activeGroupFields.map(f => getGroupFieldValue(first, f.id)).filter(Boolean).join(' — ')
        : 'All Items';
      return { key, header, items: map.get(key)! };
    });
  }, [tabItems, activeGroupFields]);

  // Flat ordered list of all visible rows (crosses group boundaries)
  const allRows = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // ── Multi-row selection state ──────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const anchorIdRef = useRef<number | null>(null);
  const isDragSelecting = useRef(false);
  const dragAnchorId = useRef<number | null>(null);

  // Clear drag flag on global pointerup
  useEffect(() => {
    const handler = () => { isDragSelecting.current = false; };
    window.addEventListener('pointerup', handler);
    return () => window.removeEventListener('pointerup', handler);
  }, []);

  // Escape to clear selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds(new Set());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Cell pointer-down handler (passed to each DataRow)
  const handleCellPointerDown = (e: React.PointerEvent, itemId: number) => {
    if (e.shiftKey && anchorIdRef.current !== null) {
      setSelectedIds(getRangeIds(anchorIdRef.current, itemId, allRows));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => {
        const s = new Set(prev);
        s.has(itemId) ? s.delete(itemId) : s.add(itemId);
        return s;
      });
      anchorIdRef.current = itemId;
    } else {
      // Normal click: select this row (DataRow will also start editing)
      setSelectedIds(new Set([itemId]));
      anchorIdRef.current = itemId;
      isDragSelecting.current = true;
      dragAnchorId.current = itemId;
    }
  };

  // Row pointer-enter handler (for drag selection extension)
  const handleRowPointerEnter = (itemId: number) => {
    if (!isDragSelecting.current || dragAnchorId.current === null) return;
    setSelectedIds(getRangeIds(dragAnchorId.current, itemId, allRows));
  };

  // ── Batch update wrapper ───────────────────────────────────────────────────
  const batchUpdate = (itemId: number, changes: Partial<Pick<OrderItem, 'qty' | 'note' | 'roomName' | 'cabNumber' | 'material' | 'customData'>>) => {
    onUpdateItem(itemId, changes);
    if (selectedIds.has(itemId) && selectedIds.size > 1) {
      selectedIds.forEach(id => { if (id !== itemId) onUpdateItem(id, changes); });
    }
  };

  // ── Enter-to-next-row state ────────────────────────────────────────────────
  const [focusTarget, setFocusTarget] = useState<{ id: number; colId: string } | null>(null);

  return (
    <div
      style={styles.container}
      onPointerDown={(e) => {
        // Click on empty background clears selection
        if ((e.target as HTMLElement).closest('[data-row]') === null) {
          setSelectedIds(new Set());
        }
      }}
    >
      {/* Title bar */}
      <div style={styles.titleBar}>PAC Door Order</div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'all' ? styles.activeTab : {}) }}
          onClick={() => { setPinnedToAll(true); setActiveTab('all'); }}
        >
          All
        </button>
        {styleTabs.map(tab => (
          <button
            key={tab.key}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.activeTab : {}) }}
            title={tab.label}
            onClick={() => {
              setPinnedToAll(false);
              setActiveTab(tab.key);
              onStyleTabClick(tab.key);
            }}
          >
            {tab.label}
          </button>
        ))}
        {/* Show indicator if current style has no tab yet */}
        {currentStyleKey !== 'None' && !styleTabs.some(t => t.key === currentStyleKey) && (
          <span style={styles.newSelIndicator}>+ new style</span>
        )}
      </div>

      {/* Hidden column indicator */}
      {(() => {
        const hidden = columns.filter(c => !c.visible);
        if (hidden.length === 0) return null;
        return (
          <div style={{ fontSize: 9, color: '#888', background: '#fef9ec', borderBottom: '1px solid #e8ddb0', padding: '2px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.65 }}>⊖</span>
            <span>{hidden.length} hidden column{hidden.length > 1 ? 's' : ''}: {hidden.map(c => c.label).join(', ')}</span>
          </div>
        );
      })()}

      {/* Table wrapper */}
      <div style={styles.tableWrapper}>
        {/* Sticky header row */}
        <div style={{ ...styles.gridRow, ...styles.headerRow, gridTemplateColumns: colTemplate }}>
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          {visibleCols.map(col => (
            <div
              key={col.id}
              style={{
                ...styles.cell,
                ...styles.headerCell,
                borderRight: '1px solid rgba(0,0,0,0.1)',
                textAlign: rightAlignedCols.has(col.id) ? 'right' : col.id === 'qty' ? 'center' : 'left',
              }}
            >
              {col.label}
            </div>
          ))}
        </div>

        {/* Scrollable data body */}
        <div style={styles.dataBody}>
          {groups.length === 0 && (
            <div style={styles.emptyRow}>No items — press "Add to Order" to add doors</div>
          )}
          {groups.map(group => (
            <div key={group.key}>
              {/* Group header */}
              <div style={{ ...styles.gridRow, ...styles.groupHeader, gridTemplateColumns: colTemplate }}>
                <div style={{ gridColumn: `1 / -1`, padding: '0 8px', fontWeight: 700, fontSize: 10, color: '#333' }}>
                  {group.header}
                </div>
              </div>
              {/* Data rows */}
              {group.items.map((item, idx) => (
                <DataRow
                  key={item.id}
                  item={item}
                  rowNum={idx + 1}
                  units={units}
                  visibleCols={visibleCols}
                  colTemplate={colTemplate}
                  isAlt={idx % 2 === 1}
                  isSelected={selectedIds.has(item.id)}
                  onRemove={() => onRemoveItem(item.id)}
                  onView={() => onViewItem(item)}
                  onLoad={() => onLoadItem(item)}
                  onUpdateQty={(qty) => batchUpdate(item.id, { qty })}
                  onUpdateNote={(note) => batchUpdate(item.id, { note })}
                  onUpdateRoomName={(roomName) => batchUpdate(item.id, { roomName })}
                  onUpdateCabNumber={(cabNumber) => batchUpdate(item.id, { cabNumber })}
                  onUpdateMaterial={(material) => batchUpdate(item.id, { material })}
                  onUpdateCustom={(colId, val) => batchUpdate(item.id, { customData: { [colId]: val } })}
                  onRowPointerDown={(e) => handleCellPointerDown(e, item.id)}
                  onRowPointerEnter={() => handleRowPointerEnter(item.id)}
                  onEnterNext={(colId) => {
                    const idx2 = allRows.findIndex(r => r.id === item.id);
                    const next = allRows[idx2 + 1];
                    if (next) setFocusTarget({ id: next.id, colId });
                  }}
                  autoFocusColId={focusTarget?.id === item.id ? focusTarget.colId : null}
                  onFocusConsumed={() => setFocusTarget(null)}
                />
              ))}
              {/* Blank add-row at bottom of each group */}
              <BlankAddRow
                units={units}
                visibleCols={visibleCols}
                colTemplate={colTemplate}
                onAdd={(h, w) => onQuickAdd(h, w)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Extract the value of a group-by field from an order item */
function getGroupFieldValue(item: OrderItem, fieldId: string): string {
  switch (fieldId) {
    case 'doorType':  return item.doorType;
    case 'finish':    return capitalize(item.textureCategory);
    case 'panelType': return item.frontPanelType;
    case 'material':  return item.material;
    case 'roomName':  return item.roomName;
    case 'cabNumber': return item.cabNumber;
    default: return '';
  }
}

/** Columns that should right-align their header and value */
const rightAlignedCols = new Set(['height', 'width', 'price', 'subtotal']);

interface DataRowProps {
  item: OrderItem;
  rowNum: number;
  units: UnitSystem;
  visibleCols: ColumnDef[];
  colTemplate: string;
  isAlt: boolean;
  isSelected: boolean;
  onRemove: () => void;
  onView: () => void;
  onLoad: () => void;
  onUpdateQty: (qty: number) => void;
  onUpdateNote: (note: string) => void;
  onUpdateRoomName: (v: string) => void;
  onUpdateCabNumber: (v: string) => void;
  onUpdateMaterial: (v: string) => void;
  onUpdateCustom: (colId: string, val: string) => void;
  onRowPointerDown: (e: React.PointerEvent) => void;
  onRowPointerEnter: () => void;
  onEnterNext: (colId: string) => void;
  autoFocusColId: string | null;
  onFocusConsumed: () => void;
}

function DataRow({
  item, rowNum, units, visibleCols, colTemplate, isAlt, isSelected,
  onRemove, onView, onLoad, onUpdateQty, onUpdateNote, onUpdateRoomName, onUpdateCabNumber, onUpdateMaterial, onUpdateCustom,
  onRowPointerDown, onRowPointerEnter, onEnterNext, autoFocusColId, onFocusConsumed,
}: DataRowProps) {
  const [editingQty, setEditingQty] = useState(false);
  const [localQty, setLocalQty] = useState(String(item.qty));
  const [editingNote, setEditingNote] = useState(false);
  const [localNote, setLocalNote] = useState(item.note);
  const [editingRoom, setEditingRoom] = useState(false);
  const [localRoom, setLocalRoom] = useState(item.roomName);
  const [editingCab, setEditingCab] = useState(false);
  const [localCab, setLocalCab] = useState(item.cabNumber);
  const [editingMaterial, setEditingMaterial] = useState(false);
  const [localMaterial, setLocalMaterial] = useState(item.material);
  const [editingCustom, setEditingCustom] = useState<string | null>(null);
  const [localCustomVal, setLocalCustomVal] = useState('');
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Cell style helper — adds column divider + hover highlight
  const cellStyle = (colId: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
    ...styles.cell,
    borderRight: '1px solid rgba(0,0,0,0.07)',
    ...(hoveredCell === colId
      ? { background: isSelected ? 'rgba(0,136,204,0.14)' : 'rgba(0,136,204,0.06)' }
      : {}),
    ...extra,
  });
  const cellEvents = (colId: string) => ({
    onMouseEnter: () => setHoveredCell(colId),
    onMouseLeave: () => setHoveredCell(null),
  });

  // Keep local state in sync if parent updates
  useEffect(() => { setLocalQty(String(item.qty)); }, [item.qty]);
  useEffect(() => { setLocalNote(item.note); }, [item.note]);
  useEffect(() => { setLocalRoom(item.roomName); }, [item.roomName]);
  useEffect(() => { setLocalCab(item.cabNumber); }, [item.cabNumber]);
  useEffect(() => { setLocalMaterial(item.material); }, [item.material]);

  // Enter-to-next-row: activate editing for the requested column
  useEffect(() => {
    if (!autoFocusColId) return;
    switch (autoFocusColId) {
      case 'qty':      setEditingQty(true); break;
      case 'roomName': setEditingRoom(true); break;
      case 'cabNumber':setEditingCab(true); break;
      case 'material': setEditingMaterial(true); break;
      case 'note':     setEditingNote(true); break;
      default:
        if (autoFocusColId.startsWith('custom_')) {
          setLocalCustomVal(item.customData?.[autoFocusColId] ?? '');
          setEditingCustom(autoFocusColId);
        }
    }
    onFocusConsumed();
  }, [autoFocusColId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitQty = () => {
    setEditingQty(false);
    const n = parseInt(localQty);
    if (!isNaN(n) && n >= 1) onUpdateQty(n);
    else setLocalQty(String(item.qty));
  };

  const subtotal = item.qty * item.price;

  // Render a cell for a given column
  const renderCell = (col: ColumnDef) => {
    switch (col.id) {
      case 'qty':
        return (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'center' })} {...cellEvents(col.id)}>
            {editingQty ? (
              <input
                autoFocus
                type="number"
                min={1}
                value={localQty}
                onChange={e => setLocalQty(e.target.value)}
                onFocus={e => e.target.select()}
                onBlur={commitQty}
                onKeyDown={e => {
                  if (e.key === 'Enter') { commitQty(); onEnterNext('qty'); }
                }}
                style={{ ...styles.input, textAlign: 'center', width: '100%' }}
              />
            ) : (
              <span
                style={styles.editableText}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingQty(true); }}
                title="Click to edit QTY"
              >
                {item.qty}
              </span>
            )}
          </div>
        );
      case 'height':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10 })} {...cellEvents(col.id)}>{fmtDim(item.doorH, units)}</div>;
      case 'width':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10 })} {...cellEvents(col.id)}>{fmtDim(item.doorW, units)}</div>;
      case 'partType':
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{item.doorType}</div>;
      case 'doorStyle':
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{item.styleName}</div>;
      case 'finish':
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{capitalize(item.textureCategory)}</div>;
      case 'roomName':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingRoom ? (
              <input
                autoFocus
                type="text"
                value={localRoom}
                onChange={e => setLocalRoom(e.target.value)}
                onBlur={() => { setEditingRoom(false); onUpdateRoomName(localRoom); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditingRoom(false); onUpdateRoomName(localRoom); onEnterNext('roomName'); } }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span
                style={{ ...styles.editableText, color: item.roomName ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingRoom(true); }}
                title={item.roomName || 'Click to add room name'}
              >
                {item.roomName || '—'}
              </span>
            )}
          </div>
        );
      case 'cabNumber':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingCab ? (
              <input
                autoFocus
                type="text"
                value={localCab}
                onChange={e => setLocalCab(e.target.value)}
                onBlur={() => { setEditingCab(false); onUpdateCabNumber(localCab); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditingCab(false); onUpdateCabNumber(localCab); onEnterNext('cabNumber'); } }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span
                style={{ ...styles.editableText, color: item.cabNumber ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingCab(true); }}
                title={item.cabNumber || 'Click to add cab #'}
              >
                {item.cabNumber || '—'}
              </span>
            )}
          </div>
        );
      case 'material':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingMaterial ? (
              <input
                autoFocus
                type="text"
                value={localMaterial}
                onChange={e => setLocalMaterial(e.target.value)}
                onBlur={() => { setEditingMaterial(false); onUpdateMaterial(localMaterial); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditingMaterial(false); onUpdateMaterial(localMaterial); onEnterNext('material'); } }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span
                style={{ ...styles.editableText, color: item.material ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingMaterial(true); }}
                title={item.material || 'Click to add material'}
              >
                {item.material || '—'}
              </span>
            )}
          </div>
        );
      case 'note':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingNote ? (
              <input
                autoFocus
                type="text"
                value={localNote}
                onChange={e => setLocalNote(e.target.value)}
                onBlur={() => { setEditingNote(false); onUpdateNote(localNote); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditingNote(false); onUpdateNote(localNote); onEnterNext('note'); } }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span
                style={{ ...styles.editableText, color: item.note ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingNote(true); }}
                title={item.note || 'Click to add note'}
              >
                {item.note || '—'}
              </span>
            )}
          </div>
        );
      case 'profile':
        return (
          <div key={col.id} style={cellStyle(col.id, { display: 'flex', alignItems: 'center', justifyContent: 'center' })} {...cellEvents(col.id)}>
            {item.crossSectionImage ? (
              <button
                onClick={onView}
                title="Click to view cross-section"
                style={{ padding: 0, border: '1px solid #e0e0e0', borderRadius: 2, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={item.crossSectionImage}
                  alt="profile"
                  style={{ width: 36, height: 22, objectFit: 'contain', display: 'block' }}
                />
              </button>
            ) : (
              <span style={{ fontSize: 9, color: '#bbb' }}>—</span>
            )}
          </div>
        );
      case 'hinges':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'center', fontSize: 10 })} {...cellEvents(col.id)}>{item.hingesDisplay ?? '—'}</div>;
      case 'hardware':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'center', fontSize: 10 })} {...cellEvents(col.id)}>{item.hardwareDisplay ?? '—'}</div>;
      case 'price':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, fontVariantNumeric: 'tabular-nums' })} {...cellEvents(col.id)}>{fmtPrice(item.price)}</div>;
      case 'subtotal':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' })} {...cellEvents(col.id)}>{fmtPrice(subtotal)}</div>;
      default:
        // Custom user-defined columns
        if (col.isCustom) {
          const val = item.customData?.[col.id] ?? '';
          const isEditing = editingCustom === col.id;
          return (
            <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={localCustomVal}
                  onChange={e => setLocalCustomVal(e.target.value)}
                  onBlur={() => { setEditingCustom(null); onUpdateCustom(col.id, localCustomVal); }}
                  onKeyDown={e => { if (e.key === 'Enter') { setEditingCustom(null); onUpdateCustom(col.id, localCustomVal); onEnterNext(col.id); } }}
                  style={{ ...styles.input, width: '100%' }}
                />
              ) : (
                <span
                  style={{ ...styles.editableText, color: val ? '#333' : '#bbb' }}
                  onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) { setEditingCustom(col.id); setLocalCustomVal(val); } }}
                  title={val || `Click to add ${col.label}`}
                >{val || '—'}</span>
              )}
            </div>
          );
        }
        return <div key={col.id} style={cellStyle(col.id)} {...cellEvents(col.id)} />;
    }
  };

  // rowNum is declared but only used for future use (ordering). Suppress lint warning.
  void rowNum;

  return (
    <div
      data-row="true"
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('button')) return;
        onRowPointerDown(e);
      }}
      onPointerEnter={onRowPointerEnter}
      style={{
        ...styles.gridRow,
        ...styles.dataRow,
        gridTemplateColumns: colTemplate,
        background: isSelected ? 'rgba(0,136,204,0.08)' : isAlt ? '#f9fafb' : '#fff',
        borderLeft: isSelected ? '3px solid #0088cc' : '3px solid transparent',
      }}
    >
      {/* Eyeball */}
      <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.07)' }}>
        <button onClick={onView} style={styles.eyeBtn} title="View item">👁</button>
      </div>
      {/* Remove */}
      <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.07)' }}>
        <button onClick={onRemove} style={styles.removeBtn} title="Remove">×</button>
      </div>
      {/* Load into editor */}
      <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.07)' }}>
        <button onClick={onLoad} style={styles.loadBtn} title="Load into data entry">↩</button>
      </div>
      {visibleCols.map(col => renderCell(col))}
    </div>
  );
}

// ── BlankAddRow ──────────────────────────────────────────────────────────────

function BlankAddRow({ units, visibleCols, colTemplate, onAdd }: {
  units: UnitSystem;
  visibleCols: ColumnDef[];
  colTemplate: string;
  onAdd: (h: number, w: number) => void;
}) {
  const [h, setH] = useState('');
  const [w, setW] = useState('');
  const [hError, setHError] = useState(false);
  const [wError, setWError] = useState(false);
  const hRef = useRef<HTMLInputElement>(null);
  const wRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const hv = parseFloat(h), wv = parseFloat(w);
    const hMissing = h === '' || isNaN(hv) || hv <= 0;
    const wMissing = w === '' || isNaN(wv) || wv <= 0;
    if (hMissing || wMissing) {
      setHError(hMissing);
      setWError(wMissing);
      if (hMissing) hRef.current?.focus(); else wRef.current?.focus();
      return;
    }
    setHError(false); setWError(false);
    const toMm = (v: number) => units === 'in' ? v * 25.4 : v;
    onAdd(toMm(hv), toMm(wv));
    setH(''); setW('');
    hRef.current?.focus();
  };

  const hasFocus = h !== '' || w !== '';

  return (
    <div style={{
      ...styles.gridRow,
      ...styles.blankRow,
      gridTemplateColumns: colTemplate,
      background: hasFocus ? 'rgba(0,136,204,0.04)' : 'transparent',
    }}>
      {/* Three action cols (eye / remove / load) */}
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      {visibleCols.map(col => {
        if (col.id === 'height') {
          return (
            <div key={col.id} style={styles.cell}>
              <input
                ref={hRef}
                type="number"
                value={h}
                onChange={e => { setH(e.target.value); if (hError) setHError(false); }}
                placeholder="H"
                onKeyDown={e => {
                  if (e.key === 'Tab') { e.preventDefault(); wRef.current?.focus(); }
                  if (e.key === 'Enter') submit();
                }}
                style={{ ...styles.blankInput, ...(hError ? styles.blankInputError : {}) }}
              />
            </div>
          );
        }
        if (col.id === 'width') {
          return (
            <div key={col.id} style={styles.cell}>
              <input
                ref={wRef}
                type="number"
                value={w}
                onChange={e => { setW(e.target.value); if (wError) setWError(false); }}
                placeholder="W"
                onKeyDown={e => {
                  if (e.key === 'Tab') { e.preventDefault(); hRef.current?.focus(); }
                  if (e.key === 'Enter') submit();
                }}
                style={{ ...styles.blankInput, ...(wError ? styles.blankInputError : {}) }}
              />
            </div>
          );
        }
        return <div key={col.id} style={{ ...styles.cell, color: '#ddd', fontSize: 10, textAlign: 'center' }}>—</div>;
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.95)',
    overflow: 'hidden',
    fontSize: 10,
    fontFamily: 'system-ui, sans-serif',
  },

  // Title bar
  titleBar: {
    height: 24,
    background: '#f0f4f8',
    borderBottom: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#444',
    flexShrink: 0,
    letterSpacing: '0.03em',
  },

  // Tab bar
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '3px 6px 0',
    background: '#f0f4f8',
    borderBottom: '1px solid #ccc',
    flexShrink: 0,
    flexWrap: 'nowrap',
    overflowX: 'auto',
    height: 28,
  },
  tab: {
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 600,
    border: '1px solid #ccc',
    borderBottom: 'none',
    borderRadius: '3px 3px 0 0',
    cursor: 'pointer',
    background: '#fff',
    color: '#666',
    whiteSpace: 'nowrap',
    lineHeight: '18px',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  activeTab: {
    background: '#0088cc',
    color: '#fff',
    borderColor: '#0088cc',
  },
  newSelIndicator: {
    fontSize: 9,
    color: '#999',
    paddingLeft: 4,
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  },

  // Table
  tableWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  gridRow: {
    display: 'grid',
    alignItems: 'center',
    borderBottom: '1px solid #e8e8e8',
  },
  headerRow: {
    background: '#f0f4f8',
    flexShrink: 0,
    height: 26,
  },
  groupHeader: {
    background: '#e6ecf2',
    height: 22,
    borderBottom: '1px solid #d0d8e4',
  },
  dataBody: {
    flex: 1,
    overflowY: 'auto',
  },
  dataRow: {
    height: 26,
  },

  // Cells
  cell: {
    padding: '0 4px',
    overflow: 'hidden',
  },
  actionCell: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  headerCell: {
    fontSize: 10,
    fontWeight: 700,
    color: '#666',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  emptyRow: {
    padding: '12px 8px',
    fontSize: 10,
    color: '#bbb',
    textAlign: 'center' as const,
  },

  // Editable text placeholder
  editableText: {
    cursor: 'text',
    fontSize: 10,
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Inputs
  input: {
    border: '1px solid #0088cc',
    borderRadius: 2,
    padding: '1px 3px',
    fontSize: 10,
    background: '#fff',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },

  // Action buttons
  eyeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
    lineHeight: 1,
    opacity: 0.7,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
    color: '#cc4444',
    padding: 0,
    lineHeight: 1,
  },
  loadBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
    lineHeight: 1,
    color: '#0088cc',
    opacity: 0.75,
  },
  blankRow: {
    borderTop: '1px dashed #d0d8e4',
    background: 'transparent',
    height: 26,
  },
  blankInput: {
    border: '1px solid #ccc',
    borderRadius: 2,
    padding: '1px 3px',
    fontSize: 10,
    background: '#fafdff',
    boxSizing: 'border-box' as const,
    outline: 'none',
    width: '100%',
    textAlign: 'right' as const,
    color: '#555',
  },
  blankInputError: {
    border: '1px solid #e05555',
    background: '#fff5f5',
  },
};

