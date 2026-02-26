import { useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useDoorData } from './hooks/useDoorData.js';
import { DoorViewer } from './components/DoorViewer.js';
import { OperationOverlay } from './components/OperationOverlay.js';
import { ToolShapeViewer } from './components/ToolShapeViewer.js';
import { CrossSectionViewer } from './components/CrossSectionViewer.js';
import { buildGenericDoor } from './utils/genericDoor.js';
import type { OperationVisibility, ToolVisibility } from './types.js';
import { MATERIAL_THICKNESS } from './types.js';

type Tab = 'door' | 'tools' | 'cross-section';

const GENERIC_DOOR_VALUE = 'generic';

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('door');
  const { doors, graphs, profiles, toolGroups, tools, loading, error } = useDoorData();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenericDoor, setIsGenericDoor] = useState(false);
  const [frontGroupId, setFrontGroupId] = useState<number | null>(null);
  const [backGroupId, setBackGroupId] = useState<number | null>(null);
  const [frontIsPocket, setFrontIsPocket] = useState(true);
  const [backIsPocket, setBackIsPocket] = useState(true);
  const [frontDepth, setFrontDepth] = useState(6.35);    // 1/4"
  const [backDepth, setBackDepth] = useState(3.175);     // 1/8"
  const [leftStileW, setLeftStileW] = useState(63.5);    // 2.5"
  const [rightStileW, setRightStileW] = useState(63.5);  // 2.5"
  const [topRailW, setTopRailW] = useState(63.5);        // 2.5"
  const [bottomRailW, setBottomRailW] = useState(63.5);  // 2.5"
  const [operationVisibility, setOperationVisibility] = useState<OperationVisibility>({});
  const [toolVisibility, setToolVisibility] = useState<ToolVisibility>({});

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

  // Compute active door + graph (either real door or generic)
  const { activeDoor, activeGraph } = useMemo(() => {
    if (isGenericDoor && frontGroupId !== null) {
      const effectiveFrontDepth = frontIsPocket ? frontDepth : 0;
      const effectiveBackDepth = backIsPocket ? backDepth : 0;
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
  }, [isGenericDoor, frontGroupId, backGroupId, frontIsPocket, backIsPocket,
      frontDepth, backDepth, leftStileW, rightStileW, topRailW, bottomRailW,
      toolGroups, tools, doors, selectedIndex, graphs]);

  // Export the current door to Mozaik optimizer XML
  const handleExport = useCallback(() => {
    if (!activeDoor) return;
    const xml = buildOptimizerXml(activeDoor);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDoor.Name.replace(/\s+/g, '_')}_optimizer.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDoor]);

  // --- Tab: Tool Shapes ---
  if (currentTab === 'tools') {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <ToolShapeViewer />
      </div>
    );
  }

  // --- Tab: Door Viewer ---
  if (loading) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <div style={styles.loading}>
          <p>Loading door data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <div style={styles.loading}>
          <p style={{ color: '#ff6b6b' }}>Error: {error}</p>
        </div>
      </div>
    );
  }

  if (doors.length === 0 && !isGenericDoor) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <div style={styles.loading}>
          <p>No CNC doors found in data.</p>
        </div>
      </div>
    );
  }

  // --- Tab: Cross Section ---
  if (currentTab === 'cross-section' && activeDoor) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <CrossSectionViewer
          door={activeDoor}
          graph={activeGraph}
          profiles={profiles}
        />
      </div>
    );
  }

  if (!activeDoor) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />
        <div style={styles.loading}>
          <p>Select a door or configure the Generic Door.</p>
        </div>
      </div>
    );
  }

  // Camera distance based on door size
  const maxDim = Math.max(activeDoor.DefaultW, activeDoor.DefaultH);
  const camDist = maxDim * 1.8;

  return (
    <div style={styles.container}>
      <TabBar currentTab={currentTab} onTabChange={setCurrentTab} />

      {/* 3D Canvas */}
      <Canvas
        camera={{
          position: [camDist * 0.3, camDist * 0.2, camDist],
          fov: 40,
          near: 1,
          far: 50000,
        }}
        style={styles.canvas}
      >
        <color attach="background" args={['#1a1a2e']} />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[500, 800, 1000]} intensity={0.8} />
        <directionalLight position={[-300, 400, -500]} intensity={0.3} />

        {/* Door */}
        <DoorViewer
          door={activeDoor}
          graph={activeGraph}
          profiles={profiles}
          operationVisibility={operationVisibility}
          toolVisibility={toolVisibility}
        />

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

      {/* Left UI Overlay */}
      <div style={styles.overlay}>
        <h2 style={styles.title}>PAC Door Viewer</h2>

        {/* Door Selector */}
        <div style={styles.selector}>
          <label style={styles.label}>Door:</label>
          <select
            value={isGenericDoor ? GENERIC_DOOR_VALUE : String(selectedIndex)}
            onChange={(e) => handleDoorChange(e.target.value)}
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
                value={frontIsPocket ? 'pocket' : 'onepiece'}
                onChange={(e) => setFrontIsPocket(e.target.value === 'pocket')}
                style={styles.typeSelect}
              >
                <option value="pocket">Pocket</option>
                <option value="onepiece">One-piece</option>
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
            </div>
            <div style={styles.selector}>
              <label style={styles.label}>Front Depth:</label>
              <input
                type="number"
                value={frontDepth}
                step={0.5}
                min={0}
                onChange={(e) => setFrontDepth(Number(e.target.value))}
                style={styles.numberInput}
              />
              <span style={styles.unitLabel}>mm ({(frontDepth / 25.4).toFixed(3)}")</span>
            </div>

            {/* Back: type + depth + tool group */}
            <div style={styles.sideRow}>
              <label style={styles.label}>Back:</label>
              <select
                value={backIsPocket ? 'pocket' : 'onepiece'}
                onChange={(e) => setBackIsPocket(e.target.value === 'pocket')}
                style={styles.typeSelect}
              >
                <option value="pocket">Pocket</option>
                <option value="onepiece">One-piece</option>
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
                value={backDepth}
                step={0.5}
                min={0}
                onChange={(e) => setBackDepth(Number(e.target.value))}
                style={styles.numberInput}
              />
              <span style={styles.unitLabel}>mm ({(backDepth / 25.4).toFixed(3)}")</span>
            </div>

            {/* Stile & Rail Widths */}
            <div style={{ borderTop: '1px solid #335577', marginTop: 6, paddingTop: 6 }}>
              <div style={styles.selector}>
                <label style={styles.label}>Left Stile:</label>
                <input type="number" value={leftStileW} step={0.5} min={0}
                  onChange={(e) => setLeftStileW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>mm ({(leftStileW / 25.4).toFixed(3)}")</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Right Stile:</label>
                <input type="number" value={rightStileW} step={0.5} min={0}
                  onChange={(e) => setRightStileW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>mm ({(rightStileW / 25.4).toFixed(3)}")</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Top Rail:</label>
                <input type="number" value={topRailW} step={0.5} min={0}
                  onChange={(e) => setTopRailW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>mm ({(topRailW / 25.4).toFixed(3)}")</span>
              </div>
              <div style={styles.selector}>
                <label style={styles.label}>Bot Rail:</label>
                <input type="number" value={bottomRailW} step={0.5} min={0}
                  onChange={(e) => setBottomRailW(Number(e.target.value))}
                  style={styles.numberInput} />
                <span style={styles.unitLabel}>mm ({(bottomRailW / 25.4).toFixed(3)}")</span>
              </div>
            </div>
          </div>
        )}

        {/* Door Info */}
        <div style={styles.info}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Size:</span>
            <span>{activeDoor.DefaultW.toFixed(1)} x {activeDoor.DefaultH.toFixed(1)} mm</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Size (in):</span>
            <span>{(activeDoor.DefaultW / 25.4).toFixed(2)}" x {(activeDoor.DefaultH / 25.4).toFixed(2)}"</span>
          </div>
          {isGenericDoor ? (
            <>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>L/R Stile:</span>
                <span>{leftStileW.toFixed(2)} / {rightStileW.toFixed(2)} mm</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>T/B Rail:</span>
                <span>{topRailW.toFixed(2)} / {bottomRailW.toFixed(2)} mm</span>
              </div>
            </>
          ) : (
            <>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Rail W:</span>
                <span>{activeDoor.TopRailW.toFixed(2)} mm ({(activeDoor.TopRailW / 25.4).toFixed(3)}")</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Stile W:</span>
                <span>{activeDoor.LeftRightStileW.toFixed(2)} mm ({(activeDoor.LeftRightStileW / 25.4).toFixed(3)}")</span>
              </div>
            </>
          )}
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Recess:</span>
            <span>{activeDoor.PanelRecess.toFixed(2)} mm ({(activeDoor.PanelRecess / 25.4).toFixed(3)}")</span>
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

        {/* Export Button */}
        <button onClick={handleExport} style={styles.exportBtn}>
          Export Optimizer XML
        </button>

        <div style={styles.hint}>
          Drag to orbit / Scroll to zoom / Right-drag to pan
        </div>
      </div>

      {/* Right-side Operation Overlay */}
      <OperationOverlay
        graph={activeGraph}
        visibility={operationVisibility}
        onToggle={toggleOperation}
        toolVisibility={toolVisibility}
        onToggleTool={toggleTool}
        onSetAllTools={setAllTools}
      />
    </div>
  );
}

function TabBar({ currentTab, onTabChange }: { currentTab: Tab; onTabChange: (tab: Tab) => void }) {
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
    border: '1px solid #444466',
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
    borderColor: '#5577aa',
  },
};

/**
 * Build Mozaik optimizer XML for a single door.
 * Matches the format in `3-4 MDF sample 1.xml`.
 */
function buildOptimizerXml(door: any): string {
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
      xml += `        <OperationPocket CCW="${B(op.CCW ?? false)}" InsideOut="${B(op.InsideOut ?? true)}" PocketingToolID="-3" ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="${B(op.ClosedShape ?? true)}" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="${op.Depth}" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="False" Noneditable="False" Anchor="" FlipSideOp="${B(op.FlipSideOp)}">\n`;
      if (!op.FlipSideOp) {
        xml += `          <OpIdTag TypeCode="29" LegacyNumber="${legacyNum}">\n`;
        xml += `            <OpIdTagReference Key="Panel Index" Value="${panelIndex}" />\n`;
        xml += `          </OpIdTag>\n`;
        panelIndex++;
      } else {
        xml += `          <OpIdTag TypeCode="0" LegacyNumber="${legacyNum}" />\n`;
      }
      const nodes = op.OperationToolPathNode ?? [];
      for (const node of nodes) {
        xml += `          <OperationToolPathNode X="${node.X}" Y="${node.Y}" DepthOR="${node.DepthOR ?? -9999}" PtType="${node.PtType ?? 0}" Data="${node.Data ?? 0}" X_Eq="" Y_Eq="" Data_Eq="" Anchor="" />\n`;
      }
      xml += '        </OperationPocket>\n';
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
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e0e0e0',
    fontSize: '18px',
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
    width: 85,
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
