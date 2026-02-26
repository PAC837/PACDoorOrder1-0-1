import * as THREE from 'three';

/**
 * A single profile shape point from profiles.json.
 * ptType: 0 = straight line vertex, 1 = filleted corner, 2 = filleted corner (alt)
 * data: fillet radius at this corner (sign controls convex vs concave)
 */
export interface ProfilePoint {
  x_mm: number;
  y_mm: number;
  x_in: number;
  y_in: number;
  ptType: number;
  data: number;
}

export interface ToolProfile {
  toolId: number;
  toolName: string;
  diameter_mm: number;
  diameter_in: number;
  points: ProfilePoint[];
}

// ---------------------------------------------------------------------------
// Corner fillet geometry
// ---------------------------------------------------------------------------

interface Vec2 {
  x: number;
  y: number;
}

function vecLen(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecNormalize(v: Vec2): Vec2 {
  const len = vecLen(v);
  if (len < 1e-10) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Apply corner fillets to a closed polygon.
 *
 * For each vertex with a non-zero radius, the sharp corner is replaced
 * with a circular arc tangent to both adjacent edges.
 *
 * Positive data → convex fillet (arc center toward angle interior)
 * Negative data → concave fillet (arc center toward angle exterior)
 */
function filletPolygon(
  vertices: Vec2[],
  radii: number[],
  dataSign: number[],
  segments: number,
): Vec2[] {
  const n = vertices.length;
  if (n < 3) return [...vertices];

  // Pre-compute trim distances for each filleted vertex
  const trimDist: number[] = new Array(n).fill(0);
  const effectiveR: number[] = new Array(n).fill(0);
  const halfAngles: number[] = new Array(n).fill(0);
  const bisectors: Vec2[] = new Array(n).fill({ x: 0, y: 0 });
  const isFilleted: boolean[] = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    const r = radii[i];
    if (r < 0.0001) continue;

    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const dIn = vecNormalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const dOut = vecNormalize({ x: next.x - curr.x, y: next.y - curr.y });

    // Skip degenerate edges
    if (vecLen(dIn) < 1e-10 || vecLen(dOut) < 1e-10) continue;

    // Interior angle: angle between reversed incoming and outgoing directions
    const dot = -dIn.x * dOut.x + -dIn.y * dOut.y;
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot)));

    // Skip near-straight or near-zero angles
    if (alpha < 0.001 || Math.PI - alpha < 0.001) continue;

    const half = alpha / 2;
    const t = r / Math.tan(half);

    // Bisector: normalize(-d_in + d_out), points into the angle opening
    const bisRaw = { x: -dIn.x + dOut.x, y: -dIn.y + dOut.y };
    const bis = vecNormalize(bisRaw);
    if (vecLen(bis) < 1e-10) continue;

    isFilleted[i] = true;
    trimDist[i] = t;
    effectiveR[i] = r;
    halfAngles[i] = half;
    bisectors[i] = bis;
  }

  // Clamp overlapping trims on shared edges
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!isFilleted[i] && !isFilleted[j]) continue;

    const edgeLen = vecLen({
      x: vertices[j].x - vertices[i].x,
      y: vertices[j].y - vertices[i].y,
    });
    if (edgeLen < 1e-10) continue;

    // Trim from vertex i's outgoing side + trim from vertex j's incoming side
    const trimI = isFilleted[i] ? trimDist[i] : 0;
    const trimJ = isFilleted[j] ? trimDist[j] : 0;
    const total = trimI + trimJ;

    if (total > edgeLen) {
      const scale = edgeLen / total;
      if (isFilleted[i]) {
        trimDist[i] *= scale;
        effectiveR[i] = trimDist[i] * Math.tan(halfAngles[i]);
      }
      if (isFilleted[j]) {
        trimDist[j] *= scale;
        effectiveR[j] = trimDist[j] * Math.tan(halfAngles[j]);
      }
    }
  }

  // Build the filleted polygon
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    if (!isFilleted[i]) {
      result.push({ x: vertices[i].x, y: vertices[i].y });
      continue;
    }

    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    const r = effectiveR[i];
    const t = trimDist[i];
    const bis = bisectors[i];
    const half = halfAngles[i];

    const dIn = vecNormalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const dOut = vecNormalize({ x: next.x - curr.x, y: next.y - curr.y });

    // Tangent points
    const T1: Vec2 = { x: curr.x - dIn.x * t, y: curr.y - dIn.y * t };
    const T2: Vec2 = { x: curr.x + dOut.x * t, y: curr.y + dOut.y * t };

    // Arc center distance from vertex along bisector
    const centerDist = r / Math.sin(half);

    // Positive data → center in bisector direction (convex fillet)
    // Negative data → center opposite (concave fillet)
    const sign = dataSign[i] >= 0 ? 1 : -1;
    const cx = curr.x + sign * bis.x * centerDist;
    const cy = curr.y + sign * bis.y * centerDist;

    // Tessellate arc from T1 to T2
    const startAngle = Math.atan2(T1.y - cy, T1.x - cx);
    const endAngle = Math.atan2(T2.y - cy, T2.x - cx);
    let sweep = endAngle - startAngle;

    // Use the SHORT arc for a standard fillet
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;

    const numSegs = Math.max(4, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * segments));

    for (let j = 0; j <= numSegs; j++) {
      const frac = j / numSegs;
      const angle = startAngle + sweep * frac;
      result.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mirror for full tool
// ---------------------------------------------------------------------------

/**
 * Mirror a half-profile (right side, x >= 0) across x=0 to produce the full tool outline.
 *
 * Input: closed polygon of the right half (first point = last point).
 * Output: closed polygon of the full tool.
 */
export function mirrorForFullTool(halfPoints: Vec2[]): Vec2[] {
  if (halfPoints.length < 2) return halfPoints;

  // Remove the closing point if it duplicates the first
  const pts = [...halfPoints];
  const last = pts[pts.length - 1];
  const first = pts[0];
  if (Math.abs(last.x - first.x) < 0.001 && Math.abs(last.y - first.y) < 0.001) {
    pts.pop();
  }

  const right = pts;

  // Left side = mirrored (x negated), reversed order, skip center-axis points
  const left: Vec2[] = [];
  for (let i = right.length - 1; i >= 0; i--) {
    const p = right[i];
    if (Math.abs(p.x) < 0.001) continue;
    left.push({ x: -p.x, y: p.y });
  }

  const full = [...left, ...right];
  full.push({ x: full[0].x, y: full[0].y });

  return full;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert profile points into an array of 2D points for rendering.
 *
 * Points define vertices of a closed polygon. Vertices with ptType != 0
 * get a corner fillet applied with radius = |data|. Sign of data controls
 * convex (+) vs concave (-) fillet direction.
 *
 * When fullTool=true, mirrors the half-profile across x=0.
 */
export function profileToLinePoints(
  points: ProfilePoint[],
  arcSegments = 32,
  fullTool = false,
): Vec2[] {
  if (points.length < 2) return [];

  const vertices = points.map((p) => ({ x: p.x_mm, y: p.y_mm }));
  const radii = points.map((p) => (p.ptType !== 0 ? Math.abs(p.data) : 0));
  const signs = points.map((p) => (p.data >= 0 ? 1 : -1));

  const filleted = filletPolygon(vertices, radii, signs, arcSegments);

  // Close the polygon
  filleted.push({ x: filleted[0].x, y: filleted[0].y });

  return fullTool ? mirrorForFullTool(filleted) : filleted;
}

/**
 * Convert profile points into straight-line polygon (no fillets) for debug overlay.
 */
export function profileToStraightLines(
  points: ProfilePoint[],
  fullTool = false,
): Vec2[] {
  if (points.length < 2) return [];

  const result = points.map((p) => ({ x: p.x_mm, y: p.y_mm }));
  result.push({ x: points[0].x_mm, y: points[0].y_mm });

  return fullTool ? mirrorForFullTool(result) : result;
}

/**
 * Convert profile points into a THREE.Shape (for 3D rendering).
 */
export function profileToShape(points: ProfilePoint[]): THREE.Shape {
  const linePoints = profileToLinePoints(points, 64);
  const shape = new THREE.Shape();

  if (linePoints.length < 2) return shape;

  shape.moveTo(linePoints[0].x, linePoints[0].y);
  for (let i = 1; i < linePoints.length; i++) {
    shape.lineTo(linePoints[i].x, linePoints[i].y);
  }
  shape.closePath();

  return shape;
}
