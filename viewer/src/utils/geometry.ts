import type { ToolPathNodeData } from '../types.js';

/**
 * All values in mm. The door is laid out in the XY plane:
 *   X = width direction (left to right)
 *   Y = height direction (bottom to top)
 *   Z = depth/thickness direction (back to front)
 *
 * Origin is at the center of the door.
 */

// ---------------------------------------------------------------------------
// Mozaik ↔ Scene coordinate transforms
// ---------------------------------------------------------------------------

/**
 * Mozaik coordinate system:
 *   X = along door Length (height), origin at bottom
 *   Y = along door Width, origin at left
 *
 * Scene coordinate system:
 *   X = width (left→right), origin at center
 *   Y = height (bottom→top), origin at center
 */
export function mozaikToScene(
  mozX: number,
  mozY: number,
  doorW: number,
  doorH: number
): { x: number; y: number } {
  return {
    x: mozY - doorW / 2,
    y: mozX - doorH / 2,
  };
}

/** Scene-space rectangle derived from operation toolpath nodes. */
export interface SceneRect {
  /** Center X in scene coords */
  x: number;
  /** Center Y in scene coords */
  y: number;
  /** Width (scene X extent) */
  width: number;
  /** Height (scene Y extent) */
  height: number;
  /** Left edge in scene coords */
  left: number;
  /** Right edge in scene coords */
  right: number;
  /** Bottom edge in scene coords */
  bottom: number;
  /** Top edge in scene coords */
  top: number;
}

/**
 * Convert an array of OperationToolPathNode into a scene-space bounding rectangle.
 * Mozaik X → scene Y, Mozaik Y → scene X.
 */
export function toolPathToRect(
  nodes: ToolPathNodeData[],
  doorW: number,
  doorH: number
): SceneRect {
  let minMozX = Infinity, maxMozX = -Infinity;
  let minMozY = Infinity, maxMozY = -Infinity;
  for (const n of nodes) {
    if (n.X < minMozX) minMozX = n.X;
    if (n.X > maxMozX) maxMozX = n.X;
    if (n.Y < minMozY) minMozY = n.Y;
    if (n.Y > maxMozY) maxMozY = n.Y;
  }

  const left = minMozY - doorW / 2;
  const right = maxMozY - doorW / 2;
  const bottom = minMozX - doorH / 2;
  const top = maxMozX - doorH / 2;

  return {
    x: (left + right) / 2,
    y: (bottom + top) / 2,
    width: right - left,
    height: top - bottom,
    left,
    right,
    bottom,
    top,
  };
}

// ---------------------------------------------------------------------------
// Rect utilities
// ---------------------------------------------------------------------------

/**
 * Expand a SceneRect outward by `amount` on all 4 sides.
 */
export function expandRect(rect: SceneRect, amount: number): SceneRect {
  const left = rect.left - amount;
  const right = rect.right + amount;
  const bottom = rect.bottom - amount;
  const top = rect.top + amount;
  return {
    x: (left + right) / 2,
    y: (bottom + top) / 2,
    width: right - left,
    height: top - bottom,
    left,
    right,
    bottom,
    top,
  };
}
