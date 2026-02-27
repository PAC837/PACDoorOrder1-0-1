import { useState, useEffect, useCallback } from 'react';

interface AdminPanelProps {
  onDataReloaded: () => void;
}

interface PacConfig {
  toolsFolderPath: string | null;
  librariesFolderPath: string | null;
  selectedLibrary: string | null;
  lastLoadedAt: string | null;
  lastLoadError: string | null;
}

interface ToolsStatus {
  toolGroups: boolean;
  toolLib: boolean;
  allPresent: boolean;
}

interface LoadStats {
  doorsCount: number;
  toolGroupsCount: number;
  toolsCount: number;
  cncDoorsCount: number;
  profilesCount: number;
}

export function AdminPanel({ onDataReloaded }: AdminPanelProps) {
  const [toolsPath, setToolsPath] = useState('');
  const [librariesPath, setLibrariesPath] = useState('');
  const [toolsStatus, setToolsStatus] = useState<ToolsStatus | null>(null);
  const [librariesList, setLibrariesList] = useState<string[]>([]);
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsingTools, setBrowsingTools] = useState(false);
  const [browsingLibraries, setBrowsingLibraries] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((config: PacConfig) => {
        if (config.toolsFolderPath) setToolsPath(config.toolsFolderPath);
        if (config.librariesFolderPath) setLibrariesPath(config.librariesFolderPath);
        if (config.lastLoadedAt) setLastLoaded(config.lastLoadedAt);
        if (config.lastLoadError) setError(config.lastLoadError);
      })
      .catch(() => {});
  }, []);

  // Validate tools folder when path changes (debounced)
  useEffect(() => {
    if (!toolsPath.trim()) {
      setToolsStatus(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch('/api/validate-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolsFolderPath: toolsPath.trim() }),
      })
        .then((r) => r.json())
        .then((result: ToolsStatus) => setToolsStatus(result))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [toolsPath]);

  // Validate libraries folder when path changes (debounced)
  useEffect(() => {
    if (!librariesPath.trim()) {
      setLibrariesList([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch('/api/validate-libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ librariesFolderPath: librariesPath.trim() }),
      })
        .then((r) => r.json())
        .then((result: { libraries: string[] }) => setLibrariesList(result.libraries))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [librariesPath]);

  const handleBrowseTools = useCallback(async () => {
    setBrowsingTools(true);
    setError(null);
    try {
      const res = await fetch('/api/browse-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: toolsPath, description: 'Select CNC Tools Folder' }),
      });
      const result = await res.json();
      if (result.success && result.folderPath) {
        setToolsPath(result.folderPath);
      } else if (result.error && result.error !== 'No folder selected') {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Browse request failed');
    } finally {
      setBrowsingTools(false);
    }
  }, [toolsPath]);

  const handleBrowseLibraries = useCallback(async () => {
    setBrowsingLibraries(true);
    setError(null);
    try {
      const res = await fetch('/api/browse-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: librariesPath, description: 'Select Door Libraries Folder' }),
      });
      const result = await res.json();
      if (result.success && result.folderPath) {
        setLibrariesPath(result.folderPath);
      } else if (result.error && result.error !== 'No folder selected') {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Browse request failed');
    } finally {
      setBrowsingLibraries(false);
    }
  }, [librariesPath]);

  const handleSaveAndLoad = useCallback(async () => {
    const tools = toolsPath.trim();
    const libs = librariesPath.trim();
    if (!tools || !libs) return;

    setLoading(true);
    setError(null);

    try {
      // Save both folder paths
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolsFolderPath: tools, librariesFolderPath: libs }),
      });

      // Load with first available library
      const firstLib = librariesList[0];
      if (!firstLib) {
        setError('No library subfolders with Doors.dat found.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library: firstLib }),
      });
      const result = await res.json();

      if (result.success) {
        setLoadStats(result.stats);
        setLastLoaded(new Date().toISOString());
        setError(null);
        onDataReloaded();
      } else {
        setError(result.error || 'Load failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [toolsPath, librariesPath, librariesList, onDataReloaded]);

  const handleReload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/load', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setLoadStats(result.stats);
        setLastLoaded(new Date().toISOString());
        setError(null);
        onDataReloaded();
      } else {
        setError(result.error || 'Load failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [onDataReloaded]);

  const canLoad = toolsPath.trim() && librariesPath.trim() && toolsStatus?.allPresent && librariesList.length > 0;

  const Dot = ({ ok }: { ok: boolean }) => (
    <span style={{ color: ok ? '#4ade80' : '#f87171', marginRight: 6 }}>
      {'\u25CF'}
    </span>
  );

  return (
    <div style={styles.wrapper}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Admin - CNC Data Configuration</h2>

        {/* CNC Tools Folder */}
        <div style={styles.section}>
          <label style={styles.label}>CNC Tools Folder</label>
          <div style={styles.pathRow}>
            <input
              type="text"
              value={toolsPath}
              onChange={(e) => setToolsPath(e.target.value)}
              placeholder="Folder containing ToolGroups.dat and ToolLib.dat"
              style={styles.pathInput}
            />
            <button
              onClick={handleBrowseTools}
              disabled={browsingTools}
              style={styles.browseButton}
            >
              {browsingTools ? '...' : 'Browse'}
            </button>
          </div>
        </div>

        {toolsStatus && (
          <div style={styles.section}>
            <label style={styles.label}>File Status</label>
            <div style={styles.fileList}>
              <div style={styles.fileRow}>
                <Dot ok={toolsStatus.toolGroups} />
                <span style={{ color: toolsStatus.toolGroups ? '#e0e0e0' : '#f87171' }}>
                  ToolGroups.dat
                </span>
              </div>
              <div style={styles.fileRow}>
                <Dot ok={toolsStatus.toolLib} />
                <span style={{ color: toolsStatus.toolLib ? '#e0e0e0' : '#f87171' }}>
                  ToolLib.dat
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Door Libraries Folder */}
        <div style={styles.section}>
          <label style={styles.label}>Door Libraries Folder</label>
          <div style={styles.pathRow}>
            <input
              type="text"
              value={librariesPath}
              onChange={(e) => setLibrariesPath(e.target.value)}
              placeholder="Folder containing library subfolders with Doors.dat"
              style={styles.pathInput}
            />
            <button
              onClick={handleBrowseLibraries}
              disabled={browsingLibraries}
              style={styles.browseButton}
            >
              {browsingLibraries ? '...' : 'Browse'}
            </button>
          </div>
        </div>

        {librariesPath.trim() && (
          <div style={styles.section}>
            <label style={styles.label}>Libraries Found</label>
            <div style={styles.fileList}>
              {librariesList.length > 0 ? (
                librariesList.map((lib) => (
                  <div key={lib} style={styles.fileRow}>
                    <Dot ok={true} />
                    <span style={{ color: '#e0e0e0' }}>{lib}</span>
                  </div>
                ))
              ) : (
                <div style={styles.fileRow}>
                  <span style={{ color: '#f87171', fontSize: '13px' }}>
                    No subfolders with Doors.dat found
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={styles.buttonRow}>
          <button
            onClick={handleSaveAndLoad}
            disabled={loading || !canLoad}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              opacity: loading || !canLoad ? 0.5 : 1,
            }}
          >
            {loading ? 'Loading...' : 'Save & Load Data'}
          </button>
          <button
            onClick={handleReload}
            disabled={loading || !lastLoaded}
            style={{
              ...styles.button,
              opacity: loading || !lastLoaded ? 0.5 : 1,
            }}
          >
            Reload
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}

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

        {/* Last loaded timestamp */}
        {lastLoaded && (
          <div style={styles.timestamp}>
            Last loaded: {new Date(lastLoaded).toLocaleString()}
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
  pathInput: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
    minWidth: 0,
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
  timestamp: {
    fontSize: '11px',
    color: '#666688',
    fontStyle: 'italic' as const,
    marginTop: 8,
  },
};
