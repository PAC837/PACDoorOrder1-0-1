import { useState, useEffect, useRef } from 'react';
import type { DoorHandlePlacement, DoorPartType, HingeSide, PanelType, RawToolGroup } from '../types.js';

interface DoorEditorToolbarProps {
  // Material/texture
  activeTextureCategory: 'painted' | 'primed' | 'raw' | 'sanded';
  onTextureCategoryChange: (cat: 'painted' | 'primed' | 'raw' | 'sanded') => void;
  selectedTextures: { painted: string | null; primed: string | null; raw: string | null; sanded: string | null };

  // Front panel type
  frontPanelType: PanelType;
  onFrontPanelTypeChange: (type: PanelType) => void;

  // Style (= front tool group)
  frontGroupId: number | null;
  onFrontGroupChange: (id: number | null) => void;
  panelToolGroups: RawToolGroup[];

  // Edge tool group
  edgeGroupId: number | null;
  onEdgeGroupChange: (id: number | null) => void;
  edgeToolGroups: RawToolGroup[];

  // Back preset
  backPreset: string; // '' | 'back-route' | 'back-pocket' | 'back-bridge' | 'custom'
  onBackPresetChange: (preset: string) => void;
  customBackGroupId: number | null;
  onCustomBackGroupChange: (id: number | null) => void;

  // Door part type
  doorPartType: DoorPartType;
  onDoorPartTypeChange: (type: DoorPartType) => void;

  // Hinges (only shown when doorPartType === 'door')
  hingeSide: HingeSide;
  onHingeSideChange: (side: HingeSide) => void;
  hingeCount: number;
  onHingeCountChange: (count: number) => void;
  onHingeAdvancedClick: () => void;

  // Handle controls (Row 8)
  isKnob: boolean;
  onHandleTypeChange: (isKnob: boolean) => void;
  doorPlacement: DoorHandlePlacement;
  onDoorPlacementChange: (placement: DoorHandlePlacement) => void;
  onHandleAdvancedClick: () => void;
}

const MATERIAL_CATS = ['raw', 'sanded', 'primed', 'painted'] as const;

const PANEL_TYPES: { value: PanelType; label: string }[] = [
  { value: 'pocket', label: 'Flat Panel' },
  { value: 'raised', label: 'Raised Panel' },
  { value: 'glass', label: 'Glass' },
];

const BACK_PRESETS = [
  { value: 'back-route', label: 'Route' },
  { value: 'back-pocket', label: 'Pocket' },
  { value: 'back-bridge', label: 'Bridge' },
  { value: 'custom', label: 'Custom' },
] as const;

const DOOR_PLACEMENTS: { value: DoorHandlePlacement; label: string }[] = [
  { value: 'top', label: 'Up' },
  { value: 'bottom', label: 'Down' },
  { value: 'middle', label: 'Center' },
  { value: 'center-top', label: 'Top Rail' },
];

const DOOR_TYPES: { value: DoorPartType; label: string }[] = [
  { value: 'door', label: 'Door' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'reduced-rail', label: 'Reduced' },
  { value: 'slab', label: 'Slab' },
  { value: 'end-panel', label: 'End Panel' },
];

export function DoorEditorToolbar({
  activeTextureCategory, onTextureCategoryChange, selectedTextures,
  frontPanelType, onFrontPanelTypeChange,
  frontGroupId, onFrontGroupChange, panelToolGroups,
  edgeGroupId, onEdgeGroupChange, edgeToolGroups,
  backPreset, onBackPresetChange, customBackGroupId, onCustomBackGroupChange,
  doorPartType, onDoorPartTypeChange,
  hingeSide, onHingeSideChange, hingeCount, onHingeCountChange, onHingeAdvancedClick,
  isKnob, onHandleTypeChange, doorPlacement, onDoorPlacementChange, onHandleAdvancedClick,
}: DoorEditorToolbarProps) {
  const [showPlacementPopup, setShowPlacementPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    if (!showPlacementPopup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPlacementPopup(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPlacementPopup]);

  return (
    <div style={containerStyle}>
      {/* Row 1: Material buttons */}
      <div style={rowStyle}>
        {MATERIAL_CATS.map((cat) => {
          const isActive = activeTextureCategory === cat;
          const hasTexture = selectedTextures[cat] !== null;
          return (
            <button
              key={cat}
              onClick={() => onTextureCategoryChange(cat)}
              style={{
                ...btnBase,
                flex: 1,
                justifyContent: 'center',
                ...(isActive ? btnActive : {}),
                ...(!isActive && !hasTexture ? { color: '#999' } : {}),
                textTransform: 'capitalize',
              }}
              title={hasTexture ? selectedTextures[cat]! : `No ${cat} texture selected`}
            >
              {isActive ? '\u2713 ' : ''}{cat}
            </button>
          );
        })}
      </div>

      {/* Row 2: Front panel type buttons */}
      <div style={rowStyle}>
        {PANEL_TYPES.map(({ value, label }) => {
          const isActive = frontPanelType === value;
          return (
            <button
              key={value}
              onClick={() => onFrontPanelTypeChange(value)}
              style={{
                ...btnBase,
                flex: 1,
                justifyContent: 'center',
                ...(isActive ? btnActive : {}),
              }}
            >
              {isActive ? '\u2713 ' : ''}{label}
            </button>
          );
        })}
      </div>

      {/* Row 3: Style dropdown + Edit + Star */}
      <div style={rowStyle}>
        <select
          value={frontGroupId ?? ''}
          onChange={(e) => onFrontGroupChange(e.target.value ? Number(e.target.value) : null)}
          style={{ ...selectStyle, flex: 1 }}
          title="Door Style (Front Tool Group)"
        >
          <option value="">-- Style --</option>
          {panelToolGroups.map((g) => (
            <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
          ))}
        </select>
        <button style={btnBase} title="Edit style construction">
          Edit
        </button>
        <button style={{ ...btnBase, fontSize: '13px' }} title="Add to favorites">
          {'\u2605'}
        </button>
      </div>

      {/* Row 4: Edge dropdown (full width) */}
      <select
        value={edgeGroupId ?? ''}
        onChange={(e) => onEdgeGroupChange(e.target.value ? Number(e.target.value) : null)}
        style={selectStyle}
        title="Edge Profile"
      >
        <option value="">Edge: None</option>
        {edgeToolGroups.map((g) => (
          <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
        ))}
      </select>

      {/* Row 5: Back preset buttons */}
      <div style={rowStyle}>
        {BACK_PRESETS.map(({ value, label }) => {
          const isActive = backPreset === value;
          return (
            <button
              key={value}
              onClick={() => onBackPresetChange(isActive ? '' : value)}
              style={{
                ...btnBase,
                flex: 1,
                justifyContent: 'center',
                padding: '3px 5px',
                fontSize: '10px',
                ...(isActive ? btnActive : {}),
              }}
            >
              {label}
            </button>
          );
        })}
        {/* None / clear button */}
        <button
          onClick={() => onBackPresetChange('')}
          style={{
            ...btnBase,
            padding: '3px 5px',
            fontSize: '10px',
            ...(backPreset === '' ? btnActive : {}),
          }}
          title="No back profile"
        >
          {'\u2298'}
        </button>
      </div>

      {/* Row 5b: Custom tool group dropdown (only when Custom is selected) */}
      {backPreset === 'custom' && (
        <select
          value={customBackGroupId ?? ''}
          onChange={(e) => onCustomBackGroupChange(e.target.value ? Number(e.target.value) : null)}
          style={selectStyle}
          title="Custom Back Tool Group"
        >
          <option value="">-- Select Tool Group --</option>
          {panelToolGroups.map((g) => (
            <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
          ))}
        </select>
      )}

      {/* Row 6: Door type buttons */}
      <div style={rowStyle}>
        {DOOR_TYPES.map(({ value, label }) => {
          const isActive = doorPartType === value;
          return (
            <button
              key={value}
              onClick={() => onDoorPartTypeChange(value)}
              style={{
                ...btnBase,
                flex: 1,
                justifyContent: 'center',
                ...(isActive ? btnActive : {}),
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Row 7: Hinge controls (only for doors) */}
      {doorPartType === 'door' && (
        <div style={rowStyle}>
          <button
            onClick={() => onHingeSideChange('left')}
            style={{
              ...btnBase,
              flex: 1,
              justifyContent: 'center',
              ...(hingeSide === 'left' ? btnActive : {}),
            }}
          >
            Left
          </button>
          <button
            onClick={() => onHingeSideChange('right')}
            style={{
              ...btnBase,
              flex: 1,
              justifyContent: 'center',
              ...(hingeSide === 'right' ? btnActive : {}),
            }}
          >
            Right
          </button>
          <input
            type="number"
            value={hingeCount}
            min={2}
            max={5}
            onChange={(e) => onHingeCountChange(Math.max(2, Math.min(5, Number(e.target.value))))}
            style={{ ...selectStyle, width: 44, textAlign: 'center' }}
            title="Hinge quantity"
          />
          <button
            onClick={onHingeAdvancedClick}
            style={{ ...btnBase, fontSize: '10px', padding: '3px 6px' }}
            title="Advanced hinge settings"
          >
            Adv
          </button>
        </div>
      )}

      {/* Row 8: Handle / Knob controls */}
      <div style={rowStyle}>
        <button
          onClick={() => onHandleTypeChange(false)}
          style={{
            ...btnBase,
            flex: 1,
            justifyContent: 'center',
            ...(!isKnob ? btnActive : {}),
          }}
        >
          Handle
        </button>
        <button
          onClick={() => onHandleTypeChange(true)}
          style={{
            ...btnBase,
            flex: 1,
            justifyContent: 'center',
            ...(isKnob ? btnActive : {}),
          }}
        >
          Knob
        </button>

        {/* Placement popup button (door type only) */}
        {doorPartType === 'door' && (
          <div ref={popupRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPlacementPopup(prev => !prev)}
              style={{
                ...btnBase,
                fontSize: '10px',
                padding: '3px 6px',
                minWidth: 56,
              }}
              title="Handle placement"
            >
              {DOOR_PLACEMENTS.find(p => p.value === doorPlacement)?.label ?? 'Up'}
              {' \u25BE'}
            </button>
            {showPlacementPopup && (
              <div style={popupPanelStyle}>
                {DOOR_PLACEMENTS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => {
                      onDoorPlacementChange(value);
                      setShowPlacementPopup(false);
                    }}
                    style={{
                      ...btnBase,
                      width: '100%',
                      justifyContent: 'center',
                      ...(doorPlacement === value ? btnActive : {}),
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onHandleAdvancedClick}
          style={{ ...btnBase, fontSize: '10px', padding: '3px 6px' }}
          title="Advanced handle settings"
        >
          Adv
        </button>
      </div>
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: 6,
  padding: 6,
  border: '1px solid #ccc',
  backdropFilter: 'blur(4px)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

const btnBase: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
};

const btnActive: React.CSSProperties = {
  background: '#0088cc',
  color: '#fff',
  borderColor: '#0077b3',
};

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: '11px',
  cursor: 'pointer',
  width: '100%',
};

const popupPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 2,
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'rgba(255, 255, 255, 0.97)',
  borderRadius: 4,
  padding: 4,
  border: '1px solid #999',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  minWidth: 70,
};
