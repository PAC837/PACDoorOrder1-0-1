import { useState, useCallback, useEffect, useRef } from 'react';
import { buildCrossSectionPoints } from '../utils/cuttingBodies.js';
import type { DoorData, DoorGraphData, ToolProfileData } from '../types.js';
import { MATERIAL_THICKNESS } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossSectionViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
}

type ToolEntry = DoorGraphData['operations'][0]['tools'][0];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEW_WIDTH = 152.4; // 6 inches in mm
const VIEW_HALF = VIEW_WIDTH / 2;
const MM_PER_INCH = 25.4;

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

  return { frontProfile: rawProfile, frontOutline: rawProfile, backProfile: rawBackProfile };
}

// ---------------------------------------------------------------------------
// Dimension drawing helpers
// ---------------------------------------------------------------------------

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number, size: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.35);
  ctx.lineTo(-size, size * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a linear dimension between two model-space points.
 * @param offset — distance to offset the dimension line from the feature (in screen px)
 * @param side — 'left'|'right'|'above'|'below' where to place the dimension relative to the feature
 */
function drawLinearDim(
  ctx: CanvasRenderingContext2D,
  mx1: number, my1: number,  // model coords start
  mx2: number, my2: number,  // model coords end
  label: string,
  offset: number,            // screen px offset from feature
  side: 'left' | 'right' | 'above' | 'below',
  toX: (x: number) => number,
  toY: (y: number) => number,
) {
  const sx1 = toX(mx1), sy1 = toY(my1);
  const sx2 = toX(mx2), sy2 = toY(my2);

  const gap = 3;    // gap between feature and extension line
  const ext = 4;    // extension beyond dimension line
  const arrowSize = 6;

  let dx = 0, dy = 0; // offset direction (perpendicular to dim line)
  if (side === 'left') dx = -offset;
  else if (side === 'right') dx = offset;
  else if (side === 'above') dy = -offset;
  else dy = offset;

  // Dimension line endpoints
  const d1x = sx1 + dx, d1y = sy1 + dy;
  const d2x = sx2 + dx, d2y = sy2 + dy;

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 0.75;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Extension lines
  if (side === 'left' || side === 'right') {
    ctx.beginPath();
    ctx.moveTo(sx1 + (dx > 0 ? gap : -gap), sy1);
    ctx.lineTo(d1x + (dx > 0 ? ext : -ext), d1y);
    ctx.moveTo(sx2 + (dx > 0 ? gap : -gap), sy2);
    ctx.lineTo(d2x + (dx > 0 ? ext : -ext), d2y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(sx1, sy1 + (dy > 0 ? gap : -gap));
    ctx.lineTo(d1x, d1y + (dy > 0 ? ext : -ext));
    ctx.moveTo(sx2, sy2 + (dy > 0 ? gap : -gap));
    ctx.lineTo(d2x, d2y + (dy > 0 ? ext : -ext));
    ctx.stroke();
  }

  // Dimension line
  ctx.beginPath();
  ctx.moveTo(d1x, d1y);
  ctx.lineTo(d2x, d2y);
  ctx.stroke();

  // Arrows
  const angle = Math.atan2(d2y - d1y, d2x - d1x);
  drawArrowHead(ctx, d1x, d1y, angle, arrowSize);
  drawArrowHead(ctx, d2x, d2y, angle + Math.PI, arrowSize);

  // Label
  const midX = (d1x + d2x) / 2;
  const midY = (d1y + d2y) / 2;

  // Background for text
  const metrics = ctx.measureText(label);
  const tw = metrics.width + 6;
  const th = 12;
  ctx.fillStyle = '#ffffff';
  if (side === 'left' || side === 'right') {
    ctx.fillRect(midX - 3, midY - th / 2 - 1, tw, th);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.fillText(label, midX, midY);
  } else {
    ctx.fillRect(midX - tw / 2, midY - th / 2 - 1, tw, th);
    ctx.fillStyle = '#000000';
    ctx.fillText(label, midX, midY);
  }

  ctx.restore();
}

function drawAngleDim(
  ctx: CanvasRenderingContext2D,
  tipSx: number, tipSy: number,  // screen coords of V-bit tip
  angleDeg: number,               // included angle
  radius: number,                 // arc radius in screen px
) {
  const halfAngle = (angleDeg / 2) * (Math.PI / 180);

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 0.75;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Arc from one leg to the other (angles measured from vertical up = -PI/2)
  const startAngle = -Math.PI / 2 - halfAngle;
  const endAngle = -Math.PI / 2 + halfAngle;

  ctx.beginPath();
  ctx.arc(tipSx, tipSy, radius, startAngle, endAngle);
  ctx.stroke();

  // Arrows at arc endpoints
  const a1x = tipSx + radius * Math.cos(startAngle);
  const a1y = tipSy + radius * Math.sin(startAngle);
  const a2x = tipSx + radius * Math.cos(endAngle);
  const a2y = tipSy + radius * Math.sin(endAngle);
  drawArrowHead(ctx, a1x, a1y, startAngle + Math.PI / 2, 5);
  drawArrowHead(ctx, a2x, a2y, endAngle - Math.PI / 2, 5);

  // Label
  const labelX = tipSx;
  const labelY = tipSy - radius - 8;
  const label = `${angleDeg}°`;
  const tw = ctx.measureText(label).width + 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(labelX - tw / 2, labelY - 6, tw, 12);
  ctx.fillStyle = '#000000';
  ctx.fillText(label, labelX, labelY);

  ctx.restore();
}

function drawRadiusDim(
  ctx: CanvasRenderingContext2D,
  arcCenterSx: number, arcCenterSy: number,
  radiusSx: number, // radius in screen px
  pointAngle: number, // angle to draw the leader line at
  label: string,
) {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = 0.75;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';

  // Point on arc
  const px = arcCenterSx + radiusSx * Math.cos(pointAngle);
  const py = arcCenterSy + radiusSx * Math.sin(pointAngle);

  // Leader line extends outward
  const leaderLen = 30;
  const ex = px + leaderLen * Math.cos(pointAngle);
  const ey = py + leaderLen * Math.sin(pointAngle);

  ctx.beginPath();
  ctx.moveTo(arcCenterSx, arcCenterSy);
  ctx.lineTo(px, py);
  ctx.stroke();

  // Arrow at arc
  drawArrowHead(ctx, px, py, pointAngle, 5);

  // Label
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.textAlign = pointAngle > Math.PI / 2 && pointAngle < 3 * Math.PI / 2 ? 'right' : 'left';
  const tw = ctx.measureText(label).width + 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ex - 3, ey - 7, tw, 14);
  ctx.fillStyle = '#000000';
  ctx.fillText(label, ex, ey);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hatching
// ---------------------------------------------------------------------------

function drawDiagonalHatch(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  spacing: number,
) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.4;
  const maxDist = w + h;
  for (let d = -maxDist; d < maxDist; d += spacing) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// DXF export
// ---------------------------------------------------------------------------

function formatDim(mm: number): string {
  return `${mm.toFixed(2)} (${(mm / MM_PER_INCH).toFixed(3)}")`;
}

function generateDxf(
  composite: CompositeProfile,
  thickness: number,
  frontPocketDepth: number,
  backPocketDepth: number,
  doorName: string,
  stileW: number,
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
  w('70'); w('3'); // 3 layers

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
  showHatching,
  showDimensions,
}: CrossSectionViewerProps & { showHatching: boolean; showDimensions: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // --- Gather data ---
    const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
    const frontOp = operations.find((op) => !op.FlipSideOp);
    const backOp = operations.find((op) => op.FlipSideOp);
    const frontPocketDepth = frontOp?.Depth ?? 0;
    const backPocketDepth = backOp?.Depth ?? 0;

    // Partition tools by effective face (operation.flipSideOp XOR tool.flipSide)
    const tools: NonNullable<typeof graph>['operations'][0]['tools'] = [];
    const backTools: typeof tools = [];
    for (const graphOp of (graph?.operations ?? [])) {
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

    // --- Coordinate transform ---
    const dimSpace = showDimensions ? 50 : 0;
    const pad = 60 + dimSpace;
    const scaleX = (cw - 2 * pad) / VIEW_WIDTH;
    const scaleY = (ch - 2 * pad) / thickness;
    const scale = Math.min(scaleX, scaleY);

    const cx = cw / 2;
    const cy = ch / 2;
    const viewCY = thickness / 2;

    const toX = (x: number) => cx + x * scale;
    const toY = (y: number) => cy + (y - viewCY) * scale;

    const slabLeft = toX(-VIEW_HALF);
    const slabRight = toX(stileW);
    const slabTop = toY(0);
    const slabBot = toY(thickness);

    // --- 1. White background ---
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    // --- 2. Build solid material clip path and draw hatching ---
    if (showHatching || true) {
      // Build clip path: slab boundary + front profile cut + back pocket
      ctx.save();
      ctx.beginPath();

      // Outer slab boundary (clockwise)
      ctx.moveTo(slabRight, slabTop);
      ctx.lineTo(slabRight, slabBot);
      ctx.lineTo(slabLeft, slabBot);
      ctx.lineTo(slabLeft, slabTop);
      ctx.closePath();

      // Front profile cut (counter-clockwise hole)
      if (outline.length > 1) {
        // Start from right-top, go along the front face to the first outline point,
        // then follow outline, then back along front face to start
        ctx.moveTo(toX(outline[0].x), toY(outline[0].y));
        for (let i = 1; i < outline.length; i++) {
          ctx.lineTo(toX(outline[i].x), toY(outline[i].y));
        }
        // Close back along front face
        ctx.lineTo(slabLeft, slabTop);
        ctx.lineTo(slabRight, slabTop);
        ctx.closePath();
      }

      // Back profile hole (counter-clockwise from back face)
      if (backProfile.length > 1) {
        const hasBackCut = backProfile.some(p => p.y > 0);
        if (hasBackCut) {
          // backProfile[i].y is depth-from-back-face → screen Y = toY(thickness - y)
          ctx.moveTo(toX(backProfile[0].x), toY(thickness - backProfile[0].y));
          for (let i = 1; i < backProfile.length; i++) {
            ctx.lineTo(toX(backProfile[i].x), toY(thickness - backProfile[i].y));
          }
          ctx.lineTo(slabLeft, slabBot);
          ctx.lineTo(slabRight, slabBot);
          ctx.closePath();
        }
      }

      ctx.clip('evenodd');

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

    // Single continuous closed outline: composite front profile + slab edges + back profile
    ctx.beginPath();
    if (outline.length > 1) {
      // Start at rightmost composite point (stile edge)
      ctx.moveTo(toX(outline[0].x), toY(outline[0].y));
      // Right edge down to bottom-right
      ctx.lineTo(slabRight, slabBot);
      // Bottom edge: back profile from right to left (reverse order)
      const hasBackCut = backProfile.length > 1 && backProfile.some(p => p.y > 0);
      if (hasBackCut) {
        // Back profile from right to left
        for (let i = 0; i < backProfile.length; i++) {
          ctx.lineTo(toX(backProfile[i].x), toY(thickness - backProfile[i].y));
        }
        // Left edge up from leftmost back profile to back face
        ctx.lineTo(slabLeft, slabBot);
      } else {
        ctx.lineTo(slabLeft, slabBot);
      }
      // Left edge up to leftmost composite point
      ctx.lineTo(toX(outline[outline.length - 1].x), toY(outline[outline.length - 1].y));
      // Composite front profile from left to right (reverse order)
      for (let i = outline.length - 2; i >= 0; i--) {
        ctx.lineTo(toX(outline[i].x), toY(outline[i].y));
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

    // Back profile outline (separate stroke for clarity when no front profile)
    if (backProfile.length > 1 && backProfile.some(p => p.y > 0) && outline.length <= 1) {
      ctx.beginPath();
      ctx.moveTo(toX(backProfile[0].x), toY(thickness - backProfile[0].y));
      for (let i = 1; i < backProfile.length; i++) {
        ctx.lineTo(toX(backProfile[i].x), toY(thickness - backProfile[i].y));
      }
      ctx.stroke();
    }

    // --- 4. Dimensions ---
    if (showDimensions) {
      // Material thickness (right side, at door edge)
      drawLinearDim(ctx, stileW, 0, stileW, thickness,
        formatDim(thickness), 30, 'right', toX, toY);

      // Front pocket depth (left side)
      if (frontPocketDepth > 0) {
        drawLinearDim(ctx, -VIEW_HALF, 0, -VIEW_HALF, frontPocketDepth,
          formatDim(frontPocketDepth), 30, 'left', toX, toY);
      }

      // Back pocket depth (left side, from back face)
      if (backPocketDepth > 0) {
        drawLinearDim(ctx, -VIEW_HALF, thickness - backPocketDepth, -VIEW_HALF, thickness,
          formatDim(backPocketDepth), 55, 'left', toX, toY);
      }

      // Stile width (bottom, from toolpath x=0 to outer edge)
      if (stileW > 0) {
        drawLinearDim(ctx, 0, thickness, stileW, thickness,
          formatDim(stileW), 20, 'below', toX, toY);
      }

      // V-bit angle annotation
      for (const tool of tools) {
        if (tool.sharpCornerAngle > 0) {
          const offset = -tool.entryOffset;
          const d = tool.entryDepth;
          const tipSx = toX(offset);
          const tipSy = toY(d);
          drawAngleDim(ctx, tipSx, tipSy, tool.sharpCornerAngle, 25);
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
            // Leader points upper-right (toward stile surface, clear of profile)
            drawRadiusDim(ctx, arcCx, arcCy, rScreen,
              -Math.PI / 4,
              `R${r.toFixed(2)} (${(r / MM_PER_INCH).toFixed(3)}")`);
          }
        }
      }

      // Profile tool entry depth
      if (tools.length > 0) {
        // Find the deepest profile/vbit tool
        const profileTools = tools.filter((t) => t.isCNCDoor || t.sharpCornerAngle > 0);
        if (profileTools.length > 0) {
          const deepest = profileTools.reduce((a, b) => a.entryDepth > b.entryDepth ? a : b);
          const offset = -deepest.entryOffset;
          drawLinearDim(ctx, offset, 0, offset, deepest.entryDepth,
            formatDim(deepest.entryDepth), 15, 'right', toX, toY);
        }
      }
    }

    // --- 5. Labels ---
    ctx.fillStyle = '#666666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Front Face', cx, slabTop - 8);
    ctx.fillText('Back Face', cx, slabBot + 16);

    ctx.fillStyle = '#888888';
    ctx.font = '10px sans-serif';
    ctx.fillText('Stile / Rail', toX(VIEW_HALF * 0.5), slabBot + 30);
    ctx.fillText('Panel Area', toX(-VIEW_HALF * 0.5), slabBot + 30);

  }, [door, graph, profiles, showHatching, showDimensions]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  return <canvas ref={canvasRef} style={canvasStyle} />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CrossSectionViewer({ door, graph, profiles }: CrossSectionViewerProps) {
  const [showHatching, setShowHatching] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);

  const handleExportDxf = useCallback(() => {
    const thickness = MATERIAL_THICKNESS;
    const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
    const frontOp = operations.find((op) => !op.FlipSideOp);
    const backOp = operations.find((op) => op.FlipSideOp);
    const frontPocketDepth = frontOp?.Depth ?? 0;
    const backPocketDepth = backOp?.Depth ?? 0;

    // Partition tools by effective face (operation.flipSideOp XOR tool.flipSide)
    const tools: NonNullable<typeof graph>['operations'][0]['tools'] = [];
    const backTools: typeof tools = [];
    for (const graphOp of (graph?.operations ?? [])) {
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

    const composite = computeCompositeProfile(
      tools, backTools, profiles, frontPocketDepth, backPocketDepth, thickness, stileW,
    );
    const dxf = generateDxf(composite, thickness, frontPocketDepth, backPocketDepth, door.Name, stileW);

    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${door.Name.replace(/\s+/g, '_')}_cross_section.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [door, graph, profiles]);

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
            <span>{door.DefaultW.toFixed(1)} x {door.DefaultH.toFixed(1)} mm</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Thickness:</span>
            <span>{MATERIAL_THICKNESS.toFixed(2)} mm ({(MATERIAL_THICKNESS / MM_PER_INCH).toFixed(3)}")</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Rail W:</span>
            <span>{door.TopRailW.toFixed(2)} mm ({(door.TopRailW / MM_PER_INCH).toFixed(3)}")</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Stile W:</span>
            <span>{door.LeftRightStileW.toFixed(2)} mm ({(door.LeftRightStileW / MM_PER_INCH).toFixed(3)}")</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Recess:</span>
            <span>{door.PanelRecess.toFixed(2)} mm ({(door.PanelRecess / MM_PER_INCH).toFixed(3)}")</span>
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
                      {type} | offset {offset.toFixed(2)} | depth {t.entryDepth.toFixed(2)}
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
        </div>

        {/* Export */}
        <button onClick={handleExportDxf} style={styles.exportBtn}>
          Export DXF
        </button>

        <div style={styles.hint}>
          6" (152.4 mm) slice through the door edge,<br />
          centered on the toolpath boundary.
        </div>
      </div>

      {/* Canvas */}
      <div style={styles.canvasArea}>
        <CrossSectionCanvas
          door={door} graph={graph} profiles={profiles}
          showHatching={showHatching} showDimensions={showDimensions}
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
