// ---------------------------------------------------------------------------
// Shared measure-tool hook for 2D canvas viewers.
// Provides: snap detection, 3-click measurement placement (pick A, pick B,
// place dimension line), H/V/diagonal orientation, and keyboard handling.
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discrete snap target in model coordinates. */
export interface SnapTarget {
  x: number;
  y: number;
  label?: string;
}

/** A line-segment snap target in model coordinates. */
export interface SnapLine {
  x1: number; y1: number;
  x2: number; y2: number;
  label?: string;
}

/** A completed user measurement. */
export interface Measurement {
  id: number;
  ax: number; ay: number;   // model coords point A (effective, after orientation)
  bx: number; by: number;   // model coords point B (effective, after orientation)
  perpOffset: number;        // signed perpendicular offset in screen px
  label: string;
}

/** Result of a snap search — the nearest snap point. */
export interface SnapResult {
  x: number;
  y: number;
  label?: string;
}

/** Live preview state during the placing-dim phase. */
export interface DimPreview {
  ax: number; ay: number;
  bx: number; by: number;
  perpOffset: number;
  label: string;
}

type MeasurePhase = 'placing-a' | 'placing-b' | 'placing-dim';

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseMeasureToolOptions {
  /** Screen → model inverse transform X */
  fromX: (sx: number) => number;
  /** Screen → model inverse transform Y */
  fromY: (sy: number) => number;
  /** Model → screen transform X */
  toX: (mx: number) => number;
  /** Model → screen transform Y */
  toY: (my: number) => number;
  /** Current zoom scale factor */
  scale: number;
  /** Discrete snap targets in model space */
  snapTargets: SnapTarget[];
  /** Line-segment snap targets in model space */
  snapLines: SnapLine[];
  /** Unit-aware distance formatter (mm → display string) */
  formatDistance: (mm: number) => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Perpendicular distance from point (px,py) to segment (x1,y1)→(x2,y2). */
function pointToSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number,
): { dist: number; projX: number; projY: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    const d = Math.hypot(px - x1, py - y1);
    return { dist: d, projX: x1, projY: y1 };
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const dist = Math.hypot(px - projX, py - projY);
  return { dist, projX, projY };
}

/**
 * Signed perpendicular distance from point C to infinite line A→B.
 * Positive = C is to the left of A→B, negative = to the right.
 */
function signedPerpDist(
  cx: number, cy: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-10) return 0;
  return ((cx - ax) * dy - (cy - ay) * dx) / len;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMeasureTool(opts: UseMeasureToolOptions) {
  const { fromX, fromY, toX, toY, scale, snapTargets, snapLines, formatDistance } = opts;

  const [measureMode, setMeasureMode] = useState(false);
  const [phase, setPhase] = useState<MeasurePhase>('placing-a');
  const [pointA, setPointA] = useState<{ x: number; y: number } | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dimPreview, setDimPreview] = useState<DimPreview | null>(null);

  // Raw B point from click 2 (model coords, un-straightened)
  const placingB = useRef<{ x: number; y: number } | null>(null);

  const nextId = useRef(1);

  // ---- Snap detection ----

  const findSnap = useCallback((sx: number, sy: number): SnapResult | null => {
    const mx = fromX(sx);
    const my = fromY(sy);
    const thresh = 8 / scale;

    let bestDist = Infinity;
    let best: SnapResult | null = null;
    for (const t of snapTargets) {
      const d = Math.hypot(t.x - mx, t.y - my);
      if (d < thresh && d < bestDist) {
        bestDist = d;
        best = { x: t.x, y: t.y, label: t.label };
      }
    }
    if (best) return best;

    for (const ln of snapLines) {
      const { dist, projX, projY } = pointToSegment(mx, my, ln.x1, ln.y1, ln.x2, ln.y2);
      if (dist < thresh && dist < bestDist) {
        bestDist = dist;
        best = { x: projX, y: projY, label: ln.label };
      }
    }
    return best;
  }, [fromX, fromY, scale, snapTargets, snapLines]);

  // ---- Compute dimension orientation from cursor position ----
  // Determines H/V/diagonal based on cursor relative to raw A→B midpoint.

  const computeDimPreview = useCallback((sx: number, sy: number) => {
    const a = pointA;
    const rawB = placingB.current;
    if (!a || !rawB) return;

    const cx = fromX(sx), cy = fromY(sy);

    // Screen-space coords of A and B
    const sax = toX(a.x), say = toY(a.y);
    const sbx = toX(rawB.x), sby = toY(rawB.y);
    const screenLen = Math.hypot(sbx - sax, sby - say);

    // Model-space deltas
    const rawDx = Math.abs(rawB.x - a.x);
    const rawDy = Math.abs(rawB.y - a.y);

    // Cursor distance from midpoint (model coords, for H/V fallback)
    const midX = (a.x + rawB.x) / 2;
    const midY = (a.y + rawB.y) / 2;
    const cursorDx = Math.abs(cx - midX);
    const cursorDy = Math.abs(cy - midY);

    let dimAx: number, dimAy: number, dimBx: number, dimBy: number;
    let perpOffset: number;

    // Check if A→B is truly diagonal (not nearly H or V)
    const isDiagonalLine = rawDx > rawDy * 0.15 && rawDy > rawDx * 0.15;

    // Corridor check: if cursor is close to A→B line, use aligned/diagonal
    let useAligned = false;
    if (isDiagonalLine && screenLen > 1e-6) {
      const perpDist = Math.abs(signedPerpDist(sx, sy, sax, say, sbx, sby));
      useAligned = perpDist < Math.max(screenLen * 0.20, 25);
    }

    if (useAligned) {
      // ALIGNED/DIAGONAL — perpendicular to raw A→B
      dimAx = a.x; dimAy = a.y;
      dimBx = rawB.x; dimBy = rawB.y;
      perpOffset = -signedPerpDist(sx, sy, sax, say, sbx, sby);
    } else if (cursorDy > cursorDx && rawDx > 1e-6) {
      // HORIZONTAL dimension
      dimAx = a.x; dimAy = a.y;
      dimBx = rawB.x; dimBy = a.y;
      perpOffset = -signedPerpDist(sx, sy, toX(a.x), toY(a.y), toX(rawB.x), toY(a.y));
    } else if (rawDy > 1e-6) {
      // VERTICAL dimension
      dimAx = a.x; dimAy = a.y;
      dimBx = a.x; dimBy = rawB.y;
      perpOffset = -signedPerpDist(sx, sy, toX(a.x), toY(a.y), toX(a.x), toY(rawB.y));
    } else {
      // Fallback: horizontal (A→B is purely horizontal)
      dimAx = a.x; dimAy = a.y;
      dimBx = rawB.x; dimBy = a.y;
      perpOffset = -signedPerpDist(sx, sy, toX(a.x), toY(a.y), toX(rawB.x), toY(a.y));
    }

    // Enforce minimum offset
    if (Math.abs(perpOffset) < 15) {
      perpOffset = perpOffset >= 0 ? 15 : -15;
    }

    const dist = Math.hypot(dimBx - dimAx, dimBy - dimAy);
    if (dist < 1e-6) return; // degenerate

    setDimPreview({
      ax: dimAx, ay: dimAy,
      bx: dimBx, by: dimBy,
      perpOffset,
      label: formatDistance(dist),
    });
  }, [pointA, fromX, fromY, toX, toY, formatDistance]);

  // ---- Mouse move → update snap or dim preview ----

  const handleMouseMove = useCallback((sx: number, sy: number) => {
    if (!measureMode) return;

    if (phase === 'placing-dim') {
      computeDimPreview(sx, sy);
    } else {
      setSnap(findSnap(sx, sy));
    }
  }, [measureMode, phase, computeDimPreview, findSnap]);

  // ---- Mouse down → place points or finalize dimension ----

  const handleMouseDown = useCallback((sx: number, sy: number): boolean => {
    if (!measureMode) return false;

    if (phase === 'placing-a') {
      const pt = findSnap(sx, sy) ?? { x: fromX(sx), y: fromY(sy) };
      setPointA({ x: pt.x, y: pt.y });
      setPhase('placing-b');
      return true;
    }

    if (phase === 'placing-b') {
      const a = pointA;
      if (!a) { setPhase('placing-a'); return true; }

      const pt = findSnap(sx, sy) ?? { x: fromX(sx), y: fromY(sy) };

      // Check for zero-length
      const dist = Math.hypot(pt.x - a.x, pt.y - a.y);
      if (dist < 1e-6) {
        setPhase('placing-a');
        setPointA(null);
        return true;
      }

      // Store raw B (no auto-straighten) and enter placing-dim
      placingB.current = { x: pt.x, y: pt.y };
      setPhase('placing-dim');

      // Initialize preview with default offset
      setDimPreview({
        ax: a.x, ay: a.y,
        bx: pt.x, by: pt.y,
        perpOffset: 30,
        label: formatDistance(dist),
      });
      return true;
    }

    if (phase === 'placing-dim') {
      // Click 3 — finalize measurement using current preview
      const preview = dimPreview;
      if (preview) {
        const m: Measurement = {
          id: nextId.current++,
          ax: preview.ax, ay: preview.ay,
          bx: preview.bx, by: preview.by,
          perpOffset: preview.perpOffset,
          label: preview.label,
        };
        setMeasurements(prev => [...prev, m]);
      }

      setPointA(null);
      setPhase('placing-a');
      setDimPreview(null);
      placingB.current = null;
      return true;
    }

    return false;
  }, [measureMode, phase, pointA, dimPreview, findSnap, fromX, fromY, formatDistance]);

  // ---- Mouse up — no special handling for placing-dim (3-click model) ----

  const handleMouseUp = useCallback((_sx: number, _sy: number) => {
    // Nothing to do — placing-dim finalizes on click 3 (mouseDown), not mouseUp
  }, []);

  // ---- Keyboard ----

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (phase === 'placing-b' || phase === 'placing-dim') {
        setPointA(null);
        setPhase('placing-a');
        setDimPreview(null);
        placingB.current = null;
      } else {
        setMeasureMode(false);
        setPhase('placing-a');
        setPointA(null);
        setSnap(null);
        setDimPreview(null);
      }
    }
  }, [phase]);

  // ---- Toggle ----

  const toggleMeasure = useCallback(() => {
    setMeasureMode(prev => {
      if (prev) {
        setPhase('placing-a');
        setPointA(null);
        setSnap(null);
        setDimPreview(null);
        placingB.current = null;
      } else {
        setPhase('placing-a');
      }
      return !prev;
    });
  }, []);

  // ---- Clear / remove ----

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const removeMeasurement = useCallback((id: number) => {
    setMeasurements(prev => prev.filter(m => m.id !== id));
  }, []);

  // ---- Existing dimension drag (reposition completed measurements) ----

  const handleDimMouseDown = useCallback((sx: number, sy: number): boolean => {
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i];
      const sax = toX(m.ax), say = toY(m.ay);
      const sbx = toX(m.bx), sby = toY(m.by);
      const midSx = (sax + sbx) / 2;
      const midSy = (say + sby) / 2;

      const dx = sbx - sax, dy = sby - say;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const px = -dy / len, py = dx / len;

      const labelSx = midSx + px * m.perpOffset;
      const labelSy = midSy + py * m.perpOffset;

      if (Math.hypot(sx - labelSx, sy - labelSy) < 15) {
        setDraggingIdx(i);
        return true;
      }
    }
    return false;
  }, [measurements, toX, toY]);

  const handleDimMouseMove = useCallback((sx: number, sy: number) => {
    if (draggingIdx === null) return;
    const m = measurements[draggingIdx];
    if (!m) return;

    const sax = toX(m.ax), say = toY(m.ay);
    const sbx = toX(m.bx), sby = toY(m.by);
    let perpOffset = -signedPerpDist(sx, sy, sax, say, sbx, sby);
    if (Math.abs(perpOffset) < 15) {
      perpOffset = perpOffset >= 0 ? 15 : -15;
    }

    setMeasurements(prev => prev.map((mm, i) =>
      i === draggingIdx ? { ...mm, perpOffset } : mm
    ));
  }, [draggingIdx, measurements, toX, toY]);

  const handleDimMouseUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  return {
    measureMode,
    toggleMeasure,
    phase,
    pointA,
    snap,
    measurements,
    dimPreview,
    clearMeasurements,
    removeMeasurement,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleKeyDown,
    draggingIdx,
    handleDimMouseDown,
    handleDimMouseMove,
    handleDimMouseUp,
  };
}
