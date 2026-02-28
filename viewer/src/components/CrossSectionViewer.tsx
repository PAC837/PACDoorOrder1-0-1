import { useState, useCallback, useEffect, useRef } from 'react';
import { buildCrossSectionPoints, getBackRabbetDepth } from '../utils/cuttingBodies.js';
import { drawArrowHead, drawLinearDim, drawAngleDim, drawRadiusDim, drawDiagonalHatch } from '../utils/canvasDrawing.js';
import type { DoorData, DoorGraphData, ToolProfileData, PanelType, UnitSystem } from '../types.js';
import { MATERIAL_THICKNESS, GLASS_THICKNESS, formatUnit } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossSectionViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
  units: UnitSystem;
  edgeGroupId?: number | null;
}

type ToolEntry = DoorGraphData['operations'][0]['tools'][0];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEW_WIDTH = 152.4; // 6 inches in mm
const VIEW_HALF = VIEW_WIDTH / 2;

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
): CompositeProfile {
  const halfThickness = thickness / 2;

  // Build shape edges for each front tool using the same geometry as the 3D viewer.
  const toolEdges: ShapeEdge[][] = [];
  for (const tool of tools) {
    const pts = buildCrossSectionPoints(tool, profiles, thickness);
    toolEdges.push(pts ? buildEdgesFromPoints(pts) : []);
  }

  // Build shape edges for each back tool.
  // No Y-mirroring needed: the depth formula (halfThickness - minY) gives
  // the tool's cutting depth regardless of front/back. The difference is
  // only in rendering (front depth from top, back depth from bottom).
  const backToolEdges: ShapeEdge[][] = [];
  for (const tool of backTools) {
    const pts = buildCrossSectionPoints(tool, profiles, thickness);
    backToolEdges.push(pts ? buildEdgesFromPoints(pts) : []);
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
  units,
  showGlass,
  edgeGroupId: edgeGroupIdProp,
}: CrossSectionViewerProps & { showHatching: boolean; showDimensions: boolean; showGlass: boolean; edgeGroupId?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);

  // Reset zoom when door changes
  useEffect(() => { setZoom(1); setPanX(0); setPanY(0); }, [door.Name]);

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

    const thickness = MATERIAL_THICKNESS;
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
    for (const graphOp of (graph?.operations ?? [])) {
      if (edgeGroupIdProp && graphOp.toolGroupId === edgeGroupIdProp) {
        for (const tool of graphOp.tools) {
          const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
          (effectiveFlip ? edgeBackTools : edgeFrontTools).push(tool);
        }
        continue;
      }
      for (const tool of graphOp.tools) {
        const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
        if (effectiveFlip) {
          backTools.push(tool);
        } else {
          tools.push(tool);
        }
      }
    }
    const stileW = door.LeftRightStileW;

    // Compute composite depth profile (front + back)
    const composite = computeCompositeProfile(
      tools, backTools, profiles, frontPocketDepth, backPocketDepth, thickness, stileW,
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
      for (const tool of edgeFrontTools) {
        const pts = buildCrossSectionPoints(tool, profiles, thickness);
        if (pts) {
          const shifted = pts.map(p => ({ x: p.x + stileW, y: p.y }));
          edgeFrontEdges.push(buildEdgesFromPoints(shifted));
        }
      }
      const edgeBackEdges: ShapeEdge[][] = [];
      for (const tool of edgeBackTools) {
        const pts = buildCrossSectionPoints(tool, profiles, thickness);
        if (pts) {
          const shifted = pts.map(p => ({ x: p.x + stileW, y: p.y }));
          edgeBackEdges.push(buildEdgesFromPoints(shifted));
        }
      }

      // Merge edge depths into front profile (override where edge cuts deeper)
      for (const pt of outline) {
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
        for (const edges of edgeBackEdges) {
          const minY = getMinYAtX(edges, pt.x);
          if (minY !== null) {
            const d = halfThickness - minY;
            if (d > pt.y) pt.y = d;
          }
        }
      }
    }

    // --- Coordinate transform (with zoom + pan) ---
    const dimSpace = showDimensions ? 50 : 0;
    const pad = 60 + dimSpace;
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
    if (showHatching || true) {
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
        // Light gray fill when hatching is off
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.restore();
    }

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

  }, [door, graph, profiles, showHatching, showDimensions, frontPanelType, backPanelType, hasBackRabbit, units, showGlass, zoom, panX, panY, edgeGroupIdProp]);

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

  // Mouse drag for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPanX(px => px + dx);
    setPanY(py => py + dy);
  }, [isDragging]);
  const handleMouseUp = useCallback(() => setIsDragging(false), []);

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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ ...canvasStyle, cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
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

export function CrossSectionViewer({ door, graph, profiles, frontPanelType, backPanelType, hasBackRabbit, units, edgeGroupId }: CrossSectionViewerProps) {
  const [showHatching, setShowHatching] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showGlass, setShowGlass] = useState(true);

  const isGlass = frontPanelType === 'glass' || backPanelType === 'glass';

  const handleExportDxf = useCallback(() => {
    const thickness = MATERIAL_THICKNESS;
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
    for (const graphOp of (graph?.operations ?? [])) {
      if (edgeGroupId && graphOp.toolGroupId === edgeGroupId) continue;
      for (const tool of graphOp.tools) {
        const effectiveFlip = graphOp.flipSideOp !== (tool.flipSide ?? false);
        if (effectiveFlip) {
          backTools.push(tool);
        } else {
          tools.push(tool);
        }
      }
    }
    const stileW = door.LeftRightStileW;
    const exportShowGlass = frontPanelType === 'glass' || backPanelType === 'glass';
    const exportRabbetDepth = getBackRabbetDepth(graph, thickness);

    const composite = computeCompositeProfile(
      tools, backTools, profiles, frontPocketDepth, backPocketDepth, thickness, stileW,
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
    <div style={styles.container}>
      {/* Left info panel */}
      <div style={styles.sidebar}>
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
            <span>{formatUnit(MATERIAL_THICKNESS, units)}</span>
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

        {/* Tool list */}
        {graph && (
          <div style={styles.toolList}>
            <h4 style={styles.toolListHeader}>Tools in Section</h4>
            {graph.operations
              .filter((o) => !o.flipSideOp)
              .flatMap((o) => o.tools)
              .map((t, i) => {
                const offset = -t.entryOffset;
                const type = t.isCNCDoor ? 'profile' : t.sharpCornerAngle > 0 ? 'v-bit' : 'flat';
                return (
                  <div key={i} style={styles.toolRow}>
                    <span style={styles.toolName}>{t.toolName}</span>
                    <span style={styles.toolDetail}>
                      {type} | offset {formatUnit(offset, units)} | depth {formatUnit(t.entryDepth, units)}
                    </span>
                  </div>
                );
              })}
          </div>
        )}

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
      </div>

      {/* Canvas */}
      <div style={styles.canvasArea}>
        <CrossSectionCanvas
          door={door} graph={graph} profiles={profiles}
          frontPanelType={frontPanelType} backPanelType={backPanelType} hasBackRabbit={hasBackRabbit}
          showHatching={showHatching} showDimensions={showDimensions}
          units={units} showGlass={showGlass} edgeGroupId={edgeGroupId}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
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
