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
export function equidistantPositions(count: number, axisLength: number, edgeDistance: number): number[] {
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
  thickness: number,
): HoleData[] {
  if (!config.enabled || config.count <= 0) return [];

  const clampedCupDepth = Math.min(config.cupDepth, thickness);
  const clampedMountDepth = Math.min(config.mountDepth, thickness);
  const isVertical = config.side === 'left' || config.side === 'right';
  const axisLength = isVertical ? doorH : doorW;

  // Hinge center positions along the axis
  const centers = config.equidistant
    ? equidistantPositions(config.count, axisLength, config.edgeDistance)
    : config.positions.slice(0, config.count);

  // Cup position on the cross-axis (perpendicular to hinge line)
  // cupBoringDist = edge-to-edge (door edge to nearest cup edge)
  // Cup center = cupBoringDist + cupRadius
  const cupR = config.cupDia / 2;
  let cupCrossPos: number;
  if (config.side === 'left') {
    cupCrossPos = config.cupBoringDist + cupR;         // left edge (low Y)
  } else if (config.side === 'right') {
    cupCrossPos = doorW - config.cupBoringDist - cupR; // right edge (high Y)
  } else if (config.side === 'top') {
    cupCrossPos = doorH - config.cupBoringDist - cupR; // top edge in Mozaik X
  } else {
    cupCrossPos = config.cupBoringDist + cupR;         // bottom edge
  }

  // Mounting holes offset inward from cup (toward door center)
  const mountCrossPos = isVertical
    ? (config.side === 'left' ? cupCrossPos + config.mountInset : cupCrossPos - config.mountInset)
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
        Depth: clampedCupDepth,
        FlipSideOp: true, // cups always on back
        holeType: 'hinge-cup',
      });
      // Mounting hole 1 (bottom of pair): X = center - halfSep
      holes.push({
        X: center - halfSep,
        Y: mountCrossPos,
        Diameter: config.mountDia,
        Depth: clampedMountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
      // Mounting hole 2 (top of pair): X = center + halfSep
      holes.push({
        X: center + halfSep,
        Y: mountCrossPos,
        Diameter: config.mountDia,
        Depth: clampedMountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
    } else {
      // Top/bottom hinge — cups along Y axis, X fixed
      holes.push({
        X: cupCrossPos,
        Y: center,
        Diameter: config.cupDia,
        Depth: clampedCupDepth,
        FlipSideOp: true,
        holeType: 'hinge-cup',
      });
      holes.push({
        X: mountCrossPos,
        Y: center - halfSep,
        Diameter: config.mountDia,
        Depth: clampedMountDepth,
        FlipSideOp: !config.mountOnFront,
        holeType: 'hinge-mount',
      });
      holes.push({
        X: mountCrossPos,
        Y: center + halfSep,
        Diameter: config.mountDia,
        Depth: clampedMountDepth,
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
  thickness: number,
): HoleData[] {
  if (!config.enabled) return [];

  const effectiveDepth = config.cutThrough
    ? thickness
    : Math.min(config.holeDepth, thickness);
  const depthEq = config.cutThrough ? 'PartTH' : '';
  const isKnob = config.holeSeparation === 0;

  // Determine handle center positions (may be multiple for two-equidistant)
  const handleCenters: { x: number; y: number }[] = [];

  if (doorPartType !== 'door') {
    // Drawer / reduced-rail / slab handle placement
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
    // Door: handle on opposite side from hinge (Y=0 is LEFT edge)
    let handleY: number;
    if (hingeSide === 'left') {
      handleY = doorW - config.insetFromEdge; // right side (high Y = opposite from left hinge)
    } else if (hingeSide === 'right') {
      handleY = config.insetFromEdge; // left side (low Y = opposite from right hinge)
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
      // Left/right hinge: use doorPlacement preset
      // Elevation controls X-axis for top/bottom/custom; inset is Y-axis only.
      // For handles (not knobs) with vertical separation, offset so the
      // nearest hole center sits at elevation from the edge.
      const isVerticalHinge = hingeSide === 'left' || hingeSide === 'right';
      const verticalSep = !isKnob && isVerticalHinge && config.doorPlacement !== 'center-top';
      const halfSepOffset = verticalSep ? (config.holeSeparation / 2) : 0;

      if (config.doorPlacement === 'middle') {
        handleX = doorH / 2;
      } else if (config.doorPlacement === 'custom') {
        handleX = config.elevation;
      } else if (config.doorPlacement === 'bottom') {
        handleX = config.elevation + halfSepOffset; // elevation from bottom edge
      } else if (config.doorPlacement === 'center-top') {
        handleX = doorH - config.insetFromEdge; // inset takes over for elevation
        handleY = doorW / 2; // centered width-wise
      } else {
        // 'top' — elevation from top edge (default)
        handleX = doorH - config.elevation - halfSepOffset;
      }
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
        Depth: effectiveDepth,
        FlipSideOp: !config.onFront,
        holeType: 'handle',
        depthEq,
      });
    } else {
      // Handle with two holes — separated along the height axis (X) for doors,
      // along width (Y) for drawers/reduced-rail/slab
      if (doorPartType !== 'door') {
        // Non-door handles: holes separated along Y (width)
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
        // Door handles: separation axis depends on hinge orientation and placement
        const isVerticalHinge = hingeSide === 'left' || hingeSide === 'right';
        const useHorizontalSep = !isVerticalHinge || config.doorPlacement === 'center-top';
        if (!useHorizontalSep) {
          // Vertical handle — holes separated along X (height)
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
        } else {
          // Horizontal handle (top/bottom hinge or center-top) — holes separated along Y (width)
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
        }
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
  thickness: number,
): HoleData[] {
  // Only doors get hinges
  const hingeHoles = doorPartType === 'door'
    ? computeHingeHoles(hingeConfig, doorW, doorH, thickness)
    : [];

  const handleHoles = computeHandleHoles(
    handleConfig,
    hingeConfig.side,
    doorPartType,
    doorW,
    doorH,
    thickness,
  );

  return [...hingeHoles, ...handleHoles];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface HardwareWarning {
  severity: 'error' | 'warning';
  message: string;
}

/** Validate hardware config against door dimensions. Returns warnings/errors. */
export function validateHardware(
  hingeConfig: HingeConfig,
  handleConfig: HandleConfig,
  doorPartType: DoorPartType,
  doorW: number,
  doorH: number,
  thickness: number,
  leftStileW: number,
  rightStileW: number,
  topRailW: number,
  bottomRailW: number,
): HardwareWarning[] {
  const warnings: HardwareWarning[] = [];
  const fmt = (v: number) => v.toFixed(1);

  // --- Hinge validation ---
  if (hingeConfig.enabled && doorPartType !== 'drawer') {
    const cupR = hingeConfig.cupDia / 2;

    // Cup depth vs thickness
    if (hingeConfig.cupDepth > thickness) {
      warnings.push({
        severity: 'error',
        message: `Hinge cup depth (${fmt(hingeConfig.cupDepth)}mm) exceeds material thickness (${fmt(thickness)}mm) — cup drills through panel`,
      });
    } else if (hingeConfig.cupDepth > thickness - 2) {
      warnings.push({
        severity: 'warning',
        message: `Hinge cup depth (${fmt(hingeConfig.cupDepth)}mm) leaves only ${fmt(thickness - hingeConfig.cupDepth)}mm of material`,
      });
    }

    // Cup boring distance < 0 (cup edge past door edge)
    if (hingeConfig.cupBoringDist < 0) {
      warnings.push({
        severity: 'error',
        message: `Hinge cup extends ${fmt(-hingeConfig.cupBoringDist)}mm past door edge (boring distance ${fmt(hingeConfig.cupBoringDist)}mm)`,
      });
    }

    // Cup extends into panel area (past stile/rail)
    // boring dist is edge-to-edge, so full cup span = cupBoringDist + cupDia
    const cupDia = hingeConfig.cupDia;
    const isVertical = hingeConfig.side === 'left' || hingeConfig.side === 'right';
    if (isVertical) {
      const stileW = hingeConfig.side === 'left' ? leftStileW : rightStileW;
      if (hingeConfig.cupBoringDist + cupDia > stileW) {
        warnings.push({
          severity: 'warning',
          message: `Hinge cup extends into panel area — stile width (${fmt(stileW)}mm) too narrow for cup (boring ${fmt(hingeConfig.cupBoringDist)}mm + diameter ${fmt(cupDia)}mm = ${fmt(hingeConfig.cupBoringDist + cupDia)}mm)`,
        });
      }
    } else {
      const railW = hingeConfig.side === 'top' ? topRailW : bottomRailW;
      if (hingeConfig.cupBoringDist + cupDia > railW) {
        warnings.push({
          severity: 'warning',
          message: `Hinge cup extends into panel area — rail width (${fmt(railW)}mm) too narrow for cup`,
        });
      }
    }

    // Mount depth vs thickness
    if (hingeConfig.mountDepth > thickness) {
      warnings.push({
        severity: 'error',
        message: `Hinge mount depth (${fmt(hingeConfig.mountDepth)}mm) exceeds material thickness (${fmt(thickness)}mm)`,
      });
    }

    // Mount holes cross-axis clearance (past stile/rail boundary)
    // Cup center = cupBoringDist + cupR, mount = cupCenter + mountInset
    const mountR = hingeConfig.mountDia / 2;
    if (isVertical) {
      const stileW = hingeConfig.side === 'left' ? leftStileW : rightStileW;
      const mountCross = hingeConfig.cupBoringDist + cupR + hingeConfig.mountInset;
      if (mountCross + mountR > stileW) {
        warnings.push({
          severity: 'warning',
          message: `Hinge mount holes extend into panel area (${fmt(mountCross + mountR)}mm > stile width ${fmt(stileW)}mm)`,
        });
      }
    }

    // Check hinge positions vs rail boundaries
    const axisLength = isVertical ? doorH : doorW;
    const halfSep = hingeConfig.mountSeparation / 2;
    const centers = hingeConfig.equidistant
      ? equidistantPositions(hingeConfig.count, axisLength, hingeConfig.edgeDistance)
      : hingeConfig.positions.slice(0, hingeConfig.count);

    const minBound = isVertical ? bottomRailW : leftStileW;
    const maxBound = isVertical ? doorH - topRailW : doorW - rightStileW;

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (c - halfSep - mountR < 0) {
        warnings.push({
          severity: 'error',
          message: `Hinge ${i + 1} mount hole extends past door edge (position ${fmt(c)}mm, needs ${fmt(halfSep + mountR)}mm clearance)`,
        });
      }
      if (c + halfSep + mountR > axisLength) {
        warnings.push({
          severity: 'error',
          message: `Hinge ${i + 1} mount hole extends past door edge (position ${fmt(c)}mm, needs ${fmt(halfSep + mountR)}mm from top)`,
        });
      }
      if (c - cupR < minBound) {
        warnings.push({
          severity: 'warning',
          message: `Hinge ${i + 1} cup extends into rail area at ${fmt(c - cupR)}mm (rail starts at ${fmt(minBound)}mm)`,
        });
      }
      if (c + cupR > maxBound) {
        warnings.push({
          severity: 'warning',
          message: `Hinge ${i + 1} cup extends into rail area at ${fmt(c + cupR)}mm (rail ends at ${fmt(maxBound)}mm)`,
        });
      }
    }
  }

  // --- Handle validation ---
  if (handleConfig.enabled) {
    // Hole depth vs thickness
    if (handleConfig.holeDepth > thickness) {
      warnings.push({
        severity: 'warning',
        message: `Handle hole depth (${fmt(handleConfig.holeDepth)}mm) exceeds material thickness (${fmt(thickness)}mm) — hole drills through`,
      });
    }

    // Compute actual hole positions and check bounds
    const handleHoles = computeHandleHoles(handleConfig, hingeConfig.side, doorPartType, doorW, doorH, thickness);
    const holeR = handleConfig.holeDia / 2;
    for (const hole of handleHoles) {
      if (hole.X - holeR < 0 || hole.X + holeR > doorH) {
        warnings.push({
          severity: 'error',
          message: `Handle hole at X=${fmt(hole.X)}mm extends outside door height (0–${fmt(doorH)}mm)`,
        });
        break; // One error is enough
      }
      if (hole.Y - holeR < 0 || hole.Y + holeR > doorW) {
        warnings.push({
          severity: 'error',
          message: `Handle hole at Y=${fmt(hole.Y)}mm extends outside door width (0–${fmt(doorW)}mm)`,
        });
        break;
      }
    }
  }

  return warnings;
}
