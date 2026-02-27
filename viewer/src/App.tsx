import { useState, useCallback, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useDoorData } from './hooks/useDoorData.js';
import { DoorViewer } from './components/DoorViewer.js';
import { OperationOverlay } from './components/OperationOverlay.js';
import { ToolShapeViewer } from './components/ToolShapeViewer.js';
import { CrossSectionViewer } from './components/CrossSectionViewer.js';
import { AdminPanel } from './components/AdminPanel.js';
import { buildGenericDoor } from './utils/genericDoor.js';
import type { OperationVisibility, ToolVisibility, PanelType, UnitSystem } from './types.js';
import { MATERIAL_THICKNESS, formatUnit } from './types.js';

type Tab = 'door' | 'tools' | 'cross-section' | 'admin';

const GENERIC_DOOR_VALUE = 'generic';

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('door');
  const [dataVersion, setDataVersion] = useState(0);
  const { doors, graphs, profiles, toolGroups, tools, loading, error } = useDoorData(dataVersion);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenericDoor, setIsGenericDoor] = useState(false);
  const [frontGroupId, setFrontGroupId] = useState<number | null>(null);
  const [backGroupId, setBackGroupId] = useState<number | null>(null);
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
  const [operationVisibility, setOperationVisibility] = useState<OperationVisibility>({});
  const [toolVisibility, setToolVisibility] = useState<ToolVisibility>({});
  const [libraries, setLibraries] = useState<string[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);

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

  // Reset visibility when door changes
  const handleDoorChange = useCallback((value: string) => {
    setOperationVisibility({});
    setToolVisibility({});
    if (value === GENERIC_DOOR_VALUE) {
      setIsGenericDoor(true);
    } else {
      setIsGenericDoor(false);
      setSelectedIndex(Number(value));
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
        setOperationVisibility({});
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

  // Compute active door + graph (either real door or generic)
  const { activeDoor, activeGraph } = useMemo(() => {
    if (isGenericDoor && frontGroupId !== null) {
      const { door, graph } = buildGenericDoor(
        toolGroups, tools, frontGroupId, backGroupId,
        effectiveFrontDepth, effectiveBackDepth,
        508, 762,
        leftStileW, rightStileW, topRailW, bottomRailW,
      );
      return { activeDoor: door, activeGraph: graph };
    }
    if (doors.length > 0) {
      const door = doors[selectedIndex];
      const graph = graphs.find((g) => g.doorName === door?.Name);
      return { activeDoor: door, activeGraph: graph };
    }
    return { activeDoor: undefined, activeGraph: undefined };
  }, [isGenericDoor, frontGroupId, backGroupId, effectiveFrontDepth, effectiveBackDepth,
      leftStileW, rightStileW, topRailW, bottomRailW,
      toolGroups, tools, doors, selectedIndex, graphs]);

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
            {/* Front: type + depth + tool group */}
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
                  setOperationVisibility({});
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
              <input
                type="number"
                value={frontPanelType === 'pocket' ? frontDepth : effectiveFrontDepth}
                step={0.5}
                min={0}
                onChange={(e) => setFrontDepth(Number(e.target.value))}
                disabled={frontPanelType !== 'pocket'}
                style={{ ...styles.numberInput, ...(frontPanelType !== 'pocket' ? { opacity: 0.5 } : {}) }}
              />
              <span style={styles.unitLabel}>{formatUnit(frontPanelType === 'pocket' ? frontDepth : effectiveFrontDepth, units)}</span>
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
                  setOperationVisibility({});
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
            <div style={styles.selector}>
              <label style={styles.label}>Back Depth:</label>
              <input
                type="number"
                value={backPanelType === 'pocket' ? backDepth : effectiveBackDepth}
                step={0.5}
                min={0}
                onChange={(e) => setBackDepth(Number(e.target.value))}
                disabled={backPanelType !== 'pocket'}
                style={{ ...styles.numberInput, ...(backPanelType !== 'pocket' ? { opacity: 0.5 } : {}) }}
              />
              <span style={styles.unitLabel}>{formatUnit(backPanelType === 'pocket' ? backDepth : effectiveBackDepth, units)}</span>
            </div>

            {/* Stile & Rail Widths */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
              <div style={styles.selector}>
                <label style={styles.label}>Left Stile:</label>
                <input type="number" value={leftStileW} step={0.5} min={0}
                  onChange={(e) => setLeftStileW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>{formatUnit(leftStileW, units)}</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Right Stile:</label>
                <input type="number" value={rightStileW} step={0.5} min={0}
                  onChange={(e) => setRightStileW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>{formatUnit(rightStileW, units)}</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Top Rail:</label>
                <input type="number" value={topRailW} step={0.5} min={0}
                  onChange={(e) => setTopRailW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>{formatUnit(topRailW, units)}</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Bot Rail:</label>
                <input type="number" value={bottomRailW} step={0.5} min={0}
                  onChange={(e) => setBottomRailW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>{formatUnit(bottomRailW, units)}</span>
              </div>
            </div>
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
  if (ops.length > 0) {
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
    color: '#e0e0e0',
    pointerEvents: 'auto',
    maxWidth: 340,
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
