import { useState, useCallback, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Group as PanelGroup, Panel, Separator } from 'react-resizable-panels';
import { useDoorData } from './hooks/useDoorData.js';
import { DoorViewer } from './components/DoorViewer.js';
import { OperationOverlay } from './components/OperationOverlay.js';
import { ToolShapeViewer } from './components/ToolShapeViewer.js';
import { CrossSectionViewer } from './components/CrossSectionViewer.js';
import { AdminPanel } from './components/AdminPanel.js';
import { ElevationViewer } from './components/ElevationViewer.js';
import { CommitNumberInput } from './components/CommitNumberInput.js';
import { PanelSplitControls } from './components/PanelSplitControls.js';
import { DoorEditorToolbar } from './components/DoorEditorToolbar.js';
import { HingeAdvancedDialog } from './components/HingeAdvancedDialog.js';
import { HandleAdvancedDialog } from './components/HandleAdvancedDialog.js';
import { buildGenericDoor } from './utils/genericDoor.js';
import { equidistantPositions } from './utils/hardware.js';
import type { PanelTree } from './utils/panelTree.js';
import { enumerateSplits, updateSplit, libraryDoorToTree, pathsEqual, addSplitAtLeaf } from './utils/panelTree.js';
import type { DoorData, DoorHandlePlacement, OperationVisibility, ToolVisibility, PanelType, UnitSystem, DoorPartType, BackPocketMode, HingeConfig, HandleConfig, RenderMode } from './types.js';
import { MATERIAL_THICKNESS, formatUnit, DEFAULT_HINGE_CONFIG, DEFAULT_HANDLE_CONFIG } from './types.js';
import { RenderModeButton, nextRenderMode } from './components/RenderModeButton.js';
import { computeAllHoles, validateHardware } from './utils/hardware.js';
import { restoreLibraries, loadLibraryData } from './utils/folderAccess.js';

type Tab = 'door' | 'tools' | 'cross-section' | 'elevation' | 'admin';

const GENERIC_DOOR_VALUE = 'generic';

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
  const [backPreset, setBackPreset] = useState<string>('');
  const [showHingeDialog, setShowHingeDialog] = useState(false);
  const [showHandleDialog, setShowHandleDialog] = useState(false);
  const [savedSep, setSavedSep] = useState(101.6); // preserve last handle separation when switching to knob
  const [thickness, setThickness] = useState(MATERIAL_THICKNESS);
  const [panelTree, setPanelTree] = useState<PanelTree>({ type: 'leaf' });
  const [selectedPanels, setSelectedPanels] = useState<Set<number>>(new Set());
  const [selectedSplitPath, setSelectedSplitPath] = useState<number[] | null>(null);
  const [operationVisibility, setOperationVisibility] = useState<OperationVisibility>({});
  const [toolVisibility, setToolVisibility] = useState<ToolVisibility>({});
  const [libraries, setLibraries] = useState<string[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [doorRenderMode, setDoorRenderMode] = useState<RenderMode>('solid');
  const [elevationRenderMode, setElevationRenderMode] = useState<RenderMode>('solid');
  const [selectedTextures, setSelectedTextures] = useState<{
    painted: string | null; primed: string | null; raw: string | null; sanded: string | null;
  }>({ painted: null, primed: null, raw: null, sanded: null });
  const [activeTextureCategory, setActiveTextureCategory] = useState<'painted' | 'primed' | 'raw' | 'sanded'>('raw');
  const [textureBlobUrls, setTextureBlobUrls] = useState<Record<string, string>>({});

  // Unit conversion helpers for number inputs (internal state always mm)
  const toDisplay = useCallback((mm: number) => units === 'in' ? parseFloat((mm / 25.4).toFixed(4)) : mm, [units]);
  const fromDisplay = useCallback((val: number) => units === 'in' ? val * 25.4 : val, [units]);
  const inputStep = units === 'in' ? 0.125 : 0.5;  // 1/8" or 0.5mm

  // Restore library list from IndexedDB handles on mount
  useEffect(() => {
    restoreLibraries().then((libs) => {
      if (libs.length > 0) setLibraries(libs);
    }).catch(() => {});
  }, []);

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
      case 'end-panel': setDoorH(762); setBottomRailW(139.7); break; // 30" height, 5.5" bottom rail
      case 'slab': setDoorH(152.4); break;
    }
    if (type === 'slab') {
      setFrontGroupId(null);
      setBackGroupId(null);
      setEdgeGroupId(null);
    }
    // Reset panel tree (clear mid rails/stiles)
    setPanelTree({ type: 'leaf' });
    setSelectedPanels(new Set());
    setSelectedSplitPath(null);
  }, []);

  const handleHingeSideChange = useCallback((side: 'left' | 'right' | 'top' | 'bottom') => {
    setHingeConfig(prev => ({ ...prev, side }));
  }, []);

  const handleHingeCountChange = useCallback((count: number) => {
    setHingeConfig(prev => ({ ...prev, count }));
  }, []);

  const handleHingePositionChange = useCallback((index: number, newPosMm: number) => {
    setHingeConfig(prev => {
      const next = { ...prev };
      // Transition from equidistant to manual: populate current positions
      if (next.equidistant) {
        const axisLength = (next.side === 'left' || next.side === 'right') ? doorH : doorW;
        next.positions = equidistantPositions(next.count, axisLength, next.edgeDistance);
        next.equidistant = false;
      }
      const positions = [...next.positions];
      positions[index] = Math.max(0, newPosMm);
      next.positions = positions;
      return next;
    });
  }, [doorH, doorW]);

  const handleHandleTypeChange = useCallback((isKnob: boolean) => {
    if (isKnob) {
      setHandleConfig(prev => {
        if (prev.holeSeparation > 0) setSavedSep(prev.holeSeparation);
        return { ...prev, holeSeparation: 0 };
      });
    } else {
      setHandleConfig(prev => ({ ...prev, holeSeparation: savedSep || 101.6 }));
    }
  }, [savedSep]);

  const handleDoorPlacementChange = useCallback((placement: DoorHandlePlacement) => {
    setHandleConfig(prev => ({ ...prev, doorPlacement: placement }));
  }, []);

  const handleHandleElevationChange = useCallback((newPosMm: number) => {
    setHandleConfig(prev => ({ ...prev, elevation: Math.max(0, newPosMm), doorPlacement: 'custom' as DoorHandlePlacement }));
  }, []);

  const handleLibraryChange = useCallback(async (library: string) => {
    setSelectedLibrary(library);
    setLibraryLoading(true);
    try {
      const result = await loadLibraryData(library);
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
    () => computeEffectiveDepths(frontPanelType, backPanelType, frontDepth, backDepth, thickness),
    [frontPanelType, backPanelType, frontDepth, backDepth, thickness],
  );

  // Compute hardware holes for generic door
  const holes = useMemo(() => {
    if (!isGenericDoor) return [];
    return computeAllHoles(hingeConfig, handleConfig, doorPartType, doorW, doorH, thickness);
  }, [isGenericDoor, hingeConfig, handleConfig, doorPartType, doorW, doorH, thickness]);

  // Validate hardware config
  const hardwareWarnings = useMemo(() => {
    if (!isGenericDoor || doorPartType === 'slab') return [];
    return validateHardware(
      hingeConfig, handleConfig, doorPartType, doorW, doorH, thickness,
      leftStileW, rightStileW, topRailW, bottomRailW,
    );
  }, [isGenericDoor, hingeConfig, handleConfig, doorPartType, doorW, doorH,
      leftStileW, rightStileW, topRailW, bottomRailW]);

  // Clamp all depths when thickness changes (prevents drilling deeper than material)
  useEffect(() => {
    setFrontDepth(prev => Math.min(prev, thickness));
    setBackDepth(prev => Math.min(prev, thickness));
    setHingeConfig(prev => {
      const cupDepth = Math.min(prev.cupDepth, thickness);
      const mountDepth = Math.min(prev.mountDepth, thickness);
      if (cupDepth === prev.cupDepth && mountDepth === prev.mountDepth) return prev;
      return { ...prev, cupDepth, mountDepth };
    });
    setHandleConfig(prev => {
      if (prev.cutThrough) {
        if (prev.holeDepth === thickness) return prev;
        return { ...prev, holeDepth: thickness };
      }
      const holeDepth = Math.min(prev.holeDepth, thickness);
      if (holeDepth === prev.holeDepth) return prev;
      return { ...prev, holeDepth };
    });
  }, [thickness]);

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
      thickness,
      isGenericDoor ? edgeGroupId : undefined,
    );
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDoor.Name.replace(/\s+/g, '_')}_optimizer.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDoor, isGenericDoor, frontPanelType, backPanelType, thickness, edgeGroupId]);

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

  const handleSplitWidthChange = useCallback((path: number[], newWidth: number) => {
    setPanelTree(prev => {
      const splits = enumerateSplits(prev);
      const split = splits.find(s => pathsEqual(s.path, path));
      if (!split) return prev;
      return updateSplit(prev, path, split.pos, newWidth);
    });
  }, []);

  // Add split at a panel's center (used by MR/MS buttons in elevation)
  const handleAddMidRail = useCallback((panelIdx: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    setPanelTree(prev => addSplitAtLeaf(prev, panelIdx, 'hsplit', (pb.xMin + pb.xMax) / 2, 76.2));
    setSelectedPanels(new Set());
  }, [panelBounds]);

  const handleAddMidStile = useCallback((panelIdx: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    setPanelTree(prev => addSplitAtLeaf(prev, panelIdx, 'vsplit', (pb.yMin + pb.yMax) / 2, 76.2));
    setSelectedPanels(new Set());
  }, [panelBounds]);

  const handleDeselectAll = useCallback(() => {
    setSelectedPanels(new Set());
    setSelectedSplitPath(null);
  }, []);

  // Texture URL for 3D door — uses active category's blob URL
  const activeTexturePath = selectedTextures[activeTextureCategory];
  const textureUrl = activeTexturePath ? textureBlobUrls[activeTexturePath] : undefined;

  const handleActiveTextureCategoryChange = useCallback((cat: 'painted' | 'primed' | 'raw' | 'sanded') => {
    setActiveTextureCategory(cat);
  }, []);

  // Elevation tree — computed once, used by both standalone tab and embedded dashboard
  const elevationTree = activeDoor
    ? (isGenericDoor ? panelTree : libraryDoorToTree(activeDoor.MainSection.Dividers?.Divider))
    : panelTree; // fallback for when no door is active

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
        <AdminPanel
          onDataReloaded={() => setDataVersion((v) => v + 1)}
          selectedTextures={selectedTextures}
          onTextureSelected={(category, path, blobUrl) => {
            setSelectedTextures(prev => ({ ...prev, [category]: path }));
            if (path && blobUrl) {
              setTextureBlobUrls(prev => ({ ...prev, [path]: blobUrl }));
            }
          }}
          onLibrariesChanged={setLibraries}
        />
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
          thickness={thickness}
        />
      </div>
    );
  }

  // --- Tab: Elevation ---
  if (currentTab === 'elevation' && activeDoor) {
    return (
      <div style={styles.container}>
        <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />
        <ElevationViewer
          door={activeDoor}
          units={units}
          panelTree={elevationTree}
          handleConfig={isGenericDoor ? handleConfig : undefined}
          renderMode={elevationRenderMode}
          onRenderModeChange={setElevationRenderMode}
          selectedSplitPath={isGenericDoor ? selectedSplitPath : undefined}
          onSplitSelect={isGenericDoor ? handleSplitSelect : undefined}
          onSplitDragEnd={isGenericDoor ? handleSplitDragEnd : undefined}
          onLeftStileWidthChange={isGenericDoor ? setLeftStileW : undefined}
          onRightStileWidthChange={isGenericDoor ? setRightStileW : undefined}
          onTopRailWidthChange={isGenericDoor ? setTopRailW : undefined}
          onBottomRailWidthChange={isGenericDoor ? setBottomRailW : undefined}
          onSplitWidthChange={isGenericDoor ? handleSplitWidthChange : undefined}
          overrideLeftStileW={isGenericDoor ? leftStileW : undefined}
          overrideRightStileW={isGenericDoor ? rightStileW : undefined}
          onPanelSelect={isGenericDoor ? handlePanelSelect : undefined}
          selectedPanelIndices={isGenericDoor ? selectedPanels : undefined}
          onAddMidRail={isGenericDoor ? handleAddMidRail : undefined}
          onAddMidStile={isGenericDoor ? handleAddMidStile : undefined}
          onDeselectAll={isGenericDoor ? handleDeselectAll : undefined}
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

      <PanelGroup orientation="horizontal" style={{ position: 'absolute', inset: 0, top: 40 }}>
        {/* Left column: 3D + Cross Section */}
        <Panel defaultSize="55%" minSize="25%">
          <PanelGroup orientation="vertical">
            {/* 3D Canvas pane */}
            <Panel defaultSize="60%" minSize="20%">
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                {/* 3D Canvas — always mounted to prevent WebGL context loss */}
                <Canvas
                  gl={{ logarithmicDepthBuffer: true }}
                  camera={{
                    position: [camDist * 0.3, camDist * 0.2, camDist],
                    fov: 40,
                    near: 1,
                    far: 50000,
                  }}
                  style={{ ...styles.canvas, display: activeDoor ? undefined : 'none' }}
                  onPointerMissed={() => { setSelectedPanels(new Set()); setSelectedSplitPath(null); }}
                >
                  <color attach="background" args={['#ffffff']} />
                  <ambientLight intensity={0.4} />
                  <directionalLight position={[500, 800, 1000]} intensity={0.8} />
                  <directionalLight position={[-300, 400, -500]} intensity={0.3} />
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
                      selectedSplitPath={isGenericDoor ? selectedSplitPath : undefined}
                      panelTree={isGenericDoor ? panelTree : undefined}
                      thickness={thickness}
                      renderMode={doorRenderMode}
                      textureUrl={textureUrl}
                    />
                  )}
                  {activeDoor && (
                    <Grid
                      args={[2000, 2000]}
                      position={[0, -activeDoor.DefaultH / 2 - 10, 0]}
                      cellSize={50}
                      cellColor="#e0e0e0"
                      sectionSize={100}
                      sectionColor="#cccccc"
                      fadeDistance={3000}
                      infiniteGrid
                    />
                  )}
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

                {/* Render mode toggle */}
                {activeDoor && (
                  <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
                    <RenderModeButton mode={doorRenderMode} onToggle={() => setDoorRenderMode(nextRenderMode(doorRenderMode))} />
                  </div>
                )}

                {/* Door Editor Toolbar (generic door only) */}
                {isGenericDoor && (
                  <DoorEditorToolbar
                    activeTextureCategory={activeTextureCategory}
                    onTextureCategoryChange={handleActiveTextureCategoryChange}
                    selectedTextures={selectedTextures}
                    frontPanelType={frontPanelType}
                    onFrontPanelTypeChange={setFrontPanelType}
                    frontGroupId={frontGroupId}
                    onFrontGroupChange={(id) => { setFrontGroupId(id); setToolVisibility({}); }}
                    panelToolGroups={panelToolGroups}
                    edgeGroupId={edgeGroupId}
                    onEdgeGroupChange={(id) => { setEdgeGroupId(id); setToolVisibility({}); }}
                    edgeToolGroups={edgeToolGroups}
                    backPreset={backPreset}
                    onBackPresetChange={(preset) => {
                      setBackPreset(preset);
                      if (preset === '' || preset !== 'custom') {
                        if (preset === '') {
                          setBackGroupId(null);
                          setBackPanelType('raised');
                        }
                      }
                      setToolVisibility({});
                    }}
                    customBackGroupId={backGroupId}
                    onCustomBackGroupChange={(id) => { setBackGroupId(id); setToolVisibility({}); }}
                    doorPartType={doorPartType}
                    onDoorPartTypeChange={handleDoorPartTypeChange}
                    hingeSide={hingeConfig.side}
                    onHingeSideChange={handleHingeSideChange}
                    hingeCount={hingeConfig.count}
                    onHingeCountChange={handleHingeCountChange}
                    onHingeAdvancedClick={() => setShowHingeDialog(true)}
                    isKnob={handleConfig.holeSeparation === 0}
                    onHandleTypeChange={handleHandleTypeChange}
                    doorPlacement={handleConfig.doorPlacement}
                    onDoorPlacementChange={handleDoorPlacementChange}
                    onHandleAdvancedClick={() => setShowHandleDialog(true)}
                  />
                )}

                {/* Loading overlay */}
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
            <div style={styles.selector}>
              <label style={styles.label}>Thickness:</label>
              <select
                value={String(thickness)}
                onChange={(e) => setThickness(Number(e.target.value))}
                style={styles.select}
              >
                <option value="19.05">3/4&quot;</option>
                <option value="22.225">7/8&quot;</option>
                <option value="25.4">1&quot;</option>
              </select>
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
                onCommit={(v) => setFrontDepth(Math.min(fromDisplay(v), thickness))}
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
                style={{ ...styles.typeSelect, ...(backGroupId === null ? { opacity: 0.5 } : {}) }}
                disabled={backGroupId === null}
              >
                <option value="pocket">Pocket</option>
                <option value="raised">Raised Panel</option>
                <option value="glass">Glass</option>
              </select>
              <select
                value={backGroupId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const newId = val ? Number(val) : null;
                  setBackGroupId(newId);
                  if (!newId) setBackPanelType('raised');
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
            {backGroupId !== null && (
              <div style={styles.selector}>
                <label style={styles.label}>Back Depth:</label>
                <CommitNumberInput
                  value={toDisplay(backPanelType === 'pocket' ? backDepth : effectiveBackDepth)}
                  step={inputStep}
                  min={0}
                  onCommit={(v) => setBackDepth(Math.min(fromDisplay(v), thickness))}
                  disabled={backPanelType !== 'pocket'}
                  style={{ ...styles.numberInput, ...(backPanelType !== 'pocket' ? { opacity: 0.5 } : {}) }}
                />
              </div>
            )}

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
            <PanelSplitControls
              panelTree={panelTree} setPanelTree={setPanelTree}
              selectedPanels={selectedPanels} setSelectedPanels={setSelectedPanels}
              selectedSplitPath={selectedSplitPath} onSplitSelect={handleSplitSelect}
              panelBounds={panelBounds}
              toDisplay={toDisplay} fromDisplay={fromDisplay} inputStep={inputStep}
              styles={styles}
            />
            </div>
            </>)}

            {/* Hinge Configuration moved to DoorEditorToolbar Row 7 + HingeAdvancedDialog */}

            {/* Handle Configuration moved to DoorEditorToolbar Row 8 + HandleAdvancedDialog */}
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
              </div>{/* end 3D pane wrapper */}
            </Panel>

            <Separator className="resize-handle-v" />

            {/* Cross Section */}
            <Panel defaultSize="40%" minSize="15%">
              {activeDoor ? (
                <CrossSectionViewer
                  compact
                  door={activeDoor}
                  graph={activeGraph}
                  profiles={profiles}
                  frontPanelType={isGenericDoor ? frontPanelType : undefined}
                  backPanelType={isGenericDoor ? backPanelType : undefined}
                  hasBackRabbit={isGenericDoor && frontPanelType === 'glass' ? hasBackRabbit : undefined}
                  units={units}
                  edgeGroupId={isGenericDoor ? edgeGroupId : undefined}
                  thickness={thickness}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                  Cross Section
                </div>
              )}
            </Panel>
          </PanelGroup>
        </Panel>

        <Separator className="resize-handle-h" />

        {/* Right column: Elevation + Order List */}
        <Panel defaultSize="45%" minSize="15%">
          <PanelGroup orientation="vertical">
            {/* Elevation pane */}
            <Panel defaultSize="60%" minSize="20%">
              {activeDoor ? (
                <ElevationViewer
                  compact
                  door={activeDoor}
                  units={units}
                  panelTree={elevationTree}
                  handleConfig={isGenericDoor ? handleConfig : undefined}
                  renderMode={elevationRenderMode}
                  onRenderModeChange={setElevationRenderMode}
                  selectedSplitPath={isGenericDoor ? selectedSplitPath : undefined}
                  onSplitSelect={isGenericDoor ? handleSplitSelect : undefined}
                  onSplitDragEnd={isGenericDoor ? handleSplitDragEnd : undefined}
                  onLeftStileWidthChange={isGenericDoor ? setLeftStileW : undefined}
                  onRightStileWidthChange={isGenericDoor ? setRightStileW : undefined}
                  onTopRailWidthChange={isGenericDoor ? setTopRailW : undefined}
                  onBottomRailWidthChange={isGenericDoor ? setBottomRailW : undefined}
                  onSplitWidthChange={isGenericDoor ? handleSplitWidthChange : undefined}
                  overrideLeftStileW={isGenericDoor ? leftStileW : undefined}
                  overrideRightStileW={isGenericDoor ? rightStileW : undefined}
                  onPanelSelect={isGenericDoor ? handlePanelSelect : undefined}
                  selectedPanelIndices={isGenericDoor ? selectedPanels : undefined}
                  onAddMidRail={isGenericDoor ? handleAddMidRail : undefined}
                  onAddMidStile={isGenericDoor ? handleAddMidStile : undefined}
                  onDeselectAll={isGenericDoor ? handleDeselectAll : undefined}
                  hingeConfig={isGenericDoor ? hingeConfig : undefined}
                  onHingePositionChange={isGenericDoor ? handleHingePositionChange : undefined}
                  onHandleElevationChange={isGenericDoor ? handleHandleElevationChange : undefined}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                  Elevation
                </div>
              )}
            </Panel>

            <Separator className="resize-handle-v" />

            {/* Order List placeholder */}
            <Panel defaultSize="40%" minSize="10%">
              <div style={{ width: '100%', height: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14 }}>
                Order List
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      {/* Hinge Advanced Dialog */}
      {showHingeDialog && (
        <HingeAdvancedDialog
          hingeConfig={hingeConfig}
          setHingeConfig={setHingeConfig}
          thickness={thickness}
          toDisplay={toDisplay}
          fromDisplay={fromDisplay}
          inputStep={inputStep}
          onClose={() => setShowHingeDialog(false)}
        />
      )}

      {/* Handle Advanced Dialog */}
      {showHandleDialog && (
        <HandleAdvancedDialog
          handleConfig={handleConfig}
          setHandleConfig={setHandleConfig}
          doorPartType={doorPartType}
          savedSep={savedSep}
          setSavedSep={setSavedSep}
          thickness={thickness}
          toDisplay={toDisplay}
          fromDisplay={fromDisplay}
          inputStep={inputStep}
          onClose={() => setShowHandleDialog(false)}
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
  door: DoorData,
  frontPanelType: PanelType = 'pocket',
  backPanelType: PanelType = 'pocket',
  thickness = MATERIAL_THICKNESS,
  edgeGroupId?: number | null,
): string {
  const B = (v: boolean) => v ? 'True' : 'False';
  const w = door.DefaultW;
  const h = door.DefaultH;

  // Map thickness to material name
  const thicknessName = thickness <= 19.05 ? '3/4' : thickness <= 22.225 ? '7/8' : '1';

  let xml = '8\n';
  xml += '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';
  xml += `<Parts MaterialName="${thicknessName} MDF">\n`;

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
      const isEdgeOp = edgeGroupId != null && op.ToolGroupID === edgeGroupId;
      let isToolPathElement = false;

      if (isEdgeOp) {
        // Edge tool group: OperationToolPath with door perimeter, Depth=0, InsideOut=False
        isToolPathElement = true;
        xml += `        <OperationToolPath ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="True" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="0" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="True" Noneditable="False" Anchor="" FlipSideOp="False">\n`;
        xml += `          <OpIdTag TypeCode="29" LegacyNumber="${legacyNum}">\n`;
        xml += `            <OpIdTagReference Key="Panel Index" Value="${panelIndex}" />\n`;
        xml += `            <OpIdTagReference Key="Count" Value="1" />\n`;
        xml += `          </OpIdTag>\n`;
        panelIndex++;
      } else {
        const panelType = op.FlipSideOp ? backPanelType : frontPanelType;
        isToolPathElement = panelType === 'raised' || panelType === 'glass';

        if (isToolPathElement) {
          xml += `        <OperationToolPath ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="True" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="0" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="True" Noneditable="False" Anchor="" FlipSideOp="${B(op.FlipSideOp)}">\n`;
        } else {
          xml += `        <OperationPocket CCW="${B(op.CCW ?? false)}" InsideOut="${B(op.InsideOut ?? true)}" PocketingToolID="-3" ToolID="-1" ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="-1" ClosedShape="${B(op.ClosedShape ?? true)}" ToolPathWidth="0" NoRamp="False" NextToolPathIdTag="-1" ToolPathIdTag="-1" ID="${op.ID}" X="0" Y="0" Depth="${op.Depth}" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" IsUserOp="False" Noneditable="False" Anchor="" FlipSideOp="${B(op.FlipSideOp)}">\n`;
        }

        if (!op.FlipSideOp) {
          xml += `          <OpIdTag TypeCode="29" LegacyNumber="${legacyNum}">\n`;
          xml += `            <OpIdTagReference Key="Panel Index" Value="${panelIndex}" />\n`;
          if (isToolPathElement) {
            xml += `            <OpIdTagReference Key="Count" Value="1" />\n`;
          }
          xml += `          </OpIdTag>\n`;
          panelIndex++;
        } else {
          xml += `          <OpIdTag TypeCode="0" LegacyNumber="${legacyNum}" />\n`;
        }
      }

      const nodes = op.OperationToolPathNode ?? [];
      for (const node of nodes) {
        const exportY = w - node.Y;
        xml += `          <OperationToolPathNode X="${node.X}" Y="${exportY}" DepthOR="${node.DepthOR ?? -9999}" PtType="${node.PtType ?? 0}" Data="${node.Data ?? 0}" X_Eq="" Y_Eq="" Data_Eq="" Anchor="" />\n`;
      }
      xml += isToolPathElement ? '        </OperationToolPath>\n' : '        </OperationPocket>\n';
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

      xml += `        <OperationHole Diameter="${hole.Diameter}" Diameter_Eq="" ID="1" X="${hole.X}" Y="${exportY}" Depth="${hole.Depth}" Hide="False" X_Eq="" Y_Eq="" Depth_Eq="${hole.depthEq ?? ''}" Hide_Eq="" IsUserOp="False" Noneditable="False" Anchor="" FlipSideOp="${B(hole.FlipSideOp)}">\n`;
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
    top: 110,
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
