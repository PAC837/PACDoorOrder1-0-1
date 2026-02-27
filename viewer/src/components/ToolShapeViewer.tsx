import { useState, useEffect, useRef, useCallback } from 'react';
import {
  profileToLinePoints,
  profileToStraightLines,
  type ToolProfile,
} from '../utils/profileShape.js';
import type { UnitSystem } from '../types.js';
import { formatUnit } from '../types.js';

export function ToolShapeViewer({ units }: { units: UnitSystem }) {
  const [profiles, setProfiles] = useState<ToolProfile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStraight, setShowStraight] = useState(false);

  useEffect(() => {
    fetch('/data/profiles.json')
      .then((r) => r.json())
      .then((data: ToolProfile[]) => {
        setProfiles(data);
        const idx = data.findIndex((p) => p.toolId === 194);
        if (idx >= 0) setSelectedIndex(idx);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={styles.centered}><p>Loading tool profiles...</p></div>;
  }
  if (error) {
    return <div style={styles.centered}><p style={{ color: '#ff6b6b' }}>Error: {error}</p></div>;
  }
  if (profiles.length === 0) {
    return <div style={styles.centered}><p>No tool profiles found.</p></div>;
  }

  const selected = profiles[selectedIndex];

  return (
    <div style={styles.container}>
      {/* Left panel */}
      <div style={styles.overlay}>
        <h2 style={styles.title}>Tool Shapes</h2>

        <div style={styles.selector}>
          <label style={styles.label}>Tool:</label>
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            style={styles.select}
          >
            {profiles.map((p, i) => (
              <option key={p.toolId} value={i}>
                #{p.toolId} — {p.toolName}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.info}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>ID:</span>
            <span>{selected.toolId}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Name:</span>
            <span style={{ fontSize: '11px' }}>{selected.toolName}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Diameter:</span>
            <span>{formatUnit(selected.diameter_mm, units)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Points:</span>
            <span>{selected.points.length}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Fillets:</span>
            <span>{selected.points.filter((p) => p.ptType !== 0).length}</span>
          </div>
        </div>

        <div style={styles.pointList}>
          <h4 style={styles.pointHeader}>Half-Profile Points</h4>
          {selected.points.map((pt, i) => (
            <div key={i} style={styles.pointRow}>
              <span style={styles.pointIndex}>{i}</span>
              <span style={styles.pointCoord}>
                ({units === 'in' ? pt.x_in.toFixed(4) : pt.x_mm.toFixed(3)}, {units === 'in' ? pt.y_in.toFixed(4) : pt.y_mm.toFixed(3)})
              </span>
              <span style={styles.pointType}>
                {pt.ptType === 0
                  ? 'LINE'
                  : `T${pt.ptType} r=${pt.data > 0 ? '+' : ''}${pt.data.toFixed(3)}`}
              </span>
            </div>
          ))}
        </div>

        <div style={styles.toggleRow}>
          <label style={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={showStraight}
              onChange={(e) => setShowStraight(e.target.checked)}
            />
            Show straight-line polygon
          </label>
        </div>
      </div>

      {/* Main canvas */}
      <div style={styles.canvasArea}>
        <ToolCanvas profile={selected} showStraight={showStraight} />
      </div>
    </div>
  );
}

function ToolCanvas({
  profile,
  showStraight,
}: {
  profile: ToolProfile;
  showStraight: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false, lastX: 0, lastY: 0,
  });
  const pinchRef = useRef<{ dist: number; zoom: number }>({ dist: 0, zoom: 1 });

  // Reset zoom when tool changes
  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [profile]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Get full-tool mirrored points
    const points = profileToLinePoints(profile.points, 64, true);

    if (points.length < 2) {
      ctx.fillStyle = '#666688';
      ctx.font = '14px sans-serif';
      ctx.fillText('No points', 10, h / 2);
      return;
    }

    // Also get straight-line version for overlay
    const straightPts = showStraight ? profileToStraightLines(profile.points, true) : null;

    // Compute bounds from both point sets
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    if (straightPts) {
      for (const pt of straightPts) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }

    const pw = maxX - minX || 1;
    const ph = maxY - minY || 1;

    // Scale to fit with padding
    const pad = 40;
    const scaleX = (w - pad * 2) / pw;
    const scaleY = (h - pad * 2) / ph;
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * zoom;

    const cx = w / 2;
    const cy = h / 2;
    const pcx = (minX + maxX) / 2;
    const pcy = (minY + maxY) / 2;

    const toX = (px: number) => cx + (px - pcx) * scale + panX;
    const toY = (py: number) => cy - (py - pcy) * scale + panY;

    // Grid
    ctx.strokeStyle = '#2a2a44';
    ctx.lineWidth = 0.5;
    const gridStep = findGridStep(pw);
    for (let x = Math.floor((minX - 1) / gridStep) * gridStep; x <= maxX + 1; x += gridStep) {
      const sx = toX(x);
      if (sx >= 0 && sx <= w) {
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      }
    }
    for (let y = Math.floor((minY - 1) / gridStep) * gridStep; y <= maxY + 1; y += gridStep) {
      const sy = toY(y);
      if (sy >= 0 && sy <= h) {
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }
    }

    // Center axis (dashed line at x=0)
    const axisX = toX(0);
    ctx.strokeStyle = '#5577aa';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, h); ctx.stroke();
    ctx.setLineDash([]);

    // Y=0 line (tip reference)
    const tipY = toY(0);
    ctx.strokeStyle = '#555577';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, tipY); ctx.lineTo(w, tipY); ctx.stroke();
    ctx.setLineDash([]);

    // Straight-line polygon overlay (if enabled)
    if (straightPts && straightPts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toX(straightPts[0].x), toY(straightPts[0].y));
      for (let i = 1; i < straightPts.length; i++) {
        ctx.lineTo(toX(straightPts[i].x), toY(straightPts[i].y));
      }
      ctx.closePath();
      ctx.strokeStyle = '#445566';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertex dots for the straight polygon
      for (let i = 0; i < straightPts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(toX(straightPts[i].x), toY(straightPts[i].y), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#667788';
        ctx.fill();
      }
    }

    // Filled shape
    ctx.beginPath();
    ctx.moveTo(toX(points[0].x), toY(points[0].y));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i].x), toY(points[i].y));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(184, 131, 74, 0.35)';
    ctx.fill();

    // Outline
    ctx.beginPath();
    ctx.moveTo(toX(points[0].x), toY(points[0].y));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i].x), toY(points[i].y));
    }
    ctx.strokeStyle = '#ffdd88';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Zoom indicator
    if (zoom !== 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${zoom.toFixed(1)}x`, w - 10, h - 10);
    }
  }, [profile, showStraight, zoom, panX, panY]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  // Wheel zoom (center-anchored)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.1, Math.min(50, z * factor)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse drag for pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (e: MouseEvent) => {
      dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
    };
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      setPanX(px => px + dx);
      setPanY(py => py + dy);
    };
    const onUp = () => { dragRef.current.dragging = false; };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Touch pinch zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const getTouchDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchRef.current = { dist: getTouchDist(e.touches), zoom };
      } else if (e.touches.length === 1) {
        dragRef.current = { dragging: true, lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches);
        const scale = newDist / pinchRef.current.dist;
        setZoom(Math.max(0.1, Math.min(50, pinchRef.current.zoom * scale)));
      } else if (e.touches.length === 1 && dragRef.current.dragging) {
        const dx = e.touches[0].clientX - dragRef.current.lastX;
        const dy = e.touches[0].clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.touches[0].clientX;
        dragRef.current.lastY = e.touches[0].clientY;
        setPanX(px => px + dx);
        setPanY(py => py + dy);
      }
    };
    const onTouchEnd = () => { dragRef.current.dragging = false; };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [zoom]);

  const handleReset = useCallback(() => {
    setZoom(1); setPanX(0); setPanY(0);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={styles.canvas} />
      {zoom !== 1 && (
        <button
          onClick={handleReset}
          style={{
            position: 'absolute', top: 8, right: 8,
            padding: '4px 10px', fontSize: '11px',
            background: 'rgba(40,40,70,0.85)', color: '#ccc',
            border: '1px solid #555', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Reset Zoom
        </button>
      )}
    </div>
  );
}

function findGridStep(maxDim: number): number {
  if (maxDim > 50) return 10;
  if (maxDim > 20) return 5;
  if (maxDim > 5) return 1;
  return 0.5;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
  },
  centered: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e0e0e0',
    fontSize: '18px',
  },
  overlay: {
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
  selector: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#aaaacc',
    flexShrink: 0,
  },
  select: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #444466',
    background: '#2a2a4e',
    color: '#e0e0e0',
    fontSize: '12px',
    cursor: 'pointer',
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
  pointList: {
    background: 'rgba(30, 30, 50, 0.9)',
    borderRadius: 8,
    padding: '8px 12px',
    border: '1px solid #333355',
    marginBottom: 12,
  },
  pointHeader: {
    margin: '0 0 6px 0',
    fontSize: '13px',
    fontWeight: 700,
    color: '#aaaacc',
  },
  pointRow: {
    display: 'flex',
    gap: 8,
    fontSize: '11px',
    padding: '2px 0',
    fontFamily: 'monospace',
  },
  pointIndex: {
    color: '#666688',
    width: 16,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  pointCoord: {
    color: '#ccccdd',
    flexShrink: 0,
  },
  pointType: {
    color: '#8888aa',
  },
  toggleRow: {
    marginBottom: 12,
  },
  toggleLabel: {
    fontSize: '12px',
    color: '#aaaacc',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  canvasArea: {
    flex: 1,
    background: '#1a1a2e',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
};
