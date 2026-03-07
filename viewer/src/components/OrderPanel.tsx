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
  textureBlobUrls: Record<string, string>;
  onAddItem: (qty: number, note: string, w: number, h: number) => void;
  onRemoveItem: (id: number) => void;
  onUpdateItem: (id: number, changes: Partial<Pick<OrderItem, 'qty' | 'note' | 'roomName' | 'cabNumber' | 'material' | 'customData' | 'doorH' | 'doorW' | 'thickness' | 'paintPath' | 'hingesDisplay' | 'hardwareDisplay'>>) => void;
  onViewItem: (item: OrderItem) => void;
  onViewAndLoad?: (item: OrderItem) => void;
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

function parseDimToMm(str: string, u: UnitSystem): number {
  const n = parseFloat(str.replace(/[^0-9.-]/g, ''));
  if (isNaN(n)) return NaN;
  return u === 'in' ? n * 25.4 : n;
}

function parseHinges(display: string): { side: string; count: string } {
  const em = '\u2014';
  if (display === 'NA' || display === '—' || display === em) return { side: display, count: '' };
  const parts = display.split(' ');
  return { side: parts[0] ?? '', count: parts[1] ?? '' };
}

// ── OrderPanel ───────────────────────────────────────────────────────────────

const BATCH_EDITABLE = new Set(['height', 'width', 'thickness', 'roomName', 'note']);

export function OrderPanel({
  items, columns, groupByFields, styleTabs, currentStyleKey, units, textureBlobUrls,
  onAddItem: _onAddItem, onRemoveItem, onUpdateItem, onViewItem, onViewAndLoad, onStyleTabClick,
  onQuickAdd, onLoadItem,
}: OrderPanelProps) {
  const [activeTab, setActiveTab] = useState<'all' | string>(currentStyleKey);
  const [pinnedToAll, setPinnedToAll] = useState(false);

  void _onAddItem;

  useEffect(() => {
    if (!pinnedToAll) setActiveTab(currentStyleKey);
  }, [currentStyleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCols = useMemo(() => columns.filter(c => c.visible), [columns]);
  const colTemplate = `22px 18px 18px ${visibleCols.map(c => `${c.width}px`).join(' ')}`;

  const tabItems = useMemo(() => {
    if (activeTab === 'all') return items;
    return items.filter(i => i.styleName === activeTab);
  }, [items, activeTab]);

  const activeGroupFields = useMemo(() => groupByFields.filter(f => f.active), [groupByFields]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const map = new Map<string, OrderItem[]>();
    for (const item of tabItems) {
      const key = activeGroupFields.length > 0
        ? activeGroupFields.map(f => getGroupFieldValue(item, f.id)).join('||')
        : '__all__';
      if (!seen.has(key)) { seen.add(key); order.push(key); map.set(key, []); }
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

  const allRows = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // ── Cell selection ─────────────────────────────────────────────────────────
  const [selectedCells, setSelectedCells] = useState<Map<string, { id: number; colId: string }>>(new Map());

  const selectedColIdList = [...selectedCells.values()].map(c => c.colId);
  const allSameCol = selectedCells.size >= 2 && new Set(selectedColIdList).size === 1;
  const batchColId = allSameCol && BATCH_EDITABLE.has(selectedColIdList[0]) ? selectedColIdList[0] : null;
  const isNumericBatch = batchColId === 'height' || batchColId === 'width' || batchColId === 'thickness';

  const handleCellClick = (e: React.MouseEvent, itemId: number, colId: string) => {
    const key = `${itemId}:${colId}`;
    if (e.ctrlKey || e.metaKey) {
      setSelectedCells(prev => {
        const next = new Map(prev);
        next.has(key) ? next.delete(key) : next.set(key, { id: itemId, colId });
        return next;
      });
    } else {
      setSelectedCells(new Map([[key, { id: itemId, colId }]]));
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedCells(new Map()); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Focus / tab navigation ─────────────────────────────────────────────────
  const [focusTarget, setFocusTarget] = useState<{ id: number; colId: string } | null>(null);

  // Tab order for editable columns (order matters)
  const TAB_COLS = useMemo(() => {
    const base = ['qty', 'height', 'width', 'roomName', 'cabNumber', 'material', 'note'];
    const customs = visibleCols.filter(c => c.isCustom).map(c => c.id);
    return [...base, ...customs].filter(id => visibleCols.some(c => c.id === id));
  }, [visibleCols]);

  const handleTabNext = (itemId: number, fromColId: string) => {
    const idx = TAB_COLS.indexOf(fromColId);
    const nextColId = TAB_COLS[idx + 1] ?? null;
    if (nextColId) {
      setFocusTarget({ id: itemId, colId: nextColId });
    } else {
      const rowIdx = allRows.findIndex(r => r.id === itemId);
      const nextRow = allRows[rowIdx + 1];
      if (nextRow && TAB_COLS[0]) setFocusTarget({ id: nextRow.id, colId: TAB_COLS[0] });
    }
  };

  return (
    <div
      style={styles.container}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement;
        // Fix 2: don't clear selection when clicking the batch bar input
        if (t.closest('[data-row]') === null && t.closest('[data-batch-bar]') === null) {
          setSelectedCells(new Map());
        }
      }}
    >
      <div style={styles.titleBar}>PAC Door Order</div>

      <div style={styles.tabBar}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'all' ? styles.activeTab : {}) }}
          onClick={() => { setPinnedToAll(true); setActiveTab('all'); }}
        >All</button>
        {styleTabs.map(tab => (
          <button
            key={tab.key}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.activeTab : {}) }}
            title={tab.label}
            onClick={() => { setPinnedToAll(false); setActiveTab(tab.key); onStyleTabClick(tab.key); }}
          >{tab.label}</button>
        ))}
        {currentStyleKey !== 'None' && !styleTabs.some(t => t.key === currentStyleKey) && (
          <span style={styles.newSelIndicator}>+ new style</span>
        )}
      </div>

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

      <div style={styles.tableWrapper}>
        {/* Sticky header */}
        <div style={{ ...styles.gridRow, ...styles.headerRow, gridTemplateColumns: colTemplate }}>
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.1)' }} />
          {visibleCols.map(col => (
            <div key={col.id} style={{ ...styles.cell, ...styles.headerCell, borderRight: '1px solid rgba(0,0,0,0.1)', textAlign: rightAlignedCols.has(col.id) ? 'right' : col.id === 'qty' ? 'center' : 'left' }}>
              {col.label}
            </div>
          ))}
        </div>

        <div style={styles.dataBody}>
          {groups.length === 0 && <div style={styles.emptyRow}>No items — press "Add to Order" to add doors</div>}
          {groups.map(group => (
            <div key={group.key}>
              <div style={{ ...styles.gridRow, ...styles.groupHeader, gridTemplateColumns: colTemplate }}>
                <div style={{ gridColumn: '1 / -1', padding: '0 8px', fontWeight: 700, fontSize: 10, color: '#333' }}>{group.header}</div>
              </div>
              {group.items.map((item, idx) => (
                <DataRow
                  key={item.id}
                  item={item}
                  rowNum={idx + 1}
                  units={units}
                  visibleCols={visibleCols}
                  colTemplate={colTemplate}
                  isAlt={idx % 2 === 1}
                  textureBlobUrls={textureBlobUrls}
                  selectedColIds={new Set([...selectedCells.values()].filter(c => c.id === item.id).map(c => c.colId))}
                  onRemove={() => onRemoveItem(item.id)}
                  onView={() => onViewAndLoad ? onViewAndLoad(item) : onViewItem(item)}
                  onLoad={() => onLoadItem(item)}
                  onUpdateQty={(qty) => onUpdateItem(item.id, { qty })}
                  onUpdateNote={(note) => onUpdateItem(item.id, { note })}
                  onUpdateRoomName={(roomName) => onUpdateItem(item.id, { roomName })}
                  onUpdateCabNumber={(cabNumber) => onUpdateItem(item.id, { cabNumber })}
                  onUpdateMaterial={(material) => onUpdateItem(item.id, { material })}
                  onUpdateCustom={(colId, val) => onUpdateItem(item.id, { customData: { [colId]: val } })}
                  onUpdateHeight={(mm) => onUpdateItem(item.id, { doorH: mm })}
                  onUpdateWidth={(mm) => onUpdateItem(item.id, { doorW: mm })}
                  onUpdateHingesDisplay={(v) => onUpdateItem(item.id, { hingesDisplay: v })}
                  onUpdateHardwareDisplay={(v) => onUpdateItem(item.id, { hardwareDisplay: v })}
                  onCellClick={(e, colId) => handleCellClick(e, item.id, colId)}
                  onEnterNext={(colId) => {
                    const idx2 = allRows.findIndex(r => r.id === item.id);
                    const next = allRows[idx2 + 1];
                    if (next) setFocusTarget({ id: next.id, colId });
                  }}
                  onTabNext={(colId) => handleTabNext(item.id, colId)}
                  autoFocusColId={focusTarget?.id === item.id ? focusTarget.colId : null}
                  onFocusConsumed={() => setFocusTarget(null)}
                />
              ))}
              <BlankAddRow units={units} visibleCols={visibleCols} colTemplate={colTemplate} onAdd={(h, w) => onQuickAdd(h, w)} />
            </div>
          ))}

          {/* Fix 2: data-batch-bar prevents background pointerDown from clearing selection */}
          {batchColId && (() => {
            const count = selectedCells.size;
            const label = columns.find(c => c.id === batchColId)?.label ?? batchColId;
            return (
              <div data-batch-bar="true" style={{ position: 'sticky', bottom: 0, zIndex: 10, background: '#e8f4fd', borderTop: '1px solid #b3d9f5', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexShrink: 0 }}>
                <span style={{ color: '#0077bb', fontWeight: 600 }}>{count} {label} cells selected</span>
                <span style={{ color: '#555' }}>Set value:</span>
                <input
                  autoFocus
                  style={{ width: 90, fontSize: 11, padding: '1px 4px', border: '1px solid #99c9e8', borderRadius: 3 }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      for (const { id } of selectedCells.values()) {
                        if (isNumericBatch) {
                          const mm = parseDimToMm(raw, units);
                          if (!isNaN(mm) && mm > 0) {
                            const field = batchColId === 'height' ? { doorH: mm } : batchColId === 'width' ? { doorW: mm } : { thickness: mm };
                            onUpdateItem(id, field);
                          }
                        } else {
                          onUpdateItem(id, batchColId === 'roomName' ? { roomName: raw } : { note: raw });
                        }
                      }
                      setSelectedCells(new Map());
                    }
                    if (e.key === 'Escape') setSelectedCells(new Map());
                  }}
                />
                <span style={{ color: '#888', fontSize: 10 }}>Enter to apply · Esc to cancel</span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

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

const rightAlignedCols = new Set(['height', 'width', 'price', 'subtotal']);

interface DataRowProps {
  item: OrderItem;
  rowNum: number;
  units: UnitSystem;
  visibleCols: ColumnDef[];
  colTemplate: string;
  isAlt: boolean;
  textureBlobUrls: Record<string, string>;
  selectedColIds: Set<string>;
  onRemove: () => void;
  onView: () => void;
  onLoad: () => void;
  onUpdateQty: (qty: number) => void;
  onUpdateNote: (note: string) => void;
  onUpdateRoomName: (v: string) => void;
  onUpdateCabNumber: (v: string) => void;
  onUpdateMaterial: (v: string) => void;
  onUpdateCustom: (colId: string, val: string) => void;
  onUpdateHeight: (mm: number) => void;
  onUpdateWidth: (mm: number) => void;
  onUpdateHingesDisplay: (v: string) => void;
  onUpdateHardwareDisplay: (v: string) => void;
  onCellClick: (e: React.MouseEvent, colId: string) => void;
  onEnterNext: (colId: string) => void;
  onTabNext: (colId: string) => void;
  autoFocusColId: string | null;
  onFocusConsumed: () => void;
}

function DataRow({
  item, rowNum, units, visibleCols, colTemplate, isAlt, textureBlobUrls, selectedColIds,
  onRemove, onView, onLoad, onUpdateQty, onUpdateNote, onUpdateRoomName, onUpdateCabNumber, onUpdateMaterial, onUpdateCustom,
  onUpdateHeight, onUpdateWidth, onUpdateHingesDisplay, onUpdateHardwareDisplay,
  onCellClick, onEnterNext, onTabNext, autoFocusColId, onFocusConsumed,
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
  const [editingH, setEditingH] = useState(false);
  const [editingW, setEditingW] = useState(false);
  const [editingHinges, setEditingHinges] = useState(false);
  const [editingHW, setEditingHW] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const cellStyle = (colId: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
    ...styles.cell,
    borderRight: '1px solid rgba(0,0,0,0.07)',
    ...(selectedColIds.has(colId)
      ? { background: 'rgba(0,136,204,0.14)', outline: '1px solid rgba(0,136,204,0.3)' }
      : hoveredCell === colId
        ? { background: 'rgba(0,136,204,0.06)' }
        : {}),
    ...extra,
  });
  const cellEvents = (colId: string) => ({
    onMouseEnter: () => setHoveredCell(colId),
    onMouseLeave: () => setHoveredCell(null),
    onClick: (e: React.MouseEvent) => onCellClick(e, colId),
  });

  useEffect(() => { setLocalQty(String(item.qty)); }, [item.qty]);
  useEffect(() => { setLocalNote(item.note); }, [item.note]);
  useEffect(() => { setLocalRoom(item.roomName); }, [item.roomName]);
  useEffect(() => { setLocalCab(item.cabNumber); }, [item.cabNumber]);
  useEffect(() => { setLocalMaterial(item.material); }, [item.material]);

  useEffect(() => {
    if (!autoFocusColId) return;
    switch (autoFocusColId) {
      case 'qty':      setEditingQty(true); break;
      case 'height':   setEditingH(true); break;
      case 'width':    setEditingW(true); break;
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

  // Fix 3: shared Tab key handler for all editable inputs
  const tabHandler = (colId: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.currentTarget.blur();
      onTabNext(colId);
    }
  };

  const renderCell = (col: ColumnDef) => {
    switch (col.id) {
      case 'qty':
        return (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'center' })} {...cellEvents(col.id)}>
            {editingQty ? (
              <input
                autoFocus type="number" min={1} value={localQty}
                onChange={e => setLocalQty(e.target.value)}
                onFocus={e => e.target.select()}
                onBlur={commitQty}
                onKeyDown={e => {
                  if (e.key === 'Enter') { commitQty(); onEnterNext('qty'); }
                  if (e.key === 'Tab') { e.preventDefault(); commitQty(); onTabNext('qty'); }
                }}
                style={{ ...styles.input, textAlign: 'center', width: '100%' }}
              />
            ) : (
              <span style={styles.editableText} onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingQty(true); }} title="Click to edit QTY">
                {item.qty}
              </span>
            )}
          </div>
        );

      case 'height':
        return editingH ? (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10 })}>
            <input
              autoFocus
              defaultValue={(units === 'in' ? item.doorH / 25.4 : item.doorH).toFixed(units === 'in' ? 2 : 1)}
              onFocus={e => e.target.select()}
              style={{ width: '100%', textAlign: 'right', fontSize: 10, border: 'none', outline: 'none', background: 'transparent', boxSizing: 'border-box' }}
              onBlur={e => { const mm = parseDimToMm(e.target.value, units); if (!isNaN(mm) && mm > 0) onUpdateHeight(mm); setEditingH(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.currentTarget.blur(); onEnterNext('height'); }
                if (e.key === 'Tab') { e.preventDefault(); e.currentTarget.blur(); onTabNext('height'); }
                if (e.key === 'Escape') setEditingH(false);
              }}
            />
          </div>
        ) : (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, cursor: 'text' })} {...cellEvents(col.id)} onClick={e => { onCellClick(e, col.id); setEditingH(true); }}>
            {fmtDim(item.doorH, units)}
          </div>
        );

      case 'width':
        return editingW ? (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10 })}>
            <input
              autoFocus
              defaultValue={(units === 'in' ? item.doorW / 25.4 : item.doorW).toFixed(units === 'in' ? 2 : 1)}
              onFocus={e => e.target.select()}
              style={{ width: '100%', textAlign: 'right', fontSize: 10, border: 'none', outline: 'none', background: 'transparent', boxSizing: 'border-box' }}
              onBlur={e => { const mm = parseDimToMm(e.target.value, units); if (!isNaN(mm) && mm > 0) onUpdateWidth(mm); setEditingW(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.currentTarget.blur(); onEnterNext('width'); }
                if (e.key === 'Tab') { e.preventDefault(); e.currentTarget.blur(); onTabNext('width'); }
                if (e.key === 'Escape') setEditingW(false);
              }}
            />
          </div>
        ) : (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, cursor: 'text' })} {...cellEvents(col.id)} onClick={e => { onCellClick(e, col.id); setEditingW(true); }}>
            {fmtDim(item.doorW, units)}
          </div>
        );

      case 'partType':
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{item.doorType}</div>;
      case 'doorStyle':
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{item.styleName}</div>;

      case 'finish': {
        // Fix 1: show paint swatch when textureCategory is 'painted'
        if (item.textureCategory === 'painted' && item.paintPath) {
          const blobUrl = textureBlobUrls[item.paintPath] ?? null;
          const colorName = item.paintPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
          return (
            <div key={col.id} style={cellStyle(col.id, { display: 'flex', alignItems: 'center', gap: 3 })} {...cellEvents(col.id)}>
              {blobUrl
                ? <img src={blobUrl} style={{ width: 12, height: 12, borderRadius: 2, objectFit: 'cover', border: '1px solid #ccc', flexShrink: 0 }} alt="" />
                : <span style={{ width: 12, height: 12, borderRadius: 2, background: '#ddd', display: 'inline-block', border: '1px solid #ccc', flexShrink: 0 }} />
              }
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>{colorName}</span>
            </div>
          );
        }
        return <div key={col.id} style={cellStyle(col.id, { fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} {...cellEvents(col.id)}>{capitalize(item.textureCategory)}</div>;
      }

      case 'roomName':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingRoom ? (
              <input autoFocus type="text" value={localRoom}
                onChange={e => setLocalRoom(e.target.value)}
                onBlur={() => { setEditingRoom(false); onUpdateRoomName(localRoom); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setEditingRoom(false); onUpdateRoomName(localRoom); onEnterNext('roomName'); }
                  tabHandler('roomName')(e);
                }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span style={{ ...styles.editableText, color: item.roomName ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingRoom(true); }}
                title={item.roomName || 'Click to add room name'}
              >{item.roomName || '—'}</span>
            )}
          </div>
        );

      case 'cabNumber':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingCab ? (
              <input autoFocus type="text" value={localCab}
                onChange={e => setLocalCab(e.target.value)}
                onBlur={() => { setEditingCab(false); onUpdateCabNumber(localCab); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setEditingCab(false); onUpdateCabNumber(localCab); onEnterNext('cabNumber'); }
                  tabHandler('cabNumber')(e);
                }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span style={{ ...styles.editableText, color: item.cabNumber ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingCab(true); }}
                title={item.cabNumber || 'Click to add cab #'}
              >{item.cabNumber || '—'}</span>
            )}
          </div>
        );

      case 'material':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingMaterial ? (
              <input autoFocus type="text" value={localMaterial}
                onChange={e => setLocalMaterial(e.target.value)}
                onBlur={() => { setEditingMaterial(false); onUpdateMaterial(localMaterial); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setEditingMaterial(false); onUpdateMaterial(localMaterial); onEnterNext('material'); }
                  tabHandler('material')(e);
                }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span style={{ ...styles.editableText, color: item.material ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingMaterial(true); }}
                title={item.material || 'Click to add material'}
              >{item.material || '—'}</span>
            )}
          </div>
        );

      case 'note':
        return (
          <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
            {editingNote ? (
              <input autoFocus type="text" value={localNote}
                onChange={e => setLocalNote(e.target.value)}
                onBlur={() => { setEditingNote(false); onUpdateNote(localNote); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setEditingNote(false); onUpdateNote(localNote); onEnterNext('note'); }
                  tabHandler('note')(e);
                }}
                style={{ ...styles.input, width: '100%' }}
              />
            ) : (
              <span style={{ ...styles.editableText, color: item.note ? '#333' : '#bbb' }}
                onClick={e => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditingNote(true); }}
                title={item.note || 'Click to add note'}
              >{item.note || '—'}</span>
            )}
          </div>
        );

      case 'profile':
        return (
          <div key={col.id} style={cellStyle(col.id, { display: 'flex', alignItems: 'center', justifyContent: 'center' })} {...cellEvents(col.id)}>
            {item.crossSectionImage ? (
              <button onClick={onView} title="Click to view cross-section"
                style={{ padding: 0, border: '1px solid #e0e0e0', borderRadius: 2, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img src={item.crossSectionImage} alt="profile" style={{ width: 36, height: 22, objectFit: 'contain', display: 'block' }} />
              </button>
            ) : (
              <span style={{ fontSize: 9, color: '#bbb' }}>—</span>
            )}
          </div>
        );

      case 'hinges': {
        // Fix 4: dropdown for L / R / NA
        const { side, count } = parseHinges(item.hingesDisplay ?? '');
        const isFixed = side === '\u2014' || side === '—';
        return (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'center', fontSize: 10 })} {...cellEvents(col.id)}>
            {editingHinges && !isFixed ? (
              <select
                autoFocus
                value={side === 'NA' ? 'NA' : side}
                onChange={e => {
                  const s = e.target.value;
                  onUpdateHingesDisplay(s === 'NA' ? 'NA' : `${s} ${count}`);
                  setEditingHinges(false);
                }}
                onBlur={() => setEditingHinges(false)}
                style={{ fontSize: 9, border: 'none', background: 'transparent', width: '100%', outline: 'none', padding: 0, textAlign: 'center' as const }}
              >
                <option value="L">L</option>
                <option value="R">R</option>
                <option value="NA">NA</option>
              </select>
            ) : (
              <span
                style={{ cursor: isFixed ? 'default' : 'pointer', fontSize: 10 }}
                onClick={() => { if (!isFixed) setEditingHinges(true); }}
              >
                {item.hingesDisplay ?? '—'}
              </span>
            )}
          </div>
        );
      }

      case 'hardware': {
        // Fix 5: dropdown for K / H / NA
        const hw = item.hardwareDisplay ?? '—';
        const isFixed = hw === '—' || hw === '\u2014';
        return (
          <div key={col.id} style={cellStyle(col.id, { textAlign: 'center', fontSize: 10 })} {...cellEvents(col.id)}>
            {editingHW && !isFixed ? (
              <select
                autoFocus
                value={hw === 'NA' ? 'NA' : hw}
                onChange={e => {
                  onUpdateHardwareDisplay(e.target.value);
                  setEditingHW(false);
                }}
                onBlur={() => setEditingHW(false)}
                style={{ fontSize: 9, border: 'none', background: 'transparent', width: '100%', outline: 'none', padding: 0, textAlign: 'center' as const }}
              >
                <option value="K">K</option>
                <option value="H">H</option>
                <option value="NA">NA</option>
              </select>
            ) : (
              <span
                style={{ cursor: isFixed ? 'default' : 'pointer', fontSize: 10 }}
                onClick={() => { if (!isFixed) setEditingHW(true); }}
              >
                {hw}
              </span>
            )}
          </div>
        );
      }

      case 'price':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, fontVariantNumeric: 'tabular-nums' })} {...cellEvents(col.id)}>{fmtPrice(item.price)}</div>;
      case 'subtotal':
        return <div key={col.id} style={cellStyle(col.id, { textAlign: 'right', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' })} {...cellEvents(col.id)}>{fmtPrice(subtotal)}</div>;

      default:
        if (col.isCustom) {
          const val = item.customData?.[col.id] ?? '';
          const isEditing = editingCustom === col.id;
          return (
            <div key={col.id} style={cellStyle(col.id, { overflow: 'hidden' })} {...cellEvents(col.id)}>
              {isEditing ? (
                <input autoFocus type="text" value={localCustomVal}
                  onChange={e => setLocalCustomVal(e.target.value)}
                  onBlur={() => { setEditingCustom(null); onUpdateCustom(col.id, localCustomVal); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { setEditingCustom(null); onUpdateCustom(col.id, localCustomVal); onEnterNext(col.id); }
                    tabHandler(col.id)(e);
                  }}
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

  void rowNum;

  return (
    <div
      data-row="true"
      style={{ ...styles.gridRow, ...styles.dataRow, gridTemplateColumns: colTemplate, background: isAlt ? '#f9fafb' : '#fff' }}
    >
      <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.07)' }}>
        <button onClick={onView} style={styles.eyeBtn} title="View item">👁</button>
      </div>
      <div style={{ ...styles.cell, ...styles.actionCell, borderRight: '1px solid rgba(0,0,0,0.07)' }}>
        <button onClick={onRemove} style={styles.removeBtn} title="Remove">×</button>
      </div>
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
      setHError(hMissing); setWError(wMissing);
      if (hMissing) hRef.current?.focus(); else wRef.current?.focus();
      return;
    }
    setHError(false); setWError(false);
    const toMm = (v: number) => units === 'in' ? v * 25.4 : v;
    onAdd(toMm(hv), toMm(wv));
    setH(''); setW('');
    hRef.current?.focus();
  };

  return (
    <div style={{ ...styles.gridRow, ...styles.blankRow, gridTemplateColumns: colTemplate, background: (h !== '' || w !== '') ? 'rgba(0,136,204,0.04)' : 'transparent' }}>
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      <div style={{ ...styles.cell, ...styles.actionCell }} />
      {visibleCols.map(col => {
        if (col.id === 'height') return (
          <div key={col.id} style={styles.cell}>
            <input ref={hRef} type="number" value={h}
              onChange={e => { setH(e.target.value); if (hError) setHError(false); }}
              placeholder="H"
              onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); wRef.current?.focus(); } if (e.key === 'Enter') submit(); }}
              style={{ ...styles.blankInput, ...(hError ? styles.blankInputError : {}) }}
            />
          </div>
        );
        if (col.id === 'width') return (
          <div key={col.id} style={styles.cell}>
            <input ref={wRef} type="number" value={w}
              onChange={e => { setW(e.target.value); if (wError) setWError(false); }}
              placeholder="W"
              onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); hRef.current?.focus(); } if (e.key === 'Enter') submit(); }}
              style={{ ...styles.blankInput, ...(wError ? styles.blankInputError : {}) }}
            />
          </div>
        );
        return <div key={col.id} style={{ ...styles.cell, color: '#ddd', fontSize: 10, textAlign: 'center' }}>—</div>;
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.95)', overflow: 'hidden', fontSize: 10, fontFamily: 'system-ui, sans-serif' },
  titleBar: { height: 24, background: '#f0f4f8', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#444', flexShrink: 0, letterSpacing: '0.03em' },
  tabBar: { display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px 0', background: '#f0f4f8', borderBottom: '1px solid #ccc', flexShrink: 0, flexWrap: 'nowrap', overflowX: 'auto', height: 28 },
  tab: { padding: '2px 8px', fontSize: 10, fontWeight: 600, border: '1px solid #ccc', borderBottom: 'none', borderRadius: '3px 3px 0 0', cursor: 'pointer', background: '#fff', color: '#666', whiteSpace: 'nowrap', lineHeight: '18px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' },
  activeTab: { background: '#0088cc', color: '#fff', borderColor: '#0088cc' },
  newSelIndicator: { fontSize: 9, color: '#999', paddingLeft: 4, whiteSpace: 'nowrap', fontStyle: 'italic' },
  tableWrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  gridRow: { display: 'grid', alignItems: 'center', borderBottom: '1px solid #e8e8e8' },
  headerRow: { background: '#f0f4f8', flexShrink: 0, height: 26 },
  groupHeader: { background: '#e6ecf2', height: 22, borderBottom: '1px solid #d0d8e4' },
  dataBody: { flex: 1, overflowY: 'auto' },
  dataRow: { height: 26 },
  cell: { padding: '0 4px', overflow: 'hidden' },
  actionCell: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  headerCell: { fontSize: 10, fontWeight: 700, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden' },
  emptyRow: { padding: '12px 8px', fontSize: 10, color: '#bbb', textAlign: 'center' as const },
  editableText: { cursor: 'text', fontSize: 10, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  input: { border: '1px solid #0088cc', borderRadius: 2, padding: '1px 3px', fontSize: 10, background: '#fff', boxSizing: 'border-box' as const, outline: 'none' },
  eyeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, opacity: 0.7 },
  removeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: '#cc4444', padding: 0, lineHeight: 1 },
  loadBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, color: '#0088cc', opacity: 0.75 },
  blankRow: { borderTop: '1px dashed #d0d8e4', background: 'transparent', height: 26 },
  blankInput: { border: '1px solid #ccc', borderRadius: 2, padding: '1px 3px', fontSize: 10, background: '#fafdff', boxSizing: 'border-box' as const, outline: 'none', width: '100%', textAlign: 'right' as const, color: '#555' },
  blankInputError: { border: '1px solid #e05555', background: '#fff5f5' },
};
