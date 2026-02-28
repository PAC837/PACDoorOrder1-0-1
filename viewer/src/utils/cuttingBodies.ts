import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { profileToLinePoints } from './profileShape.js';
import { expandRect, mozaikToScene } from './geometry.js';
import type { ToolProfileData, ProfilePointData, DoorGraphData, HoleData } from '../types.js';
import type { SceneRect } from './geometry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How far above the slab front face (in mm) cutting volumes extend.
 * Must be large enough to avoid coincident-face CSG artifacts.
 */
const SURFACE_OVERSHOOT = 1.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphToolEntry = DoorGraphData['operations'][0]['tools'][0];

// ---------------------------------------------------------------------------
// Cross-section builders
// ---------------------------------------------------------------------------

/**
 * Build a 2D cross-section THREE.Shape for a tool.
 *
 * Coordinates: X = across-path (+ = outward from panel), Y = Z in world (+ = toward front face).
 * The shape is positioned so tool center X = offset, tool tip Y = tipZ.
 *
 * When flipSide=true, the cross-section is positioned to cut from the back face
 * (negative Z) instead of the front face (positive Z).
 */
export function buildCrossSection(
  tool: GraphToolEntry,
  profiles: ToolProfileData[],
  thickness: number,
  flipSide = false,
): THREE.Shape | null {
  const offset = -tool.entryOffset;
  const tipZ = flipSide
    ? -thickness / 2 + tool.entryDepth
    : thickness / 2 - tool.entryDepth;
  const surfaceZ = flipSide
    ? -thickness / 2 - SURFACE_OVERSHOOT
    : thickness / 2 + SURFACE_OVERSHOOT;

  // Profile tool (isCNCDoor = true) — use actual profile shape
  const profile = profiles.find((p) => p.toolId === tool.toolId);
  if (tool.isCNCDoor && profile && profile.points.length >= 2) {
    return buildProfileCrossSection(profile.points, offset, tipZ, surfaceZ);
  }

  // V-bit (sharpCornerAngle > 0)
  if (tool.sharpCornerAngle > 0) {
    return buildVBitCrossSection(tool.toolDiameter, tool.sharpCornerAngle, offset, tipZ, surfaceZ);
  }

  // Flat tool (downshear) — rectangle
  return buildFlatCrossSection(tool.toolDiameter, offset, tipZ, surfaceZ);
}

/**
 * Return the 2D cross-section polygon for a tool as plain {x,y}[] points.
 * Same geometry as buildCrossSection but without the THREE.Shape wrapper,
 * so callers don't need to import three.js.
 *
 * Coordinates: X = across-path, Y = world Z.
 */
export function buildCrossSectionPoints(
  tool: GraphToolEntry,
  profiles: ToolProfileData[],
  thickness: number,
): { x: number; y: number }[] | null {
  const shape = buildCrossSection(tool, profiles, thickness);
  if (!shape) return null;
  const pts = shape.getPoints();
  // Remove closing duplicate (closePath creates one)
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 0.01) {
    pts.pop();
  }
  return pts.map(p => ({ x: p.x, y: p.y }));
}

function buildProfileCrossSection(
  points: ProfilePointData[],
  offset: number,
  tipZ: number,
  surfaceZ: number,
): THREE.Shape {
  const fullPts = profileToLinePoints(points, 64, true);

  if (fullPts.length < 3) {
    const maxX = Math.max(...points.map((p) => Math.abs(p.x_mm)));
    return buildFlatCrossSection(maxX * 2, offset, tipZ, surfaceZ);
  }

  // Clip polygon at surfaceZ — only keep geometry within the slab + overshoot.
  // Points above surfaceZ are clamped; consecutive duplicates from clamping are removed.
  // Direction: +1 for front (surfaceZ > tipZ), -1 for back (surfaceZ < tipZ).
  const direction = surfaceZ >= tipZ ? 1 : -1;
  const clipLocalY = Math.abs(surfaceZ - tipZ);

  const clipped: { x: number; y: number }[] = [];
  for (const p of fullPts) {
    const wx = offset + p.x;
    const wy = tipZ + direction * Math.min(p.y, clipLocalY);
    const prev = clipped[clipped.length - 1];
    if (prev && Math.abs(wx - prev.x) < 0.05 && Math.abs(wy - prev.y) < 0.05) continue;
    clipped.push({ x: wx, y: wy });
  }

  // Remove closing duplicate if present (closePath handles it)
  if (clipped.length > 1) {
    const last = clipped[clipped.length - 1];
    const first = clipped[0];
    if (Math.abs(last.x - first.x) < 0.05 && Math.abs(last.y - first.y) < 0.05) {
      clipped.pop();
    }
  }

  if (clipped.length < 3) {
    const maxX = Math.max(...points.map((p) => Math.abs(p.x_mm)));
    return buildFlatCrossSection(maxX * 2, offset, tipZ, surfaceZ);
  }

  const shape = new THREE.Shape();
  shape.moveTo(clipped[0].x, clipped[0].y);
  for (let i = 1; i < clipped.length; i++) {
    shape.lineTo(clipped[i].x, clipped[i].y);
  }
  shape.closePath();
  return shape;
}

function buildFlatCrossSection(
  diameter: number,
  offset: number,
  tipZ: number,
  surfaceZ: number,
): THREE.Shape {
  const r = diameter / 2;
  const shape = new THREE.Shape();
  shape.moveTo(offset - r, tipZ);
  shape.lineTo(offset - r, surfaceZ);
  shape.lineTo(offset + r, surfaceZ);
  shape.lineTo(offset + r, tipZ);
  shape.closePath();
  return shape;
}

function buildVBitCrossSection(
  diameter: number,
  angleDeg: number,
  offset: number,
  tipZ: number,
  surfaceZ: number,
): THREE.Shape {
  const halfAngle = (angleDeg / 2) * (Math.PI / 180);
  const r = diameter / 2;
  const cutHeight = Math.abs(surfaceZ - tipZ);
  // V-width at the surface — capped at full tool diameter
  const halfW = Math.min(cutHeight * Math.tan(halfAngle), r);

  const shape = new THREE.Shape();
  shape.moveTo(offset, tipZ);
  shape.lineTo(offset + halfW, surfaceZ);
  shape.lineTo(offset - halfW, surfaceZ);
  shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// Frame pocket builder (flat tools only)
// ---------------------------------------------------------------------------

/**
 * Build a frame-shaped (annular) pocket for a flat tool pass.
 *
 * The tool follows a rectangular toolpath. The material removed is a rectangular
 * annulus (frame) between an outer rect and inner rect, extruded from tipZ to
 * surfaceZ along the Z axis.
 */
function buildFramePocket(
  rect: SceneRect,
  offset: number,
  radius: number,
  tipZ: number,
  surfaceZ: number,
): THREE.BufferGeometry {
  const outerRect = expandRect(rect, offset + radius);
  const innerRect = expandRect(rect, offset - radius);

  // Outer boundary (CCW in XY plane)
  const shape = new THREE.Shape();
  shape.moveTo(outerRect.left, outerRect.bottom);
  shape.lineTo(outerRect.right, outerRect.bottom);
  shape.lineTo(outerRect.right, outerRect.top);
  shape.lineTo(outerRect.left, outerRect.top);
  shape.closePath();

  // Inner hole (CW — opposite winding to create a hole)
  const hole = new THREE.Path();
  hole.moveTo(innerRect.left, innerRect.bottom);
  hole.lineTo(innerRect.left, innerRect.top);
  hole.lineTo(innerRect.right, innerRect.top);
  hole.lineTo(innerRect.right, innerRect.bottom);
  hole.closePath();
  shape.holes.push(hole);

  const depth = surfaceZ - tipZ;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });

  geo.translate(0, 0, tipZ);
  return geo;
}

// ---------------------------------------------------------------------------
// Rectangular sweep (profile / V-bit tools)
// ---------------------------------------------------------------------------

/**
 * Sweep a 2D cross-section along a rectangular toolpath, producing a single
 * closed tube mesh (topologically a torus) with sharp mitered corners.
 *
 * Cross-section coordinates:
 *   X = across-path (+ = outward from panel)
 *   Y = world Z (+ = toward front face)
 *
 * At each corner, cross-section points are displaced along the miter bisector
 * (sum of the two adjacent edge outward normals). This produces a clean 45°
 * miter cut at each 90° corner — matching real CNC router behavior.
 *
 * Only 4 rings are needed (one per corner). Each adjacent pair of rings defines
 * one straight edge, and the miter geometry emerges from the ring positions.
 */
function buildRectangularSweep(
  crossSection: THREE.Shape,
  rect: SceneRect,
): THREE.BufferGeometry {
  const csPoints = crossSection.getPoints();

  // THREE.Shape.closePath() creates a duplicate of the first vertex at the end.
  // Remove it to avoid degenerate zero-area triangles in the sweep mesh,
  // which create non-manifold edges that can cause CSG failures.
  if (csPoints.length > 1 &&
      csPoints[0].distanceTo(csPoints[csPoints.length - 1]) < 0.01) {
    csPoints.pop();
  }

  // Ensure CCW winding for correct outward-facing normals in the sweep mesh.
  // Back-face cross-sections have reversed Y (direction=-1), which flips winding to CW.
  let signedArea = 0;
  for (let i = 0; i < csPoints.length; i++) {
    const j = (i + 1) % csPoints.length;
    signedArea += csPoints[i].x * csPoints[j].y - csPoints[j].x * csPoints[i].y;
  }
  if (signedArea < 0) {
    csPoints.reverse();
  }

  const N = csPoints.length;

  // 4 corners in CCW path order: BL → BR → TR → TL
  // Each corner's miter direction is the sum of the two adjacent edge outward normals.
  //   BL: left(-1,0) + bottom(0,-1) = (-1,-1)
  //   BR: bottom(0,-1) + right(1,0) = ( 1,-1)
  //   TR: right(1,0) + top(0,1)     = ( 1, 1)
  //   TL: top(0,1) + left(-1,0)     = (-1, 1)
  const miterCorners = [
    { cx: rect.left,  cy: rect.bottom, dx: -1, dy: -1 },
    { cx: rect.right, cy: rect.bottom, dx:  1, dy: -1 },
    { cx: rect.right, cy: rect.top,    dx:  1, dy:  1 },
    { cx: rect.left,  cy: rect.top,    dx: -1, dy:  1 },
  ];

  // Build one ring per corner
  const rings = miterCorners.map((c) =>
    csPoints.map((p) => new THREE.Vector3(
      c.cx + p.x * c.dx,
      c.cy + p.x * c.dy,
      p.y,
    )),
  );

  // Build indexed BufferGeometry connecting consecutive rings
  const totalRings = 4;
  const positions: number[] = [];

  for (const ring of rings) {
    for (const v of ring) {
      positions.push(v.x, v.y, v.z);
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < totalRings; r++) {
    const nextR = (r + 1) % totalRings;
    for (let p = 0; p < N; p++) {
      const nextP = (p + 1) % N;

      const i0 = r * N + p;
      const i1 = r * N + nextP;
      const i2 = nextR * N + nextP;
      const i3 = nextR * N + p;

      // Two triangles per quad
      indices.push(i0, i2, i1);
      indices.push(i0, i3, i2);
    }
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  indexed.setIndex(indices);

  // Convert to non-indexed so each triangle gets its own vertices.
  // computeVertexNormals on non-indexed geometry produces flat (per-face) normals,
  // which keeps V-bit faces looking sharp and roundover arcs true to shape.
  const geo = indexed.toNonIndexed();
  geo.computeVertexNormals();

  // three-bvh-csg requires matching attributes on both operands.
  // The slab (BoxGeometry) has UVs, so we must provide them here too.
  const vertexCount = geo.getAttribute('position').count;
  const uvs = new Float32Array(vertexCount * 2);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return geo;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build all cutting bodies for a door operation and subtract them from the slab.
 *
 * Dispatch per tool type:
 * - Flat tools (downshear): frame pocket — rectangular annulus, 1 CSG op
 * - Profile / V-bit tools: edge extrusion — actual cross-section, 4 CSG ops
 */
export function buildCarvedDoor(
  slabW: number,
  slabH: number,
  thickness: number,
  toolpathRects: { rect: SceneRect; tools: GraphToolEntry[]; depth?: number }[],
  profiles: ToolProfileData[],
  backPockets?: { rect: SceneRect; depth: number; tools: GraphToolEntry[] }[],
  holes?: HoleData[],
): THREE.BufferGeometry {
  console.time('[CNCDoorSlab] CSG carving');
  const evaluator = new Evaluator();

  // Start with the door slab
  const slabGeo = new THREE.BoxGeometry(slabW, slabH, thickness);
  let slabBrush = new Brush(slabGeo);
  slabBrush.updateMatrixWorld(true);

  // Subtract each tool
  let opCount = 0;
  let failedOps = 0;
  for (const { rect, tools, depth: frontPocketDepth } of toolpathRects) {
    // Front pocket subtraction (panel recess) — simple box inside the toolpath rect
    if (frontPocketDepth && frontPocketDepth > 0) {
      const pocketGeo = new THREE.BoxGeometry(
        rect.width, rect.height, frontPocketDepth + SURFACE_OVERSHOOT,
      );
      const pocketBrush = new Brush(pocketGeo);
      pocketBrush.position.set(
        rect.x,
        rect.y,
        thickness / 2 - frontPocketDepth / 2 + SURFACE_OVERSHOOT / 2,
      );
      pocketBrush.updateMatrixWorld(true);
      try {
        slabBrush = evaluator.evaluate(slabBrush, pocketBrush, SUBTRACTION);
        opCount++;
      } catch (e) {
        failedOps++;
        console.warn('[CNCDoorSlab] CSG subtract failed for front pocket, skipping', e);
      }
    }

    for (const tool of tools) {
      // Per-tool flip: FlipSide tools in a front operation render on the back face
      const effectiveFlipSide = tool.flipSide ?? false;
      const offset = -tool.entryOffset;
      const radius = tool.toolDiameter / 2;
      const tipZ = effectiveFlipSide
        ? -thickness / 2 + tool.entryDepth
        : thickness / 2 - tool.entryDepth;
      const surfaceZ = effectiveFlipSide
        ? -thickness / 2 - SURFACE_OVERSHOOT
        : thickness / 2 + SURFACE_OVERSHOOT;

      const isProfile = tool.isCNCDoor;
      const isVBit = tool.sharpCornerAngle > 0;
      const toolType = isProfile ? 'profile' : isVBit ? 'v-bit' : 'flat';

      console.log(
        `[CNCDoorSlab] Tool "${tool.toolName}": type=${toolType}, offset=${offset.toFixed(2)}, ` +
        `radius=${radius.toFixed(2)}, depth=${tool.entryDepth.toFixed(2)}, tipZ=${tipZ.toFixed(2)}, ` +
        `surfaceZ=${surfaceZ.toFixed(2)}${effectiveFlipSide ? ' (FLIPPED to back)' : ''}`,
      );

      if (!isProfile && !isVBit) {
        // FLAT TOOL — frame pocket (1 CSG op)
        // Swap args for back face to keep ExtrudeGeometry depth positive
        const pocketGeo = effectiveFlipSide
          ? buildFramePocket(rect, offset, radius, surfaceZ, tipZ)
          : buildFramePocket(rect, offset, radius, tipZ, surfaceZ);
        const pocketBrush = new Brush(pocketGeo);
        pocketBrush.updateMatrixWorld(true);
        try {
          slabBrush = evaluator.evaluate(slabBrush, pocketBrush, SUBTRACTION);
          opCount++;
        } catch (e) {
          failedOps++;
          console.warn(
            `[CNCDoorSlab] CSG subtract failed for flat tool "${tool.toolName}" ` +
            `(offset=${offset.toFixed(2)}, depth=${tool.entryDepth.toFixed(2)}), skipping`,
            e,
          );
        }
      } else {
        // PROFILE or V-BIT — sweep cross-section along rectangular toolpath
        const crossSection = buildCrossSection(tool, profiles, thickness, effectiveFlipSide);
        if (!crossSection) {
          console.warn(`[CNCDoorSlab] No cross-section for "${tool.toolName}", skipping`);
          continue;
        }

        const sweepGeo = buildRectangularSweep(crossSection, rect);
        const sweepBrush = new Brush(sweepGeo);
        sweepBrush.updateMatrixWorld(true);
        try {
          slabBrush = evaluator.evaluate(slabBrush, sweepBrush, SUBTRACTION);
          opCount++;
        } catch (e) {
          failedOps++;
          console.warn(
            `[CNCDoorSlab] CSG subtract failed for "${tool.toolName}", skipping`,
            e,
          );
        }
      }
    }
  }

  // Back pocket subtraction — box recess + tool profiles (mirrored to back face)
  if (backPockets && backPockets.length > 0) {
    for (const backPocket of backPockets) {
      const { rect: backRect, depth: backPocketDepth, tools: backTools } = backPocket;

      // Back pocket box recess
      if (backPocketDepth > 0) {
        const pocketGeo = new THREE.BoxGeometry(
          backRect.width, backRect.height, backPocketDepth + SURFACE_OVERSHOOT,
        );
        const pocketBrush = new Brush(pocketGeo);
        pocketBrush.position.set(
          backRect.x,
          backRect.y,
          -thickness / 2 + backPocketDepth / 2 - SURFACE_OVERSHOOT / 2,
        );
        pocketBrush.updateMatrixWorld(true);
        try {
          slabBrush = evaluator.evaluate(slabBrush, pocketBrush, SUBTRACTION);
          opCount++;
        } catch (e) {
          failedOps++;
          console.warn('[CNCDoorSlab] CSG subtract failed for back pocket, skipping', e);
        }
      }

      // Back tool profiles — same dispatch as front but with flipSide=true by default
      // Per-tool flip: FlipSide tools in a back operation render on the front face (XOR)
      for (const tool of backTools) {
        const effectiveFlipSide = !(tool.flipSide ?? false);
        const offset = -tool.entryOffset;
        const radius = tool.toolDiameter / 2;
        const tipZ = effectiveFlipSide
          ? -thickness / 2 + tool.entryDepth
          : thickness / 2 - tool.entryDepth;
        const surfaceZ = effectiveFlipSide
          ? -thickness / 2 - SURFACE_OVERSHOOT
          : thickness / 2 + SURFACE_OVERSHOOT;

        const isProfile = tool.isCNCDoor;
        const isVBit = tool.sharpCornerAngle > 0;
        const toolType = isProfile ? 'profile' : isVBit ? 'v-bit' : 'flat';

        console.log(
          `[CNCDoorSlab] Back tool "${tool.toolName}": type=${toolType}, offset=${offset.toFixed(2)}, ` +
          `radius=${radius.toFixed(2)}, depth=${tool.entryDepth.toFixed(2)}, tipZ=${tipZ.toFixed(2)}, ` +
          `surfaceZ=${surfaceZ.toFixed(2)}${!effectiveFlipSide ? ' (FLIPPED to front)' : ''}`,
        );

        if (!isProfile && !isVBit) {
          // FLAT TOOL — frame pocket; swap args for back face
          const pocketGeo = effectiveFlipSide
            ? buildFramePocket(backRect, offset, radius, surfaceZ, tipZ)
            : buildFramePocket(backRect, offset, radius, tipZ, surfaceZ);
          const pocketBrush = new Brush(pocketGeo);
          pocketBrush.updateMatrixWorld(true);
          try {
            slabBrush = evaluator.evaluate(slabBrush, pocketBrush, SUBTRACTION);
            opCount++;
          } catch (e) {
            failedOps++;
            console.warn(
              `[CNCDoorSlab] CSG subtract failed for back flat tool "${tool.toolName}", skipping`, e,
            );
          }
        } else {
          // PROFILE or V-BIT — sweep cross-section along back toolpath
          const crossSection = buildCrossSection(tool, profiles, thickness, effectiveFlipSide);
          if (!crossSection) {
            console.warn(`[CNCDoorSlab] No back cross-section for "${tool.toolName}", skipping`);
            continue;
          }

          const sweepGeo = buildRectangularSweep(crossSection, backRect);
          const sweepBrush = new Brush(sweepGeo);
          sweepBrush.updateMatrixWorld(true);
          try {
            slabBrush = evaluator.evaluate(slabBrush, sweepBrush, SUBTRACTION);
            opCount++;
          } catch (e) {
            failedOps++;
            console.warn(
              `[CNCDoorSlab] CSG subtract failed for back tool "${tool.toolName}", skipping`, e,
            );
          }
        }
      }
    }
  }

  // Hardware holes — subtract cylinders for hinge cups, mounting holes, handles
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      const holeRadius = hole.Diameter / 2;
      const holeDepth = hole.Depth + SURFACE_OVERSHOOT;
      const cylGeo = new THREE.CylinderGeometry(holeRadius, holeRadius, holeDepth, 24);
      // CylinderGeometry is Y-up; rotate to Z-axis (drilling into door face)
      cylGeo.rotateX(Math.PI / 2);

      const { x: sceneX, y: sceneY } = mozaikToScene(hole.X, hole.Y, slabW, slabH);
      const holeBrush = new Brush(cylGeo);
      if (hole.FlipSideOp) {
        // Back face: drill from -thickness/2 inward
        holeBrush.position.set(sceneX, sceneY, -thickness / 2 + hole.Depth / 2 - SURFACE_OVERSHOOT / 2);
      } else {
        // Front face: drill from +thickness/2 inward
        holeBrush.position.set(sceneX, sceneY, thickness / 2 - hole.Depth / 2 + SURFACE_OVERSHOOT / 2);
      }
      holeBrush.updateMatrixWorld(true);
      try {
        slabBrush = evaluator.evaluate(slabBrush, holeBrush, SUBTRACTION);
        opCount++;
      } catch (e) {
        failedOps++;
        console.warn(`[CNCDoorSlab] CSG subtract failed for ${hole.holeType} hole, skipping`, e);
      }
    }
  }

  console.timeEnd('[CNCDoorSlab] CSG carving');
  console.log(`[CNCDoorSlab] ${opCount} CSG operations completed${failedOps > 0 ? `, ${failedOps} failed` : ''}`);

  return slabBrush.geometry;
}
