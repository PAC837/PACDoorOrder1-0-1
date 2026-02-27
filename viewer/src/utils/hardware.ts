/**
 * Hardware hole computation — pure functions that produce HoleData[] from config.
 *
 * Coordinate system: Mozaik (X = height, Y = width, origin at bottom-left).
 * Left/right hinges run vertically along the height axis.
 * Top/bottom hinges run horizontally along the width axis.
 */

import type {
  HoleData,
  HingeConfig,
  HandleConfig,
  HingeSide,
  DoorPartType,
} from '../types.js';

/**
 * Compute equidistant hinge positions along an axis.
 * Returns centers spaced evenly between `edgeDistance` from each end.
 */
function equidistantPositions(count: number, axisLength: number, edgeDistance: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [axisLength / 2];
  const first = edgeDistance;
  const last = axisLength - edgeDistance;
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(first + (last - first) * i / (count - 1));
  }
  return positions;
}

/** Compute all holes for a hinge configuration. */
export function computeHingeHoles(
  config: HingeConfig,
  doorW: number,
  doorH: number,
): HoleData[] {
  if (!config.enabled || config.count <= 0) return [];

  const isVertical = config.side === 'left' || config.side === 'right';
  const axisLength = isVertical ? doorH : doorW;

  // Hinge center positions along the axis
  const centers = config.equidistant
    ? equidistantPositions(config.count, axisLength, config.edgeDistance)
    : config.positions.slice(0, config.count);

  // Cup position on the cross-axis (perpendicular to hinge line)
  // In Mozaik coords: Y = width axis for left/right hinges, X = height axis for top/bottom
  let cupCrossPos: number;
  if (config.side === 'left') {
    cupCrossPos = doorW - config.cupBoringDist; // left edge in Mozaik Y (Y=0 is right)
  } else if (config.side === 'right') {
    cupCrossPos = config.cupBoringDist;         // right edge
  } else if (config.side === 'top') {
    cupCrossPos = doorH - config.cupBoringDist; // top edge in Mozaik X
  } else {
    cupCrossPos = config.cupBoringDist;         // bottom edge
  }

  // Mounting holes offset inward from cup
  const mountCrossPos = isVertical
    ? (config.side === 'left' ? cupCrossPos - config.mountInset : cupCrossPos + config.mountInset)
    : (config.side === 'top' ? cupCrossPos - config.mountInset : cupCrossPos + config.mountInset);

  const halfSep = config.mountSeparation / 2;
  const holes: HoleData[] = [];

  for (const center of centers) {
    if (isVertical) {
      // Cup: X = center (along height), Y = cupCrossPos
      holes.push({
        X: center,
        Y: cupCrossPos,
        Diameter: config.cupDia,
        Depth: config.cupDepth,
        FlipSideOp: true, // cups always on back
        holeType: 'hinge-cup',
      });
      // Mounting hole 1 (bottom of pair): X = center - halfSep
      holes.push({
        X: center - halfSep,
        Y: mountCrossPos,
        Diameter: config.mountDia,
        Depth: config.mountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
      // Mounting hole 2 (top of pair): X = center + halfSep
      holes.push({
        X: center + halfSep,
        Y: mountCrossPos,
        Diameter: config.mountDia,
        Depth: config.mountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
    } else {
      // Top/bottom hinge — cups along Y axis, X fixed
      holes.push({
        X: cupCrossPos,
        Y: center,
        Diameter: config.cupDia,
        Depth: config.cupDepth,
        FlipSideOp: true,
        holeType: 'hinge-cup',
      });
      holes.push({
        X: mountCrossPos,
        Y: center - halfSep,
        Diameter: config.mountDia,
        Depth: config.mountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
      holes.push({
        X: mountCrossPos,
        Y: center + halfSep,
        Diameter: config.mountDia,
        Depth: config.mountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
    }
  }

  return holes;
}

/**
 * Compute handle/knob holes.
 *
 * For a handle (separation > 0): two holes per position, centered on the handle center.
 * For a knob (separation = 0): one hole per position.
 */
export function computeHandleHoles(
  config: HandleConfig,
  hingeSide: HingeSide,
  doorPartType: DoorPartType,
  doorW: number,
  doorH: number,
): HoleData[] {
  if (!config.enabled) return [];

  const isKnob = config.holeSeparation === 0;

  // Determine handle center positions (may be multiple for two-equidistant)
  const handleCenters: { x: number; y: number }[] = [];

  if (doorPartType === 'drawer') {
    // Drawer handle placement
    switch (config.placement) {
      case 'center':
        handleCenters.push({ x: doorH / 2, y: doorW / 2 });
        break;
      case 'top-rail':
        // Near the top of the drawer (just below top rail area)
        handleCenters.push({ x: doorH - doorH * 0.25, y: doorW / 2 });
        break;
      case 'two-equidistant': {
        // Two positions, each at twoHandleEdgeDist from left/right edges
        // In Mozaik Y: left edge = high Y, right edge = low Y
        const yLeft = doorW - config.twoHandleEdgeDist;
        const yRight = config.twoHandleEdgeDist;
        handleCenters.push({ x: doorH / 2, y: yLeft });
        handleCenters.push({ x: doorH / 2, y: yRight });
        break;
      }
    }
  } else {
    // Door / reduced-rail / slab: handle on opposite side from hinge
    let handleY: number;
    if (hingeSide === 'left') {
      handleY = config.insetFromEdge; // right side (low Y in Mozaik)
    } else if (hingeSide === 'right') {
      handleY = doorW - config.insetFromEdge; // left side (high Y in Mozaik)
    } else {
      // Top/bottom hinge: handle on opposite horizontal edge
      handleY = doorW / 2; // centered width-wise
    }

    let handleX: number;
    if (hingeSide === 'top') {
      handleX = config.insetFromEdge; // near bottom edge
    } else if (hingeSide === 'bottom') {
      handleX = doorH - config.insetFromEdge; // near top edge
    } else {
      // Left/right hinge: use elevation from top or bottom
      handleX = config.elevationRef === 'from-top'
        ? doorH - config.elevation
        : config.elevation;
    }

    handleCenters.push({ x: handleX, y: handleY });
  }

  // Generate holes for each handle center
  const holes: HoleData[] = [];
  const halfSep = config.holeSeparation / 2;

  for (const center of handleCenters) {
    if (isKnob) {
      // Single knob hole
      holes.push({
        X: center.x,
        Y: center.y,
        Diameter: config.holeDia,
        Depth: config.holeDepth,
        FlipSideOp: !config.onFront,
        holeType: 'handle',
      });
    } else {
      // Handle with two holes — separated along the height axis (X) for doors,
      // along width (Y) for drawers
      if (doorPartType === 'drawer') {
        // Drawer handles: holes separated along Y (width)
        holes.push({
          X: center.x,
          Y: center.y - halfSep,
          Diameter: config.holeDia,
          Depth: config.holeDepth,
          FlipSideOp: !config.onFront,
          holeType: 'handle',
        });
        holes.push({
          X: center.x,
          Y: center.y + halfSep,
          Diameter: config.holeDia,
          Depth: config.holeDepth,
          FlipSideOp: !config.onFront,
          holeType: 'handle',
        });
      } else {
        // Door handles: holes separated along X (height)
        holes.push({
          X: center.x - halfSep,
          Y: center.y,
          Diameter: config.holeDia,
          Depth: config.holeDepth,
          FlipSideOp: !config.onFront,
          holeType: 'handle',
        });
        holes.push({
          X: center.x + halfSep,
          Y: center.y,
          Diameter: config.holeDia,
          Depth: config.holeDepth,
          FlipSideOp: !config.onFront,
          holeType: 'handle',
        });
      }
    }
  }

  return holes;
}

/** Compute all hardware holes for a door. */
export function computeAllHoles(
  hingeConfig: HingeConfig,
  handleConfig: HandleConfig,
  doorPartType: DoorPartType,
  doorW: number,
  doorH: number,
): HoleData[] {
  // Drawers don't get hinges
  const hingeHoles = doorPartType === 'drawer'
    ? []
    : computeHingeHoles(hingeConfig, doorW, doorH);

  const handleHoles = computeHandleHoles(
    handleConfig,
    hingeConfig.side,
    doorPartType,
    doorW,
    doorH,
  );

  return [...hingeHoles, ...handleHoles];
}
