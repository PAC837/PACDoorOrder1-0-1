import { useState, useCallback, useMemo, useEffect, type CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useDoorData } from './hooks/useDoorData.js';
import { DoorViewer } from './components/DoorViewer.js';
import { OperationOverlay } from './components/OperationOverlay.js';
import { ToolShapeViewer } from './components/ToolShapeViewer.js';
import { CrossSectionViewer } from './components/CrossSectionViewer.js';
import { AdminPanel } from './components/AdminPanel.js';
import { ElevationViewer } from './components/ElevationViewer.js';
import { buildGenericDoor } from './utils/genericDoor.js';
import type { PanelTree } from './utils/panelTree.js';
import { addSplitAtLeaf, enumerateSplits, removeSplit, updateSplit, libraryDoorToTree, pathsEqual } from './utils/panelTree.js';
import type { OperationVisibility, ToolVisibility, PanelType, UnitSystem, DoorPartType, BackPocketMode, HingeConfig, HandleConfig, HingeSide, HandlePlacement, DoorHandlePlacement } from './types.js';
import { MATERIAL_THICKNESS, formatUnit, DEFAULT_HINGE_CONFIG, DEFAULT_HANDLE_CONFIG } from './types.js';
import { computeAllHoles, validateHardware } from './utils/hardware.js';

type Tab = 'door' | 'tools' | 'cross-section' | 'elevation' | 'admin';

const GENERIC_DOOR_VALUE = 'generic';

/** Number input that only commits its value on blur or Enter — avoids expensive re-renders per keystroke. */
function CommitNumberInput({ value, onCommit, style, ...props }: {
  value: number;
  onCommit: (v: number) => void;
  style?: CSSProperties;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type' | 'style'>) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => { const n = Number(local); if (!isNaN(n)) onCommit(n); };
  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
      style={style}
      {...props}
    />
  );
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('door');
  const [dataVersion, setDataVersion] = useState(0);
  const { doors, graphs, profiles, toolGroups, tools, loading, error } = useDoorData(dataVersion);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenericDoor, setIsGenericDoor] = useState(false);
  const [frontGroupId, setFrontGroupId] = useState<number | null>(null);
  const [backGroupId, setBackGroupId] = useState<number | null>(null);
  const [edgeGroupId, setEdgeGroupId] = useState<number | null>(null);
  const [frontPanelType, setFrontPanelType] = useState<PanelType>('pocket');
  const [backPanelType, setBackPanelType] = useState<PanelType>('pocket');
  const [hasBackRabbit, setHasBackRabbit] = useState(true);
  const [frontDepth, setFrontDepth] = useState(6.35);    // 1/4"
  const [backDepth, setBackDepth] = useState(3.175);     // 1/8"
  const [leftStileW, setLeftStileW] = useState(63.5);    // 2.5"
  const [rightStileW, setRightStileW] = useState(63.5);  // 2.5"
  const [topRailW, setTopRailW] = useState(63.5);        // 2.5"
  const [bottomRailW, setBottomRailW] = useState(63.5);  // 2.5"
  const [units, setUnits] = useState<UnitSystem>('mm');
  const [doorPartType, setDoorPartType] = useState<DoorPartType>('door');
  const [doorW, setDoorW] = useState(508);       // 20"
  const [doorH, setDoorH] = useState(762);       // 30"
  const [hingeConfig, setHingeConfig] = useState<HingeConfig>({ ...DEFAULT_HINGE_CONFIG });
  const [handleConfig, setHandleConfig] = useState<HandleConfig>({ ...DEFAULT_HANDLE_CONFIG });
  const [backPocketMode, setBackPocketMode] = useState<BackPocketMode>('all');
  const [showHingeAdvanced, setShowHingeAdvanced] = useState(false);
  const [showHandleAdvanced, setShowHandleAdvanced] = useState(false);
  const [savedSep, setSavedSep] = useState(101.6); // preserve last handle separation when switching to knob
  const [panelTree, setPanelTree] = useState<PanelTree>({ type: 'leaf' });
  const [selectedPanels, setSelectedPanels] = useState<Set<number>>(new Set());
  const [selectedSplitPath, setSelectedSplitPath] = useState<number[] | null>(null);
  const [operationVisibility, setOperationVisibility] = useState<OperationVisibility>({});
  const [toolVisibility, setToolVisibility] = useState<ToolVisibility>({});
  const [libraries, setLibraries] = useState<string[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Unit conversion helpers for number inputs (internal state always mm)
  const toDisplay = useCallback((mm: number) => units === 'in' ? parseFloat((mm / 25.4).toFixed(4)) : mm, [units]);
  const fromDisplay = useCallback((val: number) => units === 'in' ? val * 25.4 : val, [units]);
  const inputStep = units === 'in' ? 0.125 : 0.5;  // 1/8" or 0.5mm

  // Fetch library list + selected library on mount and after data reloads
  useEffect(() => {
    Promise.all([
      fetch('/api/libraries').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ])
      .then(([libData, config]) => {
        setLibraries(libData.libraries || []);
        if (config.selectedLibrary) setSelectedLibrary(config.selectedLibrary);
      })
      .catch(() => {});
  }, [dataVersion]);

  // Panel-type tool groups (Type=0), sorted by name
  const panelToolGroups = useMemo(
    () => toolGroups.filter((g) => g.Type === 0).sort((a, b) => a.Name.localeCompare(b.Name)),
    [toolGroups],
  );

  // Edge-type tool groups (Type=1), sorted by name
  const edgeToolGroups = useMemo(
    () => toolGroups.filter((g) => g.Type === 1).sort((a, b) => a.Name.localeCompare(b.Name)),
    [toolGroups],
  );

  const handleDoorChange = useCallback((value: string) => {
    setToolVisibility({});
    setEdgeGroupId(null);
    if (value === GENERIC_DOOR_VALUE) {
      setIsGenericDoor(true);
    } else {
      setIsGenericDoor(false);
      setSelectedIndex(Number(value));
    }
  }, []);

  const handleDoorPartTypeChange = useCallback((type: DoorPartType) => {
    setDoorPartType(type);
    switch (type) {
      case 'door': setDoorH(762); break;
      case 'drawer': setDoorH(203.2); break;
      case 'reduced-rail': setDoorH(152.4); break;
      case 'slab': setDoorH(152.4); break;
    }
    if (type === 'slab') {
      setFrontGroupId(null);
      setBackGroupId(null);
      setEdgeGroupId(null);
    }
  }, []);

  const handleLibraryChange = useCallback(async (library: string) => {
    setSelectedLibrary(library);
    setLibraryLoading(true);
    try {
      const res = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library }),
      });
      const result = await res.json();
      if (result.success) {
        setDataVersion((v) => v + 1);
        setSelectedIndex(0);
        setIsGenericDoor(false);
        setToolVisibility({});
      }
    } catch {
      // load failed — keep current state
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const toggleOperation = useCallback((operationId: number) => {
    setOperationVisibility((prev) => ({
      ...prev,
      [operationId]: prev[operationId] === true ? false : true,
    }));
  }, []);

  const toggleTool = useCallback((operationId: number, toolIndex: number) => {
    const key = `${operationId}-${toolIndex}`;
    setToolVisibility((prev) => ({
      ...prev,
      [key]: prev[key] === false ? true : false,
    }));
  }, []);

  const setAllTools = useCallback((operationId: number, toolCount: number, visible: boolean) => {
    setToolVisibility((prev) => {
      const next = { ...prev };
      for (let i = 0; i < toolCount; i++) {
        next[`${operationId}-${i}`] = visible;
      }
      return next;
    });
  }, []);

  // Effective depths — computed once, used for both door building and display
  const { effectiveFrontDepth, effectiveBackDepth } = useMemo(
    () => computeEffectiveDepths(frontPanelType, backPanelType, frontDepth, backDepth, MATERIAL_THICKNESS),
    [frontPanelType, backPanelType, frontDepth, backDepth],
  );

  // Compute hardware holes for generic door
  const holes = useMemo(() => {
    if (!isGenericDoor) return [];
    return computeAllHoles(hingeConfig, handleConfig, doorPartType, doorW, doorH);
  }, [isGenericDoor, hingeConfig, handleConfig, doorPartType, doorW, doorH]);

  // Validate hardware config
  const hardwareWarnings = useMemo(() => {
    if (!isGenericDoor || doorPartType === 'slab') return [];
    return validateHardware(
      hingeConfig, handleConfig, doorPartType, doorW, doorH, MATERIAL_THICKNESS,
      leftStileW, rightStileW, topRailW, bottomRailW,
    );
  }, [isGenericDoor, hingeConfig, handleConfig, doorPartType, doorW, doorH,
      leftStileW, rightStileW, topRailW, bottomRailW]);

  // Compute active door + graph (either real door or generic)
  const { activeDoor, activeGraph, panelBounds } = useMemo(() => {
    if (isGenericDoor) {
      const isSlab = doorPartType === 'slab';
      const effFrontId = isSlab ? null : frontGroupId;
      const effBackId = isSlab ? null : backGroupId;
      if (effFrontId !== null || isSlab) {
        const result = buildGenericDoor(
          toolGroups, tools, effFrontId, effBackId,
          effectiveFrontDepth, effectiveBackDepth,
          doorW, doorH,
          isSlab ? 0 : leftStileW, isSlab ? 0 : rightStileW,
          isSlab ? 0 : topRailW, isSlab ? 0 : bottomRailW,
          panelTree, holes,
          backPocketMode, selectedPanels,
          isSlab ? null : edgeGroupId,
        );
        return { activeDoor: result.door, activeGraph: result.graph, panelBounds: result.panelBounds };
      }
    }
    if (doors.length > 0) {
      const door = doors[selectedIndex];
      const graph = graphs.find((g) => g.doorName === door?.Name);
      return { activeDoor: door, activeGraph: graph, panelBounds: undefined };
    }
    return { activeDoor: undefined, activeGraph: undefined, panelBounds: undefined };
  }, [isGenericDoor, frontGroupId, backGroupId, effectiveFrontDepth, effectiveBackDepth,
      leftStileW, rightStileW, topRailW, bottomRailW, panelTree, holes,
      toolGroups, tools, doors, selectedIndex, graphs, doorW, doorH, doorPartType,
      backPocketMode, selectedPanels, edgeGroupId]);

  // Auto-enable all operations when the active graph changes
  useEffect(() => {
    if (!activeGraph) return;
    const vis: OperationVisibility = {};
    for (const op of activeGraph.operations) {
      vis[op.operationId] = true;
    }
    setOperationVisibility(vis);
  }, [activeGraph]);

  // Export the current door to Mozaik optimizer XML
  const handleExport = useCallback(() => {
    if (!activeDoor) return;
    const xml = buildOptimizerXml(
      activeDoor,
      isGenericDoor ? frontPanelType : 'pocket',
      isGenericDoor ? backPanelType : 'pocket',
    );
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDoor.Name.replace(/\s+/g, '_')}_optimizer.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDoor, isGenericDoor, frontPanelType, backPanelType]);

  const handlePanelSelect = useCallback((idx: number, event: { ctrlKey: boolean }) => {
    setSelectedSplitPath(null);
    if (event.ctrlKey) {
      setSelectedPanels(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    } else {
      setSelectedPanels(new Set([idx]));
    }
  }, []);

  const handleSplitSelect = useCallback((path: number[] | null) => {
    setSelectedSplitPath(path);
    if (path !== null) setSelectedPanels(new Set());
  }, []);

  const handleSplitDragEnd = useCallback((path: number[], newPos: number) => {
    setPanelTree(prev => {
      const splits = enumerateSplits(prev);
      const split = splits.find(s => pathsEqual(s.path, path));
      return updateSplit(prev, path, newPos, split?.width ?? 76.2);
    });
  }, []);

  // --- Tab: Tool Shapes ---
  if (currentTab === 'tools') {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />
        <ToolShapeViewer units={units} />
      </div>
    );
  }

  // --- Tab: Admin ---
  if (currentTab === 'admin') {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />
        <AdminPanel onDataReloaded={() => setDataVersion((v) => v + 1)} />
      </div>
    );
  }

  // --- Tab: Cross Section ---
  if (currentTab === 'cross-section' && activeDoor) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />
        <CrossSectionViewer
          door={activeDoor}
          graph={activeGraph}
          profiles={profiles}
          frontPanelType={isGenericDoor ? frontPanelType : undefined}
          backPanelType={isGenericDoor ? backPanelType : undefined}
          hasBackRabbit={isGenericDoor && frontPanelType === 'glass' ? hasBackRabbit : undefined}
          units={units}
          edgeGroupId={isGenericDoor ? edgeGroupId : undefined}
        />
      </div>
    );
  }

  // --- Tab: Elevation ---
  if (currentTab === 'elevation' && activeDoor) {
    const elevationTree = isGenericDoor
      ? panelTree
      : libraryDoorToTree(activeDoor.MainSection.Dividers?.Divider);
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />
        <ElevationViewer
          door={activeDoor}
          units={units}
          panelTree={elevationTree}
          selectedSplitPath={isGenericDoor ? selectedSplitPath : undefined}
          onSplitSelect={isGenericDoor ? handleSplitSelect : undefined}
          onSplitDragEnd={isGenericDoor ? handleSplitDragEnd : undefined}
        />
      </div>
    );
  }

  // Camera distance based on door size
  const maxDim = activeDoor ? Math.max(activeDoor.DefaultW, activeDoor.DefaultH) : 500;
  const camDist = maxDim * 1.8;

  return (
    <div style={styles.container}>
      <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />

      {/* 3D Canvas — always mounted to prevent WebGL context loss */}
      <Canvas
        camera={{
          position: [camDist * 0.3, camDist * 0.2, camDist],
          fov: 40,
          near: 1,
          far: 50000,
        }}
        style={{ ...styles.canvas, display: activeDoor ? undefined : 'none' }}
        onPointerMissed={() => { setSelectedPanels(new Set()); setSelectedSplitPath(null); }}
      >
        <color attach="background" args={['#1a1a2e']} />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[500, 800, 1000]} intensity={0.8} />
        <directionalLight position={[-300, 400, -500]} intensity={0.3} />

        {/* Door */}
        {activeDoor && (
          <DoorViewer
            door={activeDoor}
            graph={activeGraph}
            profiles={profiles}
            operationVisibility={operationVisibility}
            toolVisibility={toolVisibility}
            frontPanelType={isGenericDoor ? frontPanelType : undefined}
            backPanelType={isGenericDoor ? backPanelType : undefined}
            hasBackRabbit={isGenericDoor && frontPanelType === 'glass' ? hasBackRabbit : undefined}
            selectedPanelIndices={isGenericDoor ? selectedPanels : undefined}
            onPanelSelect={isGenericDoor ? handlePanelSelect : undefined}
            selectedSplitPath={isGenericDoor ? selectedSplitPath : undefined}
            onSplitSelect={isGenericDoor ? handleSplitSelect : undefined}
            panelTree={isGenericDoor ? panelTree : undefined}
          />
        )}

        {/* Grid on the back plane */}
        <Grid
          args={[2000, 2000]}
          position={[0, 0, -MATERIAL_THICKNESS]}
          rotation={[0, 0, 0]}
          cellSize={50}
          cellColor="#333355"
          sectionSize={100}
          sectionColor="#444477"
          fadeDistance={3000}
          infiniteGrid
        />

        {/* Controls */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={100}
          maxDistance={10000}
        />
      </Canvas>

      {/* Status messages (shown when no door is active) */}
      {!activeDoor && (
        <div style={styles.loading}>
          <p>
            {loading
              ? 'Loading door data...'
              : error
                ? <span style={{ color: '#ff6b6b' }}>Error: {error}</span>
                : doors.length === 0
                  ? 'No CNC doors in this library. Select a different library or use Generic Door.'
                  : 'Select a door or configure the Generic Door.'}
          </p>
        </div>
      )}

      {/* Loading overlay (shown during reload while door is visible) */}
      {loading && activeDoor && (
        <div style={styles.loadingOverlay}>
          Loading...
        </div>
      )}

      {/* Left UI Overlay */}
      <div style={styles.overlay}>
        <h2 style={styles.title}>PAC Door Viewer</h2>

        {/* Library Selector */}
        {libraries.length > 0 && (
          <div style={styles.selector}>
            <label style={styles.label}>Library:</label>
            <select
              value={selectedLibrary || ''}
              onChange={(e) => handleLibraryChange(e.target.value)}
              disabled={libraryLoading}
              style={styles.select}
            >
              {!selectedLibrary && <option value="">-- Select Library --</option>}
              {libraries.map((lib) => (
                <option key={lib} value={lib}>
                  {lib}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Door Selector */}
        <div style={styles.selector}>
          <label style={styles.label}>Door:</label>
          <select
            value={isGenericDoor ? GENERIC_DOOR_VALUE : String(selectedIndex)}
            onChange={(e) => handleDoorChange(e.target.value)}
            disabled={libraryLoading}
            style={styles.select}
          >
            <option value={GENERIC_DOOR_VALUE}>Generic Door</option>
            {doors.map((d, i) => (
              <option key={d.Name} value={String(i)}>
                {d.Name}
              </option>
            ))}
          </select>
        </div>

        {/* Generic Door Controls */}
        {isGenericDoor && (
          <div style={styles.toolGroupSelectors}>
            {/* Door Type + Size */}
            <div style={styles.sideRow}>
              <label style={styles.label}>Type:</label>
              <select
                value={doorPartType}
                onChange={(e) => handleDoorPartTypeChange(e.target.value as DoorPartType)}
                style={{ ...styles.typeSelect, width: 120 }}
              >
                <option value="door">Door</option>
                <option value="drawer">Drawer</option>
                <option value="reduced-rail">Reduced Rail</option>
                <option value="slab">Slab</option>
              </select>
            </div>
            <div style={styles.sideRow}>
              <label style={styles.label}>Width:</label>
              <CommitNumberInput value={toDisplay(doorW)} step={inputStep} min={0}
                onCommit={(v) => setDoorW(fromDisplay(v))}
                style={styles.numberInput} />
              <label style={{ ...styles.label, minWidth: 50 }}>Height:</label>
              <CommitNumberInput value={toDisplay(doorH)} step={inputStep} min={0}
                onCommit={(v) => setDoorH(fromDisplay(v))}
                style={styles.numberInput} />
            </div>

            {/* Routing controls — hidden for slab */}
            {doorPartType !== 'slab' && (<>
            {/* Front: type + depth + tool group */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
            <div style={styles.sideRow}>
              <label style={styles.label}>Front:</label>
              <select
                value={frontPanelType}
                onChange={(e) => setFrontPanelType(e.target.value as PanelType)}
                style={styles.typeSelect}
              >
                <option value="pocket">Pocket</option>
                <option value="raised">Raised Panel</option>
                <option value="glass">Glass</option>
              </select>
              <select
                value={frontGroupId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setFrontGroupId(val ? Number(val) : null);
                  setToolVisibility({});
                }}
                style={styles.groupSelect}
              >
                <option value="">-- Select Tool Group --</option>
                {panelToolGroups.map((g) => (
                  <option key={g.ToolGroupID} value={g.ToolGroupID}>
                    {g.Name} ({g.ToolEntry.length} tools)
                  </option>
                ))}
              </select>
              {frontPanelType === 'glass' && (
                <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                  <input
                    type="checkbox"
                    checked={hasBackRabbit}
                    onChange={(e) => setHasBackRabbit(e.target.checked)}
                  />
                  Back Rabbit
                </label>
              )}
            </div>
            <div style={styles.selector}>
              <label style={styles.label}>Front Depth:</label>
              <CommitNumberInput
                value={toDisplay(frontPanelType === 'pocket' ? frontDepth : effectiveFrontDepth)}
                step={inputStep}
                min={0}
                onCommit={(v) => setFrontDepth(fromDisplay(v))}
                disabled={frontPanelType !== 'pocket'}
                style={{ ...styles.numberInput, ...(frontPanelType !== 'pocket' ? { opacity: 0.5 } : {}) }}
              />
            </div>

            {/* Back: type + depth + tool group */}
            <div style={styles.sideRow}>
              <label style={styles.label}>Back:</label>
              <select
                value={backPanelType}
                onChange={(e) => setBackPanelType(e.target.value as PanelType)}
                style={styles.typeSelect}
              >
                <option value="pocket">Pocket</option>
                <option value="raised">Raised Panel</option>
                <option value="glass">Glass</option>
              </select>
              <select
                value={backGroupId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setBackGroupId(val ? Number(val) : null);
                  setToolVisibility({});
                }}
                style={styles.groupSelect}
              >
                <option value="">None</option>
                {panelToolGroups.map((g) => (
                  <option key={g.ToolGroupID} value={g.ToolGroupID}>
                    {g.Name} ({g.ToolEntry.length} tools)
                  </option>
                ))}
              </select>
            </div>
            {backGroupId !== null && (
              <div style={styles.selector}>
                <label style={styles.label}>Apply:</label>
                <select value={backPocketMode}
                  onChange={(e) => setBackPocketMode(e.target.value as BackPocketMode)}
                  style={{ ...styles.select, flex: 'none', width: 120 }}>
                  <option value="all">All Panels</option>
                  <option value="selected">Selected Panel</option>
                  <option value="full">Full Pocket</option>
                </select>
              </div>
            )}
            <div style={styles.selector}>
              <label style={styles.label}>Back Depth:</label>
              <CommitNumberInput
                value={toDisplay(backPanelType === 'pocket' ? backDepth : effectiveBackDepth)}
                step={inputStep}
                min={0}
                onCommit={(v) => setBackDepth(fromDisplay(v))}
                disabled={backPanelType !== 'pocket'}
                style={{ ...styles.numberInput, ...(backPanelType !== 'pocket' ? { opacity: 0.5 } : {}) }}
              />
            </div>

            {/* Edge Profile */}
            <div style={styles.sideRow}>
              <label style={styles.label}>Edge:</label>
              <select
                value={edgeGroupId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setEdgeGroupId(val ? Number(val) : null);
                  setToolVisibility({});
                }}
                style={styles.groupSelect}
              >
                <option value="">None</option>
                {edgeToolGroups.map((g) => (
                  <option key={g.ToolGroupID} value={g.ToolGroupID}>
                    {g.Name} ({g.ToolEntry.length} tools)
                  </option>
                ))}
              </select>
            </div>

            {/* Stile & Rail Widths */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
              <div style={styles.selector}>
                <label style={styles.label}>Left Stile:</label>
                <CommitNumberInput value={toDisplay(leftStileW)} step={inputStep} min={0}
                  onCommit={(v) => setLeftStileW(fromDisplay(v))}
                  style={styles.numberInput} />
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Right Stile:</label>
                <CommitNumberInput value={toDisplay(rightStileW)} step={inputStep} min={0}
                  onCommit={(v) => setRightStileW(fromDisplay(v))}
                  style={styles.numberInput} />
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Top Rail:</label>
                <CommitNumberInput value={toDisplay(topRailW)} step={inputStep} min={0}
                  onCommit={(v) => setTopRailW(fromDisplay(v))}
                  style={styles.numberInput} />
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Bot Rail:</label>
                <CommitNumberInput value={toDisplay(bottomRailW)} step={inputStep} min={0}
                  onCommit={(v) => setBottomRailW(fromDisplay(v))}
                  style={styles.numberInput} />
              </div>
            </div>

            {/* Panel Splitting */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: '11px', color: '#8888aa', marginBottom: 6 }}>
                {selectedPanels.size > 0
                  ? `Panel${selectedPanels.size > 1 ? 's' : ''} ${Array.from(selectedPanels).map(i => i + 1).sort((a, b) => a - b).join(', ')} selected`
                  : 'Click a panel (Ctrl+click to multi-select)'}
              </div>
              {selectedPanels.size === 1 && panelBounds && (() => {
                const idx = Array.from(selectedPanels)[0];
                const pb = panelBounds[idx];
                if (!pb) return null;
                return (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <button
                      style={styles.bulkBtn}
                      onClick={() => {
                        setPanelTree((prev) => addSplitAtLeaf(prev, idx, 'hsplit',
                          (pb.xMin + pb.xMax) / 2, 76.2));
                        setSelectedPanels(new Set());
                      }}
                    >
                      Add Mid Rail
                    </button>
                    <button
                      style={styles.bulkBtn}
                      onClick={() => {
                        setPanelTree((prev) => addSplitAtLeaf(prev, idx, 'vsplit',
                          (pb.yMin + pb.yMax) / 2, 76.2));
                        setSelectedPanels(new Set());
                      }}
                    >
                      Add Mid Stile
                    </button>
                  </div>
                );
              })()}
              {enumerateSplits(panelTree).map((split, si) => {
                const label = split.type === 'hsplit' ? 'Rail' : 'Stile';
                const isSplitSelected = selectedSplitPath !== null && pathsEqual(split.path, selectedSplitPath);
                return (
                  <div key={si} style={{
                    marginBottom: 4,
                    paddingLeft: split.depth * 12 + 4,
                    borderLeft: isSplitSelected ? '3px solid #ff8800' : '3px solid transparent',
                    background: isSplitSelected ? 'rgba(255, 136, 0, 0.15)' : undefined,
                    cursor: 'pointer',
                  }} onClick={() => handleSplitSelect(split.path)}>
                    <div style={styles.selector}>
                      <label style={styles.label}>{label} {si + 1} Pos:</label>
                      <CommitNumberInput value={toDisplay(split.pos)} step={inputStep} min={0}
                        onCommit={(v) => setPanelTree((prev) =>
                          updateSplit(prev, split.path, fromDisplay(v), split.width))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>{label} {si + 1} W:</label>
                      <CommitNumberInput value={toDisplay(split.width)} step={inputStep} min={0}
                        onCommit={(v) => setPanelTree((prev) =>
                          updateSplit(prev, split.path, split.pos, fromDisplay(v)))}
                        style={styles.numberInput} />
                      <button style={styles.removeBtn}
                        onClick={() => setPanelTree((prev) => removeSplit(prev, split.path))}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
            </>)}

            {/* Hinge Configuration — only for doors */}
            {doorPartType === 'door' && (
              <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ ...styles.label, minWidth: 0, fontWeight: 700 }}>Hinges</span>
                  <input type="checkbox" checked={hingeConfig.enabled}
                    onChange={(e) => setHingeConfig(prev => ({ ...prev, enabled: e.target.checked }))} />
                </div>
                {hingeConfig.enabled && (<>
                  <div style={styles.selector}>
                    <label style={styles.label}>Side:</label>
                    <select value={hingeConfig.side}
                      onChange={(e) => setHingeConfig(prev => ({ ...prev, side: e.target.value as HingeSide }))}
                      style={{ ...styles.select, flex: 'none', width: 80 }}>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                  <div style={styles.selector}>
                    <label style={styles.label}>Count:</label>
                    <input type="number" value={hingeConfig.count} min={2} max={5}
                      onChange={(e) => setHingeConfig(prev => ({ ...prev, count: Math.max(2, Math.min(5, Number(e.target.value))) }))}
                      style={{ ...styles.numberInput, width: 50 }} />
                  </div>
                  <div style={styles.selector}>
                    <label style={styles.label}>Edge Dist:</label>
                    <CommitNumberInput value={toDisplay(hingeConfig.edgeDistance)} step={inputStep}
                      onCommit={(v) => setHingeConfig(prev => ({ ...prev, edgeDistance: fromDisplay(v) }))}
                      style={styles.numberInput} />
                  </div>
                  <div style={styles.selector}>
                    <label style={styles.label}>Equidistant:</label>
                    <input type="checkbox" checked={hingeConfig.equidistant}
                      onChange={(e) => setHingeConfig(prev => ({ ...prev, equidistant: e.target.checked }))} />
                  </div>
                  {!hingeConfig.equidistant && (
                    Array.from({ length: hingeConfig.count }).map((_, i) => (
                      <div key={i} style={styles.selector}>
                        <label style={styles.label}>Hinge {i + 1}:</label>
                        <CommitNumberInput value={toDisplay(hingeConfig.positions[i] ?? 0)} step={inputStep}
                          onCommit={(v) => {
                            const newPos = [...hingeConfig.positions];
                            newPos[i] = fromDisplay(v);
                            setHingeConfig(prev => ({ ...prev, positions: newPos }));
                          }}
                          style={styles.numberInput} />
                      </div>
                    ))
                  )}
                  <button style={{ ...styles.bulkBtn, marginTop: 4, marginBottom: 4 }}
                    onClick={() => setShowHingeAdvanced(prev => !prev)}>
                    {showHingeAdvanced ? 'Hide' : 'Show'} Advanced
                  </button>
                  {showHingeAdvanced && (<>
                    <div style={styles.selector}>
                      <label style={styles.label}>Cup Dia:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.cupDia)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDia: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Cup Depth:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.cupDepth)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupDepth: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Boring Dist:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.cupBoringDist)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, cupBoringDist: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Mount Dia:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.mountDia)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDia: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Mount Depth:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.mountDepth)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountDepth: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Mt Spacing:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.mountSeparation)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountSeparation: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Mt Inset:</label>
                      <CommitNumberInput value={toDisplay(hingeConfig.mountInset)} step={inputStep}
                        onCommit={(v) => setHingeConfig(prev => ({ ...prev, mountInset: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                    <div style={styles.selector}>
                      <label style={styles.label}>Mt on Front:</label>
                      <input type="checkbox" checked={hingeConfig.mountOnFront}
                        onChange={(e) => setHingeConfig(prev => ({ ...prev, mountOnFront: e.target.checked }))} />
                    </div>
                  </>)}
                </>)}
              </div>
            )}

            {/* Handle Configuration */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ ...styles.label, minWidth: 0, fontWeight: 700 }}>Handle</span>
                <input type="checkbox" checked={handleConfig.enabled}
                  onChange={(e) => setHandleConfig(prev => ({ ...prev, enabled: e.target.checked }))} />
              </div>
              {handleConfig.enabled && (<>
                <div style={styles.selector}>
                  <label style={styles.label}>Type:</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      style={{ ...styles.bulkBtn, ...(handleConfig.holeSeparation > 0 ? { background: '#2a4a6e', color: '#fff' } : {}) }}
                      onClick={() => setHandleConfig(prev => ({ ...prev, holeSeparation: savedSep || 101.6 }))}
                    >Handle</button>
                    <button
                      style={{ ...styles.bulkBtn, ...(handleConfig.holeSeparation === 0 ? { background: '#2a4a6e', color: '#fff' } : {}) }}
                      onClick={() => {
                        if (handleConfig.holeSeparation > 0) setSavedSep(handleConfig.holeSeparation);
                        setHandleConfig(prev => ({ ...prev, holeSeparation: 0 }));
                      }}
                    >Knob</button>
                  </div>
                </div>
                {handleConfig.holeSeparation > 0 && (
                  <div style={styles.selector}>
                    <label style={styles.label}>Separation:</label>
                    <CommitNumberInput value={toDisplay(handleConfig.holeSeparation)} step={inputStep} min={0}
                      onCommit={(v) => {
                        const mm = fromDisplay(v);
                        setHandleConfig(prev => ({ ...prev, holeSeparation: mm }));
                        if (mm > 0) setSavedSep(mm);
                      }}
                      style={styles.numberInput} />
                  </div>
                )}
                <div style={styles.selector}>
                  <label style={styles.label}>Inset:</label>
                  <CommitNumberInput value={toDisplay(handleConfig.insetFromEdge)} step={inputStep}
                    onCommit={(v) => setHandleConfig(prev => ({ ...prev, insetFromEdge: fromDisplay(v) }))}
                    style={styles.numberInput} />
                </div>
                {doorPartType === 'door' ? (<>
                  <div style={styles.selector}>
                    <label style={styles.label}>Position:</label>
                    <select value={handleConfig.doorPlacement}
                      onChange={(e) => setHandleConfig(prev => ({ ...prev, doorPlacement: e.target.value as DoorHandlePlacement }))}
                      style={{ ...styles.select, flex: 'none', width: 100 }}>
                      <option value="top">Top</option>
                      <option value="middle">Middle</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                  {handleConfig.doorPlacement !== 'middle' && (
                    <div style={styles.selector}>
                      <label style={styles.label}>Elevation:</label>
                      <CommitNumberInput value={toDisplay(handleConfig.elevation)} step={inputStep}
                        onCommit={(v) => setHandleConfig(prev => ({ ...prev, elevation: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                  )}
                </>) : (<>
                  <div style={styles.selector}>
                    <label style={styles.label}>Placement:</label>
                    <select value={handleConfig.placement}
                      onChange={(e) => setHandleConfig(prev => ({ ...prev, placement: e.target.value as HandlePlacement }))}
                      style={{ ...styles.select, flex: 'none', width: 140 }}>
                      <option value="center">Center</option>
                      <option value="top-rail">Top Rail</option>
                      <option value="two-equidistant">Two Equidistant</option>
                    </select>
                  </div>
                  {handleConfig.placement === 'two-equidistant' && (
                    <div style={styles.selector}>
                      <label style={styles.label}>Edge Dist:</label>
                      <CommitNumberInput value={toDisplay(handleConfig.twoHandleEdgeDist)} step={inputStep}
                        onCommit={(v) => setHandleConfig(prev => ({ ...prev, twoHandleEdgeDist: fromDisplay(v) }))}
                        style={styles.numberInput} />
                    </div>
                  )}
                </>)}
                <div style={styles.selector}>
                  <label style={styles.label}>On Front:</label>
                  <input type="checkbox" checked={handleConfig.onFront}
                    onChange={(e) => setHandleConfig(prev => ({ ...prev, onFront: e.target.checked }))} />
                </div>
                <button style={{ ...styles.bulkBtn, marginTop: 4, marginBottom: 4 }}
                  onClick={() => setShowHandleAdvanced(prev => !prev)}>
                  {showHandleAdvanced ? 'Hide' : 'Show'} Advanced
                </button>
                {showHandleAdvanced && (<>
                  <div style={styles.selector}>
                    <label style={styles.label}>Hole Dia:</label>
                    <CommitNumberInput value={toDisplay(handleConfig.holeDia)} step={inputStep}
                      onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDia: fromDisplay(v) }))}
                      style={styles.numberInput} />
                  </div>
                  <div style={styles.selector}>
                    <label style={styles.label}>Hole Depth:</label>
                    <CommitNumberInput value={toDisplay(handleConfig.holeDepth)} step={inputStep}
                      onCommit={(v) => setHandleConfig(prev => ({ ...prev, holeDepth: fromDisplay(v) }))}
                      style={styles.numberInput} />
                  </div>
                </>)}
              </>)}
            </div>
          </div>
        )}

        {/* Hardware Validation Warnings */}
        {hardwareWarnings.length > 0 && (
          <div style={{ background: 'rgba(80, 30, 30, 0.85)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, border: '1px solid #664444' }}>
            {hardwareWarnings.map((w, i) => (
              <div key={i} style={{
                color: w.severity === 'error' ? '#ff6666' : '#ffaa44',
                fontSize: '11px', padding: '2px 0',
              }}>
                {w.severity === 'error' ? '\u2718' : '\u26A0'} {w.message}
              </div>
            ))}
          </div>
        )}

        {/* Door Info */}
        {activeDoor && (
          <div style={styles.info}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Size:</span>
              <span>{formatUnit(activeDoor.DefaultW, units)} x {formatUnit(activeDoor.DefaultH, units)}</span>
            </div>
            {isGenericDoor ? (
              <>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>L/R Stile:</span>
                  <span>{formatUnit(leftStileW, units)} / {formatUnit(rightStileW, units)}</span>
                </div>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>T/B Rail:</span>
                  <span>{formatUnit(topRailW, units)} / {formatUnit(bottomRailW, units)}</span>
                </div>
              </>
            ) : (
              <>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>Rail W:</span>
                  <span>{formatUnit(activeDoor.TopRailW, units)}</span>
                </div>
                <div style={styles.infoRow}>
                  <span style={styles.infoLabel}>Stile W:</span>
                  <span>{formatUnit(activeDoor.LeftRightStileW, units)}</span>
                </div>
              </>
            )}
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Recess:</span>
              <span>{formatUnit(activeDoor.PanelRecess, units)}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Split:</span>
              <span>{activeDoor.MainSection.IsSplitSection ? 'Yes (Mid-Rail)' : 'No'}</span>
            </div>
            {activeGraph && (
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Operations:</span>
                <span>{activeGraph.operationCount}</span>
              </div>
            )}
          </div>
        )}

        {/* Export Button */}
        {activeDoor && (
          <button onClick={handleExport} style={styles.exportBtn}>
            Export Optimizer XML
          </button>
        )}

        <div style={styles.hint}>
          Drag to orbit / Scroll to zoom / Right-drag to pan
        </div>
      </div>

      {/* Right-side Operation Overlay */}
      {activeDoor && (
        <OperationOverlay
          graph={activeGraph}
          visibility={operationVisibility}
          onToggle={toggleOperation}
          toolVisibility={toolVisibility}
          onToggleTool={toggleTool}
          onSetAllTools={setAllTools}
          units={units}
        />
      )}
    </div>
  );
}

function computeEffectiveDepths(
  frontType: PanelType, backType: PanelType,
  frontDepth: number, backDepth: number, thickness: number,
) {
  let eFront = frontType === 'pocket' ? frontDepth : 0;
  let eBack = backType === 'pocket' ? backDepth : 0;
  // Glass = full through-cut — pocket removes all panel material
  if (frontType === 'glass') eFront = thickness;
  if (backType === 'glass') eBack = thickness;
  return { effectiveFrontDepth: eFront, effectiveBackDepth: eBack };
}

function TabBar({ currentTab, onTabChange, units, onUnitsChange }: {
  currentTab: Tab; onTabChange: (tab: Tab) => void;
  units: UnitSystem; onUnitsChange: (u: UnitSystem) => void;
}) {
  return (
    <div style={tabStyles.bar}>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'door' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange('door')}
      >
        Door Viewer
      </button>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'tools' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange('tools')}
      >
        Tool Shapes
      </button>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'cross-section' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange('cross-section')}
      >
        Cross Section
      </button>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'elevation' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange('elevation')}
      >
        Elevation
      </button>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'admin' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange('admin')}
      >
        Admin
      </button>
      <button
        style={{ ...tabStyles.tab, marginLeft: 8, fontWeight: 'bold', minWidth: 36 }}
        onClick={() => onUnitsChange(units === 'mm' ? 'in' : 'mm')}
        title="Toggle units"
      >
        {units === 'mm' ? 'mm' : 'in'}
      </button>
    </div>
  );
}

const tabStyles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 2,
    zIndex: 100,
    padding: '8px 0 0 0',
  },
  tab: {
    padding: '6px 20px',
    borderTop: '1px solid #444466',
    borderLeft: '1px solid #444466',
    borderRight: '1px solid #444466',
    borderBottom: 'none',
    borderRadius: '8px 8px 0 0',
    background: 'rgba(26, 26, 46, 0.7)',
    color: '#8888aa',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  activeTab: {
    background: 'rgba(42, 74, 110, 0.9)',
    color: '#ffffff',
    borderTopColor: '#5577aa',
    borderLeftColor: '#5577aa',
    borderRightColor: '#5577aa',
  },
};

/**
 * Build Mozaik optimizer XML for a single door.
 * Matches the format in `3-4 MDF sample 1.xml`.
 */
function buildOptimizerXml(
  door: any,
  frontPanelType: PanelType = 'pocket',
  backPanelType: PanelType = 'pocket',
): string {
  const B = (v: boolean) => v ? 'True' : 'False';
  const w = door.DefaultW;
  const h = door.DefaultH;

  let xml = '8\n';
  xml += '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';
  xml += '<Parts MaterialName="3/4 MDF">\n';

  xml += `  <Part PartID="1" PartNumbers="1" Quan="1" Name="${door.Name}" Width="${w}" Length="${h}" EdgeBand="None" Color="None" AssyNo="R0N1" Comment="Cabinet Door" UserAdded="False" RemakeJobName="" AllowRotation="1" TextureName="">\n`;

  // Shape — rectangular outline
  xml += `    <Shape Version="2" Name="" Type="1" RadiusX="0" RadiusY="0" Source="1" Data1="0" Data2="0" RotAng="0" DoNotTranslateTo00="False">\n`;
  const sides = ['Right', 'Top', 'Left', 'Bottom'];
  const corners = [
    [0, 0], [h, 0], [h, w], [0, w],
  ];
  for (let i = 0; i < 4; i++) {
    xml += `      <ShapePoint ID="${i}" X="${corners[i][0]}" Y="${corners[i][1]}" PtType="0" Data="0" EdgeType="0" Anchor="" EBand="0" X_Eq="" Y_Eq="" Data_Eq="" LAdj="0" RAdj="0" TAdj="0" BAdj="0" Scribe="0" Source="0" BoreHoles="0" EBandLock="False" SideName="${sides[i]}" />\n`;
  }

  // Operations
  const ops = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const holeOps = door.RoutedLockedShape?.Operations?.OperationHole ?? [];
  const hasOps = ops.length > 0 || holeOps.length > 0;
  if (hasOps) {
    xml += '      <Operations Version="2">\n';
    let panelIndex = 1;
    for (let oi = 0; oi < ops.length; oi++) {
      const op = ops[oi];
      const legacyNum = 54000 + oi * 2;
      const panelType = op.FlipSideOp ? backPanelType : frontPanelType;
      const useToolPath = panelType === 'raised' || panelType === 'glass';

      if (useToolPath) {
        // Raised panel (one-piece): OperationToolPath — no pocket, closed toolpath at depth 0
        xml += `        <OperationToolPath ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="True" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="0" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="True" Noneditable="False" Anchor="" FlipSideOp="${B(op.FlipSideOp)}">\n`;
      } else {
        // Pocket or glass: OperationPocket
        xml += `        <OperationPocket CCW="${B(op.CCW ?? false)}" InsideOut="${B(op.InsideOut ?? true)}" PocketingToolID="-3" ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="${B(op.ClosedShape ?? true)}" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="${op.Depth}" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="False" Noneditable="False" Anchor="" FlipSideOp="${B(op.FlipSideOp)}">\n`;
      }

      if (!op.FlipSideOp) {
        xml += `          <OpIdTag TypeCode="29" LegacyNumber="${legacyNum}">\n`;
        xml += `            <OpIdTagReference Key="Panel Index" Value="${panelIndex}" />\n`;
        if (useToolPath) {
          xml += `            <OpIdTagReference Key="Count" Value="1" />\n`;
        }
        xml += `          </OpIdTag>\n`;
        panelIndex++;
      } else {
        xml += `          <OpIdTag TypeCode="0" LegacyNumber="${legacyNum}" />\n`;
      }
      const nodes = op.OperationToolPathNode ?? [];
      for (const node of nodes) {
        // Internal convention: Y=0 is LEFT. Mozaik convention: Y=0 is RIGHT.
        // Mirror the Y coordinate for export.
        const exportY = w - node.Y;
        xml += `          <OperationToolPathNode X="${node.X}" Y="${exportY}" DepthOR="${node.DepthOR ?? -9999}" PtType="${node.PtType ?? 0}" Data="${node.Data ?? 0}" X_Eq="" Y_Eq="" Data_Eq="" Anchor="" />\n`;
      }
      xml += useToolPath ? '        </OperationToolPath>\n' : '        </OperationPocket>\n';
    }

    // Hardware holes — OperationHole elements
    let hingeIndex = 0;
    let mountCount = 0; // counts mounts per hinge (0 or 1)
    let handleHoleIndex = 0;
    for (const hole of holeOps) {
      const exportY = w - hole.Y;
      let typeCode: number;
      let legacyNum: number;
      let tagContent = '';

      if (hole.holeType === 'hinge-cup') {
        hingeIndex++;
        mountCount = 0;
        typeCode = 12;
        legacyNum = 8000 + (hingeIndex - 1) * 6;
        tagContent = `            <OpIdTagReference Key="Hinge Index" Value="${hingeIndex}" />\n`;
      } else if (hole.holeType === 'hinge-mount') {
        typeCode = 13;
        legacyNum = 8000 + (hingeIndex - 1) * 6 + 1 + mountCount;
        const isTop = mountCount === 1;
        tagContent = `            <OpIdTagReference Key="Hinge Index" Value="${hingeIndex}" />\n`;
        tagContent += `            <OpIdTagReference Key="Is Top" Value="${B(isTop)}" />\n`;
        mountCount++;
      } else {
        handleHoleIndex++;
        typeCode = 14;
        legacyNum = 8010 + (handleHoleIndex - 1) * 10;
        tagContent = `            <OpIdTagReference Key="Hole Index" Value="${handleHoleIndex}" />\n`;
      }

      xml += `        <OperationHole Diameter="${hole.Diameter}" Diameter_Eq="" ID="1" X="${hole.X}" Y="${exportY}" Depth="${hole.Depth}" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="False" Noneditable="False" Anchor="" FlipSideOp="${B(hole.FlipSideOp)}">\n`;
      xml += `          <OpIdTag TypeCode="${typeCode}" LegacyNumber="${legacyNum}">\n`;
      xml += tagContent;
      xml += `          </OpIdTag>\n`;
      xml += `        </OperationHole>\n`;
    }

    xml += '      </Operations>\n';
  }

  xml += '    </Shape>\n';

  // BandMatTmpSel
  xml += '    <BandMatTmpSel RootTemplateId="71" MissingTemplateName="PVC Banding">\n';
  for (let i = 1; i <= 6; i++) {
    const suffix = i === 1 ? '' : String(i);
    xml += `      <TextureIdOverrideByPartType PartType="EDGEBAND${suffix}" Id="227" ManuallyChanged="False" />\n`;
  }
  xml += '    </BandMatTmpSel>\n';

  xml += '  </Part>\n';
  xml += '</Parts>\n';

  return xml;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  canvas: {
    width: '100%',
    height: '100%',
  },
  loading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e0e0e0',
    fontSize: '18px',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 48,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(26, 26, 46, 0.85)',
    color: '#e0e0e0',
    padding: '6px 18px',
    borderRadius: 6,
    fontSize: '13px',
    zIndex: 50,
  },
  overlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    bottom: 16,
    color: '#e0e0e0',
    pointerEvents: 'auto',
    maxWidth: 340,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    textShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
  selector: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#aaaacc',
    minWidth: 80,
    whiteSpace: 'nowrap',
  },
  select: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '13px',
    cursor: 'pointer',
  },
  toolGroupSelectors: {
    background: 'rgba(26, 26, 46, 0.85)',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 12,
    border: '1px solid #335577',
  },
  sideRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  typeSelect: {
    padding: '5px 6px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '12px',
    cursor: 'pointer',
    flexShrink: 0,
    width: 105,
  },
  groupSelect: {
    flex: 1,
    padding: '5px 6px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '12px',
    cursor: 'pointer',
    minWidth: 0,
  },
  numberInput: {
    width: 70,
    padding: '5px 6px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '13px',
  },
  unitLabel: {
    fontSize: '12px',
    color: '#8888aa',
    flexShrink: 0,
  },
  bulkBtn: {
    padding: '4px 12px',
    borderRadius: 4,
    border: '1px solid #555577',
    background: 'rgba(42, 42, 72, 0.8)',
    color: '#aaaacc',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  removeBtn: {
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #664444',
    background: 'rgba(72, 42, 42, 0.8)',
    color: '#ff8888',
    fontSize: '10px',
    fontWeight: 600,
    cursor: 'pointer',
    marginLeft: 4,
  },
  info: {
    background: 'rgba(26, 26, 46, 0.85)',
    borderRadius: 8,
    padding: '10px 14px',
    backdropFilter: 'blur(8px)',
    border: '1px solid #333355',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    padding: '2px 0',
    gap: 12,
  },
  infoLabel: {
    color: '#8888aa',
    fontWeight: 600,
    flexShrink: 0,
  },
  exportBtn: {
    marginTop: 12,
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a4a6e',
    color: '#e0e0e0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  hint: {
    marginTop: 12,
    fontSize: '11px',
    color: '#666688',
    fontStyle: 'italic',
  },
};
