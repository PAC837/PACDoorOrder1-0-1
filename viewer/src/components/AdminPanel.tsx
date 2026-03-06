import { useState, useEffect, useCallback, useRef } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { TextureManifest, UnitSystem } from '../types.js';
import type { ViewerSettings } from '../hooks/useViewerSettings.js';
import type { ColumnDef } from '../hooks/useOrderColumns.js';
import { DEFAULT_COLUMNS } from '../hooks/useOrderColumns.js';
import type { WatermarkConfig } from '../hooks/useWatermarkConfig.js';
import type { GroupByField } from '../hooks/useGroupByConfig.js';
import { DEFAULT_GROUP_BY } from '../hooks/useGroupByConfig.js';
import type { ToolsStatus, ScannedTextures, ParseResult } from '../utils/folderAccess.js';
import {
  pickFolder, saveHandle, getHandle, verifyPermission,
  scanToolsFolder, scanLibrariesFolder, scanTexturesFolder,
  revokeTextureUrls, loadLibraryData,
} from '../utils/folderAccess.js';

interface SelectedTextures {
  painted: string | null;
  primed: string | null;
  raw: string | null;
  sanded: string | null;
}

interface AdminPanelProps {
  onDataReloaded: () => void;
  selectedTextures: SelectedTextures;
  onTextureSelected: (category: string, texturePath: string | null, blobUrl: string | null) => void;
  onLibrariesChanged: (libraries: string[]) => void;
  textureManifest: TextureManifest | null;
  onTextureManifestChanged: (manifest: TextureManifest | null) => void;
  columns: ColumnDef[];
  onColumnsChange: (cols: ColumnDef[]) => void;
  groupByFields: GroupByField[];
  onGroupByChange: (fields: GroupByField[]) => void;
  watermarkConfig: WatermarkConfig;
  onWatermarkChange: (cfg: WatermarkConfig) => void;
  units: UnitSystem;
  onUnitsChange: (u: UnitSystem) => void;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: (settings: ViewerSettings) => void;
}

interface LoadStats {
  doorsCount: number;
  toolGroupsCount: number;
  toolsCount: number;
  cncDoorsCount: number;
  profilesCount: number;
}

function autoSelectTextures(
  manifest: TextureManifest,
  blobUrls: Map<string, string>,
  onTextureSelected: (category: string, path: string | null, blobUrl: string | null) => void,
) {
  // Painted — first file from first brand (alphabetical)
  const brands = Object.entries(manifest.painted).sort(([a], [b]) => a.localeCompare(b));
  if (brands.length > 0) {
    const [brand, files] = brands[0];
    if (files.length > 0) {
      const path = `Painted/${brand}/${files[0]}`;
      onTextureSelected('painted', path, blobUrls.get(path) ?? null);
    }
  }
  // Flat categories
  for (const cat of ['primed', 'raw', 'sanded'] as const) {
    const cap = cat.charAt(0).toUpperCase() + cat.slice(1);
    if (manifest[cat].length > 0) {
      const path = `${cap}/${manifest[cat][0]}`;
      onTextureSelected(cat, path, blobUrls.get(path) ?? null);
    }
  }
}

export function AdminPanel({ onDataReloaded, selectedTextures, onTextureSelected, onLibrariesChanged, textureManifest, onTextureManifestChanged, columns, onColumnsChange, groupByFields, onGroupByChange, watermarkConfig, onWatermarkChange, units, onUnitsChange, viewerSettings, onViewerSettingsChange }: AdminPanelProps) {
  // Folder handles (from IndexedDB or fresh pick)
  const [toolsHandle, setToolsHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [librariesHandle, setLibrariesHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [texturesHandle, setTexturesHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Folder display names
  const [toolsName, setToolsName] = useState<string | null>(null);
  const [librariesName, setLibrariesName] = useState<string | null>(null);
  const [texturesName, setTexturesName] = useState<string | null>(null);

  // Validation / scan results
  const [toolsStatus, setToolsStatus] = useState<ToolsStatus | null>(null);
  const [librariesList, setLibrariesList] = useState<string[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const textureBlobUrlsRef = useRef<Map<string, string>>(new Map());

  // Load state
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Order Columns section
  const [colSectionOpen, setColSectionOpen] = useState(false);
  const [showAddColForm, setShowAddColForm] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');

  // Order Grouping section
  const [groupSectionOpen, setGroupSectionOpen] = useState(false);

  // Cross Section section
  const [csSectionOpen, setCsSectionOpen] = useState(false);
  const [viewerSectionOpen, setViewerSectionOpen] = useState(false);

  const handleGroupDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = groupByFields.findIndex(f => f.id === active.id);
      const newIndex = groupByFields.findIndex(f => f.id === over.id);
      onGroupByChange(arrayMove(groupByFields, oldIndex, newIndex));
    }
  }, [groupByFields, onGroupByChange]);

  const handleGroupVisToggle = useCallback((id: string) => {
    onGroupByChange(groupByFields.map(f => f.id === id ? { ...f, active: !f.active } : f));
  }, [groupByFields, onGroupByChange]);

  const handleColDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex(c => c.id === active.id);
      const newIndex = columns.findIndex(c => c.id === over.id);
      onColumnsChange(arrayMove(columns, oldIndex, newIndex));
    }
  }, [columns, onColumnsChange]);

  const handleColVisToggle = useCallback((id: string) => {
    onColumnsChange(columns.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  }, [columns, onColumnsChange]);

  const handleColLabelChange = useCallback((id: string, label: string) => {
    onColumnsChange(columns.map(c => c.id === id ? { ...c, label } : c));
  }, [columns, onColumnsChange]);

  // Restore saved handles from IndexedDB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Tools
      const tools = await getHandle('tools');
      if (cancelled) return;
      if (tools && (await tools.queryPermission({ mode: 'read' })) === 'granted') {
        setToolsHandle(tools);
        setToolsName(tools.name);
        setToolsStatus(await scanToolsFolder(tools));
      }

      // Libraries
      const libs = await getHandle('libraries');
      if (cancelled) return;
      if (libs && (await libs.queryPermission({ mode: 'read' })) === 'granted') {
        setLibrariesHandle(libs);
        setLibrariesName(libs.name);
        const list = await scanLibrariesFolder(libs);
        setLibrariesList(list);
        onLibrariesChanged(list);
      }

      // Textures
      const tex = await getHandle('textures');
      if (cancelled) return;
      if (tex && (await tex.queryPermission({ mode: 'read' })) === 'granted') {
        setTexturesHandle(tex);
        setTexturesName(tex.name);
        const result = await scanTexturesFolder(tex);
        if (result) {
          onTextureManifestChanged(result.manifest);
          revokeTextureUrls(textureBlobUrlsRef.current);
          textureBlobUrlsRef.current = result.blobUrls;
          autoSelectTextures(result.manifest, result.blobUrls, onTextureSelected);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Browse + scan: CNC Tools
  const handleBrowseTools = useCallback(async () => {
    setError(null);
    const handle = await pickFolder();
    if (!handle) return;
    await saveHandle('tools', handle);
    setToolsHandle(handle);
    setToolsName(handle.name);
    setToolsStatus(await scanToolsFolder(handle));
  }, []);

  // Browse + scan: Libraries
  const handleBrowseLibraries = useCallback(async () => {
    setError(null);
    const handle = await pickFolder();
    if (!handle) return;
    await saveHandle('libraries', handle);
    setLibrariesHandle(handle);
    setLibrariesName(handle.name);
    const list = await scanLibrariesFolder(handle);
    setLibrariesList(list);
    onLibrariesChanged(list);
    setSelectedLibrary(null);
  }, [onLibrariesChanged]);

  // Browse + scan: Textures
  const handleBrowseTextures = useCallback(async () => {
    setError(null);
    const handle = await pickFolder();
    if (!handle) return;
    await saveHandle('textures', handle);
    setTexturesHandle(handle);
    setTexturesName(handle.name);
    const result = await scanTexturesFolder(handle);
    if (result) {
      onTextureManifestChanged(result.manifest);
      revokeTextureUrls(textureBlobUrlsRef.current);
      textureBlobUrlsRef.current = result.blobUrls;
      autoSelectTextures(result.manifest, result.blobUrls, onTextureSelected);
    } else {
      onTextureManifestChanged(null);
      setError('No "PAC Door Order" subfolder found in selected folder.');
    }
  }, []);

  // Load selected library
  const handleLoad = useCallback(async () => {
    const lib = selectedLibrary || librariesList[0];
    if (!lib) return;
    setLoading(true);
    setError(null);
    try {
      const result: ParseResult = await loadLibraryData(lib);
      if (result.success) {
        setLoadStats(result.stats!);
        setSelectedLibrary(lib);
        onDataReloaded();
      } else {
        setError(result.error || 'Load failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [selectedLibrary, librariesList, onDataReloaded]);

  // Texture selection
  const handleTextureSelect = useCallback((category: string, relPath: string) => {
    const currentSelection = selectedTextures[category as keyof SelectedTextures];
    if (currentSelection === relPath) {
      onTextureSelected(category, null, null);
    } else {
      const blobUrl = textureBlobUrlsRef.current.get(relPath) ?? null;
      onTextureSelected(category, relPath, blobUrl);
    }
  }, [selectedTextures, onTextureSelected]);

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const canLoad = toolsStatus?.allPresent && librariesList.length > 0;

  const Dot = ({ ok }: { ok: boolean }) => (
    <span style={{ color: ok ? '#4ade80' : '#f87171', marginRight: 6 }}>{'\u25CF'}</span>
  );

  return (
    <div style={styles.wrapper}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Admin - CNC Data Configuration</h2>

        {/* Display Units */}
        <div style={styles.section}>
          <label style={styles.label}>Display Units</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['in', 'mm'] as UnitSystem[]).map(u => (
              <button
                key={u}
                onClick={() => onUnitsChange(u)}
                style={{
                  ...styles.button,
                  ...(units === u ? styles.primaryButton : {}),
                  flex: 1,
                }}
              >
                {u === 'in' ? 'Inches' : 'Millimeters'}
              </button>
            ))}
          </div>
        </div>

        {/* Order Columns */}
        <div style={styles.section}>
          <div
            style={colSectionHeaderStyle}
            onClick={() => setColSectionOpen(o => !o)}
          >
            <span style={{ marginRight: 6 }}>{colSectionOpen ? '\u25BC' : '\u25B6'}</span>
            Order Columns
          </div>
          {colSectionOpen && (
            <div style={{ marginTop: 8 }}>
              <DndContext collisionDetection={closestCenter} onDragEnd={handleColDragEnd}>
                <SortableContext items={columns.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {columns.map(col => (
                    <SortableColumnRow
                      key={col.id}
                      col={col}
                      onToggleVisible={() => handleColVisToggle(col.id)}
                      onLabelChange={(label) => handleColLabelChange(col.id, label)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <button
                style={{ ...styles.button, marginTop: 8, fontSize: 11 }}
                onClick={() => onColumnsChange([...DEFAULT_COLUMNS])}
              >
                Reset to defaults
              </button>
              {/* Add custom column */}
              {!showAddColForm ? (
                <button
                  style={{ ...styles.button, marginTop: 6, fontSize: 11, borderColor: '#5577aa', color: '#aaccff' }}
                  onClick={() => { setShowAddColForm(true); setNewColLabel(''); }}
                >
                  ＋ Add Column
                </button>
              ) : (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    autoFocus
                    value={newColLabel}
                    onChange={e => setNewColLabel(e.target.value)}
                    placeholder="Column label"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newColLabel.trim()) {
                        const id = `custom_${Date.now()}`;
                        onColumnsChange([...columns, { id, label: newColLabel.trim(), visible: true, width: 80, isCustom: true }]);
                        setShowAddColForm(false);
                        setNewColLabel('');
                      }
                      if (e.key === 'Escape') { setShowAddColForm(false); setNewColLabel(''); }
                    }}
                    style={colLabelInputStyle}
                  />
                  <button
                    style={{ ...styles.button, fontSize: 11, padding: '4px 10px', borderColor: '#5577aa', color: '#aaccff' }}
                    onClick={() => {
                      if (!newColLabel.trim()) return;
                      const id = `custom_${Date.now()}`;
                      onColumnsChange([...columns, { id, label: newColLabel.trim(), visible: true, width: 80, isCustom: true }]);
                      setShowAddColForm(false);
                      setNewColLabel('');
                    }}
                  >
                    Add
                  </button>
                  <button
                    style={{ ...styles.button, fontSize: 11, padding: '4px 8px' }}
                    onClick={() => { setShowAddColForm(false); setNewColLabel(''); }}
                  >
                    ✕
                  </button>
                </div>
              )}
              {/* Remove custom columns */}
              {columns.some(c => c.isCustom) && (
                <button
                  style={{ ...styles.button, marginTop: 4, fontSize: 10, color: '#f87171', borderColor: '#cc4444' }}
                  onClick={() => onColumnsChange(columns.filter(c => !c.isCustom))}
                >
                  Remove custom columns
                </button>
              )}
            </div>
          )}
        </div>

        {/* Order Grouping */}
        <div style={styles.section}>
          <div
            style={colSectionHeaderStyle}
            onClick={() => setGroupSectionOpen(o => !o)}
          >
            <span style={{ marginRight: 6 }}>{groupSectionOpen ? '\u25BC' : '\u25B6'}</span>
            Order Grouping
          </div>
          {groupSectionOpen && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#666688', marginBottom: 6 }}>
                Drag to set priority. Checked fields create new section headers.
              </div>
              <DndContext collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
                <SortableContext items={groupByFields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  {groupByFields.map(field => (
                    <SortableGroupByRow
                      key={field.id}
                      field={field}
                      onToggleActive={() => handleGroupVisToggle(field.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <button
                style={{ ...styles.button, marginTop: 8, fontSize: 11 }}
                onClick={() => onGroupByChange([...DEFAULT_GROUP_BY])}
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>

        {/* Cross Section Watermark */}
        <div style={styles.section}>
          <div
            style={colSectionHeaderStyle}
            onClick={() => setCsSectionOpen(o => !o)}
          >
            <span style={{ marginRight: 6 }}>{csSectionOpen ? '\u25BC' : '\u25B6'}</span>
            Cross Section
          </div>
          {csSectionOpen && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#666688', marginBottom: 6 }}>
                Diagonal watermark text drawn on cross-section snapshots.
              </div>
              <label style={{ ...styles.label, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Watermark Text</label>
              <input
                type="text"
                value={watermarkConfig.text}
                onChange={e => onWatermarkChange({ ...watermarkConfig, text: e.target.value })}
                placeholder="e.g. DRAFT, CONFIDENTIAL"
                style={{ ...colLabelInputStyle, width: '100%', marginBottom: 8 }}
              />
              <label style={{ ...styles.label, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Font Size</label>
              <select
                value={watermarkConfig.size}
                onChange={e => onWatermarkChange({ ...watermarkConfig, size: e.target.value as WatermarkConfig['size'] })}
                style={{ ...styles.selectInput, fontSize: 12, padding: '6px 10px', marginBottom: 8 }}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
              <label style={{ ...styles.label, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Opacity</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0.03}
                  max={0.6}
                  step={0.01}
                  value={watermarkConfig.opacity}
                  onChange={e => onWatermarkChange({ ...watermarkConfig, opacity: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: '#5577aa' }}
                />
                <span style={{ fontSize: 11, color: '#aaaacc', minWidth: 32, textAlign: 'right' }}>
                  {Math.round(watermarkConfig.opacity * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 3D Viewer Settings */}
        <div style={styles.section}>
          <div
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}
            onClick={() => setViewerSectionOpen(o => !o)}
          >
            <span style={{ marginRight: 6 }}>{viewerSectionOpen ? '\u25BC' : '\u25B6'}</span>
            <label style={{ ...styles.label, marginBottom: 0, cursor: 'pointer' }}>3D Viewer</label>
          </div>
          {viewerSectionOpen && (
            <div style={{ marginTop: 8 }}>
              {/* Model Opacity Slider */}
              <label style={{ ...styles.label, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                Model Opacity
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={viewerSettings.modelOpacity}
                  onChange={e => onViewerSettingsChange({
                    ...viewerSettings,
                    modelOpacity: Number(e.target.value),
                  })}
                  style={{ flex: 1, accentColor: '#5577aa' }}
                />
                <span style={{ fontSize: 11, color: '#aaaacc', minWidth: 32, textAlign: 'right' }}>
                  {Math.round(viewerSettings.modelOpacity * 100)}%
                </span>
              </div>

            </div>
          )}
        </div>

        {/* CNC Tools Folder */}
        <div style={styles.section}>
          <label style={styles.label}>CNC Tools Folder</label>
          <div style={styles.pathRow}>
            <div style={styles.folderDisplay}>
              {toolsName || <span style={styles.placeholder}>No folder selected</span>}
            </div>
            <button onClick={handleBrowseTools} style={styles.browseButton}>Browse</button>
          </div>
        </div>

        {toolsStatus && (
          <div style={styles.section}>
            <div style={styles.fileList}>
              <div style={styles.fileRow}>
                <Dot ok={toolsStatus.toolGroups} />
                <span style={{ color: toolsStatus.toolGroups ? '#e0e0e0' : '#f87171' }}>ToolGroups.dat</span>
              </div>
              <div style={styles.fileRow}>
                <Dot ok={toolsStatus.toolLib} />
                <span style={{ color: toolsStatus.toolLib ? '#e0e0e0' : '#f87171' }}>ToolLib.dat</span>
              </div>
            </div>
          </div>
        )}

        {/* Door Libraries Folder */}
        <div style={styles.section}>
          <label style={styles.label}>Door Libraries Folder</label>
          <div style={styles.pathRow}>
            <div style={styles.folderDisplay}>
              {librariesName || <span style={styles.placeholder}>No folder selected</span>}
            </div>
            <button onClick={handleBrowseLibraries} style={styles.browseButton}>Browse</button>
          </div>
        </div>

        {librariesList.length > 0 && (
          <div style={styles.section}>
            <label style={styles.label}>Library</label>
            <select
              value={selectedLibrary || ''}
              onChange={(e) => setSelectedLibrary(e.target.value)}
              style={styles.selectInput}
            >
              {!selectedLibrary && <option value="">-- Select Library --</option>}
              {librariesList.map((lib) => (
                <option key={lib} value={lib}>{lib}</option>
              ))}
            </select>
          </div>
        )}

        {librariesName && librariesList.length === 0 && (
          <div style={styles.section}>
            <div style={styles.fileList}>
              <span style={{ color: '#f87171', fontSize: '13px' }}>No subfolders with Doors.dat found</span>
            </div>
          </div>
        )}

        {/* Textures Folder */}
        <div style={styles.section}>
          <label style={styles.label}>Textures Folder</label>
          <div style={styles.pathRow}>
            <div style={styles.folderDisplay}>
              {texturesName || <span style={styles.placeholder}>No folder selected</span>}
            </div>
            <button onClick={handleBrowseTextures} style={styles.browseButton}>Browse</button>
          </div>
        </div>

        {texturesName && !textureManifest && (
          <div style={styles.section}>
            <div style={styles.fileList}>
              <div style={styles.fileRow}>
                <Dot ok={false} />
                <span style={{ color: '#f87171' }}>PAC Door Order/</span>
              </div>
            </div>
          </div>
        )}

        {texturesName && textureManifest && (
          <div style={styles.section}>
            <div style={styles.fileList}>
              <div style={styles.fileRow}>
                <Dot ok={true} />
                <span style={{ color: '#e0e0e0' }}>PAC Door Order/</span>
              </div>
            </div>
          </div>
        )}

        {textureManifest && (
          <div style={styles.section}>
            <label style={styles.label}>Textures</label>
            <div style={styles.textureCategories}>
              {/* Painted — has brand sub-sections */}
              {textureManifest.categories.painted && (
                <TextureCategory
                  label="Painted"
                  expanded={expandedCategories['painted'] ?? false}
                  onToggle={() => toggleCategory('painted')}
                >
                  {Object.keys(textureManifest.painted).length > 0 ? (
                    Object.entries(textureManifest.painted).map(([brand, files]) => (
                      <div key={brand} style={{ marginLeft: 8 }}>
                        <div style={styles.brandHeader} onClick={() => toggleCategory(`painted-${brand}`)}>
                          <span style={{ marginRight: 6 }}>{expandedCategories[`painted-${brand}`] ? '\u25BC' : '\u25B6'}</span>
                          {brand}
                          <span style={styles.countBadge}>{files.length}</span>
                        </div>
                        {expandedCategories[`painted-${brand}`] && (
                          files.length > 0 ? (
                            <div style={styles.swatchGrid}>
                              {files.map((f) => {
                                const relPath = `Painted/${brand}/${f}`;
                                return (
                                  <TextureSwatch
                                    key={relPath}
                                    blobUrl={textureBlobUrlsRef.current.get(relPath)}
                                    filename={f}
                                    selected={selectedTextures.painted === relPath}
                                    onClick={() => handleTextureSelect('painted', relPath)}
                                  />
                                );
                              })}
                            </div>
                          ) : (
                            <div style={styles.emptyText}>No textures</div>
                          )
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={styles.emptyText}>No brand folders</div>
                  )}
                </TextureCategory>
              )}

              {/* Primed */}
              {textureManifest.categories.primed && (
                <TextureCategory
                  label="Primed"
                  expanded={expandedCategories['primed'] ?? false}
                  onToggle={() => toggleCategory('primed')}
                >
                  {textureManifest.primed.length > 0 ? (
                    <div style={styles.swatchGrid}>
                      {textureManifest.primed.map((f) => {
                        const relPath = `Primed/${f}`;
                        return (
                          <TextureSwatch
                            key={relPath}
                            blobUrl={textureBlobUrlsRef.current.get(relPath)}
                            filename={f}
                            selected={selectedTextures.primed === relPath}
                            onClick={() => handleTextureSelect('primed', relPath)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>No textures</div>
                  )}
                </TextureCategory>
              )}

              {/* Raw */}
              {textureManifest.categories.raw && (
                <TextureCategory
                  label="Raw"
                  expanded={expandedCategories['raw'] ?? false}
                  onToggle={() => toggleCategory('raw')}
                >
                  {textureManifest.raw.length > 0 ? (
                    <div style={styles.swatchGrid}>
                      {textureManifest.raw.map((f) => {
                        const relPath = `Raw/${f}`;
                        return (
                          <TextureSwatch
                            key={relPath}
                            blobUrl={textureBlobUrlsRef.current.get(relPath)}
                            filename={f}
                            selected={selectedTextures.raw === relPath}
                            onClick={() => handleTextureSelect('raw', relPath)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>No textures</div>
                  )}
                </TextureCategory>
              )}

              {/* Sanded */}
              {textureManifest.categories.sanded && (
                <TextureCategory
                  label="Sanded"
                  expanded={expandedCategories['sanded'] ?? false}
                  onToggle={() => toggleCategory('sanded')}
                >
                  {textureManifest.sanded.length > 0 ? (
                    <div style={styles.swatchGrid}>
                      {textureManifest.sanded.map((f) => {
                        const relPath = `Sanded/${f}`;
                        return (
                          <TextureSwatch
                            key={relPath}
                            blobUrl={textureBlobUrlsRef.current.get(relPath)}
                            filename={f}
                            selected={selectedTextures.sanded === relPath}
                            onClick={() => handleTextureSelect('sanded', relPath)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div style={styles.emptyText}>No textures</div>
                  )}
                </TextureCategory>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={styles.buttonRow}>
          <button
            onClick={handleLoad}
            disabled={loading || !canLoad}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              opacity: loading || !canLoad ? 0.5 : 1,
            }}
          >
            {loading ? 'Loading...' : 'Load Data'}
          </button>
        </div>

        {/* Error display */}
        {error && <div style={styles.errorBox}>{error}</div>}

        {/* Load stats */}
        {loadStats && (
          <div style={styles.section}>
            <label style={styles.label}>Loaded Data</label>
            <div style={styles.statsGrid}>
              <StatRow label="Doors" value={loadStats.doorsCount} />
              <StatRow label="CNC Doors" value={loadStats.cncDoorsCount} />
              <StatRow label="Tool Groups" value={loadStats.toolGroupsCount} />
              <StatRow label="Tools" value={loadStats.toolsCount} />
              <StatRow label="Profiles" value={loadStats.profilesCount} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Order Columns sortable row ──────────────────────────────────────────────

function SortableColumnRow({
  col,
  onToggleVisible,
  onLabelChange,
}: {
  col: ColumnDef;
  onToggleVisible: () => void;
  onLabelChange: (label: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: col.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
    fontSize: 12,
    color: '#e0e0e0',
  };
  return (
    <div ref={setNodeRef} style={style}>
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', fontSize: 14, color: '#888', flexShrink: 0, paddingRight: 2, userSelect: 'none' }}
        title="Drag to reorder"
      >
        ⠿
      </span>
      {/* Visibility checkbox */}
      <input
        type="checkbox"
        checked={col.visible}
        onChange={onToggleVisible}
        style={{ flexShrink: 0, accentColor: '#5577aa' }}
      />
      {/* Label input */}
      <input
        type="text"
        value={col.label}
        onChange={e => onLabelChange(e.target.value)}
        style={colLabelInputStyle}
      />
    </div>
  );
}

const colLabelInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid #444466',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 12,
  boxSizing: 'border-box',
};

const colSectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 12,
  fontWeight: 600,
  color: '#8888aa',
  cursor: 'pointer',
  userSelect: 'none',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

function SortableGroupByRow({
  field,
  onToggleActive,
}: {
  field: GroupByField;
  onToggleActive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
    fontSize: 12,
    color: '#e0e0e0',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', fontSize: 14, color: '#888', flexShrink: 0, paddingRight: 2, userSelect: 'none' }}
        title="Drag to reorder"
      >
        ⠿
      </span>
      <input
        type="checkbox"
        checked={field.active}
        onChange={onToggleActive}
        style={{ flexShrink: 0, accentColor: '#5577aa' }}
      />
      <span style={{ flex: 1, color: field.active ? '#e0e0e0' : '#666688' }}>{field.label}</span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.statRow}>
      <span style={styles.statLabel}>{label}:</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

function TextureCategory({ label, expanded, onToggle, children }: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.categorySection}>
      <div style={styles.categoryHeader} onClick={onToggle}>
        <span style={{ marginRight: 6 }}>{expanded ? '\u25BC' : '\u25B6'}</span>
        {label}
      </div>
      {expanded && <div style={{ paddingLeft: 4 }}>{children}</div>}
    </div>
  );
}

function TextureSwatch({ blobUrl, filename, selected, onClick }: {
  blobUrl: string | undefined;
  filename: string;
  selected: boolean;
  onClick: () => void;
}) {
  const displayName = filename.replace(/\.jpe?g$/i, '');
  return (
    <div
      style={{
        ...styles.swatchItem,
        border: selected ? '2px solid #5577aa' : '2px solid transparent',
      }}
      onClick={onClick}
      title={displayName}
    >
      <div
        style={{
          ...styles.swatchImage,
          backgroundImage: blobUrl ? `url(${blobUrl})` : undefined,
        }}
      />
      <div style={styles.swatchLabel}>{displayName}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: 80,
    background: '#1a1a2e',
  },
  panel: {
    width: 520,
    background: '#1e1e3a',
    borderRadius: 12,
    padding: '24px 28px',
    border: '1px solid #333355',
  },
  title: {
    margin: '0 0 20px 0',
    fontSize: '18px',
    fontWeight: 700,
    color: '#ffffff',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#8888aa',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  pathRow: {
    display: 'flex',
    gap: 8,
  },
  folderDisplay: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
    minWidth: 0,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  placeholder: {
    color: '#666688',
    fontStyle: 'italic' as const,
  },
  browseButton: {
    padding: '10px 16px',
    borderRadius: 6,
    border: '1px solid #5577aa',
    background: '#2a4a6e',
    color: '#e0e0e0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },
  selectInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  },
  fileList: {
    background: '#252545',
    borderRadius: 6,
    padding: '8px 12px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '13px',
    padding: '3px 0',
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  button: {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryButton: {
    flex: 1,
    background: '#2a4a6e',
    borderColor: '#5577aa',
  },
  errorBox: {
    background: 'rgba(248, 113, 113, 0.1)',
    border: '1px solid #f87171',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#f87171',
    fontSize: '13px',
    marginBottom: 16,
    whiteSpace: 'pre-wrap' as const,
  },
  statsGrid: {
    background: '#252545',
    borderRadius: 6,
    padding: '8px 12px',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    padding: '3px 0',
  },
  statLabel: {
    color: '#8888aa',
    fontWeight: 600,
  },
  statValue: {
    color: '#e0e0e0',
  },
  textureCategories: {
    background: '#252545',
    borderRadius: 6,
    padding: '8px 12px',
    maxHeight: 400,
    overflowY: 'auto' as const,
  },
  categorySection: {
    marginBottom: 4,
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '13px',
    fontWeight: 600,
    color: '#ccccee',
    cursor: 'pointer',
    padding: '4px 0',
    userSelect: 'none' as const,
  },
  brandHeader: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: 500,
    color: '#aaaacc',
    cursor: 'pointer',
    padding: '3px 0',
    userSelect: 'none' as const,
  },
  countBadge: {
    marginLeft: 6,
    fontSize: '11px',
    color: '#666688',
  },
  swatchGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    padding: '6px 0',
  },
  swatchItem: {
    width: 56,
    cursor: 'pointer',
    borderRadius: 4,
    overflow: 'hidden' as const,
    textAlign: 'center' as const,
  },
  swatchImage: {
    width: 48,
    height: 48,
    margin: '2px auto 0',
    borderRadius: 3,
    backgroundSize: 'cover' as const,
    backgroundPosition: 'center',
    backgroundColor: '#333355',
  },
  swatchLabel: {
    fontSize: '9px',
    color: '#8888aa',
    marginTop: 2,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    padding: '0 2px',
  },
  emptyText: {
    fontSize: '11px',
    color: '#666688',
    fontStyle: 'italic' as const,
    padding: '4px 8px',
  },
};
