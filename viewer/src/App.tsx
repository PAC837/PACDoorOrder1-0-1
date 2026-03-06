import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Group as PanelGroup, Panel, Separator } from 'react-resizable-panels';
import { useDoorData } from './hooks/useDoorData.js';
import { DoorViewer } from './components/DoorViewer.js';
import { CrossSectionViewer } from './components/CrossSectionViewer.js';
import type { CrossSectionViewerHandle } from './components/CrossSectionViewer.js';
import { OrderPanel } from './components/OrderPanel.js';
import { ItemViewerModal } from './components/ItemViewerModal.js';
import { AdminPanel } from './components/AdminPanel.js';
import { ElevationViewer } from './components/ElevationViewer.js';
import { DoorEditorToolbar, PANEL_TYPES, BACK_PRESETS, DOOR_TYPES } from './components/DoorEditorToolbar.js';
import { HingeAdvancedDialog } from './components/HingeAdvancedDialog.js';
import { HandleAdvancedDialog } from './components/HandleAdvancedDialog.js';
import { StyleEditorDialog } from './components/StyleEditorDialog.js';
import { buildGenericDoor } from './utils/genericDoor.js';
import { equidistantPositions } from './utils/hardware.js';
import type { PanelTree } from './utils/panelTree.js';
import { enumerateSplits, updateSplit, libraryDoorToTree, pathsEqual, addSplitAtLeaf, removeSplit, buildSplitChain, replaceLeafAt } from './utils/panelTree.js';
import type { DoorData, DoorHandlePlacement, OperationVisibility, ToolVisibility, PanelType, UnitSystem, DoorPartType, BackPocketMode, HingeConfig, HandleConfig, RenderMode, LayoutMapping, SlotPosition, PanelContentId, LayoutPreset, CompactSlotPosition, CompactLayoutMapping, TextureManifest, KerfLine, FractionPrecision } from './types.js';
import { MATERIAL_THICKNESS, DEFAULT_HINGE_CONFIG, DEFAULT_HANDLE_CONFIG, DEFAULT_LAYOUT, COMPACT_LAYOUT, PANEL_DISPLAY_NAMES, ALL_SLOTS } from './types.js';
import { RenderModeButton, nextRenderMode } from './components/RenderModeButton.js';
import { computeAllHoles, validateHardware } from './utils/hardware.js';
import { LayoutCustomizer } from './components/LayoutCustomizer.js';
import { ConfigurePanel } from './components/ConfigurePanel.js';
import { useConfigData } from './hooks/useConfigData.js';
import { useOrderColumns } from './hooks/useOrderColumns.js';
import { useGroupByConfig } from './hooks/useGroupByConfig.js';
import { useWatermarkConfig, watermarkFontSize } from './hooks/useWatermarkConfig.js';
import { useViewerSettings } from './hooks/useViewerSettings.js';
import { getPreset } from './lightingPresets.js';
import { SceneLighting } from './components/SceneLighting.js';
import type { CheckboxListValue, BooleanRadioValue, FixedCheckboxListValue, GroupDepthListValue, PresetCheckboxValue, NumberValue, TextureCheckboxListValue } from './configParams.js';

type Tab = 'door' | 'admin' | 'configure';

export interface OrderItem {
  id: number;
  selectionKey: string;
  selectionLabel: string;
  qty: number;
  note: string;
  roomName: string;
  cabNumber: string;
  material: string;
  doorW: number;
  doorH: number;
  thickness: number;
  textureCategory: string;
  paintPath: string | null;
  styleName: string;
  edgeName: string;
  backLabel: string;
  doorType: string;
  frontPanelType: PanelType;
  hingeSummary: string;
  handleSummary: string;
  hingesDisplay: string;
  hardwareDisplay: string;
  customData: Record<string, string>;
  price: number;
  crossSectionImage: string | null;
  panelTree: PanelTree;
  backPanelTree: PanelTree;
  leftStileW: number;
  rightStileW: number;
  topRailW: number;
  bottomRailW: number;
  activeDoor: DoorData;
  hingeConfig: HingeConfig;
  handleConfig: HandleConfig;
}

/** Registry entry for one style tab (keyed by styleName). */
interface StyleTabMeta {
  label: string;
  styleId: string | null;
}

/** Resets camera position when door dimensions change. Must be inside Canvas. */
function CameraAutoFit({ maxDim }: { maxDim: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const dist = maxDim * 1.8;
    camera.position.set(dist * 0.3, dist * 0.2, dist);
    camera.lookAt(0, 0, 0);
    if (controls) {
      (controls as any).target.set(0, 0, 0);
      (controls as any).update();
    }
  }, [maxDim, camera, controls]);
  return null;
}

/** Compute hinge count from door height using per-style trigger thresholds. */
function computeAutoHingeCount(
  doorH: number,
  triggers: { h3: number; h4: number; h5: number; h6: number },
): number {
  let count = 2;
  if (triggers.h3 > 0 && doorH >= triggers.h3) count = 3;
  if (triggers.h4 > 0 && doorH >= triggers.h4) count = 4;
  if (triggers.h5 > 0 && doorH >= triggers.h5) count = 5;
  if (triggers.h6 > 0 && doorH >= triggers.h6) count = 6;
  return count;
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('door');
  const [dataVersion, setDataVersion] = useState(0);
  const { doors, graphs, profiles, toolGroups, tools, loading, error } = useDoorData(dataVersion);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenericDoor, setIsGenericDoor] = useState(true);
  const [frontGroupId, setFrontGroupId] = useState<number | null>(null);
  const [backGroupId, setBackGroupId] = useState<number | null>(null);
  const [edgeGroupId, setEdgeGroupId] = useState<number | null>(null);
  const [frontPanelType, setFrontPanelType] = useState<PanelType>('pocket');
  const [backPanelType, setBackPanelType] = useState<PanelType>('pocket');
  const [hasBackRabbit, setHasBackRabbit] = useState(true);
  const [frontDepth, setFrontDepth] = useState(6.35);    // 1/4"
  // backDepth is derived reactively from the configured group list — no separate state needed
  const [leftStileW, setLeftStileW] = useState(63.5);    // 2.5"
  const [rightStileW, setRightStileW] = useState(63.5);  // 2.5"
  const [topRailW, setTopRailW] = useState(63.5);        // 2.5"
  const [bottomRailW, setBottomRailW] = useState(63.5);  // 2.5"
  const [kerfs, setKerfs] = useState<KerfLine[]>([]);
  const [units, setUnits] = useState<UnitSystem>(() => {
    try { const s = localStorage.getItem('pac-units'); if (s === 'mm' || s === 'in') return s; } catch {}
    return 'in';
  });
  const [fractionPrecision, setFractionPrecision] = useState<FractionPrecision>(() => {
    try {
      const s = localStorage.getItem('pac-fraction-precision');
      if (s === 'decimal') return 'decimal';
      if (s === '16' || s === '32' || s === '64') return Number(s) as FractionPrecision;
    } catch {}
    return 16;
  });
  const [doorPartType, setDoorPartType] = useState<DoorPartType>('door');
  const [doorW, setDoorW] = useState(508);       // 20"
  const [doorH, setDoorH] = useState(762);       // 30"
  const [hingeConfig, setHingeConfig] = useState<HingeConfig>({ ...DEFAULT_HINGE_CONFIG });
  const [handleConfig, setHandleConfig] = useState<HandleConfig>({ ...DEFAULT_HANDLE_CONFIG });
  const [backPocketMode, setBackPocketMode] = useState<BackPocketMode>('all');
  const [backPreset, setBackPreset] = useState<string>('');
  const [showHingeDialog, setShowHingeDialog] = useState(false);
  const [showHandleDialog, setShowHandleDialog] = useState(false);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [savedSep, setSavedSep] = useState(101.6); // preserve last handle separation when switching to knob
  const [thickness, setThickness] = useState(MATERIAL_THICKNESS);
  const [frontPanelTree, setFrontPanelTree] = useState<PanelTree>({ type: 'leaf' });
  const [backPanelTree, setBackPanelTree] = useState<PanelTree>({ type: 'leaf' });
  const [elevationFace, setElevationFace] = useState<'front' | 'back'>('front');
  const [selectedPanels, setSelectedPanels] = useState<Set<number>>(new Set());
  const [selectedSplitPath, setSelectedSplitPath] = useState<number[] | null>(null);
  // Derived: active panel tree for split operations based on elevation face
  const activePanelTree = elevationFace === 'back' ? backPanelTree : frontPanelTree;
  const setActivePanelTree = elevationFace === 'back' ? setBackPanelTree : setFrontPanelTree;
  const [operationVisibility, setOperationVisibility] = useState<OperationVisibility>({});
  const [toolVisibility, setToolVisibility] = useState<ToolVisibility>({});
  const [libraries, setLibraries] = useState<string[]>([]);
  const [selectedConfigStyleId, setSelectedConfigStyleId] = useState<string | null>(null);
  const configData = useConfigData();
  const [doorRenderMode, setDoorRenderMode] = useState<RenderMode>('solid');
  const [elevationRenderMode, setElevationRenderMode] = useState<RenderMode>('solid');
  const [layoutMapping, setLayoutMapping] = useState<LayoutMapping>(() => {
    try { const s = localStorage.getItem('pac-layout-mapping'); if (s) return JSON.parse(s); } catch {}
    return { ...DEFAULT_LAYOUT };
  });
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>(() => {
    try { const s = localStorage.getItem('pac-layout-preset'); if (s === 'compact') return 'compact'; } catch {}
    return 'default';
  });
  const [compactLayoutMapping, setCompactLayoutMapping] = useState<CompactLayoutMapping>(() => {
    try { const s = localStorage.getItem('pac-compact-layout-mapping'); if (s) return JSON.parse(s); } catch {}
    return { ...COMPACT_LAYOUT };
  });
  const [showLayoutCustomizer, setShowLayoutCustomizer] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({
    'left-top': null, 'left-mid': null, 'left-bot': null, 'right-top': null, 'right-bot': null,
    'right-top-left': null, 'right-top-right': null,
  });
  const crossSectionRef = useRef<CrossSectionViewerHandle>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const nextOrderId = useRef(1);
  const [selectionRegistry, setSelectionRegistry] = useState<Map<string, StyleTabMeta>>(new Map());
  const { columns, setColumns } = useOrderColumns();
  const { groupByFields, setGroupByFields } = useGroupByConfig();
  const { watermarkConfig, setWatermarkConfig } = useWatermarkConfig();
  const { viewerSettings, setViewerSettings } = useViewerSettings();
  const activePreset = useMemo(() => getPreset(viewerSettings.lightingPreset), [viewerSettings.lightingPreset]);
  const [orderQty, setOrderQty] = useState(1);
  const [viewingItem, setViewingItem] = useState<OrderItem | null>(null);
  const preSlabGroups = useRef<{ frontGroupId: number | null; backGroupId: number | null; edgeGroupId: number | null } | null>(null);
  const [canvasRect, setCanvasRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [selectedTextures, setSelectedTextures] = useState<{
    painted: string | null; primed: string | null; raw: string | null; sanded: string | null;
  }>({ painted: null, primed: null, raw: null, sanded: null });
  const [activeTextureCategory, setActiveTextureCategory] = useState<'painted' | 'primed' | 'raw' | 'sanded'>('raw');
  const [textureBlobUrls, setTextureBlobUrls] = useState<Record<string, string>>({});
  const [textureManifest, setTextureManifest] = useState<TextureManifest | null>(null);

  // Persist layout + preferences to localStorage
  useEffect(() => { localStorage.setItem('pac-units', units); }, [units]);
  useEffect(() => { localStorage.setItem('pac-fraction-precision', String(fractionPrecision)); }, [fractionPrecision]);
  useEffect(() => {
    localStorage.setItem('pac-layout-mapping', JSON.stringify(layoutMapping));
  }, [layoutMapping]);
  useEffect(() => {
    localStorage.setItem('pac-layout-preset', layoutPreset);
  }, [layoutPreset]);
  useEffect(() => {
    localStorage.setItem('pac-compact-layout-mapping', JSON.stringify(compactLayoutMapping));
  }, [compactLayoutMapping]);

  // Which slot currently holds the 3D canvas?
  const canvasSlot = useMemo(() => {
    if (layoutPreset === 'compact') {
      for (const [slot, panel] of Object.entries(compactLayoutMapping)) {
        if (panel === 'canvas3d') return slot;
      }
      return 'right-top-left';
    }
    for (const [slot, panel] of Object.entries(layoutMapping)) {
      if (panel === 'canvas3d') return slot;
    }
    return 'left-bot';
  }, [layoutMapping, compactLayoutMapping, layoutPreset]);

  // Swap two slots in the layout
  const swapPanels = useCallback((a: SlotPosition, b: SlotPosition) => {
    if (a === b) return;
    setLayoutMapping(prev => ({ ...prev, [a]: prev[b], [b]: prev[a] }));
  }, []);

  // Swap two slots in the compact layout
  const swapCompactPanels = useCallback((a: CompactSlotPosition, b: CompactSlotPosition) => {
    if (a === b) return;
    setCompactLayoutMapping(prev => ({ ...prev, [a]: prev[b], [b]: prev[a] }));
  }, []);

  // Delete selected split on Delete/Backspace key
  useEffect(() => {
    if (!selectedSplitPath) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setActivePanelTree(prev => removeSplit(prev, selectedSplitPath));
        setSelectedSplitPath(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedSplitPath, setActivePanelTree]);

  // Close Admin/Configure overlay on Escape
  useEffect(() => {
    if (currentTab !== 'admin' && currentTab !== 'configure') return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setCurrentTab('door'); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentTab]);

  // Track canvas slot position with ResizeObserver so the floating canvas overlays correctly
  useEffect(() => {
    // Admin is an overlay — keep canvas positioned underneath
    if (currentTab !== 'door' && currentTab !== 'admin' && currentTab !== 'configure') { setCanvasRect(null); return; }
    const el = slotRefs.current[canvasSlot];
    if (!el) return;

    const update = () => {
      const parent = containerRef.current?.getBoundingClientRect();
      const slot = el.getBoundingClientRect();
      if (parent) {
        setCanvasRect({
          top: slot.top - parent.top,
          left: slot.left - parent.left,
          width: slot.width,
          height: slot.height,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Also observe the container for window resize propagation
    if (containerRef.current) ro.observe(containerRef.current);
    update();
    return () => ro.disconnect();
  }, [canvasSlot, currentTab]);

  // Unit conversion helpers for number inputs (internal state always mm)
  const toDisplay = useCallback((mm: number) => units === 'in' ? parseFloat((mm / 25.4).toFixed(4)) : mm, [units]);
  const fromDisplay = useCallback((val: number) => units === 'in' ? val * 25.4 : val, [units]);
  const inputStep = units === 'in' ? 0.125 : 0.5;  // 1/8" or 0.5mm

  // Auto-compute hinge count from config trigger points when doorH or style changes
  useEffect(() => {
    if (!selectedConfigStyleId) return;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return;

    const h3 = (style.params.hinge3Trigger as NumberValue | undefined)?.value ?? 762;
    const h4 = (style.params.hinge4Trigger as NumberValue | undefined)?.value ?? 1219.2;
    const h5 = (style.params.hinge5Trigger as NumberValue | undefined)?.value ?? 1828.8;
    const h6 = (style.params.hinge6Trigger as NumberValue | undefined)?.value ?? 0;
    const edgeDist = (style.params.hingeEdgeDistance as NumberValue | undefined)?.value ?? 76.2;

    const autoCount = computeAutoHingeCount(doorH, { h3, h4, h5, h6 });

    setHingeConfig(prev => ({
      ...prev,
      count: autoCount,
      edgeDistance: edgeDist,
    }));
  }, [doorH, selectedConfigStyleId, configData.matrix]);

  // Derive which texture categories are available for the selected config style
  const availableTextureCategories = useMemo(() => {
    const all: ('painted' | 'primed' | 'raw' | 'sanded')[] = ['raw', 'sanded', 'primed', 'painted'];
    if (!selectedConfigStyleId) return all;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return all;
    const enabled = (style.params.textures as TextureCheckboxListValue | undefined)?.enabledTextures ?? [];
    if (enabled.length === 0) return ['raw', 'sanded'] as typeof all;

    const cats = new Set<'painted' | 'primed' | 'raw' | 'sanded'>(['raw']);
    for (const path of enabled) {
      if (path.startsWith('Painted/')) cats.add('painted');
      else if (path.startsWith('Primed/')) cats.add('primed');
      else if (path.startsWith('Sanded/')) cats.add('sanded');
      else if (path.startsWith('Raw/')) cats.add('raw');
    }
    return all.filter(c => cats.has(c));
  }, [selectedConfigStyleId, configData.matrix]);

  // Auto-switch active texture category when current selection is filtered out
  useEffect(() => {
    if (!availableTextureCategories.includes(activeTextureCategory)) {
      setActiveTextureCategory(
        availableTextureCategories.includes('primed') ? 'primed' : 'raw',
      );
    }
  }, [availableTextureCategories, activeTextureCategory]);

  // Default to primed on style change (if available)
  useEffect(() => {
    setActiveTextureCategory(
      availableTextureCategories.includes('primed') ? 'primed' : 'raw',
    );
  }, [selectedConfigStyleId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Config styles for the toolbar dropdown
  const configStyles = useMemo(
    () => configData.matrix
      .filter(s => {
        const ds = s.params.doorStyles as GroupDepthListValue | undefined;
        return ds?.entries && ds.entries.length > 0;
      })
      .map(s => ({ id: s.id, name: s.displayName })),
    [configData.matrix],
  );

  // Filter panel tool groups based on selected config style
  const filteredPanelToolGroups = useMemo(() => {
    if (!selectedConfigStyleId) return panelToolGroups;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return panelToolGroups;
    const doorStylesParam = style.params.doorStyles as GroupDepthListValue | undefined;
    const entries = doorStylesParam?.entries;
    if (!entries || entries.length === 0) return [];
    return panelToolGroups.filter(g => entries.some(e => e.groupId === g.ToolGroupID));
  }, [panelToolGroups, selectedConfigStyleId, configData.matrix]);

  // Kerf feature: enabled flag and available tool groups from selected config style
  const kerfEnabled = useMemo(() => {
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    return (style?.params.kerfEnabled as BooleanRadioValue | undefined)?.enabled ?? false;
  }, [configData.matrix, selectedConfigStyleId]);

  const kerfToolGroups = useMemo(() => {
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    const param = style?.params.kerfToolGroups as GroupDepthListValue | undefined;
    const ids = param?.entries.map(e => e.groupId) ?? [];
    return panelToolGroups.filter(g => ids.includes(g.ToolGroupID));
  }, [configData.matrix, selectedConfigStyleId, panelToolGroups]);

  // Filter edge tool groups based on selected config style
  const filteredEdgeToolGroups = useMemo(() => {
    if (!selectedConfigStyleId) return edgeToolGroups;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return edgeToolGroups;
    const hasEdgesParam = style.params.hasEdges as CheckboxListValue | undefined;
    const enabledIds = hasEdgesParam?.enabledGroupIds;
    if (!enabledIds || enabledIds.length === 0) return [];
    return edgeToolGroups.filter(g => enabledIds.includes(g.ToolGroupID));
  }, [edgeToolGroups, selectedConfigStyleId, configData.matrix]);

  // Filter panel types based on selected config style
  const filteredPanelTypes = useMemo(() => {
    if (!selectedConfigStyleId) return undefined; // undefined = show all
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return undefined;
    const param = style.params.panelTypes as FixedCheckboxListValue | undefined;
    const enabled = param?.enabledOptions;
    if (!enabled || enabled.length === 0) return undefined;
    return PANEL_TYPES.filter(pt => enabled.includes(pt.value));
  }, [selectedConfigStyleId, configData.matrix]);

  // Build full back presets list (including "none") for filtering
  const BACK_PRESETS_WITH_NONE = useMemo(() => [
    { value: 'none', label: '\u2298' },
    ...BACK_PRESETS.map(bp => ({ value: bp.value, label: bp.label })),
  ], []);

  // Filter back presets based on selected config style
  const filteredBackPresets = useMemo(() => {
    if (!selectedConfigStyleId) return undefined;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return undefined;
    const param = style.params.backOperations as FixedCheckboxListValue | undefined;
    const enabled = param?.enabledOptions;
    if (!enabled || enabled.length === 0) return undefined;
    return BACK_PRESETS_WITH_NONE.filter(bp => enabled.includes(bp.value));
  }, [selectedConfigStyleId, configData.matrix, BACK_PRESETS_WITH_NONE]);

  // Filter door types based on selected config style
  const filteredDoorTypes = useMemo(() => {
    if (!selectedConfigStyleId) return undefined;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return undefined;
    const param = style.params.doorTypes as FixedCheckboxListValue | undefined;
    const enabled = param?.enabledOptions;
    if (!enabled || enabled.length === 0) return undefined;
    return DOOR_TYPES.filter(dt => enabled.includes(dt.value));
  }, [selectedConfigStyleId, configData.matrix]);

  // Extract enabled stile/rail presets from config (sorted, in mm)
  const stylePresets = useMemo(() => {
    if (!selectedConfigStyleId) return [];
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return [];
    const param = style.params.stileRailPresets as PresetCheckboxValue | undefined;
    const widths = param?.enabledWidths ?? [];
    return [...widths].sort((a, b) => a - b);
  }, [selectedConfigStyleId, configData.matrix]);

  // Extract configured back route groups with resolved names
  const configuredBackRouteGroups = useMemo(() => {
    if (!selectedConfigStyleId) return [];
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return [];
    const param = style.params.backRouteGroups as GroupDepthListValue | undefined;
    const entries = param?.entries ?? [];
    return entries
      .map(e => {
        const tg = toolGroups.find(g => g.ToolGroupID === e.groupId);
        return tg ? { groupId: e.groupId, depth: e.depth, groupName: tg.Name } : null;
      })
      .filter((x): x is { groupId: number; depth: number; groupName: string } => x !== null);
  }, [selectedConfigStyleId, configData.matrix, toolGroups]);

  // Extract configured back pocket groups with resolved names
  const configuredBackPocketGroups = useMemo(() => {
    if (!selectedConfigStyleId) return [];
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return [];
    const param = style.params.backPocketGroups as GroupDepthListValue | undefined;
    const entries = param?.entries ?? [];
    return entries
      .map(e => {
        const tg = toolGroups.find(g => g.ToolGroupID === e.groupId);
        return tg ? { groupId: e.groupId, depth: e.depth, groupName: tg.Name } : null;
      })
      .filter((x): x is { groupId: number; depth: number; groupName: string } => x !== null);
  }, [selectedConfigStyleId, configData.matrix, toolGroups]);

  // Extract configured back custom groups with resolved names
  const configuredBackCustomGroups = useMemo(() => {
    if (!selectedConfigStyleId) return [];
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return [];
    const param = style.params.backCustomGroups as GroupDepthListValue | undefined;
    const entries = param?.entries ?? [];
    return entries
      .map(e => {
        const tg = toolGroups.find(g => g.ToolGroupID === e.groupId);
        return tg ? { groupId: e.groupId, depth: e.depth, groupName: tg.Name } : null;
      })
      .filter((x): x is { groupId: number; depth: number; groupName: string } => x !== null);
  }, [selectedConfigStyleId, configData.matrix, toolGroups]);

  // Derive back pocket depth reactively from whichever configured group list owns backGroupId.
  // This ensures Configure-tab depth changes flow immediately to the 3D model without requiring
  // the user to re-click the preset button.
  const backDepth = useMemo(() => {
    if (!backGroupId) return 3.175;
    const customEntry = configuredBackCustomGroups.find(g => g.groupId === backGroupId);
    if (customEntry) return customEntry.depth;
    const pocketEntry = configuredBackPocketGroups.find(g => g.groupId === backGroupId);
    if (pocketEntry) return pocketEntry.depth;
    const routeEntry = configuredBackRouteGroups.find(g => g.groupId === backGroupId);
    if (routeEntry) return routeEntry.depth;
    return 3.175; // back-route "use frontGroupId" fallback — no configured depth entry
  }, [backGroupId, configuredBackCustomGroups, configuredBackPocketGroups, configuredBackRouteGroups]);

  // When config style changes, auto-set front tool group from its enabledGroupIds
  const handleConfigStyleChange = useCallback((id: string | null) => {
    setSelectedConfigStyleId(id);
    if (!id) {
      setFrontGroupId(null);
      setEdgeGroupId(null);
      setToolVisibility({});
      return;
    }
    const style = configData.matrix.find(s => s.id === id);
    const doorStylesParam = style?.params.doorStyles as GroupDepthListValue | undefined;
    const entries = doorStylesParam?.entries;
    if (entries && entries.length > 0) {
      setFrontGroupId(entries[0].groupId);
      setFrontDepth(entries[0].depth);
    } else {
      setFrontGroupId(null);
    }
    // Validate edge group against new style's configured edges
    const hasEdgesParam = style?.params.hasEdges as CheckboxListValue | undefined;
    const enabledEdgeIds = hasEdgesParam?.enabledGroupIds;
    if (enabledEdgeIds && enabledEdgeIds.length > 0) {
      if (edgeGroupId !== null && !enabledEdgeIds.includes(edgeGroupId)) {
        setEdgeGroupId(null);
      }
    } else {
      setEdgeGroupId(null);
    }
    setToolVisibility({});
    setBackPreset('');
    setBackGroupId(null);
  }, [configData.matrix, edgeGroupId]);

  // Auto-select the default style on initial load
  const defaultAutoSelected = useRef(false);
  useEffect(() => {
    if (defaultAutoSelected.current || configData.loading || selectedConfigStyleId) return;
    const defaultStyle = configData.matrix.find(s => {
      const v = s.params.isDefault as BooleanRadioValue | undefined;
      return v?.enabled === true;
    });
    if (defaultStyle) {
      defaultAutoSelected.current = true;
      handleConfigStyleChange(defaultStyle.id);
    }
  }, [configData.matrix, configData.loading, selectedConfigStyleId, handleConfigStyleChange]);

  // When panel type changes to glass, switch to glass tool group if configured
  const handleFrontPanelTypeChange = useCallback((type: PanelType) => {
    setFrontPanelType(type);
    if (!selectedConfigStyleId) return;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (!style) return;
    if (type === 'glass') {
      const glassParam = style.params.glassToolGroup as CheckboxListValue | undefined;
      const glassIds = glassParam?.enabledGroupIds;
      if (glassIds && glassIds.length > 0) {
        setFrontGroupId(glassIds[0]);
        setToolVisibility({});
      }
    } else {
      // Switch back to normal door style tool group
      const doorStylesParam = style.params.doorStyles as GroupDepthListValue | undefined;
      const entries = doorStylesParam?.entries;
      if (entries && entries.length > 0) {
        setFrontGroupId(entries[0].groupId);
        setFrontDepth(entries[0].depth);
        setToolVisibility({});
      }
    }
  }, [selectedConfigStyleId, configData.matrix]);

  // Style editor preset — sets all four stile/rail widths to the same value
  const handleStylePresetSelect = useCallback((widthMm: number) => {
    setLeftStileW(widthMm);
    setRightStileW(widthMm);
    setTopRailW(widthMm);
    setBottomRailW(widthMm);
  }, []);

  // Back route group+depth selection from sub-dropdown (depth now derived, no longer stored)
  const handleBackRouteGroupSelect = useCallback((groupId: number, _depth: number) => {
    setBackGroupId(groupId);
    setBackPanelType('pocket');
    setToolVisibility({});
  }, []);

  // Back pocket group+depth selection from sub-dropdown
  const handleBackPocketGroupSelect = useCallback((groupId: number, _depth: number) => {
    setBackGroupId(groupId);
    setBackPanelType('pocket');
    setToolVisibility({});
  }, []);

  // Back custom group+depth selection from sub-dropdown
  const handleBackCustomGroupSelect = useCallback((groupId: number, _depth: number) => {
    setBackGroupId(groupId);
    setBackPanelType('pocket');
    setToolVisibility({});
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
      // Save current tool groups before clearing
      preSlabGroups.current = { frontGroupId, backGroupId, edgeGroupId };
      setFrontGroupId(null);
      setBackGroupId(null);
      setEdgeGroupId(null);
    } else if (doorPartType === 'slab' && preSlabGroups.current) {
      // Restore tool groups when switching away from slab
      setFrontGroupId(preSlabGroups.current.frontGroupId);
      setBackGroupId(preSlabGroups.current.backGroupId);
      setEdgeGroupId(preSlabGroups.current.edgeGroupId);
      preSlabGroups.current = null;
    }
    // Reset panel trees (clear mid rails/stiles) and kerfs
    setFrontPanelTree({ type: 'leaf' });
    setBackPanelTree({ type: 'leaf' });
    setSelectedPanels(new Set());
    setSelectedSplitPath(null);
    setKerfs([]);
  }, [frontGroupId, backGroupId, edgeGroupId, doorPartType]);

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

  // Route auto-follow: keep back group in sync with front group (only when no route groups configured)
  useEffect(() => {
    if (backPreset === 'back-route' && configuredBackRouteGroups.length === 0) {
      setBackGroupId(frontGroupId);
    }
  }, [backPreset, frontGroupId, configuredBackRouteGroups.length]);

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
          frontPanelTree, backPanelTree, holes,
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
  }, [isGenericDoor, frontGroupId, backGroupId, backPreset, effectiveFrontDepth, effectiveBackDepth,
      leftStileW, rightStileW, topRailW, bottomRailW, frontPanelTree, backPanelTree, holes,
      toolGroups, tools, doors, selectedIndex, graphs, doorW, doorH, doorPartType,
      backPocketMode, selectedPanels, edgeGroupId]);

  // Reference door for cross-section — only reacts to tool/style changes, not dimensions
  const { crossSectionDoor, crossSectionGraph } = useMemo(() => {
    if (!isGenericDoor) {
      return { crossSectionDoor: activeDoor, crossSectionGraph: activeGraph };
    }
    const isSlab = doorPartType === 'slab';
    const effFrontId = isSlab ? null : frontGroupId;
    const effBackId = isSlab ? null : backGroupId;
    if (effFrontId === null && !isSlab) {
      return { crossSectionDoor: undefined, crossSectionGraph: undefined };
    }
    const REF_SIZE = 762;       // 30"
    const REF_STILE = 57.15;   // 2-1/4"
    const REF_RAIL = 57.15;
    const result = buildGenericDoor(
      toolGroups, tools, effFrontId, effBackId,
      effectiveFrontDepth, effectiveBackDepth,
      REF_SIZE, REF_SIZE,
      isSlab ? 0 : REF_STILE, isSlab ? 0 : REF_STILE,
      isSlab ? 0 : REF_RAIL, isSlab ? 0 : REF_RAIL,
      undefined, undefined, [],
      backPocketMode, new Set<number>(),
      isSlab ? null : edgeGroupId,
    );
    return { crossSectionDoor: result.door, crossSectionGraph: result.graph };
  }, [isGenericDoor, frontGroupId, backGroupId, backPreset,
      effectiveFrontDepth, effectiveBackDepth,
      toolGroups, tools, doorPartType, backPocketMode, edgeGroupId,
      activeDoor, activeGraph]);

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

  // Add an item to the order (called by "Add to Order" button in DoorEditorToolbar)
  const handleAddOrderItem = useCallback((qty: number, note: string, w: number, h: number) => {
    if (!activeDoor) return;

    // Style name and group key
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    const styleName = style?.displayName ?? 'None';
    // Door type label (used in selectionKey for grouping)
    const doorTypeLabels: Record<string, string> = {
      door: 'Door', drawer: 'Drawer', 'reduced-rail': 'Reduced', slab: 'Slab', 'end-panel': 'End Panel',
    };
    const doorTypeLabel = doorTypeLabels[doorPartType] || doorPartType;
    // selectionKey is used for row grouping within the style tab
    const selectionKey = `${styleName}||${doorTypeLabel}||${activeTextureCategory}`;
    // Tab is keyed by styleName only
    const styleTabKey = styleName;
    const selectionLabel = styleName; // label shown in tab

    // Register style tab if not already in registry
    if (!selectionRegistry.has(styleTabKey)) {
      const capturedId = selectedConfigStyleId;
      setSelectionRegistry(prev => {
        const next = new Map(prev);
        next.set(styleTabKey, { label: selectionLabel, styleId: capturedId });
        return next;
      });
    }

    // Edge name
    const edgeGroup = filteredEdgeToolGroups.find(g => g.ToolGroupID === edgeGroupId);
    const edgeName = edgeGroup?.Name ?? 'None';

    // Back label
    let backLabel = 'None';
    if (backPreset === 'back-route') backLabel = 'Route';
    else if (backPreset === 'back-pocket') backLabel = 'Pocket';
    else if (backPreset === 'back-bridge') backLabel = 'Bridge';
    else if (backPreset === 'custom' && backGroupId !== null) {
      const bg = filteredPanelToolGroups.find(g => g.ToolGroupID === backGroupId);
      backLabel = bg?.Name ?? 'Custom';
    }

    // Hinge summary
    let hingeSummary = 'None';
    if (doorPartType === 'door' && hingeConfig.enabled) {
      const side = hingeConfig.side.charAt(0).toUpperCase() + hingeConfig.side.slice(1);
      hingeSummary = `${side} \u00D7 ${hingeConfig.count}`;
    } else if (doorPartType === 'slab') {
      hingeSummary = '\u2014';
    }

    // Handle summary
    let handleSummary = 'None';
    if (handleConfig.enabled && doorPartType !== 'slab') {
      const type = handleConfig.holeSeparation === 0 ? 'Knob' : 'Handle';
      if (doorPartType === 'door') {
        const placements: Record<string, string> = {
          top: 'Top', 'center-top': 'Center-Top', middle: 'Middle', bottom: 'Bottom', custom: 'Custom',
        };
        handleSummary = `${type} \u2013 ${placements[handleConfig.doorPlacement] || handleConfig.doorPlacement}`;
      } else {
        const placements: Record<string, string> = {
          center: 'Center', 'top-rail': 'Top Rail', 'two-equidistant': 'Two',
        };
        handleSummary = `${type} \u2013 ${placements[handleConfig.placement] || handleConfig.placement}`;
      }
    } else if (doorPartType === 'slab') {
      handleSummary = '\u2014';
    }

    // Hinge / hardware display columns
    const hingesDisplay =
      doorPartType === 'door' && hingeConfig.enabled
        ? `${hingeConfig.side[0].toUpperCase()} ${hingeConfig.count}`
        : doorPartType === 'slab' ? '\u2014' : 'NA';

    const hardwareDisplay =
      handleConfig.enabled && doorPartType !== 'slab'
        ? (handleConfig.holeSeparation === 0 ? 'K' : 'H')
        : doorPartType === 'slab' ? '\u2014' : 'NA';

    // Capture cross-section snapshot
    const crossSectionImage = crossSectionRef.current?.captureSnapshot() ?? null;

    // Price: $15/sqft
    const price = Math.round((w / 304.8) * (h / 304.8) * 15 * 100) / 100;

    const item: OrderItem = {
      id: nextOrderId.current++,
      selectionKey,
      selectionLabel,
      qty,
      note,
      roomName: '',
      cabNumber: '',
      material: '',
      doorW: w,
      doorH: h,
      thickness,
      textureCategory: activeTextureCategory,
      paintPath: activeTextureCategory === 'painted' ? (selectedTextures.painted ?? null) : null,
      styleName,
      edgeName,
      backLabel,
      doorType: doorTypeLabel,
      frontPanelType,
      hingeSummary,
      handleSummary,
      hingesDisplay,
      hardwareDisplay,
      customData: {},
      price,
      crossSectionImage,
      panelTree: frontPanelTree,
      backPanelTree,
      leftStileW,
      rightStileW,
      topRailW,
      bottomRailW,
      activeDoor,
      hingeConfig: { ...hingeConfig },
      handleConfig: { ...handleConfig },
    };
    setOrderItems(prev => [...prev, item]);
  }, [configData.matrix, selectedConfigStyleId, filteredEdgeToolGroups, edgeGroupId,
      backPreset, backGroupId, filteredPanelToolGroups, doorPartType, hingeConfig,
      handleConfig, activeTextureCategory, selectedTextures, frontPanelType, thickness, activeDoor,
      frontPanelTree, backPanelTree, leftStileW, rightStileW, topRailW, bottomRailW, selectionRegistry]);

  const handleUpdateOrderItem = useCallback((id: number, changes: Partial<Pick<OrderItem, 'qty' | 'note' | 'roomName' | 'cabNumber' | 'material' | 'customData' | 'doorH' | 'doorW' | 'thickness' | 'paintPath' | 'hingesDisplay' | 'hardwareDisplay'>>) => {
    setOrderItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (changes.customData) {
        return { ...item, ...changes, customData: { ...item.customData, ...changes.customData } };
      }
      return { ...item, ...changes };
    }));
  }, []);

  const handleAddToOrder = useCallback(() => {
    handleAddOrderItem(orderQty, '', doorW, doorH);
  }, [handleAddOrderItem, orderQty, doorW, doorH]);

  const handleQuickAdd = useCallback((h: number, w: number) => {
    handleAddOrderItem(1, '', w, h);
  }, [handleAddOrderItem]);

  const handleLoadOrderItem = useCallback((item: OrderItem) => {
    setDoorW(item.doorW);
    setDoorH(item.doorH);
    setFrontPanelTree(item.panelTree);
    setBackPanelTree(item.backPanelTree ?? { type: 'leaf' });
    setLeftStileW(item.leftStileW);
    setRightStileW(item.rightStileW);
    setTopRailW(item.topRailW);
    setBottomRailW(item.bottomRailW);
    setHingeConfig(item.hingeConfig);
    setHandleConfig(item.handleConfig);
    setFrontPanelType(item.frontPanelType);
    setActiveTextureCategory(item.textureCategory as 'painted' | 'primed' | 'raw' | 'sanded');
  }, []);

  const handleSelectionTabClick = useCallback((key: string) => {
    const meta = selectionRegistry.get(key);
    if (!meta) return;
    if (meta.styleId !== null) handleConfigStyleChange(meta.styleId);
  }, [selectionRegistry, handleConfigStyleChange]);

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
    setActivePanelTree(prev => {
      const splits = enumerateSplits(prev);
      const split = splits.find(s => pathsEqual(s.path, path));
      return updateSplit(prev, path, newPos, split?.width ?? 76.2);
    });
  }, [setActivePanelTree]);

  const handleSplitWidthChange = useCallback((path: number[], newWidth: number) => {
    setActivePanelTree(prev => {
      const splits = enumerateSplits(prev);
      const split = splits.find(s => pathsEqual(s.path, path));
      if (!split) return prev;
      return updateSplit(prev, path, split.pos, newWidth);
    });
  }, [setActivePanelTree]);

  // Add split at a panel's center (used by MR/MS buttons in elevation)
  const handleAddMidRail = useCallback((panelIdx: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    setActivePanelTree(prev => addSplitAtLeaf(prev, panelIdx, 'hsplit', (pb.xMin + pb.xMax) / 2, 76.2));
    setSelectedPanels(new Set());
  }, [panelBounds, setActivePanelTree]);

  const handleAddMidStile = useCallback((panelIdx: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    setActivePanelTree(prev => addSplitAtLeaf(prev, panelIdx, 'vsplit', (pb.yMin + pb.yMax) / 2, 76.2));
    setSelectedPanels(new Set());
  }, [panelBounds, setActivePanelTree]);

  const handleDeleteSplit = useCallback((path: number[]) => {
    setActivePanelTree(prev => removeSplit(prev, path));
    setSelectedSplitPath(null);
  }, [setActivePanelTree]);

  const handleAddEqualMidRails = useCallback((panelIdx: number, count: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    const span = pb.xMax - pb.xMin;
    const positions = Array.from({ length: count - 1 }, (_, k) => pb.xMin + (k + 1) * span / count);
    setActivePanelTree(prev => replaceLeafAt(prev, panelIdx, buildSplitChain('hsplit', positions, 76.2)));
    setSelectedPanels(new Set());
  }, [panelBounds, setActivePanelTree]);

  const handleAddEqualMidStiles = useCallback((panelIdx: number, count: number) => {
    if (!panelBounds || panelIdx < 0 || panelIdx >= panelBounds.length) return;
    const pb = panelBounds[panelIdx];
    const span = pb.yMax - pb.yMin;
    const positions = Array.from({ length: count - 1 }, (_, k) => pb.yMin + (k + 1) * span / count);
    setActivePanelTree(prev => replaceLeafAt(prev, panelIdx, buildSplitChain('vsplit', positions, 76.2)));
    setSelectedPanels(new Set());
  }, [panelBounds, setActivePanelTree]);

  const handleDeselectAll = useCallback(() => {
    setSelectedPanels(new Set());
    setSelectedSplitPath(null);
  }, []);

  const handleResetElevation = useCallback(() => {
    const style = selectedConfigStyleId
      ? configData.matrix.find(s => s.id === selectedConfigStyleId)
      : null;
    const defaultStile = (style?.params.stileMin as NumberValue | undefined)?.value ?? 63.5;
    const defaultRail  = (style?.params.railMin  as NumberValue | undefined)?.value ?? 63.5;
    setLeftStileW(defaultStile);
    setRightStileW(defaultStile);
    setTopRailW(defaultRail);
    setBottomRailW(defaultRail);
    setFrontPanelTree({ type: 'leaf' });
    setBackPanelTree({ type: 'leaf' });
    setSelectedPanels(new Set());
    setSelectedSplitPath(null);
    setKerfs([]);
  }, [selectedConfigStyleId, configData.matrix]);

  const handleAddKerf = useCallback((orientation: 'H' | 'V', centerMm: number, toolGroupId: number | null) => {
    // Look up kerf depth from configured tool group depths
    let depth: number | undefined;
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    if (style && toolGroupId != null) {
      const param = style.params.kerfToolGroups as GroupDepthListValue | undefined;
      const entry = param?.entries.find(e => e.groupId === toolGroupId);
      if (entry?.depth != null) depth = entry.depth;
    }
    setKerfs(prev => [...prev, { id: Date.now(), orientation, centerMm, toolGroupId, depth }]);
  }, [configData.matrix, selectedConfigStyleId]);

  const handleDeleteKerf = useCallback((id: number) => {
    setKerfs(prev => prev.filter(k => k.id !== id));
  }, []);

  const handleMoveKerf = useCallback((id: number, newCenterMm: number) => {
    setKerfs(prev => prev.map(k => k.id === id ? { ...k, centerMm: newCenterMm } : k));
  }, []);

  // Texture URL for 3D door — uses active category's blob URL
  const activeTexturePath = selectedTextures[activeTextureCategory];
  const textureUrl = activeTexturePath ? textureBlobUrls[activeTexturePath] : undefined;

  const handleActiveTextureCategoryChange = useCallback((cat: 'painted' | 'primed' | 'raw' | 'sanded') => {
    setActiveTextureCategory(cat);
  }, []);

  // Elevation tree — computed once, used by both standalone tab and embedded dashboard
  const elevationTree = activeDoor
    ? (isGenericDoor ? activePanelTree : libraryDoorToTree(activeDoor.MainSection.Dividers?.Divider))
    : activePanelTree; // fallback for when no door is active
  // Opposite-face tree for green-hatched rendering
  const oppositeTree = elevationFace === 'back' ? frontPanelTree : backPanelTree;

  // Current style key — used to auto-sync the Order panel's active tab to the selected style
  const currentSelectionKey = useMemo(() => {
    const style = configData.matrix.find(s => s.id === selectedConfigStyleId);
    return style?.displayName ?? 'None';
  }, [configData.matrix, selectedConfigStyleId]);

  // Ordered list of selection tabs (insertion order preserved by Map)
  const selectionTabs = useMemo(
    () => Array.from(selectionRegistry.entries()).map(([key, meta]) => ({ key, label: meta.label })),
    [selectionRegistry],
  );

  // Shared toolbar props (rendered in two positions for swap, but only one visible at a time)
  const toolbarProps = {
    activeTextureCategory,
    onTextureCategoryChange: handleActiveTextureCategoryChange,
    selectedTextures,
    availableTextureCategories,
    frontPanelType,
    onFrontPanelTypeChange: handleFrontPanelTypeChange,
    configStyles,
    selectedConfigStyleId,
    onConfigStyleChange: handleConfigStyleChange,
    onEditStyleClick: () => setShowStyleEditor(true),
    panelToolGroups: filteredPanelToolGroups,
    edgeGroupId,
    onEdgeGroupChange: (id: number | null) => { setEdgeGroupId(id); setToolVisibility({}); },
    edgeToolGroups: filteredEdgeToolGroups,
    backPreset,
    onBackPresetChange: (preset: string) => {
      setBackPreset(preset);
      if (preset === '') {
        // None — clear back
        setBackGroupId(null);
        setBackPanelType('raised');
      } else if (preset === 'back-route') {
        // Route — configured groups override front+back; fallback to front group
        if (configuredBackRouteGroups.length === 1) {
          setBackGroupId(configuredBackRouteGroups[0].groupId);
          setBackPanelType('pocket');
        } else if (configuredBackRouteGroups.length === 0) {
          setBackGroupId(frontGroupId);
          setBackPanelType('pocket');
        } else {
          setBackGroupId(null);
        }
      } else if (preset === 'back-pocket') {
        // Pocket — auto-select if exactly 1 configured group, else wait for sub-dropdown
        if (configuredBackPocketGroups.length === 1) {
          setBackGroupId(configuredBackPocketGroups[0].groupId);
          setBackPanelType('pocket');
        } else {
          setBackGroupId(null);
        }
      } else if (preset === 'custom') {
        // Custom — auto-select if exactly 1 configured group, else wait for sub-dropdown
        if (configuredBackCustomGroups.length === 1) {
          setBackGroupId(configuredBackCustomGroups[0].groupId);
          setBackPanelType('pocket');
        } else {
          setBackGroupId(null);
        }
      } else {
        // Bridge or other — clear (TBD)
        setBackGroupId(null);
      }
      setToolVisibility({});
    },
    customBackGroupId: backGroupId,
    onCustomBackGroupChange: (id: number | null) => { setBackGroupId(id); if (id !== null) setBackPanelType('pocket'); setToolVisibility({}); },
    backRouteGroups: configuredBackRouteGroups,
    backPocketGroups: configuredBackPocketGroups,
    backCustomGroups: configuredBackCustomGroups,
    onBackRouteGroupSelect: handleBackRouteGroupSelect,
    onBackPocketGroupSelect: handleBackPocketGroupSelect,
    onBackCustomGroupSelect: handleBackCustomGroupSelect,
    doorPartType,
    onDoorPartTypeChange: handleDoorPartTypeChange,
    hingeEnabled: hingeConfig.enabled,
    onHingeEnabledChange: (enabled: boolean) => setHingeConfig(prev => ({ ...prev, enabled })),
    hingeSide: hingeConfig.side,
    onHingeSideChange: handleHingeSideChange,
    hingeCount: hingeConfig.count,
    onHingeCountChange: handleHingeCountChange,
    onHingeAdvancedClick: () => setShowHingeDialog(true),
    handleEnabled: handleConfig.enabled,
    onHandleEnabledChange: (enabled: boolean) => setHandleConfig(prev => ({ ...prev, enabled })),
    isKnob: handleConfig.holeSeparation === 0,
    onHandleTypeChange: handleHandleTypeChange,
    doorPlacement: handleConfig.doorPlacement,
    onDoorPlacementChange: handleDoorPlacementChange,
    onHandleAdvancedClick: () => setShowHandleDialog(true),
    doorW, doorH, thickness,
    onDoorWChange: setDoorW,
    onDoorHChange: setDoorH,
    onThicknessChange: setThickness,
    toDisplay, fromDisplay, inputStep,
    onExport: handleExport,
    onAddToOrder: handleAddToOrder,
    orderQty,
    onOrderQtyChange: setOrderQty,
    hardwareWarnings,
    filteredPanelTypes,
    filteredBackPresets,
    filteredDoorTypes,
    paintManifest: textureManifest?.painted ?? {},
    textureBlobUrls,
    onPaintColorSelect: (path: string, blobUrl: string | null) => {
      setSelectedTextures(prev => ({ ...prev, painted: path }));
      if (path && blobUrl) setTextureBlobUrls(prev => ({ ...prev, [path]: blobUrl }));
    },
  };

  // Camera distance based on door size (use actual doorW/doorH for generic mode)
  const maxDim = activeDoor ? Math.max(doorW, doorH) : 500;
  const camDist = maxDim * 1.8;

  // Render content for a given layout slot
  const renderSlotContent = useCallback((slot: string) => {
    const panelId = layoutPreset === 'compact'
      ? compactLayoutMapping[slot as CompactSlotPosition]
      : layoutMapping[slot as SlotPosition];
    const placeholder = (text: string) => (
      <div style={{ width: '100%', height: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
        {text}
      </div>
    );
    return (
      <div
        ref={el => { slotRefs.current[slot] = el; }}
        style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        {panelId === 'canvas3d' ? (
          // Empty placeholder — the Canvas overlays this via absolute positioning
          <div style={{ width: '100%', height: '100%' }} />
        ) : panelId === 'toolbar' ? (
          <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#fff' }}>
            <DoorEditorToolbar {...toolbarProps} />
          </div>
        ) : panelId === 'crossSection' ? (
          crossSectionDoor ? (
            <CrossSectionViewer
              ref={crossSectionRef}
              compact
              door={crossSectionDoor}
              graph={crossSectionGraph}
              profiles={profiles}
              frontPanelType={frontPanelType}
              backPanelType={backPanelType}
              hasBackRabbit={frontPanelType === 'glass' ? hasBackRabbit : undefined}
              units={units}
              edgeGroupId={edgeGroupId}
              thickness={thickness}
              watermark={watermarkConfig.text || undefined}
              watermarkSize={watermarkFontSize(watermarkConfig.size)}
              watermarkOpacity={watermarkConfig.opacity}
            />
          ) : placeholder(loading ? 'Loading...' : 'Select a tool group to begin')
        ) : panelId === 'elevation' ? (
          activeDoor ? (
            <ElevationViewer
              compact
              door={activeDoor}
              units={units}
              fractionPrecision={fractionPrecision}
              panelTree={elevationTree}
              oppositeTree={oppositeTree}
              elevationFace={elevationFace}
              onElevationFaceChange={setElevationFace}
              handleConfig={handleConfig}
              renderMode={elevationRenderMode}
              onRenderModeChange={setElevationRenderMode}
              selectedSplitPath={selectedSplitPath}
              onSplitSelect={handleSplitSelect}
              onSplitDragEnd={handleSplitDragEnd}
              onLeftStileWidthChange={setLeftStileW}
              onRightStileWidthChange={setRightStileW}
              onTopRailWidthChange={setTopRailW}
              onBottomRailWidthChange={setBottomRailW}
              onSplitWidthChange={handleSplitWidthChange}
              overrideLeftStileW={leftStileW}
              overrideRightStileW={rightStileW}
              overrideTopRailW={topRailW}
              overrideBottomRailW={bottomRailW}
              onReset={handleResetElevation}
              onPanelSelect={handlePanelSelect}
              selectedPanelIndices={selectedPanels}
              onAddMidRail={handleAddMidRail}
              onAddMidStile={handleAddMidStile}
              onDeleteSplit={handleDeleteSplit}
              onAddEqualMidRails={handleAddEqualMidRails}
              onAddEqualMidStiles={handleAddEqualMidStiles}
              onDeselectAll={handleDeselectAll}
              hingeConfig={hingeConfig}
              onHingePositionChange={handleHingePositionChange}
              onHandleElevationChange={handleHandleElevationChange}
              kerfs={kerfs}
              kerfEnabled={kerfEnabled}
              kerfToolGroups={kerfToolGroups}
              onAddKerf={handleAddKerf}
              onDeleteKerf={handleDeleteKerf}
              onMoveKerf={handleMoveKerf}
            />
          ) : placeholder('Elevation')
        ) : (
          // orderList
          <OrderPanel
            items={orderItems}
            columns={columns}
            groupByFields={groupByFields}
            styleTabs={selectionTabs}
            currentStyleKey={currentSelectionKey}
            units={units}
            onAddItem={handleAddOrderItem}
            onRemoveItem={(id) => setOrderItems(prev => prev.filter(i => i.id !== id))}
            onUpdateItem={handleUpdateOrderItem}
            textureBlobUrls={textureBlobUrls}
            onViewItem={setViewingItem}
            onStyleTabClick={handleSelectionTabClick}
            onQuickAdd={handleQuickAdd}
            onLoadItem={handleLoadOrderItem}
          />
        )}
      </div>
    );
  }, [layoutMapping, layoutPreset, toolbarProps, activeDoor, activeGraph, crossSectionDoor, crossSectionGraph,
      profiles, frontPanelType, backPanelType,
      hasBackRabbit, units, edgeGroupId, thickness, loading, elevationTree, oppositeTree, elevationFace, handleConfig,
      elevationRenderMode, selectedSplitPath, leftStileW, rightStileW, selectedPanels, hingeConfig,
      orderItems, selectionTabs, currentSelectionKey, columns, groupByFields, textureBlobUrls, handleAddOrderItem,
      handleUpdateOrderItem, handleSelectionTabClick, handleQuickAdd, handleLoadOrderItem,
      handleDeleteSplit, handleAddEqualMidRails, handleAddEqualMidStiles, watermarkConfig, orderQty,
      kerfs, kerfEnabled, kerfToolGroups, handleAddKerf, handleDeleteKerf, handleMoveKerf]);

  return (
    <div style={styles.container}>
      <TabBar currentTab={currentTab} onTabChange={setCurrentTab} units={units} onUnitsChange={setUnits} />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, top: 40 }}>
        {layoutPreset === 'compact' ? (
          /* Compact: 2 tall left panels + top-right split (3D | elevation) + bottom-right order list */
          <PanelGroup orientation="horizontal" style={{ width: '100%', height: '100%' }}>
            <Panel defaultSize={35} minSize={20}>
              <PanelGroup orientation="vertical">
                <Panel defaultSize={50} minSize={20}>
                  {renderSlotContent('left-top')}
                </Panel>
                <Separator className="resize-handle-v" />
                <Panel defaultSize={50} minSize={20}>
                  {renderSlotContent('left-bot')}
                </Panel>
              </PanelGroup>
            </Panel>
            <Separator className="resize-handle-h" />
            <Panel defaultSize={65} minSize={30}>
              <PanelGroup orientation="vertical">
                <Panel defaultSize={60} minSize={20}>
                  <PanelGroup orientation="horizontal">
                    <Panel defaultSize={50} minSize={20}>
                      {renderSlotContent('right-top-left')}
                    </Panel>
                    <Separator className="resize-handle-h" />
                    <Panel defaultSize={50} minSize={20}>
                      {renderSlotContent('right-top-right')}
                    </Panel>
                  </PanelGroup>
                </Panel>
                <Separator className="resize-handle-v" />
                <Panel defaultSize={40} minSize={15}>
                  {renderSlotContent('right-bot')}
                </Panel>
              </PanelGroup>
            </Panel>
          </PanelGroup>
        ) : (
          /* Default layout: 3 left panels + 2 right panels */
          <PanelGroup orientation="horizontal" style={{ width: '100%', height: '100%' }}>
            <Panel defaultSize={50} minSize={33}>
              <PanelGroup orientation="vertical">
                <Panel defaultSize={30} minSize={10}>
                  {renderSlotContent('left-top')}
                </Panel>
                <Separator className="resize-handle-v" />
                <Panel defaultSize={35} minSize={10}>
                  {renderSlotContent('left-mid')}
                </Panel>
                <Separator className="resize-handle-v" />
                <Panel defaultSize={35} minSize={10}>
                  {renderSlotContent('left-bot')}
                </Panel>
              </PanelGroup>
            </Panel>
            <Separator className="resize-handle-h" />
            <Panel defaultSize={50} minSize={20}>
              <PanelGroup orientation="vertical">
                <Panel defaultSize={60} minSize={15}>
                  {renderSlotContent('right-top')}
                </Panel>
                <Separator className="resize-handle-v" />
                <Panel defaultSize={40} minSize={15}>
                  {renderSlotContent('right-bot')}
                </Panel>
              </PanelGroup>
            </Panel>
          </PanelGroup>
        )}

        {/* 3D Canvas — always mounted, absolutely positioned over its assigned slot */}
        <div style={{
          position: 'absolute',
          zIndex: 5,
          top: canvasRect?.top ?? 0,
          left: canvasRect?.left ?? 0,
          width: canvasRect?.width ?? 0,
          height: canvasRect?.height ?? 0,
          display: canvasRect ? undefined : 'none',
        }}>
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
            <color attach="background" args={[activePreset.background ?? '#ffffff']} />
            <SceneLighting presetKey={viewerSettings.lightingPreset} />
            {activeDoor && (
              <DoorViewer
                door={activeDoor}
                graph={activeGraph}
                profiles={profiles}
                operationVisibility={operationVisibility}
                toolVisibility={toolVisibility}
                frontPanelType={frontPanelType}
                backPanelType={backPanelType}
                hasBackRabbit={frontPanelType === 'glass' ? hasBackRabbit : undefined}
                selectedPanelIndices={selectedPanels}
                selectedSplitPath={selectedSplitPath}
                panelTree={frontPanelTree}
                thickness={thickness}
                renderMode={doorRenderMode}
                textureUrl={textureUrl}
                kerfs={kerfs}
                modelOpacity={viewerSettings.modelOpacity}
                materialOverrides={activePreset.materialOverrides}
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
            <CameraAutoFit maxDim={maxDim} />
          </Canvas>

          {!activeDoor && (
            <div style={styles.loading}>
              <p>
                {loading
                  ? 'Loading door data...'
                  : error
                    ? <span style={{ color: '#ff6b6b' }}>Error: {error}</span>
                    : 'Select a tool group to begin.'}
              </p>
            </div>
          )}

          {activeDoor && (
            <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
              <RenderModeButton mode={doorRenderMode} onToggle={() => setDoorRenderMode(nextRenderMode(doorRenderMode))} />
            </div>
          )}

          {loading && activeDoor && (
            <div style={styles.loadingOverlay}>
              Loading...
            </div>
          )}
        </div>

        {/* Layout customizer button — top-right corner */}
        <button
          onClick={() => setShowLayoutCustomizer(prev => !prev)}
          style={layoutBtnStyle}
          title="Customize layout"
        >
          {'\u229E'}
        </button>

        {showLayoutCustomizer && (
          <LayoutCustomizer
            layoutMapping={layoutMapping}
            onSwap={swapPanels}
            onReset={() => setLayoutMapping({ ...DEFAULT_LAYOUT })}
            onClose={() => setShowLayoutCustomizer(false)}
            layoutPreset={layoutPreset}
            onPresetChange={setLayoutPreset}
            compactLayoutMapping={compactLayoutMapping}
            onCompactSwap={swapCompactPanels}
            onCompactReset={() => setCompactLayoutMapping({ ...COMPACT_LAYOUT })}
          />
        )}
      </div>

      {/* Admin Panel — overlay on top of the dashboard */}
      {currentTab === 'admin' && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={() => setCurrentTab('door')}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', height: '100%' }}>
            <AdminPanel
              onDataReloaded={() => setDataVersion(v => v + 1)}
              selectedTextures={selectedTextures}
              onTextureSelected={(category, path, blobUrl) => {
                setSelectedTextures(prev => ({ ...prev, [category]: path }));
                if (path && blobUrl) {
                  setTextureBlobUrls(prev => ({ ...prev, [path]: blobUrl }));
                }
              }}
              onLibrariesChanged={setLibraries}
              textureManifest={textureManifest}
              onTextureManifestChanged={setTextureManifest}
              columns={columns}
              onColumnsChange={setColumns}
              groupByFields={groupByFields}
              onGroupByChange={setGroupByFields}
              watermarkConfig={watermarkConfig}
              onWatermarkChange={setWatermarkConfig}
              units={units}
              onUnitsChange={setUnits}
              fractionPrecision={fractionPrecision}
              onFractionPrecisionChange={setFractionPrecision}
              viewerSettings={viewerSettings}
              onViewerSettingsChange={setViewerSettings}
            />
          </div>
        </div>
      )}

      {/* Configure Panel — overlay on top of the dashboard */}
      {currentTab === 'configure' && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={() => setCurrentTab('door')}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', height: '100%' }}>
            <ConfigurePanel
              toolGroups={toolGroups}
              configData={configData}
              textureManifest={textureManifest}
              onClose={() => setCurrentTab('door')}
              toDisplay={toDisplay}
              fromDisplay={fromDisplay}
              inputStep={inputStep}
            />
          </div>
        </div>
      )}


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

      {showStyleEditor && (
        <StyleEditorDialog
          leftStileW={leftStileW}
          rightStileW={rightStileW}
          topRailW={topRailW}
          bottomRailW={bottomRailW}
          onPresetSelect={handleStylePresetSelect}
          presets={stylePresets}
          toDisplay={toDisplay}
          units={units}
          onClose={() => setShowStyleEditor(false)}
        />
      )}

      {viewingItem && (
        <ItemViewerModal
          item={viewingItem}
          units={units}
          onClose={() => setViewingItem(null)}
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
          ...(currentTab === 'configure' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange(currentTab === 'configure' ? 'door' : 'configure')}
      >
        Configure
      </button>
      <button
        style={{
          ...tabStyles.tab,
          ...(currentTab === 'admin' ? tabStyles.activeTab : {}),
        }}
        onClick={() => onTabChange(currentTab === 'admin' ? 'door' : 'admin')}
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
};

const layoutBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  zIndex: 10,
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid #444466',
  background: 'rgba(26, 26, 46, 0.8)',
  color: '#8888aa',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
  transition: 'background 0.15s, color 0.15s',
};
