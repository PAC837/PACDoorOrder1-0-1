import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { DoorData, UnitSystem, HoleData, HandleConfig, RenderMode } from '../types.js';
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
  compact?: boolean;
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

export function ElevationViewer({
  door, units, panelTree, handleConfig, renderMode, onRenderModeChange,
  selectedSplitPath, onSplitSelect, onSplitDragEnd, compact,
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

  const [hoveredSplit, setHoveredSplit] = useState<{ path: number[]; type: 'hsplit' | 'vsplit' } | null>(null);
  const [draggingSplit, setDraggingSplit] = useState<DragState | null>(null);

  const holes: HoleData[] = door.RoutedLockedShape?.Operations?.OperationHole ?? [];

  const doorW = door.DefaultW;
  const doorH = door.DefaultH;
  const leftStileW = door.LeftRightStileW;
  const rightStileW = door.LeftRightStileW;
  const topRailW = door.TopRailW;
  const bottomRailW = door.BottomRailW;

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

  // Reset zoom/pan when door changes
  useEffect(() => {
    setZoom(1); setPanX(0); setPanY(0);
  }, [door.Name]);

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

  // Coordinate transforms (extracted so mouse handlers can use them)
  const pad = 80;
  const scaleX = (cw - 2 * pad) / doorW;
  const scaleY = (ch - 2 * pad) / doorH;
  const baseScale = Math.min(scaleX, scaleY);
  const scale = baseScale * zoom;
  const cx = cw / 2;
  const cy = ch / 2;

  const toX = useCallback((x: number) => cx + (x - doorW / 2) * scale + panX, [cx, doorW, scale, panX]);
  const toY = useCallback((y: number) => cy - (y - doorH / 2) * scale + panY, [cy, doorH, scale, panY]);
  // Inverse transforms: screen → model
  const fromX = useCallback((sx: number) => (sx - panX - cx) / scale + doorW / 2, [cx, doorW, scale, panX]);
  const fromY = useCallback((sy: number) => -(sy - panY - cy) / scale + doorH / 2, [cy, doorH, scale, panY]);
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

  // Cursor
  const cursor = useMemo(() => {
    if (measure.measureMode) return measure.draggingIdx !== null ? 'grabbing' : 'crosshair';
    if (draggingSplit) {
      return draggingSplit.type === 'hsplit' ? 'ns-resize' : 'ew-resize';
    }
    if (hoveredSplit) {
      return hoveredSplit.type === 'hsplit' ? 'ns-resize' : 'ew-resize';
    }
    if (isPanning) return 'grabbing';
    return 'grab';
  }, [measure.measureMode, measure.draggingIdx, draggingSplit, hoveredSplit, isPanning]);

  // Wheel zoom (center-anchored)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.1, Math.min(20, z * factor)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse handlers — measure mode > split hit-testing > pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Measure mode has highest priority
    if (measure.measureMode) {
      if (measure.handleDimMouseDown(sx, sy)) return;
      measure.handleMouseDown(sx, sy);
      return;
    }

    // Hit-test dividers first (only when interactive)
    if (onSplitSelect) {
      const hit = hitTestSplits(sx, sy, splitsWithBounds, toX, toY);
      if (hit) {
        e.preventDefault();
        onSplitSelect(hit.path);
        const range = getDragRange(hit);
        setDraggingSplit({
          path: hit.path,
          type: hit.type,
          currentPos: hit.pos,
          range,
        });
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }
    }

    // Otherwise start canvas pan
    setIsPanning(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [measure.measureMode, measure.handleDimMouseDown, measure.handleMouseDown, splitsWithBounds, toX, toY, onSplitSelect]);

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

    if (draggingSplit) {
      // Compute new position from mouse
      let newPos: number;
      if (draggingSplit.type === 'hsplit') {
        newPos = fromY(sy); // hsplit moves along height (model Y)
      } else {
        newPos = fromX(sx); // vsplit moves along width (model X)
      }
      newPos = Math.max(draggingSplit.range.min, Math.min(draggingSplit.range.max, newPos));
      setDraggingSplit(prev => prev ? { ...prev, currentPos: newPos } : null);
      return;
    }

    if (isPanning) {
      setPanX((p) => p + e.clientX - lastMouse.current.x);
      setPanY((p) => p + e.clientY - lastMouse.current.y);
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Hover detection for cursor
    if (onSplitSelect) {
      const hit = hitTestSplits(sx, sy, splitsWithBounds, toX, toY);
      if (hit) {
        if (!hoveredSplit || !pathsEqual(hoveredSplit.path, hit.path)) {
          setHoveredSplit({ path: hit.path, type: hit.type });
        }
      } else if (hoveredSplit) {
        setHoveredSplit(null);
      }
    }
  }, [measure.measureMode, measure.phase, measure.handleMouseMove, measure.draggingIdx, measure.handleDimMouseMove, draggingSplit, isPanning, splitsWithBounds, toX, toY, fromX, fromY, onSplitSelect, hoveredSplit]);

  const handleMouseUp = useCallback(() => {
    if (measure.draggingIdx !== null) {
      measure.handleDimMouseUp();
    }
    if (draggingSplit) {
      onSplitDragEnd?.(draggingSplit.path, draggingSplit.currentPos);
      setDraggingSplit(null);
    }
    setIsPanning(false);
  }, [measure.draggingIdx, measure.handleDimMouseUp, draggingSplit, onSplitDragEnd]);

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

    // Helper: draw a filled rect in model space
    const drawRect = (x1: number, y1: number, x2: number, y2: number) => {
      const sx1 = toX(x1), sy1 = toY(y2); // toY flips, so y2 (higher) maps to lower screen y
      const sx2 = toX(x2), sy2 = toY(y1);
      ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    };
    const strokeRect = (x1: number, y1: number, x2: number, y2: number) => {
      const sx1 = toX(x1), sy1 = toY(y2);
      const sx2 = toX(x2), sy2 = toY(y1);
      ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    };

    // Hatching helper
    const drawHatch = (x1: number, y1: number, x2: number, y2: number) => {
      if (!showHatching) return;
      const sx1 = toX(x1), sy1 = toY(y2);
      const sx2 = toX(x2), sy2 = toY(y1);
      const w = sx2 - sx1;
      const h = sy2 - sy1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx1, sy1, w, h);
      ctx.clip();
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 0.5;
      const spacing = 6;
      const diag = w + h;
      for (let d = -diag; d < diag; d += spacing) {
        ctx.beginPath();
        ctx.moveTo(sx1 + d, sy1);
        ctx.lineTo(sx1 + d + h, sy1 + h);
        ctx.stroke();
      }
      ctx.restore();
    };

    const leaves = flattenTree(panelTree, rootBounds);

    // Panel areas (light gray fill with hatching)
    if (renderMode !== 'wireframe') {
      if (renderMode === 'ghosted') ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#f0f0f0';
      for (const pb of leaves) {
        drawRect(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
        if (renderMode === 'solid') drawHatch(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
      }

      // Frame members (stile/rail fill)
      ctx.fillStyle = '#e8dcc8';

      // Left stile
      drawRect(0, 0, leftStileW, doorH);
      // Right stile
      drawRect(doorW - rightStileW, 0, doorW, doorH);
      // Bottom rail
      drawRect(leftStileW, 0, doorW - rightStileW, bottomRailW);
      // Top rail
      drawRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

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
      if (renderMode === 'ghosted') ctx.globalAlpha = 1.0;
    }

    // Outlines
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;

    // Door perimeter
    strokeRect(0, 0, doorW, doorH);

    // Frame member outlines
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#555555';
    strokeRect(0, 0, leftStileW, doorH);
    strokeRect(doorW - rightStileW, 0, doorW, doorH);
    strokeRect(leftStileW, 0, doorW - rightStileW, bottomRailW);
    strokeRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

    // Divider bar outlines — recursive
    function strokeDividers(tree: PanelTree, bounds: PanelBounds) {
      if (tree.type === 'leaf') return;
      const half = tree.width / 2;
      if (tree.type === 'hsplit') {
        strokeRect(bounds.yMin, tree.pos - half, bounds.yMax, tree.pos + half);
        strokeDividers(tree.children[0], { ...bounds, xMax: tree.pos - half });
        strokeDividers(tree.children[1], { ...bounds, xMin: tree.pos + half });
      } else {
        strokeRect(tree.pos - half, bounds.xMin, tree.pos + half, bounds.xMax);
        strokeDividers(tree.children[0], { ...bounds, yMax: tree.pos - half });
        strokeDividers(tree.children[1], { ...bounds, yMin: tree.pos + half });
      }
    }
    strokeDividers(panelTree, rootBounds);

    // Panel outlines
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 0.5;
    for (const pb of leaves) {
      strokeRect(pb.yMin, pb.xMin, pb.yMax, pb.xMax);
    }

    // --- Divider highlights (selected + hovered) ---
    // Hovered divider (subtle warm tint, only if not the selected one)
    if (hoveredSplit && (!selectedSplitPath || !pathsEqual(hoveredSplit.path, selectedSplitPath))) {
      const hovered = splitsWithBounds.find(s => pathsEqual(s.path, hoveredSplit.path));
      if (hovered) {
        const b = hovered.bounds;
        ctx.fillStyle = 'rgba(255, 200, 100, 0.2)';
        drawRect(b.yMin, b.xMin, b.yMax, b.xMax);
        ctx.strokeStyle = '#ffaa44';
        ctx.lineWidth = 1.5;
        strokeRect(b.yMin, b.xMin, b.yMax, b.xMax);
      }
    }

    // Selected divider (orange highlight)
    if (selectedSplitPath) {
      const selected = splitsWithBounds.find(s => pathsEqual(s.path, selectedSplitPath));
      if (selected) {
        const b = selected.bounds;
        ctx.fillStyle = 'rgba(255, 165, 0, 0.35)';
        drawRect(b.yMin, b.xMin, b.yMax, b.xMax);
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 2;
        strokeRect(b.yMin, b.xMin, b.yMax, b.xMax);
      }
    }

    // Ghost line during drag
    if (draggingSplit) {
      ctx.save();
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      if (draggingSplit.type === 'hsplit') {
        // Horizontal line at new Y position
        const syLine = toY(draggingSplit.currentPos);
        const sxLeft = toX(leftStileW);
        const sxRight = toX(doorW - rightStileW);
        ctx.beginPath();
        ctx.moveTo(sxLeft, syLine);
        ctx.lineTo(sxRight, syLine);
        ctx.stroke();
      } else {
        // Vertical line at new X position
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

    // Dimensions
    if (showDimensions) {
      // Door width (bottom)
      drawLinearDim(ctx, 0, 0, doorW, 0, fmtDim(doorW), 35, 'below', toX, toY);
      // Door height (right side)
      drawLinearDim(ctx, doorW, 0, doorW, doorH, fmtDim(doorH), 35, 'right', toX, toY);

      // Left stile width (inside, at top)
      drawLinearDim(ctx, 0, doorH, leftStileW, doorH, fmtDim(leftStileW), 15, 'above', toX, toY);
      // Right stile width (inside, at top)
      drawLinearDim(ctx, doorW - rightStileW, doorH, doorW, doorH, fmtDim(rightStileW), 15, 'above', toX, toY);
      // Top rail width (inside, at right)
      drawLinearDim(ctx, 0, doorH - topRailW, 0, doorH, fmtDim(topRailW), 15, 'left', toX, toY);
      // Bottom rail width (inside, at right)
      drawLinearDim(ctx, 0, 0, 0, bottomRailW, fmtDim(bottomRailW), 15, 'left', toX, toY);

      // Split dims — position from origin and width for each split
      const splits = enumerateSplits(panelTree);
      for (const split of splits) {
        if (split.type === 'hsplit') {
          // Rail position from bottom (left side)
          drawLinearDim(ctx, 0, 0, 0, split.pos, fmtDim(split.pos), 55 + split.depth * 20, 'left', toX, toY);
          // Rail width (right side)
          drawLinearDim(ctx, doorW, split.pos - split.width / 2, doorW, split.pos + split.width / 2,
            fmtDim(split.width), 15 + split.depth * 20, 'right', toX, toY);
        } else {
          // Stile position from left (bottom)
          drawLinearDim(ctx, 0, 0, split.pos, 0, fmtDim(split.pos), 55 + split.depth * 20, 'below', toX, toY);
          // Stile width (top)
          drawLinearDim(ctx, split.pos - split.width / 2, doorH, split.pos + split.width / 2, doorH,
            fmtDim(split.width), 15 + split.depth * 20, 'above', toX, toY);
        }
      }

      // Sub-panel dimensions (drawn inside each panel)
      for (const pb of leaves) {
        const panelH = pb.xMax - pb.xMin;
        const panelW = pb.yMax - pb.yMin;
        const pcx = (pb.yMin + pb.yMax) / 2;
        const pcy = (pb.xMin + pb.xMax) / 2;
        drawLinearDim(ctx, pcx, pb.xMin, pcx, pb.xMax,
          fmtDim(panelH), 0, 'right', toX, toY);
        drawLinearDim(ctx, pb.yMin, pcy, pb.yMax, pcy,
          fmtDim(panelW), 0, 'above', toX, toY);
      }
    }

    // Hardware holes
    if (showHardware && holes.length > 0) {
      for (const hole of holes) {
        // Hole position in model coords: X=height(y-axis), Y=width(x-axis)
        const sx = toX(hole.Y);
        const sy = toY(hole.X);
        const sr = (hole.Diameter / 2) * scale;

        // Color by type
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

        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Cross-hair for center
        ctx.strokeStyle = hole.holeType === 'handle' ? '#2255aa' : '#666666';
        ctx.lineWidth = 0.5;
        const ch2 = Math.max(sr * 0.3, 2);
        ctx.beginPath();
        ctx.moveTo(sx - ch2, sy); ctx.lineTo(sx + ch2, sy);
        ctx.moveTo(sx, sy - ch2); ctx.lineTo(sx, sy + ch2);
        ctx.stroke();
      }

      // Handle dimension annotations
      if (handleConfig) {
        const handleHoles = holes.filter(h => h.holeType === 'handle');
        const dimColor = '#2255aa';

        // Separation dimension between handle hole pair
        if (handleHoles.length === 2) {
          const h0 = handleHoles[0], h1 = handleHoles[1];
          // Model coords: mx = Mozaik Y (width), my = Mozaik X (height)
          drawLinearDim(ctx, h0.Y, h0.X, h1.Y, h1.X,
            fmtDim(Math.hypot(h1.X - h0.X, h1.Y - h0.Y)),
            20, 'left', toX, toY, dimColor);
        }

        // Elevation dimension — pick first handle hole as reference
        if (handleHoles.length > 0) {
          const h = handleHoles[0];
          const handleMidX = handleHoles.length === 2
            ? (handleHoles[0].X + handleHoles[1].X) / 2
            : h.X;
          const dp = handleConfig.doorPlacement;
          if (dp === 'top' || dp === 'center-top') {
            // Elevation from top of door
            drawLinearDim(ctx, h.Y, handleMidX, h.Y, doorH,
              fmtDim(doorH - handleMidX), 40, 'left', toX, toY, dimColor);
          } else if (dp === 'bottom' || dp === 'custom') {
            // Elevation from bottom of door
            drawLinearDim(ctx, h.Y, 0, h.Y, handleMidX,
              fmtDim(handleMidX), 40, 'left', toX, toY, dimColor);
          }
        }
      }
    }

    // --- Measure tool overlays ---
    // Completed measurements
    if (showUserDimensions) {
      for (const m of measure.measurements) {
        drawGeneralDim(ctx, toX(m.ax), toY(m.ay), toX(m.bx), toY(m.by), m.label, m.perpOffset, '#0088cc');
      }
    }

    // Dimension preview during placing-dim drag
    if (measure.measureMode && measure.dimPreview) {
      const dp = measure.dimPreview;
      drawGeneralDim(ctx, toX(dp.ax), toY(dp.ay), toX(dp.bx), toY(dp.by), dp.label, dp.perpOffset, 'rgba(0, 136, 204, 0.6)');
    }

    // Snap indicator
    if (measure.measureMode && measure.snap && measure.phase !== 'placing-dim') {
      drawSnapIndicator(ctx, toX(measure.snap.x), toY(measure.snap.y), measure.snap.label);
    }
    // Preview line from point A to cursor (during placing-b)
    if (measure.measureMode && measure.phase === 'placing-b' && measure.pointA && measure.snap) {
      const sax = toX(measure.pointA.x), say = toY(measure.pointA.y);
      const sbx = toX(measure.snap.x), sby = toY(measure.snap.y);
      drawMeasurePreview(ctx, sax, say, sbx, sby, sbx, sby);
    }
    // Point A marker
    if (measure.measureMode && measure.pointA) {
      ctx.save();
      ctx.fillStyle = '#00aaff';
      ctx.beginPath();
      ctx.arc(toX(measure.pointA.x), toY(measure.pointA.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

  }, [cw, ch, toX, toY, scale, doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW,
      panelTree, rootBounds, showDimensions, showHatching, showHardware, showUserDimensions, holes, handleConfig, renderMode, fmtDim,
      selectedSplitPath, hoveredSplit, draggingSplit, splitsWithBounds,
      measure.measurements, measure.measureMode, measure.snap, measure.pointA, measure.dimPreview, measure.phase]);

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
