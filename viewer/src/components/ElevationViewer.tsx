import { useRef, useEffect, useState, useCallback } from 'react';
import type { DoorData, UnitSystem } from '../types.js';
import { formatUnit } from '../types.js';

interface ElevationViewerProps {
  door: DoorData;
  units: UnitSystem;
  hasMidRail: boolean;
  midRailPos: number;    // mm from bottom to center
  midRailW: number;      // mm bar width
  hasMidStile: boolean;
  midStilePos: number;   // mm from left to center
  midStileW: number;     // mm bar width
}

export function ElevationViewer({
  door, units,
  hasMidRail, midRailPos, midRailW,
  hasMidStile, midStilePos, midStileW,
}: ElevationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(800);
  const [ch, setCh] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showHatching, setShowHatching] = useState(true);

  const doorW = door.DefaultW;
  const doorH = door.DefaultH;
  const leftStileW = door.LeftRightStileW;
  const rightStileW = door.LeftRightStileW;
  const topRailW = door.TopRailW;
  const bottomRailW = door.BottomRailW;

  // Reset zoom/pan when door changes
  useEffect(() => {
    setZoom(1); setPanX(0); setPanY(0);
  }, [door.Name]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCw(Math.round(width));
      setCh(Math.round(height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom (center-anchored)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.1, Math.min(20, z * factor)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanX((p) => p + e.clientX - lastMouse.current.x);
    setPanY((p) => p + e.clientY - lastMouse.current.y);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [isDragging]);
  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0];
      setPanX((p) => p + t.clientX - lastMouse.current.x);
      setPanY((p) => p + t.clientY - lastMouse.current.y);
      lastMouse.current = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist.current > 0) {
        const factor = dist / lastPinchDist.current;
        setZoom((z) => Math.max(0.1, Math.min(20, z * factor)));
      }
      lastPinchDist.current = dist;
    }
  }, [isDragging]);
  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastPinchDist.current = 0;
  }, []);

  const fmtDim = useCallback((mm: number) => formatUnit(mm, units), [units]);

  // DXF export
  const handleExportDxf = useCallback(() => {
    const dxf = buildElevationDxf(
      doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW,
      hasMidRail, midRailPos, midRailW,
      hasMidStile, midStilePos, midStileW,
    );
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${door.Name.replace(/\s+/g, '_')}_elevation.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [door.Name, doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW,
      hasMidRail, midRailPos, midRailW, hasMidStile, midStilePos, midStileW]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    // Coordinate transform: model space mm (origin at bottom-left of door) → screen
    const pad = 80;
    const scaleX = (cw - 2 * pad) / doorW;
    const scaleY = (ch - 2 * pad) / doorH;
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * zoom;
    const cx = cw / 2;
    const cy = ch / 2;
    const toX = (x: number) => cx + (x - doorW / 2) * scale + panX;
    const toY = (y: number) => cy - (y - doorH / 2) * scale + panY; // Y-up

    // Helper: draw a filled rect in model space
    const drawRect = (x1: number, y1: number, x2: number, y2: number) => {
      const sx1 = toX(x1), sy1 = toY(y2); // toY flips, so y2 (higher) maps to lower screen y
      const sx2 = toX(x2), sy2 = toY(y1);
      ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    };
    const strokeRect = (x1: number, y1: number, x2: number, y2: number) => {
      const sx1 = toX(x1), sy1 = toY(y2);
      const sx2 = toX(x2), sy2 = toY(y1);
      ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    };

    // Hatching helper
    const drawHatch = (x1: number, y1: number, x2: number, y2: number) => {
      if (!showHatching) return;
      const sx1 = toX(x1), sy1 = toY(y2);
      const sx2 = toX(x2), sy2 = toY(y1);
      const w = sx2 - sx1;
      const h = sy2 - sy1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx1, sy1, w, h);
      ctx.clip();
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 0.5;
      const spacing = 6;
      const diag = w + h;
      for (let d = -diag; d < diag; d += spacing) {
        ctx.beginPath();
        ctx.moveTo(sx1 + d, sy1);
        ctx.lineTo(sx1 + d + h, sy1 + h);
        ctx.stroke();
      }
      ctx.restore();
    };

    // Panel areas (light gray fill with hatching)
    const panelXMin = bottomRailW;
    const panelXMax = doorH - topRailW;
    const panelYMin = leftStileW;
    const panelYMax = doorW - rightStileW;

    // Compute sub-panel rects
    const xSplits: [number, number][] = [];
    if (hasMidRail) {
      xSplits.push([panelXMin, midRailPos - midRailW / 2]);
      xSplits.push([midRailPos + midRailW / 2, panelXMax]);
    } else {
      xSplits.push([panelXMin, panelXMax]);
    }
    const ySplits: [number, number][] = [];
    if (hasMidStile) {
      ySplits.push([panelYMin, midStilePos - midStileW / 2]);
      ySplits.push([midStilePos + midStileW / 2, panelYMax]);
    } else {
      ySplits.push([panelYMin, panelYMax]);
    }

    // Draw panel areas
    ctx.fillStyle = '#f0f0f0';
    for (const [xMin, xMax] of xSplits) {
      for (const [yMin, yMax] of ySplits) {
        // Note: model x maps to screen Y (height), model y maps to screen X (width)
        drawRect(yMin, xMin, yMax, xMax);
        drawHatch(yMin, xMin, yMax, xMax);
      }
    }

    // Frame members (stile/rail fill)
    ctx.fillStyle = '#e8dcc8';

    // Left stile
    drawRect(0, 0, leftStileW, doorH);
    // Right stile
    drawRect(doorW - rightStileW, 0, doorW, doorH);
    // Bottom rail
    drawRect(leftStileW, 0, doorW - rightStileW, bottomRailW);
    // Top rail
    drawRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

    // Mid-rail
    if (hasMidRail) {
      drawRect(leftStileW, midRailPos - midRailW / 2, doorW - rightStileW, midRailPos + midRailW / 2);
    }
    // Mid-stile
    if (hasMidStile) {
      drawRect(midStilePos - midStileW / 2, bottomRailW, midStilePos + midStileW / 2, doorH - topRailW);
    }

    // Outlines
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;

    // Door perimeter
    strokeRect(0, 0, doorW, doorH);

    // Frame member outlines
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#555555';
    // Left stile inner edge
    strokeRect(0, 0, leftStileW, doorH);
    // Right stile
    strokeRect(doorW - rightStileW, 0, doorW, doorH);
    // Bottom rail
    strokeRect(leftStileW, 0, doorW - rightStileW, bottomRailW);
    // Top rail
    strokeRect(leftStileW, doorH - topRailW, doorW - rightStileW, doorH);
    // Mid-rail
    if (hasMidRail) {
      strokeRect(leftStileW, midRailPos - midRailW / 2, doorW - rightStileW, midRailPos + midRailW / 2);
    }
    // Mid-stile
    if (hasMidStile) {
      strokeRect(midStilePos - midStileW / 2, bottomRailW, midStilePos + midStileW / 2, doorH - topRailW);
    }

    // Panel outlines
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 0.5;
    for (const [xMin, xMax] of xSplits) {
      for (const [yMin, yMax] of ySplits) {
        strokeRect(yMin, xMin, yMax, xMax);
      }
    }

    // Dimensions
    if (showDimensions) {
      // Door width (bottom)
      drawLinearDim(ctx, 0, 0, doorW, 0, fmtDim(doorW), 35, 'below', toX, toY);
      // Door height (right side)
      drawLinearDim(ctx, doorW, 0, doorW, doorH, fmtDim(doorH), 35, 'right', toX, toY);

      // Left stile width (inside, at top)
      drawLinearDim(ctx, 0, doorH, leftStileW, doorH, fmtDim(leftStileW), 15, 'above', toX, toY);
      // Right stile width (inside, at top)
      drawLinearDim(ctx, doorW - rightStileW, doorH, doorW, doorH, fmtDim(rightStileW), 15, 'above', toX, toY);
      // Top rail width (inside, at right)
      drawLinearDim(ctx, 0, doorH - topRailW, 0, doorH, fmtDim(topRailW), 15, 'left', toX, toY);
      // Bottom rail width (inside, at right)
      drawLinearDim(ctx, 0, 0, 0, bottomRailW, fmtDim(bottomRailW), 15, 'left', toX, toY);

      // Mid-rail position from bottom (left side)
      if (hasMidRail) {
        drawLinearDim(ctx, 0, 0, 0, midRailPos, fmtDim(midRailPos), 55, 'left', toX, toY);
        drawLinearDim(ctx, doorW, midRailPos - midRailW / 2, doorW, midRailPos + midRailW / 2,
          fmtDim(midRailW), 15, 'right', toX, toY);
      }
      // Mid-stile position from left (bottom)
      if (hasMidStile) {
        drawLinearDim(ctx, 0, 0, midStilePos, 0, fmtDim(midStilePos), 55, 'below', toX, toY);
        drawLinearDim(ctx, midStilePos - midStileW / 2, doorH, midStilePos + midStileW / 2, doorH,
          fmtDim(midStileW), 15, 'above', toX, toY);
      }

      // Sub-panel heights (left side, between rails/dividers)
      if (hasMidRail) {
        const bottomPanelH = (midRailPos - midRailW / 2) - bottomRailW;
        const topPanelH = (doorH - topRailW) - (midRailPos + midRailW / 2);
        drawLinearDim(ctx, leftStileW, bottomRailW, leftStileW, midRailPos - midRailW / 2,
          fmtDim(bottomPanelH), 15, 'left', toX, toY);
        drawLinearDim(ctx, leftStileW, midRailPos + midRailW / 2, leftStileW, doorH - topRailW,
          fmtDim(topPanelH), 15, 'left', toX, toY);
      }
      // Sub-panel widths (bottom, between stiles)
      if (hasMidStile) {
        const leftPanelW = (midStilePos - midStileW / 2) - leftStileW;
        const rightPanelW = (doorW - rightStileW) - (midStilePos + midStileW / 2);
        drawLinearDim(ctx, leftStileW, bottomRailW, midStilePos - midStileW / 2, bottomRailW,
          fmtDim(leftPanelW), 15, 'below', toX, toY);
        drawLinearDim(ctx, midStilePos + midStileW / 2, bottomRailW, doorW - rightStileW, bottomRailW,
          fmtDim(rightPanelW), 15, 'below', toX, toY);
      }
    }

  }, [cw, ch, zoom, panX, panY, doorW, doorH, leftStileW, rightStileW, topRailW, bottomRailW,
      hasMidRail, midRailPos, midRailW, hasMidStile, midStilePos, midStileW,
      showDimensions, showHatching, fmtDim]);

  const isZoomed = zoom !== 1 || panX !== 0 || panY !== 0;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar */}
      <div style={sidebarStyles.container}>
        <h3 style={sidebarStyles.title}>{door.Name}</h3>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>Size:</span>
          <span>{fmtDim(doorW)} x {fmtDim(doorH)}</span>
        </div>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>L/R Stile:</span>
          <span>{fmtDim(leftStileW)} / {fmtDim(rightStileW)}</span>
        </div>
        <div style={sidebarStyles.row}>
          <span style={sidebarStyles.label}>T/B Rail:</span>
          <span>{fmtDim(topRailW)} / {fmtDim(bottomRailW)}</span>
        </div>
        {hasMidRail && (
          <div style={sidebarStyles.row}>
            <span style={sidebarStyles.label}>Mid Rail:</span>
            <span>{fmtDim(midRailW)} @ {fmtDim(midRailPos)}</span>
          </div>
        )}
        {hasMidStile && (
          <div style={sidebarStyles.row}>
            <span style={sidebarStyles.label}>Mid Stile:</span>
            <span>{fmtDim(midStileW)} @ {fmtDim(midStilePos)}</span>
          </div>
        )}

        <div style={{ borderTop: '1px solid #333355', marginTop: 8, paddingTop: 8 }}>
          <div style={sidebarStyles.label}>Layers</div>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showDimensions} onChange={(e) => setShowDimensions(e.target.checked)} />
            Dimensions
          </label>
          <label style={sidebarStyles.checkLabel}>
            <input type="checkbox" checked={showHatching} onChange={(e) => setShowHatching(e.target.checked)} />
            Panel Hatching
          </label>
        </div>

        <button style={sidebarStyles.exportBtn} onClick={handleExportDxf}>
          Export DXF
        </button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={cw}
          height={ch}
          style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        {isZoomed && (
          <button
            style={resetBtnStyle}
            onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
          >
            Reset View
          </button>
        )}
      </div>
    </div>
  );
}

// --- Dimension drawing helpers (same pattern as CrossSectionViewer) ---

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

function drawLinearDim(
  ctx: CanvasRenderingContext2D,
  mx1: number, my1: number,
  mx2: number, my2: number,
  label: string,
  offset: number,
  side: 'left' | 'right' | 'above' | 'below',
  toX: (x: number) => number,
  toY: (y: number) => number,
) {
  const sx1 = toX(mx1), sy1 = toY(my1);
  const sx2 = toX(mx2), sy2 = toY(my2);

  const gap = 3;
  const ext = 4;
  const arrowSize = 6;

  let dx = 0, dy = 0;
  if (side === 'left') dx = -offset;
  else if (side === 'right') dx = offset;
  else if (side === 'above') dy = -offset;
  else dy = offset;

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

// --- DXF Export ---

function buildElevationDxf(
  doorW: number, doorH: number,
  leftStileW: number, rightStileW: number,
  topRailW: number, bottomRailW: number,
  hasMidRail: boolean, midRailPos: number, midRailW: number,
  hasMidStile: boolean, midStilePos: number, midStileW: number,
): string {
  const lines: string[] = [];
  const addLine = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    lines.push('0', 'LINE', '8', layer,
      '10', x1.toFixed(4), '20', y1.toFixed(4), '30', '0.0',
      '11', x2.toFixed(4), '21', y2.toFixed(4), '31', '0.0');
  };
  const addRect = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    addLine(layer, x1, y1, x2, y1);
    addLine(layer, x2, y1, x2, y2);
    addLine(layer, x2, y2, x1, y2);
    addLine(layer, x1, y2, x1, y1);
  };

  // Header
  const dxf: string[] = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4',
    '0', 'ENDSEC',
    // Tables — layers
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '4',
  ];
  const layers = [
    ['OUTLINE', '7'],   // white
    ['FRAME', '3'],     // green
    ['PANELS', '8'],    // gray
    ['DIVIDERS', '1'],  // red
  ];
  for (const [name, color] of layers) {
    dxf.push('0', 'LAYER', '2', name, '70', '0', '62', color, '6', 'CONTINUOUS');
  }
  dxf.push('0', 'ENDTAB', '0', 'ENDSEC');

  // Entities
  dxf.push('0', 'SECTION', '2', 'ENTITIES');

  // Door outline
  addRect('OUTLINE', 0, 0, doorW, doorH);

  // Frame members
  addRect('FRAME', 0, 0, leftStileW, doorH);
  addRect('FRAME', doorW - rightStileW, 0, doorW, doorH);
  addRect('FRAME', leftStileW, 0, doorW - rightStileW, bottomRailW);
  addRect('FRAME', leftStileW, doorH - topRailW, doorW - rightStileW, doorH);

  // Mid-rail
  if (hasMidRail) {
    addRect('DIVIDERS', leftStileW, midRailPos - midRailW / 2,
      doorW - rightStileW, midRailPos + midRailW / 2);
  }
  // Mid-stile
  if (hasMidStile) {
    addRect('DIVIDERS', midStilePos - midStileW / 2, bottomRailW,
      midStilePos + midStileW / 2, doorH - topRailW);
  }

  // Panel areas
  const panelXMin = bottomRailW;
  const panelXMax = doorH - topRailW;
  const panelYMin = leftStileW;
  const panelYMax = doorW - rightStileW;
  const xSplits: [number, number][] = hasMidRail
    ? [[panelXMin, midRailPos - midRailW / 2], [midRailPos + midRailW / 2, panelXMax]]
    : [[panelXMin, panelXMax]];
  const ySplits: [number, number][] = hasMidStile
    ? [[panelYMin, midStilePos - midStileW / 2], [midStilePos + midStileW / 2, panelYMax]]
    : [[panelYMin, panelYMax]];
  for (const [hMin, hMax] of xSplits) {
    for (const [wMin, wMax] of ySplits) {
      addRect('PANELS', wMin, hMin, wMax, hMax);
    }
  }

  dxf.push(...lines);
  dxf.push('0', 'ENDSEC', '0', 'EOF');

  return dxf.join('\n') + '\n';
}

// --- Styles ---

const sidebarStyles: Record<string, React.CSSProperties> = {
  container: {
    width: 220,
    flexShrink: 0,
    background: '#1a1a2e',
    color: '#e0e0e0',
    padding: '12px 14px',
    overflowY: 'auto',
    borderRight: '1px solid #333355',
    fontSize: '12px',
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '14px',
    fontWeight: 700,
    color: '#ffffff',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
    gap: 8,
  },
  label: {
    color: '#8888aa',
    fontWeight: 600,
    flexShrink: 0,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    padding: '3px 0',
  },
  exportBtn: {
    marginTop: 12,
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a4a6e',
    color: '#e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const resetBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid #444466',
  background: 'rgba(26, 26, 46, 0.85)',
  color: '#e0e0e0',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  zIndex: 10,
};
