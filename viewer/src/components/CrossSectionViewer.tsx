import { useState, useCallback, useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import { buildCrossSectionPoints, buildUnclippedCrossSectionPoints, getBackRabbetDepth } from '../utils/cuttingBodies.js';
import { drawArrowHead, drawLinearDim, drawAngleDim, drawRadiusDim, drawDiagonalHatch, drawSnapIndicator, drawMeasurePreview, drawGeneralDim } from '../utils/canvasDrawing.js';
import { useMeasureTool } from '../hooks/useMeasureTool.js';
import type { SnapTarget, SnapLine } from '../hooks/useMeasureTool.js';
import type { DoorData, DoorGraphData, ToolProfileData, PanelType, UnitSystem } from '../types.js';
import { MATERIAL_THICKNESS, GLASS_THICKNESS, formatUnit } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossSectionViewerHandle {
  captureSnapshot: () => string | null;
}

interface CrossSectionViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
  units: UnitSystem;
  edgeGroupId?: number | null;
  thickness?: number;
  toolOverlayList?: ToolOverlayInfo[];
  toolOverlayVisibility?: Record<string, boolean>;
  compact?: boolean;
}

type ToolEntry = DoorGraphData['operations'][0]['tools'][0];

// ---------------------------------------------------------------------------
// Per-tool color overlay types
// ---------------------------------------------------------------------------

const TOOL_COLORS = [
  '#2196F3', '#4CAF50', '#FF9800', '#9C27B0',
  '#F44336', '#00BCD4', '#795548', '#E91E63',
  '#607D8B', '#CDDC39',
];

export interface ToolOverlayInfo {
  key: string;
  toolId: number;
  toolName: string;
  color: string;
  face: 'front' | 'back';
  isEdge: boolean;
  alignment: number;
  entryOffset: number;
  entryDepth: number;
  toolDiameter: number;
  isCNCDoor: boolean;
  sharpCornerAngle: number;
}

/**
 * Adjust cross-section points for edge-aligned tool groups (Alignment=0).
 * When alignment=0, the Offset measures to the tool's deepest-cutting edge
 * (farthest from the toolpath). The center is CLOSER to the toolpath by
 * one radius — so we shift in the opposite direction of the offset.
 */
function adjustForAlignment(
  pts: { x: number; y: number }[],
  alignment: number,
  offset: number,
  toolDiameter: number,
): void {
  if (alignment !== 0 || offset === 0) return;
  const adj = -Math.sign(offset) * (toolDiameter / 2);
  for (const p of pts) p.x += adj;
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEW_WIDTH = 152.4; // 6 inches in mm
const VIEW_HALF = VIEW_WIDTH / 2;
const EXTEND_ABOVE = 38.1; // 1.5 inches above surface for tool shape display

// ---------------------------------------------------------------------------
// Composite depth profile — sample the deepest cut at each X position
// using the same 2D cross-section shapes as the 3D viewer (cuttingBodies.ts).
// ---------------------------------------------------------------------------

interface ShapeEdge {
  x1: number; y1: number;
  x2: number; y2: number;
  xMin: number; xMax: number;
}

function buildEdgesFromPoints(pts: { x: number; y: number }[]): ShapeEdge[] {
  const edges: ShapeEdge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    edges.push({
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      xMin: Math.min(a.x, b.x), xMax: Math.max(a.x, b.x),
    });
  }
  return edges;
}

/** Find the minimum Y (deepest cut point) at a given X across all edges of a shape polygon. */
function getMinYAtX(edges: ShapeEdge[], x: number): number | null {
  let minY = Infinity;
  let found = false;
  for (const e of edges) {
    if (x < e.xMin - 0.001 || x > e.xMax + 0.001) continue;
    const dx = e.x2 - e.x1;
    let y: number;
    if (Math.abs(dx) < 0.0001) {
      y = Math.min(e.y1, e.y2);
    } else {
      const t = (x - e.x1) / dx;
      if (t < -0.001 || t > 1.001) continue;
      y = e.y1 + t * (e.y2 - e.y1);
    }
    if (y < minY) { minY = y; found = true; }
  }
  return found ? minY : null;
}

interface CompositeProfile {
  /** Front face depth profile: array of {x, y} from right to left */
  frontProfile: { x: number; y: number }[];
  /** Front profile used for outline rendering (same as frontProfile) */
  frontOutline: { x: number; y: number }[];
  /** Back face depth profile: array of {x, y=depthFromBackFace} from right to left */
  backProfile: { x: number; y: number }[];
}

function computeCompositeProfile(
  tools: ToolEntry[],
  backTools: ToolEntry[],
  profiles: ToolProfileData[],
  frontPocketDepth: number,
  backPocketDepth: number,
  thickness: number,
  stileW: number,
  toolAlignments: number[] = [],
  backToolAlignments: number[] = [],
): CompositeProfile {
  const halfThickness = thickness / 2;

  // Build shape edges for each front tool using the same geometry as the 3D viewer.
  const toolEdges: ShapeEdge[][] = [];
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const pts = buildCrossSectionPoints(tool, profiles, thickness);
    if (pts) {
      adjustForAlignment(pts, toolAlignments[i] ?? 1, -tool.entryOffset, tool.toolDiameter);
      toolEdges.push(buildEdgesFromPoints(pts));
    } else {
      toolEdges.push([]);
    }
  }

  // Build shape edges for each back tool.
  // No Y-mirroring needed: the depth formula (halfThickness - minY) gives
  // the tool's cutting depth regardless of front/back. The difference is
  // only in rendering (front depth from top, back depth from bottom).
  const backToolEdges: ShapeEdge[][] = [];
  for (let i = 0; i < backTools.length; i++) {
    const tool = backTools[i];
    const pts = buildCrossSectionPoints(tool, profiles, thickness);
    if (pts) {
      adjustForAlignment(pts, backToolAlignments[i] ?? 1, -tool.entryOffset, tool.toolDiameter);
      backToolEdges.push(buildEdgesFromPoints(pts));
    } else {
      backToolEdges.push([]);
    }
  }

  const step = 0.05; // 0.05mm resolution
  const rawProfile: { x: number; y: number }[] = [];

  for (let x = stileW; x >= -VIEW_HALF; x -= step) {
    let depth = 0;
    if (x < 0 && frontPocketDepth > 0) {
      depth = frontPocketDepth;
    }
    for (const edges of toolEdges) {
      if (edges.length === 0) continue;
      const minY = getMinYAtX(edges, x);
      if (minY !== null) {
        // Convert from shape world-Z to depth-from-front-face
        const d = halfThickness - minY;
        if (d > depth) depth = d;
      }
    }
    rawProfile.push({ x, y: depth });
  }

  // Back profile: same approach with mirrored edges
  const rawBackProfile: { x: number; y: number }[] = [];
  for (let x = stileW; x >= -VIEW_HALF; x -= step) {
    let depth = 0;
    if (x < 0 && backPocketDepth > 0) {
      depth = backPocketDepth;
    }
    for (const edges of backToolEdges) {
      if (edges.length === 0) continue;
      const minY = getMinYAtX(edges, x);
      if (minY !== null) {
        const d = halfThickness - minY;
        if (d > depth) depth = d;
      }
    }
    rawBackProfile.push({ x, y: depth });
  }

  // Cap so front + back depth never exceeds thickness.
  // Prevents the clip path from self-intersecting where cuts overlap.
  const capLen = Math.min(rawProfile.length, rawBackProfile.length);
  for (let i = 0; i < capLen; i++) {
    const total = rawProfile[i].y + rawBackProfile[i].y;
    if (total > thickness) {
      rawBackProfile[i].y = Math.max(0, thickness - rawProfile[i].y);
    }
  }

  return { frontProfile: rawProfile, frontOutline: rawProfile, backProfile: rawBackProfile };
}

// ---------------------------------------------------------------------------
// DXF export
// ---------------------------------------------------------------------------

function generateDxf(
  composite: CompositeProfile,
  thickness: number,
  frontPocketDepth: number,
  backPocketDepth: number,
  doorName: string,
  stileW: number,
  showGlass = false,
  rabbetDepth = 0,
): string {
  let dxf = '';
  const w = (s: string) => { dxf += s + '\n'; };

  // HEADER — R12 format for maximum CAD software compatibility (Vectric, AutoCAD, etc.)
  w('0'); w('SECTION');
  w('2'); w('HEADER');
  w('9'); w('$ACADVER'); w('1'); w('AC1009');  // R12 — no handles/subclass markers needed
  w('9'); w('$INSUNITS'); w('70'); w('4');     // mm
  w('9'); w('$MEASUREMENT'); w('70'); w('1');  // metric
  w('0'); w('ENDSEC');

  // TABLES — layers
  w('0'); w('SECTION');
  w('2'); w('TABLES');

  w('0'); w('TABLE');
  w('2'); w('LAYER');
  w('70'); w(showGlass ? '4' : '3');

  // OUTLINE layer (black)
  w('0'); w('LAYER');
  w('2'); w('OUTLINE');
  w('70'); w('0');
  w('62'); w('7');  // white/black
  w('6'); w('CONTINUOUS');

  // HATCHING layer (gray)
  w('0'); w('LAYER');
  w('2'); w('HATCHING');
  w('70'); w('0');
  w('62'); w('8');  // gray
  w('6'); w('CONTINUOUS');

  // DIMENSIONS layer (red)
  w('0'); w('LAYER');
  w('2'); w('DIMENSIONS');
  w('70'); w('0');
  w('62'); w('1');  // red
  w('6'); w('CONTINUOUS');

  if (showGlass) {
    // GLASS layer (cyan)
    w('0'); w('LAYER');
    w('2'); w('GLASS');
    w('70'); w('0');
    w('62'); w('4');  // cyan
    w('6'); w('CONTINUOUS');
  }

  w('0'); w('ENDTAB');
  w('0'); w('ENDSEC');

  // ENTITIES
  w('0'); w('SECTION');
  w('2'); w('ENTITIES');

  // --- Outline: composite front profile as R12 POLYLINE ---
  const outline = composite.frontOutline;
  if (outline.length > 1) {
    w('0'); w('POLYLINE');
    w('8'); w('OUTLINE');
    w('66'); w('1');  // vertices follow
    w('70'); w('1');  // closed polyline (auto-closes to first vertex)

    // Front profile vertices from right to left (y values are depth; DXF: negate for Y-up)
    for (const p of outline) {
      w('0'); w('VERTEX');
      w('8'); w('OUTLINE');
      w('10'); w(p.x.toFixed(4));
      w('20'); w((-p.y).toFixed(4));
    }

    // Back profile from left to right (reverse order)
    // backProfile[i].y = depth-from-back-face; DXF Y = -(thickness - depth)
    const bp = composite.backProfile;
    const hasBackCut = bp.length > 1 && bp.some(p => p.y > 0);
    if (hasBackCut) {
      for (let i = bp.length - 1; i >= 0; i--) {
        w('0'); w('VERTEX');
        w('8'); w('OUTLINE');
        w('10'); w(bp[i].x.toFixed(4));
        w('20'); w((-(thickness - bp[i].y)).toFixed(4));
      }
    } else {
      // Flat bottom edge (no back cuts)
      w('0'); w('VERTEX');
      w('8'); w('OUTLINE');
      w('10'); w((-VIEW_HALF).toFixed(4));
      w('20'); w((-thickness).toFixed(4));

      w('0'); w('VERTEX');
      w('8'); w('OUTLINE');
      w('10'); w(stileW.toFixed(4));
      w('20'); w((-thickness).toFixed(4));
    }

    // Top-right corner (auto-closes back to first vertex)
    w('0'); w('VERTEX');
    w('8'); w('OUTLINE');
    w('10'); w(stileW.toFixed(4));
    w('20'); w('0.0000');

    w('0'); w('SEQEND');
    w('8'); w('OUTLINE');
  }

  // --- Glass pane ---
  if (showGlass) {
    const glassLip = 9.525; // 3/8" overlap into stile/rail
    const glassTopY = rabbetDepth > 0
      ? thickness - rabbetDepth  // glass front face at back rabbet floor
      : thickness / 2 - GLASS_THICKNESS / 2;
    const glassBotY = glassTopY + GLASS_THICKNESS;
    w('0'); w('POLYLINE');
    w('8'); w('GLASS');
    w('66'); w('1');
    w('70'); w('1'); // closed
    for (const [px, py] of [
      [-VIEW_HALF, -glassTopY], [glassLip, -glassTopY],
      [glassLip, -glassBotY], [-VIEW_HALF, -glassBotY],
    ]) {
      w('0'); w('VERTEX');
      w('8'); w('GLASS');
      w('10'); w(px.toFixed(4));
      w('20'); w(py.toFixed(4));
    }
    w('0'); w('SEQEND');
    w('8'); w('GLASS');
  }

  // --- Title text ---
  w('0'); w('TEXT');
  w('8'); w('DIMENSIONS');
  w('10'); w('0');
  w('20'); w('5');
  w('40'); w('3'); // text height
  w('1'); w(`${doorName} - Cross Section`);
  w('72'); w('1'); // center aligned
  w('11'); w('0');
  w('21'); w('5');

  w('0'); w('ENDSEC');
  w('0'); w('EOF');

  return dxf;
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function CrossSectionCanvas({
  door,
  graph,
  profiles,
  frontPanelType,
  backPanelType,
  hasBackRabbit,
  showHatching,
  showDimensions,
  showUserDimensions,
  units,
  showGlass,
  toolOverlayMode,
  edgeGroupId: edgeGroupIdProp,
  thickness: thicknessCanvasProp,
  toolOverlayList,
  toolOverlayVisibility,
  onToggleHatching,
  onToggleDimensions,
  onToggleUserDimensions,
  onCycleToolOverlay,
  onExportDxf,
  canvasRefOut,
}: CrossSectionViewerProps & {
  showHatching: boolean; showDimensions: boolean; showUserDimensions: boolean; showGlass: boolean;
  toolOverlayMode: 'off' | 'full' | 'outline';
  edgeGroupId?: number | null;
  onToggleHatching: () => void;
  onToggleDimensions: () => void;
  onToggleUserDimensions: () => void;
  onCycleToolOverlay: () => void;
  onExportDxf: () => void;
  canvasRefOut?: React.MutableRefObject<HTMLCanvasElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Expose canvas ref to parent for snapshot capture
  const canvasCallbackRef = useCallback((el: HTMLCanvasElement | null) => {
    (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
    if (canvasRefOut) canvasRefOut.current = el;
  }, [canvasRefOut]);

  const onPrint = useCallback(() => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<img src="${dataUrl}" style="max-width:100%" />`);
    win.document.close();
    win.focus();
    win.print();
  }, []);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);
  const [cw, setCw] = useState(800);
  const [ch, setCh] = useState(600);

  // Reset zoom when door changes
  useEffect(() => { setZoom(1); setPanX(0); setPanY(0); }, [door.Name]);

  // Track canvas container size
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

  // Component-level coordinate transforms (for measure tool + mouse handlers)
  const thickness = thicknessCanvasProp ?? MATERIAL_THICKNESS;
  const stileW = door.LeftRightStileW;
  const dimSpace = showDimensions ? 50 : 0;
  const padVal = Math.min(60 + dimSpace, Math.max(20, Math.min(cw, ch) * 0.12));
  const scaleVal = Math.min((cw - 2 * padVal) / VIEW_WIDTH, (cw > 0 && ch > 0 ? (ch - 2 * padVal) / thickness : 1)) * zoom;
  const cxVal = cw / 2;
  const cyVal = ch / 2;
  const viewCY = thickness / 2;

  const toX = useCallback((x: number) => cxVal + x * scaleVal + panX, [cxVal, scaleVal, panX]);
  const toY = useCallback((y: number) => cyVal + (y - viewCY) * scaleVal + panY, [cyVal, viewCY, scaleVal, panY]);
  const fromX = useCallback((sx: number) => (sx - panX - cxVal) / scaleVal, [cxVal, scaleVal, panX]);
  const fromY = useCallback((sy: number) => (sy - panY - cyVal) / scaleVal + viewCY, [cyVal, viewCY, scaleVal, panY]);
  const fmtDim = useCallback((mm: number) => formatUnit(mm, units), [units]);

  // --- Build snap targets for measure tool ---
  const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const frontOp = operations.find((op) => !op.FlipSideOp);
  const backOp = operations.find((op) => op.FlipSideOp);
  const frontPocketDepth = frontPanelType === 'glass' ? thickness : (frontOp?.Depth ?? 0);
  const backPocketDepth = backPanelType === 'glass' ? thickness : (backOp?.Depth ?? 0);

  const snapTargets = useMemo((): SnapTarget[] => {
    const targets: SnapTarget[] = [];
    // Slab corners
    targets.push({ x: -VIEW_HALF, y: 0, label: 'front face' });
    targets.push({ x: -VIEW_HALF, y: thickness, label: 'back face' });
    targets.push({ x: stileW, y: 0, label: 'stile edge' });
    targets.push({ x: stileW, y: thickness, label: 'stile edge' });
    // Toolpath boundary
    targets.push({ x: 0, y: 0, label: 'toolpath' });
    targets.push({ x: 0, y: thickness, label: 'toolpath' });
    // Pocket depth boundaries
    if (frontPocketDepth > 0.01 && frontPanelType !== 'glass') {
      targets.push({ x: -VIEW_HALF, y: frontPocketDepth, label: 'front pocket' });
      targets.push({ x: 0, y: frontPocketDepth, label: 'front pocket' });
    }
    if (backPocketDepth > 0.01 && backPanelType !== 'glass') {
      targets.push({ x: -VIEW_HALF, y: thickness - backPocketDepth, label: 'back pocket' });
      targets.push({ x: 0, y: thickness - backPocketDepth, label: 'back pocket' });
    }
    // Tool overlay polygon vertices
    if (toolOverlayMode !== 'off') {
      const overlayList = toolOverlayList ?? [];
      for (const info of overlayList) {
        const toolEntry = { ...info, flipSide: false };
        let pts: { x: number; y: number }[] | null;
        if (toolOverlayMode === 'full') {
          pts = buildUnclippedCrossSectionPoints(toolEntry, profiles, thickness, EXTEND_ABOVE, info.alignment);
        } else {
          pts = buildCrossSectionPoints(toolEntry, profiles, thickness);
          if (pts) adjustForAlignment(pts, info.alignment, -info.entryOffset, info.toolDiameter);
        }
        if (!pts) continue;
        const halfTh = thickness / 2;
        for (const pt of pts) {
          const depth = halfTh - pt.y;
          const x = info.isEdge ? pt.x + stileW : pt.x;
          const y = info.face === 'front' ? depth : thickness - depth;
          if (y >= -1 && y <= thickness + 1) {
            targets.push({ x, y });
          }
        }
      }
    }
    return targets;
  }, [thickness, stileW, frontPocketDepth, backPocketDepth, frontPanelType, backPanelType, toolOverlayList, profiles, toolOverlayMode]);

  const snapLines = useMemo((): SnapLine[] => [
    { x1: -VIEW_HALF, y1: 0, x2: stileW, y2: 0, label: 'front face' },
    { x1: -VIEW_HALF, y1: thickness, x2: stileW, y2: thickness, label: 'back face' },
    { x1: -VIEW_HALF, y1: 0, x2: -VIEW_HALF, y2: thickness, label: 'left edge' },
    { x1: stileW, y1: 0, x2: stileW, y2: thickness, label: 'stile edge' },
    { x1: 0, y1: 0, x2: 0, y2: thickness, label: 'toolpath' },
  ], [thickness, stileW]);

  // --- Measure tool hook ---
  const measure = useMeasureTool({
    fromX, fromY, toX, toY,
    scale: scaleVal,
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    const thickness = thicknessCanvasProp ?? MATERIAL_THICKNESS;
    const fmtDim = (mm: number) => formatUnit(mm, units);

    // --- Gather data ---
    const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
    const frontOp = operations.find((op) => !op.FlipSideOp);
    const backOp = operations.find((op) => op.FlipSideOp);
    // Glass = full through-cut (removes all panel material, fixes remnant island)
    const frontPocketDepth = frontPanelType === 'glass' ? thickness : (frontOp?.Depth ?? 0);
    const backPocketDepth = backPanelType === 'glass' ? thickness : (backOp?.Depth ?? 0);

    // Partition tools by effective face (operation.flipSideOp XOR tool.flipSide)
    // Edge tools are separated into their own arrays
    const tools: NonNullable<typeof graph>['operations'][0]['tools'] = [];
    const backTools: typeof tools = [];
    const edgeFrontTools: typeof tools = [];
    const edgeBackTools: typeof tools = [];
    const toolAlignments: number[] = [];
    const backToolAlignments: number[] = [];
    const edgeFrontAlignments: number[] = [];
    const edgeBackAlignments: number[] = [];
    for (const graphOp of (graph?.operations ?? [])) {
      if (edgeGroupIdProp && graphOp.toolGroupId === edgeGroupIdProp) {
        for (const tool of graphOp.tools) {
          const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
          if (effectiveFlip) {
            edgeBackTools.push(tool);
            edgeBackAlignments.push(graphOp.alignment);
          } else {
            edgeFrontTools.push(tool);
            edgeFrontAlignments.push(graphOp.alignment);
          }
        }
        continue;
      }
      for (const tool of graphOp.tools) {
        const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
        if (effectiveFlip) {
          backTools.push(tool);
          backToolAlignments.push(graphOp.alignment);
        } else {
          tools.push(tool);
          toolAlignments.push(graphOp.alignment);
        }
      }
    }
    const stileW = door.LeftRightStileW;

    // Compute composite depth profile (front + back)
    const composite = computeCompositeProfile(
      tools, backTools, profiles, frontPocketDepth, backPocketDepth, thickness, stileW,
      toolAlignments, backToolAlignments,
    );
    const outline = composite.frontOutline;
    const backProfile = composite.backProfile;

    // Edge tools carve the outer stile edge. Their cross-sections are relative to
    // the door perimeter (x=0 at perimeter). In cross-section view, the perimeter
    // is at x=stileW. Shift edge tool points by stileW and merge into the composite
    // by overriding the profile at x >= 0 (stile area) where edge tools cut deeper.
    if (edgeFrontTools.length > 0 || edgeBackTools.length > 0) {
      const halfThickness = thickness / 2;

      // Build shifted edge cross-section edges (shift x by stileW)
      const edgeFrontEdges: ShapeEdge[][] = [];
      for (let i = 0; i < edgeFrontTools.length; i++) {
        const tool = edgeFrontTools[i];
        const pts = buildCrossSectionPoints(tool, profiles, thickness);
        if (pts) {
          adjustForAlignment(pts, edgeFrontAlignments[i] ?? 1, -tool.entryOffset, tool.toolDiameter);
          const shifted = pts.map(p => ({ x: p.x + stileW, y: p.y }));
          edgeFrontEdges.push(buildEdgesFromPoints(shifted));
        }
      }
      const edgeBackEdges: ShapeEdge[][] = [];
      for (let i = 0; i < edgeBackTools.length; i++) {
        const tool = edgeBackTools[i];
        const pts = buildCrossSectionPoints(tool, profiles, thickness);
        if (pts) {
          adjustForAlignment(pts, edgeBackAlignments[i] ?? 1, -tool.entryOffset, tool.toolDiameter);
          const shifted = pts.map(p => ({ x: p.x + stileW, y: p.y }));
          edgeBackEdges.push(buildEdgesFromPoints(shifted));
        }
      }

      // Merge edge depths into front profile (override where edge cuts deeper)
      for (const pt of outline) {
        if (pt.x < 0) continue; // Only merge edge depth in stile area
        for (const edges of edgeFrontEdges) {
          const minY = getMinYAtX(edges, pt.x);
          if (minY !== null) {
            const d = halfThickness - minY;
            if (d > pt.y) pt.y = d;
          }
        }
      }
      // Merge edge depths into back profile
      for (const pt of backProfile) {
        if (pt.x < 0) continue; // Only merge edge depth in stile area
        for (const edges of edgeBackEdges) {
          const minY = getMinYAtX(edges, pt.x);
          if (minY !== null) {
            const d = halfThickness - minY;
            if (d > pt.y) pt.y = d;
          }
        }
      }
    }

    // --- Per-tool cross-section outlines (for colored overlays) ---
    const perToolShapes: { key: string; color: string; isFront: boolean; open: boolean; path: { x: number; y: number }[] }[] = [];
    const overlayList = toolOverlayList ?? [];
    const overlayVis = toolOverlayVisibility ?? {};
    if (toolOverlayMode !== 'off' && overlayList.length > 0) {
      const halfTh = thickness / 2;
      for (const info of overlayList) {
        if (overlayVis[info.key] === false) continue;
        const toolEntry = { ...info, flipSide: false };

        if (toolOverlayMode === 'full') {
          // Full tool shape — closed polygon with fill extending above surface
          const pts = buildUnclippedCrossSectionPoints(toolEntry, profiles, thickness, EXTEND_ABOVE, info.alignment);
          if (!pts || pts.length < 3) continue;
          const path: { x: number; y: number }[] = [];
          for (const pt of pts) {
            const depth = halfTh - pt.y;
            let x = pt.x;
            if (info.isEdge) x += stileW;
            path.push({ x, y: depth });
          }
          if (path.length >= 3) {
            perToolShapes.push({ key: info.key, color: info.color, isFront: info.face === 'front', open: false, path });
          }
        } else {
          // Outline — show where this tool sits on the composite profile
          const csPoints = buildCrossSectionPoints(toolEntry, profiles, thickness);
          if (!csPoints || csPoints.length < 3) continue;
          adjustForAlignment(csPoints, info.alignment, -info.entryOffset, info.toolDiameter);
          if (info.isEdge) {
            for (const p of csPoints) p.x += stileW;
          }
          const toolEdges = buildEdgesFromPoints(csPoints);

          // Compare tool depth against composite at each sample point
          const profile = info.face === 'front' ? outline : backProfile;
          const contactPath: { x: number; y: number }[] = [];
          const tolerance = 0.15; // mm — accounts for floating-point sampling differences

          for (const sample of profile) {
            const toolMinY = getMinYAtX(toolEdges, sample.x);
            if (toolMinY === null) continue;
            const toolDepth = halfTh - toolMinY;
            if (toolDepth >= sample.y - tolerance) {
              // This tool is the deepest (or tied) at this X — it's on the profile
              contactPath.push({ x: sample.x, y: sample.y });
            }
          }

          if (contactPath.length >= 2) {
            perToolShapes.push({
              key: info.key, color: info.color,
              isFront: info.face === 'front', open: true,
              path: contactPath,
            });
          }
        }
      }
    }

    // --- Coordinate transform (with zoom + pan) ---
    const dimSpace = showDimensions ? 50 : 0;
    const pad = Math.min(60 + dimSpace, Math.max(20, Math.min(cw, ch) * 0.12));
    const scaleX = (cw - 2 * pad) / VIEW_WIDTH;
    const scaleY = (ch - 2 * pad) / thickness;
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * zoom;

    const cx = cw / 2;
    const cy = ch / 2;
    const viewCY = thickness / 2;

    const toX = (x: number) => cx + x * scale + panX;
    const toY = (y: number) => cy + (y - viewCY) * scale + panY;

    const slabLeft = toX(-VIEW_HALF);
    const slabRight = toX(stileW);
    const slabTop = toY(0);
    const slabBot = toY(thickness);

    // --- 1. White background ---
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    // --- 2. Build solid material clip path and draw hatching ---
    // Clip to the actual material outline: front profile (top boundary) →
    // left edge → back profile reversed (bottom boundary) → right edge.
    // Never goes through slabBot explicitly, preventing the back groove
    // from being enclosed as material.
    ctx.save();
    ctx.beginPath();

    if (outline.length > 1 && backProfile.length > 1) {
      // Front profile from right to left (top boundary of material)
      ctx.moveTo(toX(outline[0].x), toY(outline[0].y));
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(toX(outline[i].x), toY(outline[i].y));
      }
      // Left edge: from front profile's leftmost down to back profile's leftmost
      const lastIdx = backProfile.length - 1;
      ctx.lineTo(toX(backProfile[lastIdx].x), toY(thickness - backProfile[lastIdx].y));
      // Back profile from left to right (bottom boundary, reversed order)
      for (let i = lastIdx - 1; i >= 0; i--) {
        ctx.lineTo(toX(backProfile[i].x), toY(thickness - backProfile[i].y));
      }
      // Right edge: closePath connects back to front profile start
      ctx.closePath();
    } else {
      // Fallback: plain slab rectangle
      ctx.moveTo(slabRight, slabTop);
      ctx.lineTo(slabRight, slabBot);
      ctx.lineTo(slabLeft, slabBot);
      ctx.lineTo(slabLeft, slabTop);
      ctx.closePath();
    }

    ctx.clip(); // nonzero (default)

    if (showHatching) {
      const hatchSpacing = Math.max(3, 2 * scale);
      drawDiagonalHatch(ctx, cw, ch, hatchSpacing);
    } else {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.restore();

    // --- 3. Draw outlines ---
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;

    // Same material outline as clip path: front profile → left edge → back profile reversed → right edge
    ctx.beginPath();
    if (outline.length > 1 && backProfile.length > 1) {
      // Front profile from right to left (top boundary)
      ctx.moveTo(toX(outline[0].x), toY(outline[0].y));
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(toX(outline[i].x), toY(outline[i].y));
      }
      // Left edge: front profile last → back profile last
      const lastIdx = backProfile.length - 1;
      ctx.lineTo(toX(backProfile[lastIdx].x), toY(thickness - backProfile[lastIdx].y));
      // Back profile from left to right (bottom boundary, reversed)
      for (let i = lastIdx - 1; i >= 0; i--) {
        ctx.lineTo(toX(backProfile[i].x), toY(thickness - backProfile[i].y));
      }
      ctx.closePath();
    } else {
      // Fallback: plain slab rectangle
      ctx.moveTo(slabRight, slabTop);
      ctx.lineTo(slabRight, slabBot);
      ctx.lineTo(slabLeft, slabBot);
      ctx.lineTo(slabLeft, slabTop);
      ctx.closePath();
    }
    ctx.stroke();

    // For glass through-cut, erase the degenerate panel-area outline where
    // front and back profiles both sit at slabBot (no material = no outline)
    if (frontPanelType === 'glass') {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Find the panel-area boundary (x ≈ 0, where front depth transitions to thickness)
      const panelBoundX = toX(0);
      ctx.moveTo(slabLeft, slabBot);
      ctx.lineTo(panelBoundX, slabBot);
      ctx.stroke();
      ctx.restore();
    }

    // --- 3b. Per-tool cross-section shape overlays ---
    for (const tp of perToolShapes) {
      if (tp.path.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = tp.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const yFn = tp.isFront
        ? (d: number) => toY(d)
        : (d: number) => toY(thickness - d);
      ctx.moveTo(toX(tp.path[0].x), yFn(tp.path[0].y));
      for (let i = 1; i < tp.path.length; i++) {
        if (tp.open) {
          const xGap = Math.abs(tp.path[i].x - tp.path[i - 1].x);
          if (xGap > 0.2) {
            // Gap in the contact region — start a new sub-path
            ctx.moveTo(toX(tp.path[i].x), yFn(tp.path[i].y));
            continue;
          }
        }
        ctx.lineTo(toX(tp.path[i].x), yFn(tp.path[i].y));
      }
      if (!tp.open) {
        ctx.closePath();
      }
      ctx.stroke();
      if (!tp.open) {
        // Light fill for visibility on closed shapes
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = tp.color;
        ctx.fill();
      }
      ctx.restore();
    }

    // --- 4. Dimensions ---
    if (showDimensions) {
      // Material thickness (right side, at door edge)
      drawLinearDim(ctx, stileW, 0, stileW, thickness,
        fmtDim(thickness), 30, 'right', toX, toY);

      // Front pocket depth (left side) — skip for glass (redundant with thickness)
      if (frontPocketDepth > 0 && frontPanelType !== 'glass') {
        drawLinearDim(ctx, -VIEW_HALF, 0, -VIEW_HALF, frontPocketDepth,
          fmtDim(frontPocketDepth), 30, 'left', toX, toY);
      }

      // Back pocket depth (left side, from back face) — skip for glass
      if (backPocketDepth > 0 && backPanelType !== 'glass') {
        drawLinearDim(ctx, -VIEW_HALF, thickness - backPocketDepth, -VIEW_HALF, thickness,
          fmtDim(backPocketDepth), 55, 'left', toX, toY);
      }

      // Stile width (top, from toolpath x=0 to outer edge)
      if (stileW > 0) {
        drawLinearDim(ctx, 0, 0, stileW, 0,
          fmtDim(stileW), 20, 'above', toX, toY);
      }

      // V-bit angle annotation
      for (const tool of tools) {
        if (tool.sharpCornerAngle > 0) {
          const offset = -tool.entryOffset;
          const d = tool.entryDepth;
          const tipSx = toX(offset);
          const tipSy = toY(d);
          drawAngleDim(ctx, tipSx, tipSy, tool.sharpCornerAngle / 2, 25);
        }
      }

      // Roundover radius annotation — outermost CNC door tool only
      const cncTools = tools.filter((t) => t.isCNCDoor);
      if (cncTools.length > 0) {
        const outerTool = cncTools.reduce((a, b) =>
          (-a.entryOffset) > (-b.entryOffset) ? a : b);
        const profile = profiles.find((p) => p.toolId === outerTool.toolId);
        if (profile) {
          const filletPt = profile.points.find((p) => p.ptType !== 0 && Math.abs(p.data) > 0.01);
          if (filletPt) {
            const r = Math.abs(filletPt.data);
            const offset = -outerTool.entryOffset;
            const d = outerTool.entryDepth;
            const toolR = outerTool.toolDiameter / 2;
            // Arc center in drawing coords: LEFT arc of outer roundover (toward bead).
            // The right arc is under the groove floor (flat tool). The visible arc
            // is the left one. In profile space fillet center ≈ (toolR, 0),
            // mirrored to (-toolR, 0), maps to (offset-toolR, d).
            const arcCx = toX(offset - toolR);
            const arcCy = toY(d);
            const rScreen = r * scale;
            // Leader points upper-left (toward panel area, clear of profile)
            drawRadiusDim(ctx, arcCx, arcCy, rScreen,
              -3 * Math.PI / 4,
              `R${fmtDim(r)}`);
          }
        }
      }

      // Profile tool entry depth (at stile edge, outside profile area)
      if (tools.length > 0) {
        // Find the deepest profile/vbit tool
        const profileTools = tools.filter((t) => t.isCNCDoor || t.sharpCornerAngle > 0);
        if (profileTools.length > 0) {
          const deepest = profileTools.reduce((a, b) => a.entryDepth > b.entryDepth ? a : b);
          drawLinearDim(ctx, stileW, 0, stileW, deepest.entryDepth,
            fmtDim(deepest.entryDepth), 55, 'right', toX, toY);
        }
      }

      // Edge tool offset + depth dimensions (colored per tool)
      for (let ti = 0; ti < edgeFrontTools.length; ti++) {
        const tool = edgeFrontTools[ti];
        const offset = -tool.entryOffset;
        // Adjust offset position for edge-aligned groups
        const align = edgeFrontAlignments[ti] ?? 1;
        const adj = (align === 0 && offset !== 0) ? -Math.sign(offset) * (tool.toolDiameter / 2) : 0;
        const adjOffset = offset + adj;
        // Look up per-tool color
        const overlayInfo = overlayList.find(o => o.toolId === tool.toolId && o.isEdge && o.face === 'front');
        const dimColor = overlayInfo?.color ?? '#ff8800';
        if (Math.abs(offset) > 0.01) {
          drawLinearDim(ctx, stileW, 0, stileW + adjOffset, 0,
            fmtDim(Math.abs(offset)), 42 + ti * 22, 'above', toX, toY, dimColor);
        }
        if (tool.entryDepth > 0.01) {
          drawLinearDim(ctx, stileW + adjOffset, 0, stileW + adjOffset, tool.entryDepth,
            fmtDim(tool.entryDepth), 80 + ti * 25, 'right', toX, toY, dimColor);
        }
      }
      for (let ti = 0; ti < edgeBackTools.length; ti++) {
        const tool = edgeBackTools[ti];
        const offset = -tool.entryOffset;
        const align = edgeBackAlignments[ti] ?? 1;
        const adj = (align === 0 && offset !== 0) ? -Math.sign(offset) * (tool.toolDiameter / 2) : 0;
        const adjOffset = offset + adj;
        const overlayInfo = overlayList.find(o => o.toolId === tool.toolId && o.isEdge && o.face === 'back');
        const dimColor = overlayInfo?.color ?? '#ff8800';
        if (Math.abs(offset) > 0.01) {
          drawLinearDim(ctx, stileW, thickness, stileW + adjOffset, thickness,
            fmtDim(Math.abs(offset)), 42 + ti * 22, 'below', toX, toY, dimColor);
        }
        if (tool.entryDepth > 0.01) {
          drawLinearDim(ctx, stileW + adjOffset, thickness - tool.entryDepth, stileW + adjOffset, thickness,
            fmtDim(tool.entryDepth), 80 + ti * 25, 'right', toX, toY, dimColor);
        }
      }
    }

    // --- 4b. Glass pane ---
    const glassVisible = showGlass && (frontPanelType === 'glass' || backPanelType === 'glass');
    if (glassVisible) {
      // Glass sits in the back rabbet groove, extending 3/8" into stile/rail
      const backRabbet = hasBackRabbit !== false ? getBackRabbetDepth(graph, thickness) : 0;
      const glassLip = hasBackRabbit !== false ? 9.525 : 0; // 3/8" lip only with back rabbit
      const glassTopY = backRabbet > 0
        ? thickness - backRabbet  // glass front face at back rabbet floor
        : thickness / 2 - GLASS_THICKNESS / 2;
      const glassBotY = glassTopY + GLASS_THICKNESS;
      const gLeft = slabLeft;
      const gRight = toX(glassLip); // extends into stile
      const gTop = toY(glassTopY);
      const gBot = toY(glassBotY);
      ctx.save();
      ctx.fillStyle = 'rgba(100, 180, 255, 0.35)';
      ctx.fillRect(gLeft, gTop, gRight - gLeft, gBot - gTop);
      ctx.strokeStyle = '#4488cc';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(gLeft, gTop, gRight - gLeft, gBot - gTop);
      ctx.restore();

      if (showDimensions) {
        drawLinearDim(ctx, -VIEW_HALF, glassTopY, -VIEW_HALF, glassBotY,
          fmtDim(GLASS_THICKNESS), 80, 'left', toX, toY);
      }
    }

    // --- 5. Labels ---
    ctx.fillStyle = '#666666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Front Face', cx + panX, slabTop - 8);
    ctx.fillText('Back Face', cx + panX, slabBot + 16);

    ctx.fillStyle = '#888888';
    ctx.font = '10px sans-serif';
    ctx.fillText('Stile / Rail', toX(VIEW_HALF * 0.5), slabBot + 30);
    ctx.fillText('Panel Area', toX(-VIEW_HALF * 0.5), slabBot + 30);

    // --- 6. Measure tool overlays ---
    // Completed measurements (only when user dimensions layer is visible)
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

    // Point A marker (when placed)
    if (measure.measureMode && measure.pointA) {
      ctx.save();
      ctx.fillStyle = '#00aaff';
      ctx.beginPath();
      ctx.arc(toX(measure.pointA.x), toY(measure.pointA.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

  }, [door, graph, profiles, showHatching, showDimensions, showUserDimensions, toolOverlayMode, frontPanelType, backPanelType, hasBackRabbit, units, showGlass, zoom, panX, panY, edgeGroupIdProp, toolOverlayList, toolOverlayVisibility, measure.measurements, measure.measureMode, measure.snap, measure.pointA, measure.dimPreview, measure.phase, cw, ch]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  // Wheel zoom (center-anchored)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.1, Math.min(20, z * factor)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse handlers — measure mode has highest priority, then pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (measure.measureMode) {
      if (measure.handleDimMouseDown(sx, sy)) return;
      measure.handleMouseDown(sx, sy);
      return;
    }

    setIsDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [measure.measureMode, measure.handleDimMouseDown, measure.handleMouseDown]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (measure.measureMode) {
      measure.handleMouseMove(sx, sy);
      if (measure.draggingIdx !== null) {
        measure.handleDimMouseMove(sx, sy);
      }
      return;
    }

    if (!isDragging) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPanX(px => px + dx);
    setPanY(py => py + dy);
  }, [isDragging, measure.measureMode, measure.phase, measure.handleMouseMove, measure.draggingIdx, measure.handleDimMouseMove]);

  const handleMouseUp = useCallback(() => {
    if (measure.draggingIdx !== null) {
      measure.handleDimMouseUp();
    }
    setIsDragging(false);
  }, [measure.draggingIdx, measure.handleDimMouseUp]);

  // Touch pinch zoom + single-finger pan
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / lastPinchDist.current;
      setZoom(z => Math.max(0.1, Math.min(20, z * factor)));
      lastPinchDist.current = dist;
    } else if (e.touches.length === 1 && isDragging) {
      const tdx = e.touches[0].clientX - lastMouse.current.x;
      const tdy = e.touches[0].clientY - lastMouse.current.y;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPanX(px => px + tdx);
      setPanY(py => py + tdy);
    }
  }, [isDragging]);
  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastPinchDist.current = null;
  }, []);

  const handleReset = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  const canvasCursor = measure.measureMode
    ? (measure.draggingIdx !== null ? 'grabbing' : 'crosshair')
    : (isDragging ? 'grabbing' : 'grab');

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasCallbackRef}
        style={{ ...canvasStyle, cursor: canvasCursor }}
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
        {/* 1. Hatching (hash marks) */}
        <button
          onClick={onToggleHatching}
          style={{
            ...measureBtnStyle,
            background: showHatching ? '#0088cc' : '#fff',
            color: showHatching ? '#fff' : '#333',
            borderColor: showHatching ? '#0077b3' : '#999',
          }}
          title={showHatching ? 'Hide Hatching' : 'Show Hatching'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <line x1="3" y1="1" x2="1" y2="3" />
            <line x1="6" y1="1" x2="1" y2="6" />
            <line x1="9" y1="1" x2="1" y2="9" />
            <line x1="12" y1="1" x2="1" y2="12" />
            <line x1="13" y1="3" x2="3" y2="13" />
            <line x1="13" y1="6" x2="6" y2="13" />
            <line x1="13" y1="9" x2="9" y2="13" />
            <line x1="13" y1="12" x2="12" y2="13" />
          </svg>
        </button>
        {/* 2. Dimension visibility */}
        <button
          onClick={onToggleDimensions}
          style={{
            ...measureBtnStyle,
            background: showDimensions ? '#0088cc' : '#fff',
            color: showDimensions ? '#fff' : '#333',
            borderColor: showDimensions ? '#0077b3' : '#999',
          }}
          title={showDimensions ? 'Hide Dimensions' : 'Show Dimensions'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="3" x2="2" y2="11" />
            <line x1="12" y1="3" x2="12" y2="11" />
            <line x1="2" y1="7" x2="12" y2="7" />
            <polyline points="4,5.5 2,7 4,8.5" />
            <polyline points="10,5.5 12,7 10,8.5" />
          </svg>
        </button>
        {/* 3. Measure Tool (user dimension) */}
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
        {/* 4. User dimension visibility */}
        <button
          onClick={onToggleUserDimensions}
          style={{
            ...measureBtnStyle,
            background: showUserDimensions ? '#0088cc' : '#fff',
            color: showUserDimensions ? '#fff' : '#333',
            borderColor: showUserDimensions ? '#0077b3' : '#999',
          }}
          title={showUserDimensions ? 'Hide User Dimensions' : 'Show User Dimensions'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="3" x2="2" y2="11" />
            <line x1="12" y1="3" x2="12" y2="11" />
            <line x1="2" y1="7" x2="12" y2="7" />
            <polyline points="4,5.5 2,7 4,8.5" />
            <polyline points="10,5.5 12,7 10,8.5" />
            <circle cx="7" cy="4" r="2" />
          </svg>
        </button>
        {/* 5. Export DXF (download) */}
        <button
          onClick={onExportDxf}
          style={measureBtnStyle}
          title="Export DXF"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 2 L7 10 M4 7 L7 10 L10 7" />
            <path d="M2 11 L2 12 L12 12 L12 11" />
          </svg>
        </button>
        {/* 6. Print */}
        <button
          onClick={onPrint}
          style={measureBtnStyle}
          title="Print Cross Section"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="1" width="8" height="3" />
            <rect x="1" y="4" width="12" height="5" />
            <rect x="3" y="8" width="8" height="5" />
          </svg>
        </button>
        {/* 7. Tool Overlays — 3-state cycle: off → full → outline */}
        <button
          onClick={onCycleToolOverlay}
          style={{
            ...measureBtnStyle,
            background: toolOverlayMode !== 'off' ? '#0088cc' : '#fff',
            color: toolOverlayMode !== 'off' ? '#fff' : '#333',
            borderColor: toolOverlayMode !== 'off' ? '#0077b3' : '#999',
          }}
          title={`Tool Overlays: ${toolOverlayMode === 'off' ? 'Off' : toolOverlayMode === 'full' ? 'Full Shape' : 'Outline'}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12 L5 2 L7 8 L9 4 L12 12" />
          </svg>
          {toolOverlayMode !== 'off' && (
            <span style={{ fontSize: '9px' }}>{toolOverlayMode === 'full' ? 'F' : 'O'}</span>
          )}
        </button>
        {/* 8. Clear measurements */}
        {measure.measurements.length > 0 && (
          <button
            onClick={measure.clearMeasurements}
            style={measureBtnStyle}
            title="Clear Measurements"
          >Clear</button>
        )}
      </div>
      {zoom !== 1 && (
        <button onClick={handleReset} style={resetBtnStyle}>Reset</button>
      )}
      {zoom !== 1 && (
        <div style={zoomIndicatorStyle}>{(zoom * 100).toFixed(0)}%</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CrossSectionViewer = forwardRef<CrossSectionViewerHandle, CrossSectionViewerProps>(function CrossSectionViewer({ door, graph, profiles, frontPanelType, backPanelType, hasBackRabbit, units, edgeGroupId, thickness: thicknessProp, compact }, ref) {
  const canvasRefForSnapshot = useRef<HTMLCanvasElement | null>(null);

  useImperativeHandle(ref, () => ({
    captureSnapshot: () => canvasRefForSnapshot.current?.toDataURL('image/png') ?? null,
  }));

  const [showHatching, setShowHatching] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showUserDimensions, setShowUserDimensions] = useState(true);
  const [showGlass, setShowGlass] = useState(true);
  const [toolOverlayMode, setToolOverlayMode] = useState<'off' | 'full' | 'outline'>('off');
  const [toolOverlayVisibility, setToolOverlayVisibility] = useState<Record<string, boolean>>({});

  const isGlass = frontPanelType === 'glass' || backPanelType === 'glass';

  // Build per-tool overlay info from graph data (deduplicated by toolId + face)
  const toolOverlayList = useMemo(() => {
    if (!graph) return [];
    const list: ToolOverlayInfo[] = [];
    const seen = new Set<string>();
    let colorIdx = 0;
    for (const op of graph.operations) {
      const isEdge = edgeGroupId != null && op.toolGroupId === edgeGroupId;
      for (let ti = 0; ti < op.tools.length; ti++) {
        const t = op.tools[ti];
        const effectiveFlip = op.flipSideOp !== (t.flipSide ?? false);
        const face = effectiveFlip ? 'back' : 'front';
        const dedupeKey = `${t.toolId}-${face}-${t.entryOffset}-${t.entryDepth}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        list.push({
          key: dedupeKey,
          toolId: t.toolId,
          toolName: t.toolName,
          color: TOOL_COLORS[colorIdx % TOOL_COLORS.length],
          face,
          isEdge,
          alignment: op.alignment,
          entryOffset: t.entryOffset,
          entryDepth: t.entryDepth,
          toolDiameter: t.toolDiameter,
          isCNCDoor: t.isCNCDoor,
          sharpCornerAngle: t.sharpCornerAngle,
        });
        colorIdx++;
      }
    }
    return list;
  }, [graph, edgeGroupId]);

  const handleExportDxf = useCallback(() => {
    const thickness = thicknessProp ?? MATERIAL_THICKNESS;
    const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
    const frontOp = operations.find((op) => !op.FlipSideOp);
    const backOp = operations.find((op) => op.FlipSideOp);
    // Glass = full through-cut
    const frontPocketDepth = frontPanelType === 'glass' ? thickness : (frontOp?.Depth ?? 0);
    const backPocketDepth = backPanelType === 'glass' ? thickness : (backOp?.Depth ?? 0);

    // Partition tools by effective face (operation.flipSideOp XOR tool.flipSide)
    // Edge tools are excluded from panel profile (they'd need separate handling in DXF)
    const tools: NonNullable<typeof graph>['operations'][0]['tools'] = [];
    const backTools: typeof tools = [];
    const dxfToolAlignments: number[] = [];
    const dxfBackToolAlignments: number[] = [];
    for (const graphOp of (graph?.operations ?? [])) {
      if (edgeGroupId && graphOp.toolGroupId === edgeGroupId) continue;
      for (const tool of graphOp.tools) {
        const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
        if (effectiveFlip) {
          backTools.push(tool);
          dxfBackToolAlignments.push(graphOp.alignment);
        } else {
          tools.push(tool);
          dxfToolAlignments.push(graphOp.alignment);
        }
      }
    }
    const stileW = door.LeftRightStileW;
    const exportShowGlass = frontPanelType === 'glass' || backPanelType === 'glass';
    const exportRabbetDepth = getBackRabbetDepth(graph, thickness);

    const composite = computeCompositeProfile(
      tools, backTools, profiles, frontPocketDepth, backPocketDepth, thickness, stileW,
      dxfToolAlignments, dxfBackToolAlignments,
    );
    const dxf = generateDxf(composite, thickness, frontPocketDepth, backPocketDepth, door.Name, stileW, exportShowGlass, exportRabbetDepth);

    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${door.Name.replace(/\s+/g, '_')}_cross_section.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [door, graph, profiles, frontPanelType, backPanelType]);

  return (
    <div style={compact ? { width: '100%', height: '100%', display: 'flex' } : styles.container}>
      {/* Left info panel */}
      {!compact && <div style={styles.sidebar}>
        <h2 style={styles.title}>Cross Section</h2>
        <div style={styles.info}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Door:</span>
            <span style={styles.infoValue}>{door.Name}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Size:</span>
            <span>{formatUnit(door.DefaultW, units)} x {formatUnit(door.DefaultH, units)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Thickness:</span>
            <span>{formatUnit(thicknessProp ?? MATERIAL_THICKNESS, units)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Rail W:</span>
            <span>{formatUnit(door.TopRailW, units)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Stile W:</span>
            <span>{formatUnit(door.LeftRightStileW, units)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Recess:</span>
            <span>{formatUnit(door.PanelRecess, units)}</span>
          </div>
        </div>

        {/* Per-tool color-coded legend with toggles */}
        {toolOverlayList.length > 0 && (() => {
          const groups = [
            { label: 'Front Panel', items: toolOverlayList.filter(t => !t.isEdge && t.face === 'front') },
            { label: 'Back Panel', items: toolOverlayList.filter(t => !t.isEdge && t.face === 'back') },
            { label: 'Front Edge', items: toolOverlayList.filter(t => t.isEdge && t.face === 'front') },
            { label: 'Back Edge', items: toolOverlayList.filter(t => t.isEdge && t.face === 'back') },
          ].filter(g => g.items.length > 0);
          const allKeys = toolOverlayList.map(t => t.key);
          const allVisible = allKeys.every(k => toolOverlayVisibility[k] !== false);
          const noneVisible = allKeys.every(k => toolOverlayVisibility[k] === false);
          return (
            <div style={styles.toolList}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h4 style={{ ...styles.toolListHeader, margin: 0 }}>Tool Overlays</h4>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => {
                      const vis: Record<string, boolean> = {};
                      for (const k of allKeys) vis[k] = true;
                      setToolOverlayVisibility(vis);
                    }}
                    style={{ ...styles.toggleBtn, opacity: allVisible ? 0.5 : 1 }}
                  >All</button>
                  <button
                    onClick={() => {
                      const vis: Record<string, boolean> = {};
                      for (const k of allKeys) vis[k] = false;
                      setToolOverlayVisibility(vis);
                    }}
                    style={{ ...styles.toggleBtn, opacity: noneVisible ? 0.5 : 1 }}
                  >None</button>
                </div>
              </div>
              {groups.map(g => (
                <div key={g.label} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: '10px', color: '#8888aa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 0' }}>
                    {g.label}
                  </div>
                  {g.items.map(info => {
                    const visible = toolOverlayVisibility[info.key] !== false;
                    const offset = -info.entryOffset;
                    const type = info.isCNCDoor ? 'profile' : info.sharpCornerAngle > 0 ? 'v-bit' : 'flat';
                    return (
                      <label key={info.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer', fontSize: '11px', color: '#ccccdd' }}>
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => setToolOverlayVisibility(prev => ({ ...prev, [info.key]: !visible }))}
                          style={{ margin: 0, accentColor: info.color }}
                        />
                        <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: info.color, flexShrink: 0, opacity: visible ? 1 : 0.3 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: visible ? 1 : 0.5 }}>
                          {info.toolName}
                        </span>
                        <span style={{ fontSize: '9px', color: '#777799', fontFamily: 'monospace', flexShrink: 0, opacity: visible ? 1 : 0.4 }}>
                          {type} {formatUnit(Math.abs(offset), units)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Layer toggles */}
        <div style={styles.toggleSection}>
          <h4 style={styles.toolListHeader}>Layers</h4>
          <label style={styles.toggleLabel}>
            <input type="checkbox" checked={showHatching}
              onChange={(e) => setShowHatching(e.target.checked)} />
            Cross Hatching
          </label>
          <label style={styles.toggleLabel}>
            <input type="checkbox" checked={showDimensions}
              onChange={(e) => setShowDimensions(e.target.checked)} />
            Dimensions
          </label>
          <label style={styles.toggleLabel}>
            <input type="checkbox" checked={showUserDimensions}
              onChange={(e) => setShowUserDimensions(e.target.checked)} />
            User Dimensions
          </label>
          <label style={styles.toggleLabel}>
            <select
              value={toolOverlayMode}
              onChange={(e) => setToolOverlayMode(e.target.value as 'off' | 'full' | 'outline')}
              style={{ fontSize: '11px', background: '#2a2a44', color: '#ccc', border: '1px solid #444466', borderRadius: 3, padding: '1px 4px' }}
            >
              <option value="off">Off</option>
              <option value="full">Full Shape</option>
              <option value="outline">Outline</option>
            </select>
            Tool Overlays
          </label>
          {isGlass && (
            <label style={styles.toggleLabel}>
              <input type="checkbox" checked={showGlass}
                onChange={(e) => setShowGlass(e.target.checked)} />
              Glass Pane
            </label>
          )}
        </div>

        {/* Export */}
        <button onClick={handleExportDxf} style={styles.exportBtn}>
          Export DXF
        </button>

        <div style={styles.hint}>
          {units === 'mm' ? '152.4 mm' : '6"'} slice through the door edge,<br />
          centered on the toolpath boundary.
        </div>
      </div>}

      {/* Canvas */}
      <div style={styles.canvasArea}>
        <CrossSectionCanvas
          door={door} graph={graph} profiles={profiles}
          frontPanelType={frontPanelType} backPanelType={backPanelType} hasBackRabbit={hasBackRabbit}
          showHatching={showHatching} showDimensions={showDimensions} showUserDimensions={showUserDimensions}
          toolOverlayMode={toolOverlayMode}
          units={units} showGlass={showGlass} edgeGroupId={edgeGroupId}
          thickness={thicknessProp}
          toolOverlayList={toolOverlayList}
          toolOverlayVisibility={toolOverlayVisibility}
          onToggleHatching={() => setShowHatching(v => !v)}
          onToggleDimensions={() => setShowDimensions(v => !v)}
          onToggleUserDimensions={() => setShowUserDimensions(v => !v)}
          onCycleToolOverlay={() => setToolOverlayMode(m => m === 'off' ? 'full' : m === 'full' ? 'outline' : 'off')}
          onExportDxf={handleExportDxf}
          canvasRefOut={canvasRefForSnapshot}
        />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
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
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: '11px',
  cursor: 'pointer',
  zIndex: 10,
};

const zoomIndicatorStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  fontSize: '11px',
  color: '#666',
  zIndex: 10,
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
  },
  sidebar: {
    width: 300,
    flexShrink: 0,
    padding: 16,
    color: '#e0e0e0',
    overflowY: 'auto',
    background: 'rgba(26, 26, 46, 0.95)',
    borderRight: '1px solid #333355',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
  },
  info: {
    background: 'rgba(30, 30, 50, 0.9)',
    borderRadius: 8,
    padding: '10px 14px',
    border: '1px solid #333355',
    marginBottom: 12,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    padding: '2px 0',
    gap: 8,
  },
  infoLabel: {
    color: '#8888aa',
    fontWeight: 600,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: '11px',
    textAlign: 'right' as const,
  },
  toolList: {
    background: 'rgba(30, 30, 50, 0.9)',
    borderRadius: 8,
    padding: '8px 12px',
    border: '1px solid #333355',
    marginBottom: 12,
  },
  toolListHeader: {
    margin: '0 0 6px 0',
    fontSize: '13px',
    fontWeight: 700,
    color: '#aaaacc',
  },
  toolRow: {
    padding: '3px 0',
    borderBottom: '1px solid #2a2a44',
  },
  toolName: {
    display: 'block',
    fontSize: '11px',
    color: '#ccccdd',
    fontWeight: 600,
  },
  toolDetail: {
    display: 'block',
    fontSize: '10px',
    color: '#777799',
    fontFamily: 'monospace',
  },
  toggleSection: {
    background: 'rgba(30, 30, 50, 0.9)',
    borderRadius: 8,
    padding: '8px 12px',
    border: '1px solid #333355',
    marginBottom: 12,
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '12px',
    color: '#aaaacc',
    cursor: 'pointer',
    padding: '3px 0',
  },
  exportBtn: {
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
    marginBottom: 12,
  },
  toggleBtn: {
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid #444466',
    background: '#2a2a44',
    color: '#aaaacc',
    fontSize: '10px',
    cursor: 'pointer',
  },
  hint: {
    fontSize: '11px',
    color: '#666688',
    fontStyle: 'italic',
    lineHeight: '1.4',
  },
  canvasArea: {
    flex: 1,
    background: '#ffffff',
  },
};
