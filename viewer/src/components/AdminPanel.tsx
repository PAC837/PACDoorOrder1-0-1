import { useState, useEffect, useCallback, useRef } from 'react';

import type { TextureManifest } from '../types.js';
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
}

interface LoadStats {
  doorsCount: number;
  toolGroupsCount: number;
  toolsCount: number;
  cncDoorsCount: number;
  profilesCount: number;
}

export function AdminPanel({ onDataReloaded, selectedTextures, onTextureSelected, onLibrariesChanged }: AdminPanelProps) {
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
  const [textureManifest, setTextureManifest] = useState<TextureManifest | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const textureBlobUrlsRef = useRef<Map<string, string>>(new Map());

  // Load state
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          setTextureManifest(result.manifest);
          revokeTextureUrls(textureBlobUrlsRef.current);
          textureBlobUrlsRef.current = result.blobUrls;
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
      setTextureManifest(result.manifest);
      revokeTextureUrls(textureBlobUrlsRef.current);
      textureBlobUrlsRef.current = result.blobUrls;
    } else {
      setTextureManifest(null);
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
