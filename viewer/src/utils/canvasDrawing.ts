// ---------------------------------------------------------------------------
// Shared canvas drawing utilities for 2D dimension annotations and hatching.
// Used by CrossSectionViewer, ElevationViewer, and potentially other 2D views.
// ---------------------------------------------------------------------------

export type DimSide = 'left' | 'right' | 'above' | 'below';
export type CoordTransform = (v: number) => number;

/**
 * Draw a filled arrowhead at (x, y) pointing in the direction of `angle`.
 */
export function drawArrowHead(
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
 * @param side — where to place the dimension relative to the feature
 */
export function drawLinearDim(
  ctx: CanvasRenderingContext2D,
  mx1: number, my1: number,  // model coords start
  mx2: number, my2: number,  // model coords end
  label: string,
  offset: number,            // screen px offset from feature
  side: DimSide,
  toX: CoordTransform,
  toY: CoordTransform,
  color = '#000000',
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
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
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
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, midX, midY);
  } else {
    ctx.fillRect(midX - tw / 2, midY - th / 2 - 1, tw, th);
    ctx.fillStyle = color;
    ctx.fillText(label, midX, midY);
  }

  ctx.restore();
}

/**
 * Draw an angle dimension arc around a vertex (e.g. V-bit tip angle).
 */
export function drawAngleDim(
  ctx: CanvasRenderingContext2D,
  tipSx: number, tipSy: number,  // screen coords of vertex
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

/**
 * Draw a radius dimension with a leader line from arc center through the arc.
 */
export function drawRadiusDim(
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

/**
 * Draw a snap indicator at screen coordinates: hollow circle + crosshair.
 */
export function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  label?: string,
) {
  ctx.save();
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1.5;

  // Hollow circle
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
  ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
  ctx.stroke();

  // Optional label
  if (label) {
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#00aaff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx + 10, sy - 4);
  }
  ctx.restore();
}

/**
 * Draw the measure-tool rubber-band preview: dashed line A→cursor,
 * solid line A→auto-straightened B, and a filled dot at A.
 */
export function drawMeasurePreview(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number,   // screen coords of point A
  bx: number, by: number,   // screen coords of current cursor/snap
  straightX: number, straightY: number, // screen coords of auto-straightened B
) {
  ctx.save();

  // Dashed line from A to raw cursor
  ctx.strokeStyle = 'rgba(0, 170, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Solid line from A to straightened B
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(straightX, straightY);
  ctx.stroke();

  // Point A marker
  ctx.fillStyle = '#00aaff';
  ctx.beginPath();
  ctx.arc(ax, ay, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Draw a general-purpose linear dimension between two screen-space points.
 * Works for any angle (horizontal, vertical, or diagonal).
 *
 * @param perpOffset — signed perpendicular offset from the A→B line (screen px).
 *   Positive = left of A→B direction, negative = right.
 */
export function drawGeneralDim(
  ctx: CanvasRenderingContext2D,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  label: string,
  perpOffset: number,
  color = '#00aaff',
) {
  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  // Perpendicular unit vector (rotated 90° CCW from A→B direction)
  const px = -dy / len;
  const py = dx / len;

  const gap = 3;
  const ext = 4;
  const arrowSize = 6;

  // Dimension line endpoints (offset perpendicular from feature)
  const d1x = sx1 + px * perpOffset;
  const d1y = sy1 + py * perpOffset;
  const d2x = sx2 + px * perpOffset;
  const d2y = sy2 + py * perpOffset;

  // Extension line direction sign (same as perpOffset sign)
  const sign = perpOffset >= 0 ? 1 : -1;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.75;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Extension lines from feature to dimension line (with gap and extension past)
  ctx.beginPath();
  ctx.moveTo(sx1 + px * gap * sign, sy1 + py * gap * sign);
  ctx.lineTo(d1x + px * ext * sign, d1y + py * ext * sign);
  ctx.moveTo(sx2 + px * gap * sign, sy2 + py * gap * sign);
  ctx.lineTo(d2x + px * ext * sign, d2y + py * ext * sign);
  ctx.stroke();

  // Dimension line
  ctx.beginPath();
  ctx.moveTo(d1x, d1y);
  ctx.lineTo(d2x, d2y);
  ctx.stroke();

  // Arrows along the dimension line direction
  const angle = Math.atan2(d2y - d1y, d2x - d1x);
  drawArrowHead(ctx, d1x, d1y, angle, arrowSize);
  drawArrowHead(ctx, d2x, d2y, angle + Math.PI, arrowSize);

  // Label at midpoint with white background
  const midX = (d1x + d2x) / 2;
  const midY = (d1y + d2y) / 2;
  const metrics = ctx.measureText(label);
  const tw = metrics.width + 6;
  const th = 12;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(midX - tw / 2, midY - th / 2 - 1, tw, th);
  ctx.fillStyle = color;
  ctx.fillText(label, midX, midY);

  ctx.restore();
}

/**
 * Draw diagonal hatching lines within a rectangular area.
 * Assumes ctx is already translated/clipped to the target region.
 */
export function drawDiagonalHatch(
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
