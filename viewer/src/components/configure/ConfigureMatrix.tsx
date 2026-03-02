import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { PARAM_DEFINITIONS } from '../../configParams.js';
import type { ParamDefinition, BooleanRadioValue } from '../../configParams.js';
import type { RawToolGroup, TextureManifest } from '../../types.js';
import type { DoorStyleWithParams } from '../../hooks/useConfigData.js';
import { ParamCell } from './ParamCell.js';

interface ConfigureMatrixProps {
  styles: DoorStyleWithParams[];
  toolGroups: RawToolGroup[];
  onParamChange: (styleId: string, paramKey: string, value: unknown) => void;
  onRenameStyle: (styleId: string, newName: string) => Promise<void>;
  onRemoveStyle: (styleId: string) => void;
  onAddStyle: (displayName: string) => void;
  onReorderStyles: (styleIds: string[]) => void;
  paramOrder: string[] | null;
  onReorderParams: (paramKeys: string[]) => void;
  textureManifest: TextureManifest | null;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}

// ---------------------------------------------------------------------------
// Sortable sub-components
// ---------------------------------------------------------------------------

function SortableStyleHeader({
  id,
  style,
  isEditing,
  editingName,
  onEditingNameChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onRemove,
}: {
  id: string;
  style: DoorStyleWithParams;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ ...headerCellStyle, opacity: isDragging ? 0.4 : 1 }}
    >
      <span
        {...attributes}
        {...listeners}
        style={dragHandleStyle}
        title="Drag to reorder"
      >
        {'\u2847'}
      </span>
      {isEditing ? (
        <input
          type="text"
          value={editingName}
          onChange={e => onEditingNameChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCancelRename();
          }}
          autoFocus
          style={renameInputStyle}
        />
      ) : (
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
          onDoubleClick={onStartRename}
          title="Double-click to rename"
        >
          {style.displayName}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        style={deleteBtnStyle}
        title="Remove style"
      >
        ×
      </button>
    </div>
  );
}

function SortableParamLabel({ id, param }: { id: string; param: ParamDefinition }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ ...labelCellStyle, opacity: isDragging ? 0.4 : 1 }}
    >
      <span
        {...attributes}
        {...listeners}
        style={dragHandleStyle}
        title="Drag to reorder"
      >
        {'\u2847'}
      </span>
      {param.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConfigureMatrix({
  styles,
  toolGroups,
  onParamChange,
  onRenameStyle,
  onRemoveStyle,
  onAddStyle,
  onReorderStyles,
  paramOrder,
  onReorderParams,
  textureManifest,
  toDisplay,
  fromDisplay,
  inputStep,
}: ConfigureMatrixProps) {
  const [addingName, setAddingName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const panelGroups = useMemo(
    () => toolGroups
      .filter(g => g.Type === 0)
      .map(g => ({ id: g.ToolGroupID, label: g.Name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [toolGroups],
  );

  const edgeGroups = useMemo(
    () => toolGroups
      .filter(g => g.Type === 1)
      .map(g => ({ id: g.ToolGroupID, label: g.Name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [toolGroups],
  );

  // Compute ordered params from paramOrder prop
  const orderedParams = useMemo(() => {
    if (!paramOrder) return PARAM_DEFINITIONS;
    const map = new Map(PARAM_DEFINITIONS.map(p => [p.key, p]));
    const ordered: ParamDefinition[] = [];
    for (const key of paramOrder) {
      const p = map.get(key);
      if (p) ordered.push(p);
    }
    // Append any new params not in the saved order
    for (const p of PARAM_DEFINITIONS) {
      if (!paramOrder.includes(p.key)) ordered.push(p);
    }
    return ordered;
  }, [paramOrder]);

  // DnD IDs with prefixes to distinguish style vs param drags
  const styleIds = useMemo(() => styles.map(s => `style-${s.id}`), [styles]);
  const paramIds = useMemo(() => orderedParams.map(p => `param-${p.key}`), [orderedParams]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    if (activeStr.startsWith('style-') && overStr.startsWith('style-')) {
      const oldIndex = styleIds.indexOf(activeStr);
      const newIndex = styleIds.indexOf(overStr);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(styles.map(s => s.id), oldIndex, newIndex);
        onReorderStyles(newOrder);
      }
    } else if (activeStr.startsWith('param-') && overStr.startsWith('param-')) {
      const keys = orderedParams.map(p => p.key);
      const oldKey = activeStr.replace('param-', '');
      const overKey = overStr.replace('param-', '');
      const oldIndex = keys.indexOf(oldKey);
      const newIndex = keys.indexOf(overKey);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(keys, oldIndex, newIndex);
        onReorderParams(newOrder);
      }
    }
  }, [styleIds, styles, orderedParams, onReorderStyles, onReorderParams]);

  const handleAdd = () => {
    const name = addingName.trim();
    if (!name) return;
    onAddStyle(name);
    setAddingName('');
    setShowAddInput(false);
  };

  const startRename = (style: DoorStyleWithParams) => {
    setEditingStyleId(style.id);
    setEditingName(style.displayName);
  };

  const commitRename = () => {
    if (editingStyleId && editingName.trim()) {
      onRenameStyle(editingStyleId, editingName.trim());
    }
    setEditingStyleId(null);
    setEditingName('');
  };

  const cancelRename = () => {
    setEditingStyleId(null);
    setEditingName('');
  };

  // Radio coordination: when a boolean-radio param is set to true for one style, clear all others
  const handleRadioSelect = useCallback((selectedStyleId: string, paramKey: string) => {
    for (const s of styles) {
      if (s.id !== selectedStyleId) {
        const current = s.params[paramKey] as BooleanRadioValue | undefined;
        if (current?.enabled) {
          onParamChange(s.id, paramKey, { enabled: false });
        }
      }
    }
  }, [styles, onParamChange]);

  // Overlay content for DragOverlay
  const overlayContent = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith('style-')) {
      const realId = activeId.replace('style-', '');
      const s = styles.find(st => st.id === realId);
      return (
        <div style={{ ...overlayHeaderStyle }}>
          {s?.displayName ?? ''}
        </div>
      );
    }
    if (activeId.startsWith('param-')) {
      const key = activeId.replace('param-', '');
      const p = PARAM_DEFINITIONS.find(pd => pd.key === key);
      return (
        <div style={{ ...overlayLabelStyle }}>
          {p?.label ?? ''}
        </div>
      );
    }
    return null;
  }, [activeId, styles]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={wrapperStyle}>
        <div
          style={{
            ...gridStyle,
            gridTemplateColumns: `200px repeat(${styles.length}, 260px) auto`,
          }}
        >
          {/* --- Header row --- */}
          <div style={cornerCellStyle}>Parameter</div>
          <SortableContext items={styleIds} strategy={horizontalListSortingStrategy}>
            {styles.map(s => (
              <SortableStyleHeader
                key={s.id}
                id={`style-${s.id}`}
                style={s}
                isEditing={editingStyleId === s.id}
                editingName={editingName}
                onEditingNameChange={setEditingName}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onStartRename={() => startRename(s)}
                onRemove={() => onRemoveStyle(s.id)}
              />
            ))}
          </SortableContext>
          <div style={addColumnStyle}>
            {showAddInput ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  value={addingName}
                  onChange={e => setAddingName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') { setShowAddInput(false); setAddingName(''); }
                  }}
                  placeholder="Style name..."
                  autoFocus
                  style={addInputStyle}
                />
                <button type="button" onClick={handleAdd} style={addConfirmBtnStyle}>+</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddInput(true)}
                style={addBtnStyle}
              >
                + Add Style
              </button>
            )}
          </div>

          {/* --- Parameter rows --- */}
          <SortableContext items={paramIds} strategy={verticalListSortingStrategy}>
            {orderedParams.map(param => (
              <ParamRow
                key={param.key}
                param={param}
                paramId={`param-${param.key}`}
                styles={styles}
                panelGroups={panelGroups}
                edgeGroups={edgeGroups}
                onParamChange={onParamChange}
                onRadioSelect={handleRadioSelect}
                textureManifest={textureManifest}
                toDisplay={toDisplay}
                fromDisplay={fromDisplay}
                inputStep={inputStep}
              />
            ))}
          </SortableContext>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {overlayContent}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// ParamRow — a label cell + value cells for one parameter across all styles
// ---------------------------------------------------------------------------

function ParamRow({
  param,
  paramId,
  styles,
  panelGroups,
  edgeGroups,
  onParamChange,
  onRadioSelect,
  textureManifest,
  toDisplay,
  fromDisplay,
  inputStep,
}: {
  param: ParamDefinition;
  paramId: string;
  styles: DoorStyleWithParams[];
  panelGroups: { id: number; label: string }[];
  edgeGroups: { id: number; label: string }[];
  onParamChange: (styleId: string, paramKey: string, value: unknown) => void;
  onRadioSelect: (styleId: string, paramKey: string) => void;
  textureManifest: TextureManifest | null;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}) {
  return (
    <>
      <SortableParamLabel id={paramId} param={param} />
      {styles.map(s => (
        <div key={`${s.id}-${param.key}`} style={valueCellStyle}>
          <ParamCell
            param={param}
            value={s.params[param.key]}
            allParams={s.params}
            panelGroups={panelGroups}
            edgeGroups={edgeGroups}
            onChange={v => onParamChange(s.id, param.key, v)}
            onRadioSelect={param.type === 'boolean-radio' ? () => onRadioSelect(s.id, param.key) : undefined}
            textureManifest={textureManifest}
            onCopyToAll={param.type === 'texture-checkbox-list'
              ? () => {
                  const val = s.params[param.key];
                  for (const other of styles) {
                    if (other.id !== s.id) onParamChange(other.id, param.key, val);
                  }
                }
              : undefined}
            toDisplay={toDisplay}
            fromDisplay={fromDisplay}
            inputStep={inputStep}
          />
        </div>
      ))}
      <div style={{ minWidth: 120 }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const wrapperStyle: React.CSSProperties = {
  overflow: 'auto',
  flex: 1,
  maxHeight: 'calc(100vh - 120px)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
};

const cornerCellStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  top: 0,
  zIndex: 3,
  background: '#1a1a2e',
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#8888aa',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid #335577',
  borderRight: '1px solid #335577',
};

const headerCellStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#1a1a2e',
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 12,
  color: '#e0e0e0',
  borderBottom: '1px solid #335577',
  borderRight: '1px solid #252545',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 6px',
  borderRadius: 3,
  border: '1px solid #5577aa',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 12,
  fontWeight: 600,
  outline: 'none',
};

const addColumnStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#1a1a2e',
  padding: '8px 8px',
  borderBottom: '1px solid #335577',
  minWidth: 160,
};

const labelCellStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: '#1e1e3a',
  padding: '6px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#8888aa',
  borderBottom: '1px solid #252545',
  borderRight: '1px solid #335577',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const valueCellStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid #252545',
  borderRight: '1px solid #252545',
  display: 'flex',
  alignItems: 'center',
};

const deleteBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#666688',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
};

const addBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#8888aa',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const addInputStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  width: 160,
};

const addConfirmBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #5577aa',
  background: '#2a4a6e',
  color: '#e0e0e0',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const dragHandleStyle: React.CSSProperties = {
  cursor: 'grab',
  color: '#555577',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 2px',
  userSelect: 'none',
  flexShrink: 0,
};

const overlayHeaderStyle: React.CSSProperties = {
  background: '#2a4a6e',
  padding: '8px 14px',
  fontWeight: 600,
  fontSize: 12,
  color: '#e0e0e0',
  borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
};

const overlayLabelStyle: React.CSSProperties = {
  background: '#2a4a6e',
  padding: '6px 14px',
  fontWeight: 600,
  fontSize: 11,
  color: '#e0e0e0',
  borderRadius: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
};
