import * as THREE from 'three';

/**
 * A single profile shape point from profiles.json.
 * ptType: 0 = straight line vertex
 * ptType: 1 = filleted corner (data = fillet radius in mm, sign = convex/concave)
 * ptType: -1 = filleted corner (same as ptType 1, data = fillet radius in mm)
 * ptType: 2 = Mozaik sagitta arc (data = sagitta in mm from this vertex to the next;
 *             sagitta = perpendicular distance from chord midpoint to arc midpoint,
 *             positive = arc curves left of travel direction, negative = right)
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

    // Always compute convex center first (along bisector)
    let cx = curr.x + bis.x * centerDist;
    let cy = curr.y + bis.y * centerDist;

    // For concave fillets (ptType=-1), reflect center across T1-T2 chord.
    // The convex and concave centers are the two circle-circle intersections
    // of radius r around T1 and T2. Reflecting gives the correct concave arc.
    if (dataSign[i] < 0) {
      const mx = (T1.x + T2.x) / 2;
      const my = (T1.y + T2.y) / 2;
      cx = 2 * mx - cx;
      cy = 2 * my - cy;
    }

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
// Sagitta-based arc tessellation
// ---------------------------------------------------------------------------

/**
 * Tessellate an arc between two points defined by a Mozaik sagitta value.
 *
 * The sagitta is the perpendicular distance from the chord midpoint to the
 * arc midpoint (the "height" of the arc), in mm.
 *
 *   Positive sagitta → arc curves to the LEFT of the p1→p2 direction (CCW)
 *   Negative sagitta → arc curves to the RIGHT (CW)
 *
 * Returns an array of points along the arc INCLUDING p1, EXCLUDING p2
 * (p2 will be emitted by the next segment).
 */
function tessellateArc(
  p1: Vec2,
  p2: Vec2,
  sagitta: number,
  segments: number,
): Vec2[] {
  if (Math.abs(sagitta) < 1e-10) return [p1];

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.sqrt(dx * dx + dy * dy);
  if (chord < 1e-10) return [p1];

  // Arc geometry from sagitta
  const s = Math.abs(sagitta);
  const halfChord = chord / 2;
  const radius = (s * s + halfChord * halfChord) / (2 * s);

  // Midpoint of chord
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  // Unit perpendicular to chord (LEFT of p1→p2 direction)
  const px = -dy / chord;
  const py = dx / chord;

  // Center is on the opposite side of chord from the arc,
  // at distance (radius - s) from midpoint
  const centerDist = radius - s;
  const sign = sagitta > 0 ? 1 : -1;
  const cx = mx - sign * px * centerDist;
  const cy = my - sign * py * centerDist;

  // Sweep angles
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const endAngle = Math.atan2(p2.y - cy, p2.x - cx);

  // Determine sweep direction
  let sweep = endAngle - startAngle;
  if (sagitta > 0) {
    // CW: arc curves left of p1→p2, center is on right → sweep negative
    if (sweep > 0) sweep -= 2 * Math.PI;
  } else {
    // CCW: arc curves right of p1→p2, center is on left → sweep positive
    if (sweep < 0) sweep += 2 * Math.PI;
  }

  const numSegs = Math.max(4, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * segments));
  const result: Vec2[] = [];

  // Emit all points except the last (p2 will be emitted by next segment)
  for (let j = 0; j < numSegs; j++) {
    const frac = j / numSegs;
    const angle = startAngle + sweep * frac;
    result.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
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
 * Two-phase approach:
 *   Phase 1: Resolve ptType=2 (DXF bulge) segments into tessellated arc points.
 *   Phase 2: Apply ptType=1 corner fillets on the expanded polygon.
 *
 * When fullTool=true, mirrors the half-profile across x=0.
 */
export function profileToLinePoints(
  points: ProfilePoint[],
  arcSegments = 32,
  fullTool = false,
): Vec2[] {
  if (points.length < 2) return [];

  const n = points.length;

  // Phase 1: Resolve ptType=2 (bulge) segments into tessellated arc points
  const expanded: Vec2[] = [];
  const expandedRadii: number[] = [];
  const expandedSigns: number[] = [];

  for (let i = 0; i < n; i++) {
    const curr: Vec2 = { x: points[i].x_mm, y: points[i].y_mm };
    const next: Vec2 = { x: points[(i + 1) % n].x_mm, y: points[(i + 1) % n].y_mm };

    if (points[i].ptType === 2 && Math.abs(points[i].data) > 1e-10) {
      // Bulge arc from curr to next — tessellate into line segments
      const arcPts = tessellateArc(curr, next, points[i].data, arcSegments);
      for (const p of arcPts) {
        expanded.push(p);
        expandedRadii.push(0);   // Arc points don't get fillets
        expandedSigns.push(1);
      }
    } else {
      // Straight vertex (ptType=0) or filleted corner (ptType=1)
      expanded.push(curr);
      if ((points[i].ptType === 1 || points[i].ptType === -1) && Math.abs(points[i].data) > 1e-10) {
        expandedRadii.push(Math.abs(points[i].data));
        const baseSign = points[i].data >= 0 ? 1 : -1;
        expandedSigns.push(points[i].ptType === -1 ? -baseSign : baseSign);
      } else {
        expandedRadii.push(0);
        expandedSigns.push(1);
      }
    }
  }

  // Phase 2: Apply corner fillets for ptType=1 vertices
  const filleted = filletPolygon(expanded, expandedRadii, expandedSigns, arcSegments);

  // Close the polygon
  filleted.push({ x: filleted[0].x, y: filleted[0].y });

  return fullTool ? mirrorForFullTool(filleted) : filleted;
}

/**
 * Convert profile points into straight-line polygon (no fillets) for debug overlay.
 * ptType=2 bulge arcs are tessellated with a few segments for visibility.
 */
export function profileToStraightLines(
  points: ProfilePoint[],
  fullTool = false,
): Vec2[] {
  if (points.length < 2) return [];

  const n = points.length;
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const curr: Vec2 = { x: points[i].x_mm, y: points[i].y_mm };
    const next: Vec2 = { x: points[(i + 1) % n].x_mm, y: points[(i + 1) % n].y_mm };

    if (points[i].ptType === 2 && Math.abs(points[i].data) > 1e-10) {
      const arcPts = tessellateArc(curr, next, points[i].data, 8);
      for (const p of arcPts) result.push(p);
    } else {
      result.push(curr);
    }
  }

  result.push({ x: result[0].x, y: result[0].y });
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
