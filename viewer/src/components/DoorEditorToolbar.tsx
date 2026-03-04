import { useState, useEffect, useRef } from 'react';
import type { DoorHandlePlacement, DoorPartType, HingeSide, PanelType, RawToolGroup } from '../types.js';
import { CommitNumberInput } from './CommitNumberInput.js';

interface DoorEditorToolbarProps {
  // Material/texture
  activeTextureCategory: 'painted' | 'primed' | 'raw' | 'sanded';
  onTextureCategoryChange: (cat: 'painted' | 'primed' | 'raw' | 'sanded') => void;
  selectedTextures: { painted: string | null; primed: string | null; raw: string | null; sanded: string | null };
  availableTextureCategories: ('painted' | 'primed' | 'raw' | 'sanded')[];

  // Front panel type
  frontPanelType: PanelType;
  onFrontPanelTypeChange: (type: PanelType) => void;

  // Style (config database)
  configStyles: { id: string; name: string }[];
  selectedConfigStyleId: string | null;
  onConfigStyleChange: (id: string | null) => void;
  onEditStyleClick: () => void;

  // Panel tool groups (used for back custom dropdown)
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
  hingeEnabled: boolean;
  onHingeEnabledChange: (enabled: boolean) => void;
  hingeSide: HingeSide;
  onHingeSideChange: (side: HingeSide) => void;
  hingeCount: number;
  onHingeCountChange: (count: number) => void;
  onHingeAdvancedClick: () => void;

  // Handle controls
  handleEnabled: boolean;
  onHandleEnabledChange: (enabled: boolean) => void;
  isKnob: boolean;
  onHandleTypeChange: (isKnob: boolean) => void;
  doorPlacement: DoorHandlePlacement;
  onDoorPlacementChange: (placement: DoorHandlePlacement) => void;
  onHandleAdvancedClick: () => void;

  // Dimensions
  doorW: number;
  doorH: number;
  thickness: number;
  onDoorWChange: (v: number) => void;
  onDoorHChange: (v: number) => void;
  onThicknessChange: (v: number) => void;

  // Units
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;

  // Export
  onExport: () => void;

  // Order quantity
  orderQty: number;
  onOrderQtyChange: (qty: number) => void;

  // Add to Order
  onAddToOrder: () => void;

  // Hardware warnings
  hardwareWarnings: { severity: string; message: string }[];

  // Paint color picker (only used when activeTextureCategory === 'painted')
  paintManifest?: Record<string, string[]>;
  textureBlobUrls?: Record<string, string>;
  onPaintColorSelect?: (path: string, blobUrl: string | null) => void;

  // Config-based filters (hide options not enabled in selected style)
  filteredPanelTypes?: { value: PanelType; label: string }[];
  filteredBackPresets?: { value: string; label: string }[];
  filteredDoorTypes?: { value: DoorPartType; label: string }[];

  // Configured back groups (from config database)
  backRouteGroups: Array<{ groupId: number; depth: number; groupName: string }>;
  backPocketGroups: Array<{ groupId: number; depth: number; groupName: string }>;
  backCustomGroups: Array<{ groupId: number; depth: number; groupName: string }>;
  onBackRouteGroupSelect: (groupId: number, depth: number) => void;
  onBackPocketGroupSelect: (groupId: number, depth: number) => void;
  onBackCustomGroupSelect: (groupId: number, depth: number) => void;
}

const MATERIAL_CATS = ['raw', 'sanded', 'primed', 'painted'] as const;

export const PANEL_TYPES: { value: PanelType; label: string }[] = [
  { value: 'pocket', label: 'Flat Panel' },
  { value: 'raised', label: 'Raised Panel' },
  { value: 'glass', label: 'Glass' },
];

export const BACK_PRESETS = [
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

export const DOOR_TYPES: { value: DoorPartType; label: string }[] = [
  { value: 'door', label: 'Door' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'reduced-rail', label: 'Reduced' },
  { value: 'slab', label: 'Slab' },
  { value: 'end-panel', label: 'End Panel' },
];

export function DoorEditorToolbar({
  activeTextureCategory, onTextureCategoryChange, selectedTextures, availableTextureCategories,
  frontPanelType, onFrontPanelTypeChange,
  configStyles, selectedConfigStyleId, onConfigStyleChange, onEditStyleClick,
  panelToolGroups,
  edgeGroupId, onEdgeGroupChange, edgeToolGroups,
  backPreset, onBackPresetChange, customBackGroupId, onCustomBackGroupChange,
  doorPartType, onDoorPartTypeChange,
  hingeEnabled, onHingeEnabledChange, hingeSide, onHingeSideChange, hingeCount, onHingeCountChange, onHingeAdvancedClick,
  handleEnabled, onHandleEnabledChange, isKnob, onHandleTypeChange, doorPlacement, onDoorPlacementChange, onHandleAdvancedClick,
  doorW, doorH, thickness, onDoorWChange, onDoorHChange, onThicknessChange,
  toDisplay, fromDisplay, inputStep,
  onExport, onAddToOrder, orderQty, onOrderQtyChange, hardwareWarnings,
  filteredPanelTypes, filteredBackPresets, filteredDoorTypes,
  backRouteGroups, backPocketGroups, backCustomGroups, onBackRouteGroupSelect, onBackPocketGroupSelect, onBackCustomGroupSelect,
  paintManifest, textureBlobUrls, onPaintColorSelect,
}: DoorEditorToolbarProps) {
  const [showPlacementPopup, setShowPlacementPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const [showPaintDropdown, setShowPaintDropdown] = useState(false);
  const paintDropdownRef = useRef<HTMLDivElement>(null);
  const isSlab = doorPartType === 'slab';

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

  // Close paint dropdown when clicking outside
  useEffect(() => {
    if (!showPaintDropdown) return;
    const handler = (e: MouseEvent) => {
      if (paintDropdownRef.current && !paintDropdownRef.current.contains(e.target as Node)) {
        setShowPaintDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPaintDropdown]);

  const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>Data Entry</div>

      {/* Section 1: Finish */}
      <div style={rowStyle}>
        <span style={sectionNum}>1</span>
        <span style={sectionLabel}>Finish</span>
        {MATERIAL_CATS.filter(cat => availableTextureCategories.includes(cat)).map((cat) => {
          const isActive = activeTextureCategory === cat;
          const hasTexture = selectedTextures[cat] !== null;
          return (
            <button
              key={cat}
              onClick={() => onTextureCategoryChange(cat)}
              style={{
                ...btnBase,
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
        {/* Paint color picker — shown when painted is active and manifest is available */}
        {activeTextureCategory === 'painted' && paintManifest && Object.keys(paintManifest).length > 0 && (
          <div ref={paintDropdownRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
              onClick={() => setShowPaintDropdown(p => !p)}
              style={{ ...btnBase, ...(showPaintDropdown ? btnActive : {}), display: 'flex', alignItems: 'center', gap: 3, padding: '2px 5px' }}
              title="Select paint color"
            >
              {selectedTextures.painted && textureBlobUrls?.[selectedTextures.painted] ? (
                <img src={textureBlobUrls[selectedTextures.painted]} style={{ width: 14, height: 14, borderRadius: 2, objectFit: 'cover', border: '1px solid #ccc', flexShrink: 0 }} alt="" />
              ) : (
                <span style={{ width: 14, height: 14, borderRadius: 2, background: '#ddd', display: 'inline-block', border: '1px solid #ccc', flexShrink: 0 }} />
              )}
              <span style={{ maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
                {selectedTextures.painted ? stripExt(selectedTextures.painted.split('/').pop() ?? '') : '— color —'}
              </span>
              <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
            </button>
            {showPaintDropdown && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 200,
                background: '#fff', border: '1px solid #bbb', borderRadius: 4,
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                minWidth: 210, maxHeight: 320, overflowY: 'auto',
                padding: '4px 0',
              }}>
                {Object.entries(paintManifest).sort(([a], [b]) => a.localeCompare(b)).map(([brand, files]) => (
                  <div key={brand}>
                    <div style={{ padding: '4px 8px 2px', fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f5f5f7', borderBottom: '1px solid #e8e8e8' }}>
                      {brand}
                    </div>
                    {files.map(filename => {
                      const path = `Painted/${brand}/${filename}`;
                      const blobUrl = textureBlobUrls?.[path] ?? null;
                      const colorName = stripExt(filename);
                      const isActive = selectedTextures.painted === path;
                      return (
                        <div
                          key={path}
                          onClick={() => { onPaintColorSelect?.(path, blobUrl); setShowPaintDropdown(false); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 10, background: isActive ? 'rgba(0,136,204,0.08)' : 'transparent', fontWeight: isActive ? 600 : 400 }}
                          onMouseEnter={e => (e.currentTarget.style.background = isActive ? 'rgba(0,136,204,0.12)' : '#f0f4f8')}
                          onMouseLeave={e => (e.currentTarget.style.background = isActive ? 'rgba(0,136,204,0.08)' : 'transparent')}
                        >
                          {blobUrl ? (
                            <img src={blobUrl} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover', border: '1px solid #ddd', flexShrink: 0 }} alt="" />
                          ) : (
                            <span style={{ width: 16, height: 16, borderRadius: 2, background: '#e8e8e8', display: 'inline-block', border: '1px solid #ddd', flexShrink: 0 }} />
                          )}
                          {colorName}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={sectionDivider} />

      {/* Section 2: Panel Type */}
      {!isSlab && (<>
        <div style={rowStyle}>
          <span style={sectionNum}>2</span>
          <span style={sectionLabel}>Panel Type</span>
          {(filteredPanelTypes ?? PANEL_TYPES).map(({ value, label }) => {
            const isActive = frontPanelType === value;
            return (
              <button
                key={value}
                onClick={() => onFrontPanelTypeChange(value)}
                style={{
                  ...btnBase,
                  ...(isActive ? btnActive : {}),
                }}
              >
                {isActive ? '\u2713 ' : ''}{label}
              </button>
            );
          })}
        </div>
        <div style={sectionDivider} />
      </>)}

      {/* Section 3: Style */}
      {!isSlab && (<>
        <div style={rowStyle}>
          <span style={sectionNum}>3</span>
          <span style={sectionLabel}>Style</span>
          <select
            value={selectedConfigStyleId ?? ''}
            onChange={(e) => onConfigStyleChange(e.target.value || null)}
            style={{ ...selectStyle, flex: 1 }}
            title="Door style (from Configure database)"
          >
            <option value="">-- Select Style --</option>
            {configStyles.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            style={{ ...btnBase, flex: 'none' }}
            title="Edit style configuration"
            onClick={onEditStyleClick}
          >
            Edit
          </button>
        </div>
        <div style={sectionDivider} />
      </>)}

      {/* Section 4: Edge Type */}
      {!isSlab && (<>
        <div style={rowStyle}>
          <span style={sectionNum}>4</span>
          <span style={sectionLabel}>Edge Type</span>
          <select
            value={edgeGroupId ?? ''}
            onChange={(e) => onEdgeGroupChange(e.target.value ? Number(e.target.value) : null)}
            style={{ ...selectStyle, flex: 1 }}
            title="Edge Profile"
          >
            <option value="">None</option>
            {edgeToolGroups.map((g) => (
              <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
            ))}
          </select>
        </div>
        <div style={sectionDivider} />
      </>)}

      {/* Section 5: Back Type */}
      {!isSlab && (<>
        <div style={rowStyle}>
          <span style={sectionNum}>5</span>
          <span style={sectionLabel}>Back Type</span>
          {BACK_PRESETS.map(({ value, label }) => {
            if (filteredBackPresets && !filteredBackPresets.some(bp => bp.value === value)) return null;
            const isActive = backPreset === value;
            return (
              <button
                key={value}
                onClick={() => onBackPresetChange(isActive ? '' : value)}
                style={{
                  ...btnBase,
                  padding: '3px 5px',
                  fontSize: '10px',
                  ...(isActive ? btnActive : {}),
                }}
              >
                {isActive ? '\u2713 ' : ''}{label}
              </button>
            );
          })}
          {(!filteredBackPresets || filteredBackPresets.some(bp => bp.value === 'none')) && (
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
              {backPreset === '' ? '\u2713 ' : ''}{'\u2298'}
            </button>
          )}
        </div>
        {/* Sub-dropdown for Route preset */}
        {backPreset === 'back-route' && backRouteGroups.length > 0 && (
          <div style={{ ...rowStyle, paddingLeft: 64 }}>
            <select
              value={customBackGroupId ?? ''}
              onChange={(e) => {
                if (!e.target.value) { onCustomBackGroupChange(null); return; }
                const groupId = Number(e.target.value);
                const entry = backRouteGroups.find(g => g.groupId === groupId);
                if (entry) onBackRouteGroupSelect(groupId, entry.depth);
              }}
              style={{ ...selectStyle, flex: 1 }}
              title="Back Route Tool Group"
            >
              <option value="">-- Select Route Group --</option>
              {backRouteGroups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupName} ({g.depth.toFixed(2)}mm)
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Sub-dropdown for Pocket preset */}
        {backPreset === 'back-pocket' && backPocketGroups.length > 0 && (
          <div style={{ ...rowStyle, paddingLeft: 64 }}>
            <select
              value={customBackGroupId ?? ''}
              onChange={(e) => {
                if (!e.target.value) { onCustomBackGroupChange(null); return; }
                const groupId = Number(e.target.value);
                const entry = backPocketGroups.find(g => g.groupId === groupId);
                if (entry) onBackPocketGroupSelect(groupId, entry.depth);
              }}
              style={{ ...selectStyle, flex: 1 }}
              title="Back Pocket Tool Group"
            >
              <option value="">-- Select Pocket Group --</option>
              {backPocketGroups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupName} ({g.depth.toFixed(2)}mm)
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Sub-dropdown for Custom preset (configured groups) */}
        {backPreset === 'custom' && backCustomGroups.length > 0 && (
          <div style={{ ...rowStyle, paddingLeft: 64 }}>
            <select
              value={customBackGroupId ?? ''}
              onChange={(e) => {
                if (!e.target.value) { onCustomBackGroupChange(null); return; }
                const groupId = Number(e.target.value);
                const entry = backCustomGroups.find(g => g.groupId === groupId);
                if (entry) onBackCustomGroupSelect(groupId, entry.depth);
              }}
              style={{ ...selectStyle, flex: 1 }}
              title="Custom Back Tool Group"
            >
              <option value="">-- Select Tool Group --</option>
              {backCustomGroups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupName} ({g.depth.toFixed(2)}mm)
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Fallback: Custom with no configured groups shows ALL panel groups */}
        {backPreset === 'custom' && backCustomGroups.length === 0 && (
          <div style={{ ...rowStyle, paddingLeft: 64 }}>
            <select
              value={customBackGroupId ?? ''}
              onChange={(e) => onCustomBackGroupChange(e.target.value ? Number(e.target.value) : null)}
              style={{ ...selectStyle, flex: 1 }}
              title="Custom Back Tool Group"
            >
              <option value="">-- Select Tool Group --</option>
              {panelToolGroups.map((g) => (
                <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={sectionDivider} />
      </>)}

      {/* Section 6: Door Type */}
      <div style={rowStyle}>
        <span style={sectionNum}>6</span>
        <span style={sectionLabel}>Door Type</span>
        {(filteredDoorTypes ?? DOOR_TYPES).map(({ value, label }) => {
          const isActive = doorPartType === value;
          return (
            <button
              key={value}
              onClick={() => onDoorPartTypeChange(value)}
              style={{
                ...btnBase,
                ...(isActive ? btnActive : {}),
              }}
            >
              {isActive ? '\u2713 ' : ''}{label}
            </button>
          );
        })}
      </div>
      <div style={sectionDivider} />

      {/* Section 7: Hinges */}
      {doorPartType === 'door' && (<>
        <div style={rowStyle}>
          <span style={sectionNum}>7</span>
          <span style={sectionLabel}>Hinges</span>
          <button
            onClick={() => onHingeEnabledChange(false)}
            style={{
              ...btnBase,
              ...(!hingeEnabled ? btnActive : {}),
            }}
          >
            {!hingeEnabled ? '\u2713 ' : ''}None
          </button>
          <button
            onClick={() => { onHingeEnabledChange(true); onHingeSideChange('left'); }}
            style={{
              ...btnBase,
              ...(hingeEnabled && hingeSide === 'left' ? btnActive : {}),
            }}
          >
            {hingeEnabled && hingeSide === 'left' ? '\u2713 ' : ''}Left
          </button>
          <button
            onClick={() => { onHingeEnabledChange(true); onHingeSideChange('right'); }}
            style={{
              ...btnBase,
              ...(hingeEnabled && hingeSide === 'right' ? btnActive : {}),
            }}
          >
            {hingeEnabled && hingeSide === 'right' ? '\u2713 ' : ''}Right
          </button>
          {hingeEnabled && (
            <input
              type="number"
              value={hingeCount}
              min={2}
              max={6}
              onChange={(e) => onHingeCountChange(Math.max(2, Math.min(6, Number(e.target.value))))}
              onFocus={(e) => e.currentTarget.select()}
              style={{ ...numInputStyle, width: 44, textAlign: 'center' }}
              title="Hinge quantity"
            />
          )}
          <button
            onClick={onHingeAdvancedClick}
            style={{ ...btnBase, fontSize: '10px', padding: '3px 6px', flex: 'none' }}
            title="Advanced hinge settings"
          >
            Adv
          </button>
        </div>
        <div style={sectionDivider} />
      </>)}

      {/* Section 8: Handles */}
      <div style={rowStyle}>
        <span style={sectionNum}>8</span>
        <span style={sectionLabel}>Handles</span>
        <button
          onClick={() => onHandleEnabledChange(false)}
          style={{
            ...btnBase,
            ...(!handleEnabled ? btnActive : {}),
          }}
        >
          {!handleEnabled ? '\u2713 ' : ''}None
        </button>
        <button
          onClick={() => { onHandleEnabledChange(true); onHandleTypeChange(false); }}
          style={{
            ...btnBase,
            ...(handleEnabled && !isKnob ? btnActive : {}),
          }}
        >
          {handleEnabled && !isKnob ? '\u2713 ' : ''}Handle
        </button>
        <button
          onClick={() => { onHandleEnabledChange(true); onHandleTypeChange(true); }}
          style={{
            ...btnBase,
            ...(handleEnabled && isKnob ? btnActive : {}),
          }}
        >
          {handleEnabled && isKnob ? '\u2713 ' : ''}Knob
        </button>

        {/* Placement popup only when handles enabled */}
        {handleEnabled && doorPartType === 'door' && (
          <div ref={popupRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPlacementPopup(prev => !prev)}
              style={{
                ...btnBase,
                fontSize: '10px',
                padding: '3px 6px',
                minWidth: 56,
                flex: 'none',
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
          style={{ ...btnBase, fontSize: '10px', padding: '3px 6px', flex: 'none' }}
          title="Advanced handle settings"
        >
          Adv
        </button>
      </div>

      <div style={sectionDivider} />

      {/* Section 9: Size */}
      <div style={rowStyle}>
        <span style={sectionNum}>9</span>
        <span style={sectionLabel}>Size</span>
        <label style={sizeDimLabel}>W</label>
        <CommitNumberInput value={toDisplay(doorW)} step={inputStep} min={0}
          onCommit={(v) => onDoorWChange(fromDisplay(v))}
          style={sizeInputStyle} />
        <label style={sizeDimLabel}>H</label>
        <CommitNumberInput value={toDisplay(doorH)} step={inputStep} min={0}
          onCommit={(v) => onDoorHChange(fromDisplay(v))}
          style={sizeInputStyle} />
        <label style={sizeDimLabel}>T</label>
        <select
          value={String(thickness)}
          onChange={(e) => onThicknessChange(Number(e.target.value))}
          style={sizeSelectStyle}
        >
          <option value="19.05">3/4&quot;</option>
          <option value="22.225">7/8&quot;</option>
          <option value="25.4">1&quot;</option>
        </select>
      </div>

      <div style={sectionDivider} />

      {/* Section 10: Price */}
      <div style={rowStyle}>
        <span style={sectionNum}>10</span>
        <span style={sectionLabel}>Price</span>
        <span style={{ ...inlineLabel, marginLeft: 'auto', color: '#999' }}>{'\u2014'}</span>
      </div>
      <div style={sectionDivider} />

      {/* Section 11: QTY */}
      <div style={rowStyle}>
        <span style={sectionNum}>11</span>
        <span style={sectionLabel}>Qty</span>
        <CommitNumberInput
          value={orderQty}
          step={1}
          min={1}
          onCommit={onOrderQtyChange}
          style={{ ...sizeInputStyle, width: 52 }}
        />
      </div>
      <div style={sectionDivider} />

      {/* Add to Order */}
      <button onClick={onAddToOrder} style={addToOrderBtnStyle}>Add to Order</button>

      {/* Export + Warnings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onExport} style={exportBtnStyle}>Export</button>
        {hardwareWarnings.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
            {hardwareWarnings.map((w, i) => (
              <span key={i} style={{
                color: w.severity === 'error' ? '#cc3333' : '#cc7700',
                fontSize: '10px',
              }}>
                {w.severity === 'error' ? '\u2718' : '\u26A0'} {w.message}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  background: 'rgba(255, 255, 255, 0.95)',
  padding: 6,
  borderBottom: '1px solid #ccc',
  flexShrink: 0,
  overflowY: 'auto',
  minHeight: '100%',
};

const headerStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#333',
  textAlign: 'center',
  paddingBottom: 6,
  borderBottom: '1px solid #ddd',
  marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  width: '100%',
};

const btnBase: React.CSSProperties = {
  padding: '4px 10px',
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
  flex: 1,
  minWidth: 0,
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

const numInputStyle: React.CSSProperties = {
  width: 54,
  padding: '3px 4px',
  borderRadius: 3,
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: 11,
  flexShrink: 0,
};

const inlineLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#666',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #ddd',
  margin: '2px 0',
};

const exportBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid #0077b3',
  background: '#0088cc',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
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

const sectionNum: React.CSSProperties = {
  ...btnBase,
  flex: 'none',
  width: 22,
  padding: '2px 0',
  fontSize: '10px',
  cursor: 'default',
  pointerEvents: 'none',
  background: '#fff',
  color: '#666',
  fontWeight: 700,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#666',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  minWidth: 52,
};

const sectionDivider: React.CSSProperties = {
  borderTop: '1px solid #cce0f0',
  margin: '2px 0',
};

// --- Size section ---

const sizeDimLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#555',
  flexShrink: 0,
};

const sizeInputStyle: React.CSSProperties = {
  width: 80,
  padding: '6px 8px',
  borderRadius: 4,
  border: '2px solid #0088cc',
  background: '#fff',
  color: '#222',
  fontSize: 18,
  fontWeight: 600,
  flexShrink: 0,
};

const sizeSelectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '2px solid #0088cc',
  background: '#fff',
  color: '#222',
  fontSize: 18,
  fontWeight: 600,
  cursor: 'pointer',
  width: 80,
  flexShrink: 0,
};

const addToOrderBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 16px',
  borderRadius: 4,
  border: '1px solid #0077b3',
  background: '#0088cc',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  letterSpacing: '0.5px',
};
