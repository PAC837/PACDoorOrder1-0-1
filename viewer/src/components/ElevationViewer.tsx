import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { DoorData, UnitSystem, HoleData, HandleConfig, HingeConfig, RenderMode, KerfLine, RawToolGroup } from '../types.js';
import { formatUnit } from '../types.js';
import { RenderModeButton, nextRenderMode } from './RenderModeButton.js';
import type { PanelTree, PanelBounds, SplitInfoWithBounds } from '../utils/panelTree.js';
import { flattenTree, enumerateSplits, enumerateSplitsWithBounds, pathsEqual } from '../utils/panelTree.js';
import { drawArrowHead, drawLinearDim, drawSnapIndicator, drawMeasurePreview, drawGeneralDim } from '../utils/canvasDrawing.js';
import { useMeasureTool } from '../hooks/useMeasureTool.js';
import type { SnapTarget, SnapLine } from '../hooks/useMeasureTool.js';

interface ElevationViewerProps {
  door: DoorData;
  units: UnitSystem;
  panelTree: PanelTree;
  handleConfig?: HandleConfig;
  renderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  selectedSplitPath?: number[] | null;
  onSplitSelect?: (path: number[] | null) => void;
  onSplitDragEnd?: (path: number[], newPos: number) => void;
  onLeftStileWidthChange?: (w: number) => void;
  onRightStileWidthChange?: (w: number) => void;
  onTopRailWidthChange?: (w: number) => void;
  onBottomRailWidthChange?: (w: number) => void;
  onSplitWidthChange?: (path: number[], w: number) => void;
  overrideLeftStileW?: number;
  overrideRightStileW?: number;
  overrideTopRailW?: number;
  overrideBottomRailW?: number;
  onReset?: () => void;
  onPanelSelect?: (idx: number, event: { ctrlKey: boolean }) => void;
  selectedPanelIndices?: Set<number>;
  onAddMidRail?: (panelIdx: number) => void;
  onAddMidStile?: (panelIdx: number) => void;
  onDeleteSplit?: (path: number[]) => void;
  onAddEqualMidRails?: (panelIdx: number, count: number) => void;
  onAddEqualMidStiles?: (panelIdx: number, count: number) => void;
  onDeselectAll?: () => void;
  hingeConfig?: HingeConfig;
  onHingePositionChange?: (index: number, newPositionMm: number) => void;
  onHandleElevationChange?: (newElevationMm: number) => void;
  compact?: boolean;
  kerfs?: KerfLine[];
  kerfEnabled?: boolean;
  kerfToolGroups?: RawToolGroup[];
  onAddKerf?: (orientation: 'H' | 'V', centerMm: number, toolGroupId: number | null) => void;
  onDeleteKerf?: (id: number) => void;
  onMoveKerf?: (id: number, newCenterMm: number) => void;
}

const MIN_PANEL_SIZE = 25.4; // 1" minimum panel dimension for drag constraints

interface DragState {
  path: number[];
  type: 'hsplit' | 'vsplit';
  currentPos: number;
  range: { min: number; max: number };
}

/** Hit-test splits against a screen coordinate. Returns the deepest hit. */
function hitTestSplits(
  sx: number, sy: number,
  splits: SplitInfoWithBounds[],
  toX: (x: number) => number,
  toY: (y: number) => number,
  hitPadding = 4,
): SplitInfoWithBounds | null {
  // Test in reverse order (deepest splits get priority)
  for (let i = splits.length - 1; i >= 0; i--) {
    const s = splits[i];
    const b = s.bounds;
    // Convert divider model bounds to screen rect
    // drawRect maps (yMin, xMin, yMax, xMax) — x-axis is width (model Y), y-axis is height (model X)
    const sx1 = toX(b.yMin);
    const sy1 = toY(b.xMax); // toY flips: higher model y → lower screen y
    const sx2 = toX(b.yMax);
    const sy2 = toY(b.xMin);

    const minSx = Math.min(sx1, sx2) - hitPadding;
    const maxSx = Math.max(sx1, sx2) + hitPadding;
    const minSy = Math.min(sy1, sy2) - hitPadding;
    const maxSy = Math.max(sy1, sy2) + hitPadding;

    if (sx >= minSx && sx <= maxSx && sy >= minSy && sy <= maxSy) {
      return s;
    }
  }
  return null;
}

/** Compute valid drag range for a split within its parent bounds. */
function getDragRange(split: SplitInfoWithBounds): { min: number; max: number } {
  const half = split.width / 2;
  if (split.type === 'hsplit') {
    return {
      min: split.parentBounds.xMin + MIN_PANEL_SIZE + half,
      max: split.parentBounds.xMax - MIN_PANEL_SIZE - half,
    };
  }
  return {
    min: split.parentBounds.yMin + MIN_PANEL_SIZE + half,
    max: split.parentBounds.yMax - MIN_PANEL_SIZE - half,
  };
}

type EditingMember = {
  type: 'left-stile' | 'right-stile' | 'top-rail' | 'bottom-rail' | 'split';
  path?: number[];
  screenX: number;
  screenY: number;
  currentValue: number;
} | null;

/** Returns the nearest frame/split boundary below (lo) and above (hi) for dimension display. */
function getNearestBoundaries(
  centerMm: number,
  orientation: 'H' | 'V',
  doorH: number,
  doorW: number,
  bottomRailW: number,
  topRailW: number,
  leftStileW: number,
  rightStileW: number,
  splitsWithBounds: SplitInfoWithBounds[],
): { lo: number; hi: number } {
  if (orientation === 'H') {
    const bounds = [bottomRailW, doorH - topRailW];
    for (const s of splitsWithBounds) {
      if (s.type === 'hsplit') { bounds.push(s.pos - s.width / 2); bounds.push(s.pos + s.width / 2); }
    }
    const lo = Math.max(...bounds.filter(b => b <= centerMm), 0);
    const hi = Math.min(...bounds.filter(b => b >= centerMm), doorH);
    return { lo, hi };
  } else {
    const bounds = [leftStileW, doorW - rightStileW];
    for (const s of splitsWithBounds) {
      if (s.type === 'vsplit') { bounds.push(s.pos - s.width / 2); bounds.push(s.pos + s.width / 2); }
    }
    const lo = Math.max(...bounds.filter(b => b <= centerMm), 0);
    const hi = Math.min(...bounds.filter(b => b >= centerMm), doorW);
    return { lo, hi };
  }
}

export function ElevationViewer({
  door, units, panelTree, handleConfig, renderMode, onRenderModeChange,
  selectedSplitPath, onSplitSelect, onSplitDragEnd,
  onLeftStileWidthChange, onRightStileWidthChange, onTopRailWidthChange, onBottomRailWidthChange,
  onSplitWidthChange, overrideLeftStileW, overrideRightStileW, overrideTopRailW, overrideBottomRailW,
  onPanelSelect, selectedPanelIndices, onAddMidRail, onAddMidStile,
  onDeleteSplit, onAddEqualMidRails, onAddEqualMidStiles, onDeselectAll,
  hingeConfig, onHingePositionChange, onHandleElevationChange, compact, onReset,
  kerfs, kerfEnabled, kerfToolGroups, onAddKerf, onDeleteKerf, onMoveKerf,
}: ElevationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(800);
  const [ch, setCh] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showHatching, setShowHatching] = useState(true);
  const [showHardware, setShowHardware] = useState(true);
  const [showUserDimensions, setShowUserDimensions] = useState(true);
  const [singleView, setSingleView] = useState(false);

  const [hoveredSplit, setHoveredSplit] = useState<{ path: number[]; type: 'hsplit' | 'vsplit' } | null>(null);
  const [draggingSplit, setDraggingSplit] = useState<DragState | null>(null);
  const [editingMember, setEditingMember] = useState<EditingMember>(null);
  const [selectedFrameMember, setSelectedFrameMember] = useState<string | null>(null);
  const pendingClick = useRef<{ path: number[]; type: 'hsplit' | 'vsplit'; pos: number; startX: number; startY: number } | null>(null);

  // Hinge interaction state
  const [selectedHingeIdx, setSelectedHingeIdx] = useState<number | null>(null);
  const [draggingHinge, setDraggingHinge] = useState<{ index: number; currentPos: number } | null>(null);
  const [editingHinge, setEditingHinge] = useState<{ index: number; screenX: number; screenY: number; currentValue: number } | null>(null);
  const pendingHingeClick = useRef<{ index: number; startX: number; startY: number } | null>(null);

  // Handle interaction state
  const [selectedHandleIdx, setSelectedHandleIdx] = useState<number | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<{ currentPos: number } | null>(null);
  const [editingHandle, setEditingHandle] = useState<{ screenX: number; screenY: number; currentValue: number } | null>(null);
  const pendingHandleClick = useRef<{ startX: number; startY: number } | null>(null);

  // Kerf mode state
  const [kerfMode, setKerfMode] = useState<'H' | 'V' | null>(null);
  const [kerfToolGroupId, setKerfToolGroupId] = useState<number | null>(null);
  const [selectedKerfId, setSelectedKerfId] = useState<number | null>(null);
  const [kerfHoverMm, setKerfHoverMm] = useState<number | null>(null);

  const holes: HoleData[] = door.RoutedLockedShape?.Operations?.OperationHole ?? [];

  const doorW = door.DefaultW;
  const doorH = door.DefaultH;
  const leftStileW = overrideLeftStileW ?? door.LeftRightStileW;
  const rightStileW = overrideRightStileW ?? door.LeftRightStileW;
  const topRailW = overrideTopRailW ?? door.TopRailW;
  const bottomRailW = overrideBottomRailW ?? door.BottomRailW;

  // Root panel bounds (computed once, used by hit-testing and drawing)
  const rootBounds: PanelBounds = useMemo(() => ({
    xMin: bottomRailW,
    xMax: doorH - topRailW,
    yMin: leftStileW,
    yMax: doorW - rightStileW,
  }), [bottomRailW, topRailW, leftStileW, rightStileW, doorH, doorW]);

  // Splits with bounds for hit-testing
  const splitsWithBounds = useMemo(
    () => enumerateSplitsWithBounds(panelTree, rootBounds),
    [panelTree, rootBounds],
  );

  // Reset zoom/pan when door changes (name or dimensions)
  useEffect(() => {
    setZoom(1); setPanX(0); setPanY(0);
  }, [door.Name, door.DefaultW, door.DefaultH]);

  // Auto-select first kerf tool group when list changes
  useEffect(() => {
    if (!kerfToolGroups || kerfToolGroups.length === 0) return;
    setKerfToolGroupId(prev =>
      prev !== null && kerfToolGroups.some(g => g.ToolGroupID === prev)
        ? prev
        : kerfToolGroups[0].ToolGroupID
    );
  }, [kerfToolGroups]);

  // Exit kerf mode when feature is disabled
  useEffect(() => {
    if (!kerfEnabled) { setKerfMode(null); setKerfHoverMm(null); }
  }, [kerfEnabled]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCw(Math.round(width));
      setCh(Math.round(height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Coordinate transforms — front view occupies left half, back view occupies right half
  const pad = 80;
  const halfW = singleView ? cw : cw / 2;
  const scaleX = (halfW - 2 * pad) / doorW;
  const scaleY = (ch - 2 * pad) / doorH;
  const baseScale = Math.min(scaleX, scaleY);
  const scale = baseScale * zoom;
  const cx = halfW / 2; // center of left half
  const cy = ch / 2;

  // Front view transforms (left half) — used by mouse handlers and measure tool
  const toX = useCallback((x: number) => cx + (x - doorW / 2) * scale + panX, [cx, doorW, scale, panX]);
  const toY = useCallback((y: number) => cy - (y - doorH / 2) * scale + panY, [cy, doorH, scale, panY]);
  // Inverse transforms: screen → model (front half)
  const fromX = useCallback((sx: number) => (sx - panX - cx) / scale + doorW / 2, [cx, doorW, scale, panX]);
  const fromY = useCallback((sy: number) => -(sy - panY - cy) / scale + doorH / 2, [cy, doorH, scale, panY]);
  // Back view X transform (right half, mirrored)
  const toXBack = useCallback((x: number) => halfW + halfW / 2 + (doorW / 2 - x) * scale + panX, [halfW, doorW, scale, panX]);
  const fmtDim = useCallback((mm: number) => formatUnit(mm, units), [units]);

  // Panel leaves for snap targets
  const leaves = useMemo(() => flattenTree(panelTree, rootBounds), [panelTree, rootBounds]);

  // --- Snap targets for measure tool ---
  const snapTargets = useMemo((): SnapTarget[] => {
    const targets: SnapTarget[] = [];
    // Door perimeter corners
    targets.push({ x: 0, y: 0, label: 'corner' });
    targets.push({ x: doorW, y: 0, label: 'corner' });
    targets.push({ x: doorW, y: doorH, label: 'corner' });
    targets.push({ x: 0, y: doorH, label: 'corner' });
    // Inner frame corners
    targets.push({ x: leftStileW, y: bottomRailW, label: 'frame' });
    targets.push({ x: doorW - rightStileW, y: bottomRailW, label: 'frame' });
    targets.push({ x: leftStileW, y: doorH - topRailW, label: 'frame' });
    targets.push({ x: doorW - rightStileW, y: doorH - topRailW, label: 'frame' });
    // Panel leaf corners
    for (const pb of leaves) {
      targets.push({ x: pb.yMin, y: pb.xMin });
      targets.push({ x: pb.yMax, y: pb.xMin });
      targets.push({ x: pb.yMin, y: pb.xMax });
      targets.push({ x: pb.yMax, y: pb.xMax });
    }
    // Divider centers and edges
    for (const s of splitsWithBounds) {
      const b = s.bounds;
      targets.push({ x: (b.yMin + b.yMax) / 2, y: (b.xMin + b.xMax) / 2, label: 'divider' });
    }
    // Hardware hole centers
    for (const hole of holes) {
      targets.push({ x: hole.Y, y: hole.X, label: 'hole' });
    }
    return targets;
  }, [doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW, leaves, splitsWithBounds, holes]);

  const snapLines = useMemo((): SnapLine[] => {
    const lines: SnapLine[] = [];
    // Door perimeter
    lines.push({ x1: 0, y1: 0, x2: doorW, y2: 0, label: 'bottom' });
    lines.push({ x1: doorW, y1: 0, x2: doorW, y2: doorH, label: 'right' });
    lines.push({ x1: doorW, y1: doorH, x2: 0, y2: doorH, label: 'top' });
    lines.push({ x1: 0, y1: doorH, x2: 0, y2: 0, label: 'left' });
    // Inner frame
    lines.push({ x1: leftStileW, y1: bottomRailW, x2: doorW - rightStileW, y2: bottomRailW });
    lines.push({ x1: doorW - rightStileW, y1: bottomRailW, x2: doorW - rightStileW, y2: doorH - topRailW });
    lines.push({ x1: doorW - rightStileW, y1: doorH - topRailW, x2: leftStileW, y2: doorH - topRailW });
    lines.push({ x1: leftStileW, y1: doorH - topRailW, x2: leftStileW, y2: bottomRailW });
    return lines;
  }, [doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW]);

  // --- Measure tool hook ---
  const measure = useMeasureTool({
    fromX, fromY, toX, toY,
    scale,
    snapTargets,
    snapLines,
    formatDistance: fmtDim,
  });

  // Keyboard listener for measure tool
  useEffect(() => {
    if (!measure.measureMode) return;
    const handler = (e: KeyboardEvent) => measure.handleKeyDown(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [measure.measureMode, measure.handleKeyDown]);

  // Escape exits kerf mode
  useEffect(() => {
    if (!kerfMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setKerfMode(null); setKerfHoverMm(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [kerfMode]);

  // Auto-select the newest kerf when one is added (while in kerf mode)
  const kerfsLen = kerfs?.length ?? 0;
  useEffect(() => {
    if (kerfMode && kerfs && kerfs.length > 0) {
      setSelectedKerfId(kerfs[kerfs.length - 1].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kerfsLen]); // intentionally watching length only

  // Arrow key nudge of selected kerf
  useEffect(() => {
    if (!selectedKerfId || !onMoveKerf) return;
    const NUDGE = 1.5875; // 1/16 inch
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const kerf = (kerfs ?? []).find(k => k.id === selectedKerfId);
      if (!kerf) return;
      e.preventDefault();
      let delta = 0;
      if (kerf.orientation === 'H') {
        if (e.key === 'ArrowUp') delta = NUDGE;
        else if (e.key === 'ArrowDown') delta = -NUDGE;
      } else {
        if (e.key === 'ArrowRight') delta = NUDGE;
        else if (e.key === 'ArrowLeft') delta = -NUDGE;
      }
      if (delta !== 0) {
        const max = kerf.orientation === 'H' ? doorH : doorW;
        const newPos = Math.max(0, Math.min(max, kerf.centerMm + delta));
        onMoveKerf(selectedKerfId, newPos);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedKerfId, kerfs, onMoveKerf, doorH, doorW]);

  // Cursor
  const cursor = useMemo(() => {
    if (measure.measureMode) return measure.draggingIdx !== null ? 'grabbing' : 'crosshair';
    if (kerfMode) return 'crosshair';
    if (draggingHinge || draggingHandle) return 'ns-resize';
    if (draggingSplit) {
      return draggingSplit.type === 'hsplit' ? 'ns-resize' : 'ew-resize';
    }
    if (hoveredSplit) {
      return hoveredSplit.type === 'hsplit' ? 'ns-resize' : 'ew-resize';
    }
    if (isPanning) return 'grabbing';
    return 'grab';
  }, [measure.measureMode, measure.draggingIdx, kerfMode, draggingHinge, draggingHandle, draggingSplit, hoveredSplit, isPanning]);

  // Wheel zoom (center-anchored)
  // Hit-test fixed frame members (returns member type and width, or null)
  const hitTestFrame = useCallback((mx: number, my: number): EditingMember => {
    // mx, my are model coords (from fromX/fromY)
    if (mx < 0 || mx > doorW || my < 0 || my > doorH) return null;
    // Left stile
    if (mx >= 0 && mx <= leftStileW && onLeftStileWidthChange) {
      return { type: 'left-stile', screenX: toX(leftStileW / 2), screenY: toY(doorH / 2), currentValue: leftStileW };
    }
    // Right stile
    if (mx >= doorW - rightStileW && mx <= doorW && onRightStileWidthChange) {
      return { type: 'right-stile', screenX: toX(doorW - rightStileW / 2), screenY: toY(doorH / 2), currentValue: rightStileW };
    }
    // Top rail (between stiles)
    if (mx > leftStileW && mx < doorW - rightStileW && my >= doorH - topRailW && my <= doorH && onTopRailWidthChange) {
      return { type: 'top-rail', screenX: toX(doorW / 2), screenY: toY(doorH - topRailW / 2), currentValue: topRailW };
    }
    // Bottom rail (between stiles)
    if (mx > leftStileW && mx < doorW - rightStileW && my >= 0 && my <= bottomRailW && onBottomRailWidthChange) {
      return { type: 'bottom-rail', screenX: toX(doorW / 2), screenY: toY(bottomRailW / 2), currentValue: bottomRailW };
    }
    return null;
  }, [doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW, toX, toY,
      onLeftStileWidthChange, onRightStileWidthChange, onTopRailWidthChange, onBottomRailWidthChange]);

  // Hit-test panels — returns leaf index or -1
  const hitTestPanels = useCallback((sx: number, sy: number): number => {
    const mx = fromX(sx);
    const my = fromY(sy);
    for (let i = 0; i < leaves.length; i++) {
      const pb = leaves[i];
      if (mx >= pb.yMin && mx <= pb.yMax && my >= pb.xMin && my <= pb.xMax) {
        return i;
      }
    }
    return -1;
  }, [leaves, fromX, fromY]);

  // Hit-test hinge cups — returns cup index or -1
  const hitTestHingeCup = useCallback((sx: number, sy: number): number => {
    if (!onHingePositionChange) return -1;
    const cupHoles = holes.filter(h => h.holeType === 'hinge-cup');
    const hitRadius = 8; // screen pixels
    for (let i = 0; i < cupHoles.length; i++) {
      const hole = cupHoles[i];
      // Cups are FlipSideOp=true (back face)
      // In dual view, they appear in the back half (right side) — use toXBack
      // In single view, they appear as dotted outlines in front half — use toX
      const hsx = singleView ? toX(hole.Y) : toXBack(hole.Y);
      const hsy = toY(hole.X);
      const sr = (hole.Diameter / 2) * scale;
      const dist = Math.hypot(sx - hsx, sy - hsy);
      if (dist <= Math.max(sr, hitRadius)) {
        return i;
      }
    }
    return -1;
  }, [holes, toX, toXBack, toY, scale, singleView, onHingePositionChange]);

  // Hit-test handle holes — returns first handle hole index or -1
  const hitTestHandle = useCallback((sx: number, sy: number): number => {
    if (!onHandleElevationChange) return -1;
    const handleHoles = holes.filter(h => h.holeType === 'handle');
    const hitRadius = 8;
    for (let i = 0; i < handleHoles.length; i++) {
      const hole = handleHoles[i];
      // Handles can be on front or back
      const hsx = hole.FlipSideOp
        ? (singleView ? toX(hole.Y) : toXBack(hole.Y))
        : toX(hole.Y);
      const hsy = toY(hole.X);
      const sr = (hole.Diameter / 2) * scale;
      const dist = Math.hypot(sx - hsx, sy - hsy);
      if (dist <= Math.max(sr, hitRadius)) {
        return i;
      }
    }
    return -1;
  }, [holes, toX, toXBack, toY, scale, singleView, onHandleElevationChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setZoom((z) => Math.max(0.1, Math.min(20, z * factor)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse handlers — measure mode > split hit-testing > frame hit-testing > pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Close any open editor on new click
    setEditingMember(null);
    setEditingHinge(null);
    setEditingHandle(null);

    // Measure mode has highest priority
    if (measure.measureMode) {
      if (measure.handleDimMouseDown(sx, sy)) return;
      measure.handleMouseDown(sx, sy);
      return;
    }

    // Kerf mode — hit-test existing kerfs first, otherwise place a new one
    if (kerfMode && sx < halfW) {
      const HIT_PX = 6;
      const existingHit = (kerfs ?? []).find(k => {
        if (k.orientation !== kerfMode) return false;
        const screenPos = kerfMode === 'H' ? toY(k.centerMm) : toX(k.centerMm);
        const mousePos = kerfMode === 'H' ? sy : sx;
        return Math.abs(screenPos - mousePos) < HIT_PX;
      });
      if (existingHit) {
        setSelectedKerfId(existingHit.id);
        return;
      }
      if (onAddKerf) {
        let centerMm = kerfMode === 'H' ? fromY(sy) : fromX(sx);
        const clamp = kerfMode === 'H' ? doorH : doorW;
        centerMm = Math.max(0, Math.min(clamp, centerMm));
        // Snap to selected split center if within 10mm
        if (selectedSplitPath) {
          const sel = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
          if (sel) {
            if (kerfMode === 'H' && sel.type === 'hsplit' && Math.abs(sel.pos - centerMm) < 10) centerMm = sel.pos;
            else if (kerfMode === 'V' && sel.type === 'vsplit' && Math.abs(sel.pos - centerMm) < 10) centerMm = sel.pos;
          }
        }
        onAddKerf(kerfMode, centerMm, kerfToolGroupId);
        // selectedKerfId updated by the kerfsLen useEffect
      }
      return;
    }

    // Hit-test hinge cups (back half in dual view, front half in single view)
    {
      const hingeIdx = hitTestHingeCup(sx, sy);
      if (hingeIdx >= 0) {
        e.preventDefault();
        setSelectedHingeIdx(hingeIdx);
        setSelectedHandleIdx(null);
        pendingHingeClick.current = { index: hingeIdx, startX: e.clientX, startY: e.clientY };
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }
    }

    // Hit-test handle holes
    {
      const handleIdx = hitTestHandle(sx, sy);
      if (handleIdx >= 0) {
        e.preventDefault();
        setSelectedHandleIdx(handleIdx);
        setSelectedHingeIdx(null);
        pendingHandleClick.current = { startX: e.clientX, startY: e.clientY };
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }
    }

    // Deselect hinge/handle when clicking elsewhere
    setSelectedHingeIdx(null);
    setSelectedHandleIdx(null);

    // Only interact in front half (left side)
    if (sx < halfW) {
      // Hit-test dividers first (only when interactive)
      if (onSplitSelect) {
        const hit = hitTestSplits(sx, sy, splitsWithBounds, toX, toY);
        if (hit) {
          e.preventDefault();
          onSplitSelect(hit.path);
          setSelectedFrameMember(null);
          pendingClick.current = { path: hit.path, type: hit.type, pos: hit.pos, startX: e.clientX, startY: e.clientY };
          lastMouse.current = { x: e.clientX, y: e.clientY };
          return;
        }
      }

      // Hit-test panels
      if (onPanelSelect) {
        const panelIdx = hitTestPanels(sx, sy);
        if (panelIdx >= 0) {
          e.preventDefault();
          onPanelSelect(panelIdx, { ctrlKey: e.ctrlKey });
          setSelectedFrameMember(null);
          lastMouse.current = { x: e.clientX, y: e.clientY };
          return;
        }
      }

      // Hit-test fixed frame members
      const mx = fromX(sx), my = fromY(sy);
      const frameHit = hitTestFrame(mx, my);
      if (frameHit) {
        e.preventDefault();
        setEditingMember(frameHit);
        setSelectedFrameMember(frameHit.type);
        onDeselectAll?.();
        return;
      }
    }

    // Nothing hit — deselect everything
    setSelectedFrameMember(null);
    onDeselectAll?.();

    // Start canvas pan
    setIsPanning(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [measure.measureMode, measure.handleDimMouseDown, measure.handleMouseDown, splitsWithBounds, toX, toY, fromX, fromY, halfW, onSplitSelect, hitTestFrame, hitTestPanels, onPanelSelect, onDeselectAll, hitTestHingeCup, hitTestHandle, kerfMode, kerfs, onAddKerf, kerfToolGroupId, selectedSplitPath, doorH, doorW]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Measure mode
    if (measure.measureMode) {
      measure.handleMouseMove(sx, sy);
      if (measure.draggingIdx !== null) {
        measure.handleDimMouseMove(sx, sy);
      }
      return;
    }

    // Kerf hover preview — update ghost position when in kerf mode
    if (kerfMode) {
      if (sx < halfW) {
        const pos = kerfMode === 'H' ? fromY(sy) : fromX(sx);
        const clamp = kerfMode === 'H' ? doorH : doorW;
        setKerfHoverMm(Math.max(0, Math.min(clamp, pos)));
      } else if (kerfHoverMm !== null) {
        setKerfHoverMm(null);
      }
    }

    // Check if pending hinge click should convert to drag (3px threshold)
    if (pendingHingeClick.current && !draggingHinge) {
      const dx = e.clientX - pendingHingeClick.current.startX;
      const dy = e.clientY - pendingHingeClick.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        const cupHoles = holes.filter(h => h.holeType === 'hinge-cup');
        const cup = cupHoles[pendingHingeClick.current.index];
        if (cup) {
          // Hinge axis position is cup.X for left/right, cup.Y for top/bottom
          const isVerticalAxis = hingeConfig?.side === 'left' || hingeConfig?.side === 'right';
          const currentPos = isVerticalAxis ? cup.X : cup.Y;
          setDraggingHinge({ index: pendingHingeClick.current.index, currentPos });
        }
        pendingHingeClick.current = null;
      }
    }

    // Handle hinge dragging — constrain to hinge axis
    if (draggingHinge) {
      const isVerticalAxis = hingeConfig?.side === 'left' || hingeConfig?.side === 'right';
      let newPos: number;
      if (isVerticalAxis) {
        newPos = fromY(sy); // screen Y → model height (X axis in Mozaik)
      } else {
        // For top/bottom hinges, drag along width
        // Use appropriate inverse transform based on which half we're in
        newPos = fromX(sx);
      }
      newPos = Math.max(0, Math.min(isVerticalAxis ? doorH : doorW, newPos));
      setDraggingHinge(prev => prev ? { ...prev, currentPos: newPos } : null);
      return;
    }

    // Check if pending handle click should convert to drag (3px threshold)
    if (pendingHandleClick.current && !draggingHandle) {
      const dx = e.clientX - pendingHandleClick.current.startX;
      const dy = e.clientY - pendingHandleClick.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        const handleHoles = holes.filter(h => h.holeType === 'handle');
        if (handleHoles.length > 0) {
          // Handle elevation = X in Mozaik coords (height axis)
          setDraggingHandle({ currentPos: handleHoles[0].X });
        }
        pendingHandleClick.current = null;
      }
    }

    // Handle dragging — constrain to height axis (screen Y)
    if (draggingHandle) {
      let newPos = fromY(sy);
      newPos = Math.max(0, Math.min(doorH, newPos));
      setDraggingHandle({ currentPos: newPos });
      return;
    }

    // Check if pending click should convert to drag (3px threshold)
    if (pendingClick.current && !draggingSplit) {
      const dx = e.clientX - pendingClick.current.startX;
      const dy = e.clientY - pendingClick.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        const pc = pendingClick.current;
        const hitForRange = splitsWithBounds.find(s => pathsEqual(s.path, pc.path));
        if (hitForRange) {
          const range = getDragRange(hitForRange);
          setDraggingSplit({ path: pc.path, type: pc.type, currentPos: pc.pos, range });
        }
        pendingClick.current = null;
      }
    }

    if (draggingSplit) {
      let newPos: number;
      if (draggingSplit.type === 'hsplit') {
        newPos = fromY(sy);
      } else {
        newPos = fromX(sx);
      }
      newPos = Math.max(draggingSplit.range.min, Math.min(draggingSplit.range.max, newPos));
      setDraggingSplit(prev => prev ? { ...prev, currentPos: newPos } : null);
      return;
    }

    if (isPanning) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      const panScale = 1.5;
      setPanX((p) => p + dx * panScale);
      setPanY((p) => p + dy * panScale);
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Hover detection for cursor (front half only)
    if (onSplitSelect && sx < halfW) {
      const hit = hitTestSplits(sx, sy, splitsWithBounds, toX, toY);
      if (hit) {
        if (!hoveredSplit || !pathsEqual(hoveredSplit.path, hit.path)) {
          setHoveredSplit({ path: hit.path, type: hit.type });
        }
      } else if (hoveredSplit) {
        setHoveredSplit(null);
      }
    } else if (hoveredSplit && sx >= halfW) {
      setHoveredSplit(null);
    }
  }, [measure.measureMode, measure.phase, measure.handleMouseMove, measure.draggingIdx, measure.handleDimMouseMove, draggingSplit, draggingHinge, draggingHandle, isPanning, splitsWithBounds, toX, toY, fromX, fromY, halfW, onSplitSelect, hoveredSplit, holes, hingeConfig, doorH, doorW, kerfMode, kerfHoverMm]);

  const handleMouseUp = useCallback(() => {
    if (measure.draggingIdx !== null) {
      measure.handleDimMouseUp();
    }

    // Handle hinge drag commit or click-to-edit
    if (draggingHinge) {
      onHingePositionChange?.(draggingHinge.index, draggingHinge.currentPos);
      setDraggingHinge(null);
      pendingHingeClick.current = null;
    } else if (pendingHingeClick.current) {
      // Click without drag → open inline position editor
      const cupHoles = holes.filter(h => h.holeType === 'hinge-cup');
      const cup = cupHoles[pendingHingeClick.current.index];
      if (cup) {
        const isVerticalAxis = hingeConfig?.side === 'left' || hingeConfig?.side === 'right';
        const currentValue = isVerticalAxis ? cup.X : cup.Y;
        const hsx = singleView ? toX(cup.Y) : toXBack(cup.Y);
        const hsy = toY(cup.X);
        setEditingHinge({
          index: pendingHingeClick.current.index,
          screenX: hsx,
          screenY: hsy,
          currentValue,
        });
      }
      pendingHingeClick.current = null;
    }

    // Handle drag commit or click-to-edit
    if (draggingHandle) {
      onHandleElevationChange?.(draggingHandle.currentPos);
      setDraggingHandle(null);
      pendingHandleClick.current = null;
    } else if (pendingHandleClick.current) {
      // Click without drag → open inline elevation editor
      const handleHoles = holes.filter(h => h.holeType === 'handle');
      if (handleHoles.length > 0) {
        const hole = handleHoles[0];
        const hsx = hole.FlipSideOp
          ? (singleView ? toX(hole.Y) : toXBack(hole.Y))
          : toX(hole.Y);
        const hsy = toY(hole.X);
        setEditingHandle({
          screenX: hsx,
          screenY: hsy,
          currentValue: hole.X, // elevation = Mozaik X (height axis)
        });
      }
      pendingHandleClick.current = null;
    }

    if (draggingSplit) {
      onSplitDragEnd?.(draggingSplit.path, draggingSplit.currentPos);
      setDraggingSplit(null);
    }
    // If pending click wasn't converted to drag → open width editor for that split
    if (pendingClick.current && !draggingSplit) {
      const pc = pendingClick.current;
      const splitInfo = splitsWithBounds.find(s => pathsEqual(s.path, pc.path));
      if (splitInfo && onSplitWidthChange) {
        const b = splitInfo.bounds;
        const centerX = pc.type === 'vsplit' ? pc.pos : (b.yMin + b.yMax) / 2;
        const centerY = pc.type === 'hsplit' ? pc.pos : (b.xMin + b.xMax) / 2;
        setEditingMember({
          type: 'split',
          path: pc.path,
          screenX: toX(centerX),
          screenY: toY(centerY),
          currentValue: splitInfo.width,
        });
      }
      pendingClick.current = null;
    }
    setIsPanning(false);
  }, [measure.draggingIdx, measure.handleDimMouseUp, draggingSplit, draggingHinge, draggingHandle, onSplitDragEnd, splitsWithBounds, onSplitWidthChange, toX, toY, toXBack, holes, hingeConfig, singleView, onHingePositionChange, onHandleElevationChange]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && onSplitSelect) {
        const sx = e.touches[0].clientX - rect.left;
        const sy = e.touches[0].clientY - rect.top;
        const hit = hitTestSplits(sx, sy, splitsWithBounds, toX, toY);
        if (hit) {
          onSplitSelect(hit.path);
          const range = getDragRange(hit);
          setDraggingSplit({ path: hit.path, type: hit.type, currentPos: hit.pos, range });
          lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          return;
        }
      }
      setIsPanning(true);
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }, [splitsWithBounds, toX, toY, onSplitSelect]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      if (draggingSplit) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const sx = e.touches[0].clientX - rect.left;
          const sy = e.touches[0].clientY - rect.top;
          let newPos = draggingSplit.type === 'hsplit' ? fromY(sy) : fromX(sx);
          newPos = Math.max(draggingSplit.range.min, Math.min(draggingSplit.range.max, newPos));
          setDraggingSplit(prev => prev ? { ...prev, currentPos: newPos } : null);
        }
        return;
      }
      if (isPanning) {
        const t = e.touches[0];
        setPanX((p) => p + t.clientX - lastMouse.current.x);
        setPanY((p) => p + t.clientY - lastMouse.current.y);
        lastMouse.current = { x: t.clientX, y: t.clientY };
      }
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist.current > 0) {
        const factor = dist / lastPinchDist.current;
        setZoom((z) => Math.max(0.1, Math.min(20, z * factor)));
      }
      lastPinchDist.current = dist;
    }
  }, [draggingSplit, isPanning, fromX, fromY]);

  const handleTouchEnd = useCallback(() => {
    if (draggingSplit) {
      onSplitDragEnd?.(draggingSplit.path, draggingSplit.currentPos);
      setDraggingSplit(null);
    }
    setIsPanning(false);
    lastPinchDist.current = 0;
  }, [draggingSplit, onSplitDragEnd]);

  // Commit an inline width edit
  const commitEdit = useCallback((mm: number) => {
    if (!editingMember) return;
    if (mm <= 0) return;
    switch (editingMember.type) {
      case 'left-stile': onLeftStileWidthChange?.(mm); break;
      case 'right-stile': onRightStileWidthChange?.(mm); break;
      case 'top-rail': onTopRailWidthChange?.(mm); break;
      case 'bottom-rail': onBottomRailWidthChange?.(mm); break;
      case 'split':
        if (editingMember.path) onSplitWidthChange?.(editingMember.path, mm);
        break;
    }
  }, [editingMember, onLeftStileWidthChange, onRightStileWidthChange, onTopRailWidthChange, onBottomRailWidthChange, onSplitWidthChange]);

  // DXF export
  const handleExportDxf = useCallback(() => {
    const dxf = buildElevationDxf(
      doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW, panelTree, holes,
    );
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${door.Name.replace(/\s+/g, '_')}_elevation.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [door.Name, doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW, panelTree, holes]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    const leaves = flattenTree(panelTree, rootBounds);

    // --- Draw one elevation view (reused for front and back) ---
    // simplified=true: solid door outline + hardware only (for back view)
    function drawElevation(
      ctx: CanvasRenderingContext2D,
      localToX: (x: number) => number,
      clipLeft: number,
      clipWidth: number,
      filteredHoles: HoleData[],
      label: string,
      simplified: boolean,
      backPocketRects?: { yMin: number; xMin: number; yMax: number; xMax: number }[],
      singleViewMode = false,
    ) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipLeft, 0, clipWidth, ch);
      ctx.clip();

      // Helper: draw a filled rect in model space
      const drawRect = (x1: number, y1: number, x2: number, y2: number) => {
        const sx1 = localToX(x1), sy1 = toY(y2);
        const sx2 = localToX(x2), sy2 = toY(y1);
        ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      };
      const strokeRect = (x1: number, y1: number, x2: number, y2: number) => {
        const sx1 = localToX(x1), sy1 = toY(y2);
        const sx2 = localToX(x2), sy2 = toY(y1);
        ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      };

      if (!simplified) {
        // Hatching helper
        const drawHatch = (x1: number, y1: number, x2: number, y2: number) => {
          if (!showHatching) return;
          const sx1 = localToX(x1), sy1 = toY(y2);
          const sx2 = localToX(x2), sy2 = toY(y1);
          const w = sx2 - sx1;
          const h = sy2 - sy1;
          ctx.save();
          ctx.beginPath();
          ctx.rect(sx1, sy1, w, h);
          ctx.clip();
          ctx.strokeStyle = '#cccccc';
          ctx.lineWidth = 0.5;
          const spacing = 6;
          const diag = Math.abs(w) + h;
          for (let d = -diag; d < diag; d += spacing) {
            ctx.beginPath();
            ctx.moveTo(sx1 + d, sy1);
            ctx.lineTo(sx1 + d + h, sy1 + h);
            ctx.stroke();
          }
          ctx.restore();
        };

        // Panel areas
        if (renderMode !== 'wireframe') {
          ctx.fillStyle = '#f0f0f0';
          for (const pb of leaves) {
            drawRect(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
            if (renderMode === 'solid') drawHatch(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
          }

          // Frame members (stile/rail fill)
          ctx.fillStyle = '#e8dcc8';
          drawRect(0, 0, leftStileW, doorH);
          drawRect(doorW - rightStileW, 0, doorW, doorH);
          drawRect(leftStileW, 0, doorW - rightStileW, bottomRailW);
          drawRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

          // Frame member selection highlight
          if (selectedFrameMember && !simplified) {
            ctx.fillStyle = 'rgba(60, 120, 255, 0.15)';
            switch (selectedFrameMember) {
              case 'left-stile': drawRect(0, 0, leftStileW, doorH); break;
              case 'right-stile': drawRect(doorW - rightStileW, 0, doorW, doorH); break;
              case 'top-rail': drawRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH); break;
              case 'bottom-rail': drawRect(leftStileW, 0, doorW - rightStileW, bottomRailW); break;
            }
            ctx.strokeStyle = '#3c78ff';
            ctx.lineWidth = 2;
            switch (selectedFrameMember) {
              case 'left-stile': strokeRect(0, 0, leftStileW, doorH); break;
              case 'right-stile': strokeRect(doorW - rightStileW, 0, doorW, doorH); break;
              case 'top-rail': strokeRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH); break;
              case 'bottom-rail': strokeRect(leftStileW, 0, doorW - rightStileW, bottomRailW); break;
            }
          }

          // Divider bars — recursive
          function drawDividers(tree: PanelTree, bounds: PanelBounds) {
            if (tree.type === 'leaf') return;
            const half = tree.width / 2;
            if (tree.type === 'hsplit') {
              drawRect(bounds.yMin, tree.pos - half, bounds.yMax, tree.pos + half);
              drawDividers(tree.children[0], { ...bounds, xMax: tree.pos - half });
              drawDividers(tree.children[1], { ...bounds, xMin: tree.pos + half });
            } else {
              drawRect(tree.pos - half, bounds.xMin, tree.pos + half, bounds.xMax);
              drawDividers(tree.children[0], { ...bounds, yMax: tree.pos - half });
              drawDividers(tree.children[1], { ...bounds, yMin: tree.pos + half });
            }
          }
          drawDividers(panelTree, rootBounds);
        }

        // Outer door perimeter
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1.5;
        strokeRect(0, 0, doorW, doorH);

        // Panel outlines
        ctx.strokeStyle = '#999999';
        ctx.lineWidth = 0.5;
        for (const pb of leaves) {
          strokeRect(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
        }

        // Width labels on frame members and dividers
        if (renderMode !== 'wireframe') {
          ctx.fillStyle = '#666666';
          ctx.font = `${Math.max(9, Math.min(12, 10 * scale / baseScale))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fmtDim(leftStileW), localToX(leftStileW / 2), toY(doorH / 2));
          ctx.fillText(fmtDim(rightStileW), localToX(doorW - rightStileW / 2), toY(doorH / 2));
          ctx.fillText(fmtDim(topRailW), localToX(doorW / 2), toY(doorH - topRailW / 2));
          ctx.fillText(fmtDim(bottomRailW), localToX(doorW / 2), toY(bottomRailW / 2));
          function labelDividers(tree: PanelTree, bounds: PanelBounds) {
            if (tree.type === 'leaf') return;
            const half = tree.width / 2;
            if (tree.type === 'hsplit') {
              const cx = (bounds.yMin + bounds.yMax) / 2;
              ctx.fillText(fmtDim(tree.width), localToX(cx), toY(tree.pos));
              labelDividers(tree.children[0], { ...bounds, xMax: tree.pos - half });
              labelDividers(tree.children[1], { ...bounds, xMin: tree.pos + half });
            } else {
              const cy = (bounds.xMin + bounds.xMax) / 2;
              ctx.fillText(fmtDim(tree.width), localToX(tree.pos), toY(cy));
              labelDividers(tree.children[0], { ...bounds, yMax: tree.pos - half });
              labelDividers(tree.children[1], { ...bounds, yMin: tree.pos + half });
            }
          }
          labelDividers(panelTree, rootBounds);
        }
      } else {
        // Simplified back view — solid door fill + outline only
        if (renderMode !== 'wireframe') {
          ctx.fillStyle = '#e8dcc8';
          drawRect(0, 0, doorW, doorH);
        }
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1.5;
        strokeRect(0, 0, doorW, doorH);

        // Back pocket outlines (solid — this IS the back view)
        if (backPocketRects && backPocketRects.length > 0) {
          ctx.strokeStyle = '#888888';
          ctx.lineWidth = 1;
          for (const r of backPocketRects) {
            // r uses Mozaik coords: Y=width, X=height
            strokeRect(r.yMin, r.xMin, r.yMax, r.xMax);
          }
        }
      }

      // Hardware holes (always drawn)
      if (showHardware && filteredHoles.length > 0) {
        for (const hole of filteredHoles) {
          const sx = localToX(hole.Y);
          const sy = toY(hole.X);
          const sr = (hole.Diameter / 2) * scale;

          // In single-view mode, back-face holes render as dotted red outlines
          const isBackInSingle = singleViewMode && hole.FlipSideOp;

          if (isBackInSingle) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#cc3333';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            if (hole.holeType === 'hinge-cup') {
              ctx.fillStyle = 'rgba(180, 120, 60, 0.5)';
              ctx.strokeStyle = '#8B6914';
            } else if (hole.holeType === 'hinge-mount') {
              ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
              ctx.strokeStyle = '#444444';
            } else {
              ctx.fillStyle = 'rgba(60, 120, 200, 0.5)';
              ctx.strokeStyle = '#2255aa';
            }

            ctx.lineWidth = renderMode === 'wireframe' ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            if (renderMode !== 'wireframe') {
              ctx.fill();
            }
            ctx.stroke();

            ctx.strokeStyle = hole.holeType === 'handle' ? '#2255aa' : '#666666';
            ctx.lineWidth = 0.5;
            const ch2 = Math.max(sr * 0.3, 2);
            ctx.beginPath();
            ctx.moveTo(sx - ch2, sy); ctx.lineTo(sx + ch2, sy);
            ctx.moveTo(sx, sy - ch2); ctx.lineTo(sx, sy + ch2);
            ctx.stroke();
          }
        }
      }

      // View label
      ctx.fillStyle = '#888888';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, clipLeft + clipWidth / 2, 16);

      ctx.restore();
    }

    // --- Compute back pocket rects from back operations ---
    const allOps = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
    const backPocketRects = allOps
      .filter(op => op.FlipSideOp && op.OperationToolPathNode && op.OperationToolPathNode.length >= 3)
      .map(op => {
        const nodes = op.OperationToolPathNode!;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
          if (n.X < minX) minX = n.X;
          if (n.X > maxX) maxX = n.X;
          if (n.Y < minY) minY = n.Y;
          if (n.Y > maxY) maxY = n.Y;
        }
        return { xMin: minX, xMax: maxX, yMin: minY, yMax: maxY };
      });

    // --- Draw front elevation (left half, or full width in single view) ---
    const frontHoles = singleView ? holes : holes.filter(h => !h.FlipSideOp);
    drawElevation(ctx, toX, 0, halfW, frontHoles, singleView ? '' : 'FRONT', false, undefined, singleView);

    // --- Draw back elevation (right half, mirrored + simplified) — skip in single view ---
    if (!singleView) {
      const backHoles = holes.filter(h => h.FlipSideOp);
      drawElevation(ctx, toXBack, halfW, halfW, backHoles, 'BACK', true, backPocketRects);

      // --- Divider line between front and back ---
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 0);
      ctx.lineTo(halfW, ch);
      ctx.stroke();
    }

    // --- Divider highlights (front view only) ---
    if (hoveredSplit && (!selectedSplitPath || !pathsEqual(hoveredSplit.path, selectedSplitPath))) {
      const hovered = splitsWithBounds.find(s => pathsEqual(s.path, hoveredSplit.path));
      if (hovered) {
        const b = hovered.bounds;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, halfW, ch);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 200, 100, 0.2)';
        const sx1 = toX(b.yMin), sy1 = toY(b.xMax);
        const sx2 = toX(b.yMax), sy2 = toY(b.xMin);
        ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        ctx.strokeStyle = '#ffaa44';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        ctx.restore();
      }
    }

    if (selectedSplitPath) {
      const selected = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
      if (selected) {
        const b = selected.bounds;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, halfW, ch);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 165, 0, 0.35)';
        const sx1 = toX(b.yMin), sy1 = toY(b.xMax);
        const sx2 = toX(b.yMax), sy2 = toY(b.xMin);
        ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        ctx.restore();
      }
    }

    // Panel selection highlights (front view only)
    if (selectedPanelIndices && selectedPanelIndices.size > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, halfW, ch);
      ctx.clip();
      for (const idx of selectedPanelIndices) {
        if (idx >= 0 && idx < leaves.length) {
          const pb = leaves[idx];
          const sx1 = toX(pb.yMin), sy1 = toY(pb.xMax);
          const sx2 = toX(pb.yMax), sy2 = toY(pb.xMin);
          ctx.fillStyle = 'rgba(60, 120, 255, 0.15)';
          ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
          ctx.strokeStyle = '#3c78ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        }
      }
      ctx.restore();
    }

    // Ghost line during drag (front view only)
    if (draggingSplit) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, halfW, ch);
      ctx.clip();
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      if (draggingSplit.type === 'hsplit') {
        const syLine = toY(draggingSplit.currentPos);
        const sxLeft = toX(leftStileW);
        const sxRight = toX(doorW - rightStileW);
        ctx.beginPath();
        ctx.moveTo(sxLeft, syLine);
        ctx.lineTo(sxRight, syLine);
        ctx.stroke();
      } else {
        const sxLine = toX(draggingSplit.currentPos);
        const syTop = toY(doorH - topRailW);
        const syBot = toY(bottomRailW);
        ctx.beginPath();
        ctx.moveTo(sxLine, syTop);
        ctx.lineTo(sxLine, syBot);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Hinge selection highlight + drag ghost
    if (showHardware && holes.length > 0) {
      const cupHoles = holes.filter(h => h.holeType === 'hinge-cup');

      // Selection highlight on selected cup
      if (selectedHingeIdx !== null && selectedHingeIdx < cupHoles.length && !draggingHinge) {
        const cup = cupHoles[selectedHingeIdx];
        const hsx = singleView ? toX(cup.Y) : toXBack(cup.Y);
        const hsy = toY(cup.X);
        const sr = (cup.Diameter / 2) * scale;
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(hsx, hsy, sr + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ghost circle during drag
      if (draggingHinge && draggingHinge.index < cupHoles.length) {
        const cup = cupHoles[draggingHinge.index];
        const isVerticalAxis = hingeConfig?.side === 'left' || hingeConfig?.side === 'right';
        const ghostX = isVerticalAxis ? cup.Y : draggingHinge.currentPos;
        const ghostY = isVerticalAxis ? draggingHinge.currentPos : cup.X;
        const hsx = singleView ? toX(ghostX) : toXBack(ghostX);
        const hsy = toY(ghostY);
        const sr = (cup.Diameter / 2) * scale;

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hsx, hsy, sr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Position label
        const posVal = draggingHinge.currentPos;
        const label = fmtDim(posVal);
        ctx.fillStyle = '#ff8800';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, hsx, hsy - sr - 8);
      }
    }

    // Handle selection highlight + drag ghost
    if (showHardware && holes.length > 0) {
      const handleHoles = holes.filter(h => h.holeType === 'handle');

      // Selection highlight on selected handle hole
      if (selectedHandleIdx !== null && selectedHandleIdx < handleHoles.length && !draggingHandle) {
        const hole = handleHoles[selectedHandleIdx];
        const hsx = hole.FlipSideOp
          ? (singleView ? toX(hole.Y) : toXBack(hole.Y))
          : toX(hole.Y);
        const hsy = toY(hole.X);
        const sr = (hole.Diameter / 2) * scale;
        ctx.strokeStyle = '#2266cc';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(hsx, hsy, sr + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ghost circles during handle drag (all handle holes move together)
      if (draggingHandle && handleHoles.length > 0) {
        const firstHole = handleHoles[0];
        const elevationDelta = draggingHandle.currentPos - firstHole.X;

        for (const hole of handleHoles) {
          const ghostX = hole.Y;
          const ghostY = hole.X + elevationDelta;
          const hsx = hole.FlipSideOp
            ? (singleView ? toX(ghostX) : toXBack(ghostX))
            : toX(ghostX);
          const hsy = toY(ghostY);
          const sr = (hole.Diameter / 2) * scale;

          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#2266cc';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(hsx, hsy, sr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Position label on first hole
        const labelHsx = firstHole.FlipSideOp
          ? (singleView ? toX(firstHole.Y) : toXBack(firstHole.Y))
          : toX(firstHole.Y);
        const labelHsy = toY(draggingHandle.currentPos);
        const sr = (firstHole.Diameter / 2) * scale;
        ctx.fillStyle = '#2266cc';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(fmtDim(draggingHandle.currentPos), labelHsx, labelHsy - sr - 8);
      }
    }

    // Dimensions (front view only)
    if (showDimensions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, halfW, ch);
      ctx.clip();

      drawLinearDim(ctx, 0, 0, doorW, 0, fmtDim(doorW), 35, 'below', toX, toY);
      drawLinearDim(ctx, doorW, 0, doorW, doorH, fmtDim(doorH), 35, 'right', toX, toY);

      drawLinearDim(ctx, 0, doorH, leftStileW, doorH, fmtDim(leftStileW), 15, 'above', toX, toY);
      drawLinearDim(ctx, doorW - rightStileW, doorH, doorW, doorH, fmtDim(rightStileW), 15, 'above', toX, toY);
      drawLinearDim(ctx, 0, doorH - topRailW, 0, doorH, fmtDim(topRailW), 15, 'left', toX, toY);
      drawLinearDim(ctx, 0, 0, 0, bottomRailW, fmtDim(bottomRailW), 15, 'left', toX, toY);

      const splits = enumerateSplits(panelTree);
      for (const split of splits) {
        if (split.type === 'hsplit') {
          drawLinearDim(ctx, 0, 0, 0, split.pos, fmtDim(split.pos), 55 + split.depth * 20, 'left', toX, toY);
          drawLinearDim(ctx, doorW, split.pos - split.width / 2, doorW, split.pos + split.width / 2,
            fmtDim(split.width), 15 + split.depth * 20, 'right', toX, toY);
        } else {
          drawLinearDim(ctx, 0, 0, split.pos, 0, fmtDim(split.pos), 55 + split.depth * 20, 'below', toX, toY);
          drawLinearDim(ctx, split.pos - split.width / 2, doorH, split.pos + split.width / 2, doorH,
            fmtDim(split.width), 15 + split.depth * 20, 'above', toX, toY);
        }
      }

      for (const pb of leaves) {
        const panelH = pb.xMax - pb.xMin;
        const panelW = pb.yMax - pb.yMin;
        const pcx = (pb.yMin + pb.yMax) / 2;
        const pcy = (pb.xMin + pb.xMax) / 2;
        drawLinearDim(ctx, pcx, pb.xMin, pcx, pb.xMax,
          fmtDim(panelH), 10, 'right', toX, toY);
        drawLinearDim(ctx, pb.yMin, pcy, pb.yMax, pcy,
          fmtDim(panelW), 10, 'above', toX, toY);
      }

      ctx.restore();
    }

    // Handle dimension annotations (front view only, for front-facing handles)
    if (showHardware && handleConfig) {
      const handleHoles = holes.filter(h => h.holeType === 'handle' && !h.FlipSideOp);
      const dimColor = '#2255aa';

      if (handleHoles.length === 2) {
        const h0 = handleHoles[0], h1 = handleHoles[1];
        drawLinearDim(ctx, h0.Y, h0.X, h1.Y, h1.X,
          fmtDim(Math.hypot(h1.X - h0.X, h1.Y - h0.Y)),
          20, 'left', toX, toY, dimColor);
      }

      if (handleHoles.length > 0) {
        const h = handleHoles[0];
        const handleMidX = handleHoles.length === 2
          ? (handleHoles[0].X + handleHoles[1].X) / 2
          : h.X;
        const dp = handleConfig.doorPlacement;
        if (dp === 'top' || dp === 'center-top') {
          drawLinearDim(ctx, h.Y, handleMidX, h.Y, doorH,
            fmtDim(doorH - handleMidX), 40, 'left', toX, toY, dimColor);
        } else if (dp === 'bottom' || dp === 'custom') {
          drawLinearDim(ctx, h.Y, 0, h.Y, handleMidX,
            fmtDim(handleMidX), 40, 'left', toX, toY, dimColor);
        }
      }
    }

    // --- Measure tool overlays (front view only) ---
    if (showUserDimensions) {
      for (const m of measure.measurements) {
        drawGeneralDim(ctx, toX(m.ax), toY(m.ay), toX(m.bx), toY(m.by), m.label, m.perpOffset, '#0088cc');
      }
    }

    if (measure.measureMode && measure.dimPreview) {
      const dp = measure.dimPreview;
      drawGeneralDim(ctx, toX(dp.ax), toY(dp.ay), toX(dp.bx), toY(dp.by), dp.label, dp.perpOffset, 'rgba(0, 136, 204, 0.6)');
    }

    if (measure.measureMode && measure.snap && measure.phase !== 'placing-dim') {
      drawSnapIndicator(ctx, toX(measure.snap.x), toY(measure.snap.y), measure.snap.label);
    }
    if (measure.measureMode && measure.phase === 'placing-b' && measure.pointA && measure.snap) {
      const sax = toX(measure.pointA.x), say = toY(measure.pointA.y);
      const sbx = toX(measure.snap.x), sby = toY(measure.snap.y);
      drawMeasurePreview(ctx, sax, say, sbx, sby, sbx, sby);
    }
    if (measure.measureMode && measure.pointA) {
      ctx.save();
      ctx.fillStyle = '#00aaff';
      ctx.beginPath();
      ctx.arc(toX(measure.pointA.x), toY(measure.pointA.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw kerf lines (front view)
    if (kerfs && kerfs.length > 0) {
      const KERF_HALF = 3.175 / 2; // half of 1/8" kerf width
      ctx.save();
      for (const k of kerfs) {
        const isSelected = k.id === selectedKerfId;
        ctx.fillStyle = isSelected ? 'rgba(200, 100, 0, 0.45)' : 'rgba(200, 100, 0, 0.25)';
        ctx.strokeStyle = '#cc6600';
        ctx.lineWidth = isSelected ? 2 : 1;
        if (k.orientation === 'H') {
          const x1 = toX(0);
          const x2 = toX(doorW);
          const y1 = toY(k.centerMm + KERF_HALF);
          const y2 = toY(k.centerMm - KERF_HALF);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        } else {
          const x1 = toX(k.centerMm - KERF_HALF);
          const x2 = toX(k.centerMm + KERF_HALF);
          const y1 = toY(doorH);
          const y2 = toY(0);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        }
      }
      ctx.restore();
    }

    // Ghost kerf preview + dimension lines when in kerf mode and hovering
    if (kerfMode && kerfHoverMm !== null) {
      const KERF_HALF = 3.175 / 2;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = 'rgba(200, 100, 0, 0.12)';
      ctx.strokeStyle = '#cc6600';
      ctx.lineWidth = 1;
      if (kerfMode === 'H') {
        const x1 = toX(0); const x2 = toX(doorW);
        const y1 = toY(kerfHoverMm + KERF_HALF); const y2 = toY(kerfHoverMm - KERF_HALF);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      } else {
        const x1 = toX(kerfHoverMm - KERF_HALF); const x2 = toX(kerfHoverMm + KERF_HALF);
        const y1 = toY(doorH); const y2 = toY(0);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
      ctx.setLineDash([]);
      ctx.restore();

      // Dimension annotations to nearest boundaries
      const { lo, hi } = getNearestBoundaries(kerfHoverMm, kerfMode,
        doorH, doorW, bottomRailW, topRailW, leftStileW, rightStileW, splitsWithBounds);
      const distLo = kerfHoverMm - lo;
      const distHi = hi - kerfHoverMm;
      if (kerfMode === 'H') {
        if (distLo > 0.5) drawLinearDim(ctx, doorW, lo, doorW, kerfHoverMm, fmtDim(distLo), 28, 'right', toX, toY, '#cc6600');
        if (distHi > 0.5) drawLinearDim(ctx, doorW, kerfHoverMm, doorW, hi, fmtDim(distHi), 28, 'right', toX, toY, '#cc6600');
      } else {
        if (distLo > 0.5) drawLinearDim(ctx, lo, doorH, kerfHoverMm, doorH, fmtDim(distLo), 28, 'above', toX, toY, '#cc6600');
        if (distHi > 0.5) drawLinearDim(ctx, kerfHoverMm, doorH, hi, doorH, fmtDim(distHi), 28, 'above', toX, toY, '#cc6600');
      }
    }

    // Draw kerf lines (back view, if dual view)
    if (!singleView && kerfs && kerfs.length > 0) {
      const KERF_HALF = 3.175 / 2;
      ctx.save();
      for (const k of kerfs) {
        ctx.fillStyle = 'rgba(200, 100, 0, 0.25)';
        ctx.strokeStyle = '#cc6600';
        ctx.lineWidth = 1;
        if (k.orientation === 'H') {
          // Back view mirrors X axis
          const x1 = toXBack(doorW);
          const x2 = toXBack(0);
          const y1 = toY(k.centerMm + KERF_HALF);
          const y2 = toY(k.centerMm - KERF_HALF);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        } else {
          // Vertical kerf on back: same width position, mirrored X
          const x1 = toXBack(k.centerMm + KERF_HALF);
          const x2 = toXBack(k.centerMm - KERF_HALF);
          const y1 = toY(doorH);
          const y2 = toY(0);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        }
      }
      ctx.restore();
    }

  }, [cw, ch, halfW, toX, toXBack, toY, scale, baseScale, doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW,
      panelTree, rootBounds, showDimensions, showHatching, showHardware, showUserDimensions, holes, handleConfig, renderMode, fmtDim, door,
      selectedSplitPath, hoveredSplit, draggingSplit, splitsWithBounds, selectedPanelIndices, selectedFrameMember, singleView,
      measure.measurements, measure.measureMode, measure.snap, measure.pointA, measure.dimPreview, measure.phase,
      selectedHingeIdx, draggingHinge, hingeConfig,
      selectedHandleIdx, draggingHandle, kerfs, selectedKerfId, kerfMode, kerfHoverMm]);

  const isZoomed = zoom !== 1 || panX !== 0 || panY !== 0;

  // Sidebar data
  const splits = enumerateSplits(panelTree);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar */}
      {!compact && <div style={sidebarStyles.container}>
        <h3 style={sidebarStyles.title}>{door.Name}</h3>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>Size:</span>
          <span>{fmtDim(doorW)} x {fmtDim(doorH)}</span>
        </div>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>L/R Stile:</span>
          <span>{fmtDim(leftStileW)} / {fmtDim(rightStileW)}</span>
        </div>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>T/B Rail:</span>
          <span>{fmtDim(topRailW)} / {fmtDim(bottomRailW)}</span>
        </div>
        {splits.map((s, i) => (
          <div key={i} style={sidebarStyles.row}>
            <span style={sidebarStyles.label}>
              {s.type === 'hsplit' ? 'Rail' : 'Stile'} {i + 1}:
            </span>
            <span>{fmtDim(s.width)} @ {fmtDim(s.pos)}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid #333355', marginTop: 8, paddingTop: 8 }}>
          <div style={sidebarStyles.label}>Layers</div>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showDimensions} onChange={(e) => setShowDimensions(e.target.checked)} />
            Dimensions
          </label>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showHatching} onChange={(e) => setShowHatching(e.target.checked)} />
            Panel Hatching
          </label>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showHardware} onChange={(e) => setShowHardware(e.target.checked)} />
            Hardware ({holes.length})
          </label>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showUserDimensions} onChange={(e) => setShowUserDimensions(e.target.checked)} />
            User Dimensions
          </label>
        </div>

        <button style={sidebarStyles.exportBtn} onClick={handleExportDxf}>
          Export DXF
        </button>
      </div>}

      {/* Canvas area */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={cw}
          height={ch}
          style={{ width: '100%', height: '100%', cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        {/* Inline width editor */}
        {editingMember && (
          <div style={{
            position: 'absolute',
            left: editingMember.screenX - 32,
            top: editingMember.screenY - 14,
            zIndex: 20,
          }}>
            <input
              autoFocus
              type="number"
              defaultValue={units === 'in'
                ? parseFloat((editingMember.currentValue / 25.4).toFixed(4))
                : editingMember.currentValue}
              step={units === 'in' ? 0.125 : 0.5}
              style={{
                width: 64,
                fontSize: 12,
                textAlign: 'center',
                padding: '2px 4px',
                borderRadius: 4,
                border: '2px solid #ff8800',
                background: '#fff',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const raw = parseFloat(e.currentTarget.value);
                  if (!isNaN(raw)) {
                    const mm = units === 'in' ? raw * 25.4 : raw;
                    commitEdit(mm);
                  }
                  setEditingMember(null);
                }
                if (e.key === 'Escape') {
                  setEditingMember(null);
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEditingMember(null)}
            />
          </div>
        )}
        {/* Inline hinge position editor */}
        {editingHinge && (
          <div style={{
            position: 'absolute',
            left: editingHinge.screenX - 32,
            top: editingHinge.screenY - 14,
            zIndex: 20,
          }}>
            <input
              autoFocus
              type="number"
              defaultValue={units === 'in'
                ? parseFloat((editingHinge.currentValue / 25.4).toFixed(4))
                : parseFloat(editingHinge.currentValue.toFixed(2))}
              step={units === 'in' ? 0.125 : 0.5}
              style={{
                width: 64,
                fontSize: 12,
                textAlign: 'center',
                padding: '2px 4px',
                borderRadius: 4,
                border: '2px solid #ff8800',
                background: '#fff',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const raw = parseFloat(e.currentTarget.value);
                  if (!isNaN(raw)) {
                    const mm = units === 'in' ? raw * 25.4 : raw;
                    onHingePositionChange?.(editingHinge.index, mm);
                  }
                  setEditingHinge(null);
                }
                if (e.key === 'Escape') {
                  setEditingHinge(null);
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEditingHinge(null)}
            />
          </div>
        )}
        {/* Inline handle elevation editor */}
        {editingHandle && (
          <div style={{
            position: 'absolute',
            left: editingHandle.screenX - 32,
            top: editingHandle.screenY - 14,
            zIndex: 20,
          }}>
            <input
              autoFocus
              type="number"
              defaultValue={units === 'in'
                ? parseFloat((editingHandle.currentValue / 25.4).toFixed(4))
                : parseFloat(editingHandle.currentValue.toFixed(2))}
              step={units === 'in' ? 0.125 : 0.5}
              style={{
                width: 64,
                fontSize: 12,
                textAlign: 'center',
                padding: '2px 4px',
                borderRadius: 4,
                border: '2px solid #2266cc',
                background: '#fff',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const raw = parseFloat(e.currentTarget.value);
                  if (!isNaN(raw)) {
                    const mm = units === 'in' ? raw * 25.4 : raw;
                    onHandleElevationChange?.(mm);
                  }
                  setEditingHandle(null);
                }
                if (e.key === 'Escape') {
                  setEditingHandle(null);
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEditingHandle(null)}
            />
          </div>
        )}
        {/* MR/MS + equal-split overlay — show when exactly 1 panel selected */}
        {selectedPanelIndices && selectedPanelIndices.size === 1 && (onAddMidRail || onAddMidStile || onAddEqualMidRails || onAddEqualMidStiles) && (() => {
          const idx = [...selectedPanelIndices][0];
          if (idx < 0 || idx >= leaves.length) return null;
          const pb = leaves[idx];
          const btnX = toX((pb.yMin + pb.yMax) / 2);
          const btnY = toY((pb.xMin + pb.xMax) / 2);
          return (
            <div style={{
              position: 'absolute',
              left: btnX,
              top: btnY,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              zIndex: 15,
              pointerEvents: 'auto',
            }}>
              {/* Rail group: MR + equal-rail buttons */}
              <div style={{ display: 'flex', gap: 2 }}>
                {onAddMidRail && (
                  <button onClick={() => onAddMidRail(idx)} style={mrMsBtnStyle} title="Add Mid Rail">MR</button>
                )}
                {onAddEqualMidRails && [2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => onAddEqualMidRails(idx, n)}
                    style={{ ...mrMsBtnStyle, background: 'rgba(40,130,90,0.9)', border: '1px solid #44bb77', padding: '1px 5px', fontSize: '10px' }}
                    title={`${n} equal horizontal panels`}
                  >=R{n}</button>
                ))}
              </div>
              {/* Stile group: MS + equal-stile buttons */}
              <div style={{ display: 'flex', gap: 2 }}>
                {onAddMidStile && (
                  <button onClick={() => onAddMidStile(idx)} style={mrMsBtnStyle} title="Add Mid Stile">MS</button>
                )}
                {onAddEqualMidStiles && [2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => onAddEqualMidStiles(idx, n)}
                    style={{ ...mrMsBtnStyle, background: 'rgba(80,80,140,0.9)', border: '1px solid #8888cc', padding: '1px 5px', fontSize: '10px' }}
                    title={`${n} equal vertical panels`}
                  >=S{n}</button>
                ))}
              </div>
            </div>
          );
        })()}
        {/* Delete-split overlay button — show when a split is selected */}
        {selectedSplitPath && onDeleteSplit && (() => {
          const sp = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
          if (!sp) return null;
          const b = sp.bounds;
          let btnX: number, btnY: number;
          if (sp.type === 'hsplit') {
            btnX = toX((b.yMin + b.yMax) / 2);
            btnY = toY(sp.pos);
          } else {
            btnX = toX(sp.pos);
            btnY = toY((b.xMin + b.xMax) / 2);
          }
          return (
            <div style={{ position: 'absolute', left: btnX, top: btnY, transform: 'translate(-50%, -50%)', zIndex: 20, pointerEvents: 'auto' }}>
              <button
                onClick={() => onDeleteSplit(selectedSplitPath)}
                style={{ ...mrMsBtnStyle, background: 'rgba(200, 60, 60, 0.9)', border: '1px solid #dd4444', padding: '1px 6px', fontSize: '13px', lineHeight: '16px' }}
                title="Delete split (Delete key)"
              >✕</button>
            </div>
          );
        })()}
        {/* Drag dimension callouts — live panel size labels during split drag */}
        {draggingSplit && (() => {
          const sp = splitsWithBounds.find(s => pathsEqual(s.path, draggingSplit.path));
          if (!sp) return null;
          const pos = draggingSplit.currentPos;
          const pb = sp.parentBounds;
          const hw = sp.width / 2;
          const pillStyle: React.CSSProperties = {
            position: 'absolute',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(20, 20, 40, 0.82)',
            color: '#ffdd88',
            fontSize: '11px',
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 10,
            pointerEvents: 'none',
            zIndex: 25,
            whiteSpace: 'nowrap',
          };
          if (draggingSplit.type === 'hsplit') {
            const botH = Math.max(0, pos - hw - pb.xMin);
            const topH = Math.max(0, pb.xMax - pos - hw);
            const cx = toX((pb.yMin + pb.yMax) / 2);
            const botY = toY(pb.xMin + botH / 2);
            const topY = toY(pb.xMax - topH / 2);
            return (
              <>
                <div style={{ ...pillStyle, left: cx, top: botY }}>{fmtDim(botH)}</div>
                <div style={{ ...pillStyle, left: cx, top: topY }}>{fmtDim(topH)}</div>
              </>
            );
          } else {
            const leftW = Math.max(0, pos - hw - pb.yMin);
            const rightW = Math.max(0, pb.yMax - pos - hw);
            const cy = toY((pb.xMin + pb.xMax) / 2);
            const leftX = toX(pb.yMin + leftW / 2);
            const rightX = toX(pb.yMax - rightW / 2);
            return (
              <>
                <div style={{ ...pillStyle, left: leftX, top: cy }}>{fmtDim(leftW)}</div>
                <div style={{ ...pillStyle, left: rightX, top: cy }}>{fmtDim(rightW)}</div>
              </>
            );
          }
        })()}
        {/* Toolbar */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, zIndex: 10 }}>
          <RenderModeButton mode={renderMode} onToggle={() => onRenderModeChange(nextRenderMode(renderMode))} />
          <button
            onClick={measure.toggleMeasure}
            style={{
              ...measureBtnStyle,
              background: measure.measureMode ? '#0088cc' : '#fff',
              color: measure.measureMode ? '#fff' : '#333',
              borderColor: measure.measureMode ? '#0077b3' : '#999',
            }}
            title={measure.measureMode ? 'Exit Measure Mode (Esc)' : 'Measure Tool'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="13" x2="13" y2="1" />
              <line x1="1" y1="13" x2="1" y2="9" />
              <line x1="1" y1="13" x2="5" y2="13" />
              <line x1="13" y1="1" x2="13" y2="5" />
              <line x1="13" y1="1" x2="9" y2="1" />
            </svg>
          </button>
          {measure.measurements.length > 0 && (
            <button
              onClick={measure.clearMeasurements}
              style={measureBtnStyle}
              title="Clear Measurements"
            >Clear</button>
          )}
          <button
            onClick={() => setSingleView(v => !v)}
            style={{
              ...measureBtnStyle,
              background: singleView ? '#0088cc' : '#fff',
              color: singleView ? '#fff' : '#333',
              borderColor: singleView ? '#0077b3' : '#999',
              fontWeight: 700,
              fontSize: '12px',
            }}
            title={singleView ? 'Show Front & Back' : 'Show Front Only'}
          >{singleView ? '1' : '1|2'}</button>
          {onReset && (
            <button
              onClick={onReset}
              style={measureBtnStyle}
              title="Reset stile/rail widths and mid splits to style defaults"
            >Reset</button>
          )}
          {kerfEnabled && (
            <>
              <button
                onClick={() => {
                  if (kerfMode === 'H') { setKerfMode(null); return; }
                  // Auto-place if an hsplit is selected
                  if (onAddKerf && selectedSplitPath) {
                    const sel = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
                    if (sel && sel.type === 'hsplit') {
                      onAddKerf('H', sel.pos, kerfToolGroupId);
                      return;
                    }
                  }
                  setKerfMode('H');
                }}
                style={{
                  ...measureBtnStyle,
                  background: kerfMode === 'H' ? '#cc6600' : '#fff',
                  color: kerfMode === 'H' ? '#fff' : '#333',
                  borderColor: kerfMode === 'H' ? '#aa4400' : '#999',
                }}
                title="Add Horizontal Kerf — click on elevation to set center height"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1" y1="7" x2="13" y2="7" />
                  <polyline points="3,7 3,4 5,7 5,4 7,7 7,4 9,7 9,4 11,7" />
                </svg>
                H
              </button>
              <button
                onClick={() => {
                  if (kerfMode === 'V') { setKerfMode(null); return; }
                  // Auto-place if a vsplit is selected
                  if (onAddKerf && selectedSplitPath) {
                    const sel = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
                    if (sel && sel.type === 'vsplit') {
                      onAddKerf('V', sel.pos, kerfToolGroupId);
                      return;
                    }
                  }
                  setKerfMode('V');
                }}
                style={{
                  ...measureBtnStyle,
                  background: kerfMode === 'V' ? '#cc6600' : '#fff',
                  color: kerfMode === 'V' ? '#fff' : '#333',
                  borderColor: kerfMode === 'V' ? '#aa4400' : '#999',
                }}
                title="Add Vertical Kerf — click on elevation to set center width"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="7" y1="1" x2="7" y2="13" />
                  <polyline points="7,3 4,3 7,5 4,5 7,7 4,7 7,9 4,9 7,11" />
                </svg>
                V
              </button>
              {kerfMode && kerfToolGroups && kerfToolGroups.length > 1 && (
                <select
                  value={kerfToolGroupId ?? ''}
                  onChange={e => setKerfToolGroupId(e.target.value ? Number(e.target.value) : null)}
                  style={{ fontSize: 11, border: '1px solid #999', borderRadius: 4, padding: '2px 4px', background: '#fff', color: '#333' }}
                >
                  {kerfToolGroups.map(g => (
                    <option key={g.ToolGroupID} value={g.ToolGroupID}>{g.Name}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
        {isZoomed && (
          <button
            style={resetBtnStyle}
            onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
          >
            Reset View
          </button>
        )}
      </div>
    </div>
  );
}

// --- DXF Export ---

function buildElevationDxf(
  doorW: number, doorH: number,
  leftStileW: number, rightStileW: number,
  topRailW: number, bottomRailW: number,
  panelTree: PanelTree,
  holes: HoleData[] = [],
): string {
  const lines: string[] = [];
  const addLine = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    lines.push('0', 'LINE', '8', layer,
      '10', x1.toFixed(4), '20', y1.toFixed(4), '30', '0.0',
      '11', x2.toFixed(4), '21', y2.toFixed(4), '31', '0.0');
  };
  const addRect = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    addLine(layer, x1, y1, x2, y1);
    addLine(layer, x2, y1, x2, y2);
    addLine(layer, x2, y2, x1, y2);
    addLine(layer, x1, y2, x1, y1);
  };
  const addCircle = (layer: string, cx: number, cy: number, radius: number) => {
    lines.push('0', 'CIRCLE', '8', layer,
      '10', cx.toFixed(4), '20', cy.toFixed(4), '30', '0.0',
      '40', radius.toFixed(4));
  };

  // Header
  const dxf: string[] = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4',
    '0', 'ENDSEC',
    // Tables — layers
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '5',
  ];
  const layers = [
    ['OUTLINE', '7'],   // white
    ['FRAME', '3'],     // green
    ['PANELS', '8'],    // gray
    ['DIVIDERS', '1'],  // red
    ['HARDWARE', '5'],  // blue
  ];
  for (const [name, color] of layers) {
    dxf.push('0', 'LAYER', '2', name, '70', '0', '62', color, '6', 'CONTINUOUS');
  }
  dxf.push('0', 'ENDTAB', '0', 'ENDSEC');

  // Entities
  dxf.push('0', 'SECTION', '2', 'ENTITIES');

  // Door outline
  addRect('OUTLINE', 0, 0, doorW, doorH);

  // Frame members
  addRect('FRAME', 0, 0, leftStileW, doorH);
  addRect('FRAME', doorW - rightStileW, 0, doorW, doorH);
  addRect('FRAME', leftStileW, 0, doorW - rightStileW, bottomRailW);
  addRect('FRAME', leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

  // Root panel bounds
  const rootBounds: PanelBounds = {
    xMin: bottomRailW,
    xMax: doorH - topRailW,
    yMin: leftStileW,
    yMax: doorW - rightStileW,
  };

  // Divider bars — recursive
  function dxfDividers(tree: PanelTree, bounds: PanelBounds) {
    if (tree.type === 'leaf') return;
    const half = tree.width / 2;
    if (tree.type === 'hsplit') {
      addRect('DIVIDERS', bounds.yMin, tree.pos - half, bounds.yMax, tree.pos + half);
      dxfDividers(tree.children[0], { ...bounds, xMax: tree.pos - half });
      dxfDividers(tree.children[1], { ...bounds, xMin: tree.pos + half });
    } else {
      addRect('DIVIDERS', tree.pos - half, bounds.xMin, tree.pos + half, bounds.xMax);
      dxfDividers(tree.children[0], { ...bounds, yMax: tree.pos - half });
      dxfDividers(tree.children[1], { ...bounds, yMin: tree.pos + half });
    }
  }
  dxfDividers(panelTree, rootBounds);

  // Panel areas
  const leaves = flattenTree(panelTree, rootBounds);
  for (const pb of leaves) {
    addRect('PANELS', pb.yMin, pb.xMin, pb.yMax, pb.xMax);
  }

  // Hardware holes (DXF coords: X=width=hole.Y, Y=height=hole.X)
  for (const hole of holes) {
    addCircle('HARDWARE', hole.Y, hole.X, hole.Diameter / 2);
  }

  dxf.push(...lines);
  dxf.push('0', 'ENDSEC', '0', 'EOF');

  return dxf.join('\n') + '\n';
}

// --- Styles ---

const sidebarStyles: Record<string, React.CSSProperties> = {
  container: {
    width: 220,
    flexShrink: 0,
    background: '#1a1a2e',
    color: '#e0e0e0',
    padding: '12px 14px',
    overflowY: 'auto',
    borderRight: '1px solid #333355',
    fontSize: '12px',
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '14px',
    fontWeight: 700,
    color: '#ffffff',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
    gap: 8,
  },
  label: {
    color: '#8888aa',
    fontWeight: 600,
    flexShrink: 0,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    padding: '3px 0',
  },
  exportBtn: {
    marginTop: 12,
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a4a6e',
    color: '#e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const measureBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: '11px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const mrMsBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid #3c78ff',
  background: 'rgba(60, 120, 255, 0.9)',
  color: '#fff',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
  lineHeight: '16px',
};

const resetBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid #444466',
  background: 'rgba(26, 26, 46, 0.85)',
  color: '#e0e0e0',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  zIndex: 10,
};
