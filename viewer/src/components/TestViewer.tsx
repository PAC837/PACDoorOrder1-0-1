import { useState, useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { DoorData, DoorGraphData, ToolProfileData, ToolVisibility, OperationVisibility, HoleData, KerfLine } from '../types.js';
import { MATERIAL_THICKNESS } from '../types.js';
import { toolPathToRect } from '../utils/geometry.js';
import { buildCarvedDoor } from '../utils/cuttingBodies.js';

// ── Settings ────────────────────────────────────────────────────────────────

interface RakingSettings {
  angle: number;       // 0–360 degrees, rotation around door face normal
  elevation: number;   // 5–45 degrees from surface plane
  intensity: number;   // 0.2–2.0
  shadowsOn: boolean;
  shadowOpacity: number;
}

const DEFAULT_SETTINGS: RakingSettings = {
  angle: 315,      // upper-left default — shows profiles well
  elevation: 15,   // fairly raking — strong shadows in cuts
  intensity: 1.0,
  shadowsOn: true,
  shadowOpacity: 0.4,
};

// ── Props ───────────────────────────────────────────────────────────────────

interface TestViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  operationVisibility: OperationVisibility;
  toolVisibility: ToolVisibility;
  thickness?: number;
  kerfs?: KerfLine[];
  textureUrl?: string;
  color?: string;
}

// ── Geometry hook ───────────────────────────────────────────────────────────

function useCarvedGeometry(
  door: DoorData,
  graph: DoorGraphData | undefined,
  profiles: ToolProfileData[],
  operationVisibility: OperationVisibility,
  toolVisibility: ToolVisibility,
  thickness: number,
  kerfs: KerfLine[],
) {
  const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const holes: HoleData[] = door.RoutedLockedShape?.Operations?.OperationHole ?? [];
  const frontOps = operations.filter(op => !op.FlipSideOp);
  const backPocketOps = operations.filter(op => op.FlipSideOp);
  const frontVisible = frontOps.some(op => operationVisibility[op.ID] === true);
  const backPocketVisible = backPocketOps.some(op => operationVisibility[op.ID] === true);
  const doorW = door.DefaultW;
  const doorH = door.DefaultH;

  return useMemo(() => {
    const toolpathRects: { rect: ReturnType<typeof toolPathToRect>; tools: DoorGraphData['operations'][0]['tools']; depth?: number; alignment?: number }[] = [];

    if (frontVisible && graph) {
      for (const op of frontOps) {
        if (!op.OperationToolPathNode || op.OperationToolPathNode.length < 3) continue;
        const rect = toolPathToRect(op.OperationToolPathNode, doorW, doorH);
        const graphOp = graph.operations.find(go => go.operationId === op.ID);
        if (graphOp) {
          const visibleTools = graphOp.tools.filter((_, ti) => {
            const key = `${graphOp.operationId}-${ti}`;
            return toolVisibility[key] !== false;
          });
          if (visibleTools.length > 0) {
            toolpathRects.push({ rect, tools: visibleTools, depth: op.Depth, alignment: graphOp.alignment });
          }
        }
      }
    }

    const backPockets: { rect: ReturnType<typeof toolPathToRect>; depth: number; tools: DoorGraphData['operations'][0]['tools']; alignment?: number }[] = [];
    if (backPocketVisible) {
      for (const bop of backPocketOps) {
        if (!bop.OperationToolPathNode || bop.OperationToolPathNode.length < 3) continue;
        const graphBackOp = graph?.operations.find(go => go.operationId === bop.ID);
        const backTools = graphBackOp
          ? graphBackOp.tools.filter((_, ti) => {
              const key = `${graphBackOp.operationId}-${ti}`;
              return toolVisibility[key] !== false;
            })
          : [];
        backPockets.push({
          rect: toolPathToRect(bop.OperationToolPathNode, doorW, doorH),
          depth: bop.Depth,
          tools: backTools,
          alignment: graphBackOp?.alignment ?? 1,
        });
      }
    }

    if (toolpathRects.length === 0 && backPockets.length === 0 && holes.length === 0 && kerfs.length === 0) {
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }

    try {
      return buildCarvedDoor(doorW, doorH, thickness, toolpathRects, profiles, backPockets, holes, kerfs);
    } catch {
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }
  }, [doorW, doorH, thickness, frontOps, backPocketOps, graph, profiles, frontVisible, backPocketVisible, toolVisibility, holes, kerfs]);
}

// ── Texture loader ──────────────────────────────────────────────────────────

function useTexture(textureUrl?: string) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!textureUrl) { setTexture(null); return; }
    const loader = new THREE.TextureLoader();
    const tex = loader.load(textureUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      setTexture(t);
    });
    return () => { tex.dispose(); };
  }, [textureUrl]);
  return texture;
}

// ── Camera auto-fit ─────────────────────────────────────────────────────────

function CameraFit({ maxDim }: { maxDim: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = maxDim * 1.8;
    camera.position.set(dist * 0.3, dist * 0.2, dist);
    camera.lookAt(0, 0, 0);
  }, [maxDim, camera]);
  return null;
}

// ── Compute raking light position ───────────────────────────────────────────

function rakingLightPosition(angleDeg: number, elevationDeg: number, dist: number): [number, number, number] {
  const a = (angleDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  // X/Y rotate around Z axis (door front normal), Z = elevation above the surface plane
  const x = Math.cos(a) * Math.cos(e) * dist;
  const y = Math.sin(a) * Math.cos(e) * dist;
  const z = Math.sin(e) * dist;
  return [x, y, z];
}

// ── Slider panel ────────────────────────────────────────────────────────────

function SliderPanel({ settings, onChange }: { settings: RakingSettings; onChange: (s: RakingSettings) => void }) {
  const set = <K extends keyof RakingSettings>(key: K, value: RakingSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div style={panelStyles.container}>
      <div style={panelStyles.title}>Raking Light</div>

      <SliderRow label="Angle" value={settings.angle} min={0} max={360} step={5}
        onChange={v => set('angle', v)} format={v => `${v}\u00B0`} />
      <SliderRow label="Elevation" value={settings.elevation} min={5} max={45} step={1}
        onChange={v => set('elevation', v)} format={v => `${v}\u00B0`} />
      <SliderRow label="Intensity" value={settings.intensity} min={0.2} max={2} step={0.1}
        onChange={v => set('intensity', v)} />

      <div style={panelStyles.section}>Ground Shadow</div>
      <CheckRow label="Shadow On" checked={settings.shadowsOn}
        onChange={v => set('shadowsOn', v)} />
      {settings.shadowsOn && (
        <SliderRow label="Opacity" value={settings.shadowOpacity} min={0} max={1} step={0.05}
          onChange={v => set('shadowOpacity', v)} />
      )}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div style={panelStyles.row}>
      <span style={panelStyles.label}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#5577aa' }} />
      <span style={panelStyles.value}>{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ ...panelStyles.row, gap: 8 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#5577aa' }} />
      <span style={{ ...panelStyles.label, flex: 1 }}>{label}</span>
    </div>
  );
}

const panelStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 50,
    right: 12,
    width: 220,
    background: 'rgba(20, 20, 35, 0.9)',
    borderRadius: 10,
    padding: '12px 14px',
    zIndex: 60,
    color: '#e0e0e0',
    fontSize: 11,
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(85, 119, 170, 0.3)',
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  section: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    color: '#8888aa',
    marginTop: 12,
    marginBottom: 6,
    borderTop: '1px solid rgba(136, 136, 170, 0.2)',
    paddingTop: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  label: {
    minWidth: 56,
    color: '#bbbbdd',
    fontSize: 11,
  },
  value: {
    minWidth: 32,
    textAlign: 'right' as const,
    color: '#aaaacc',
    fontSize: 10,
    fontFamily: 'monospace',
  },
};

// ── Main component ──────────────────────────────────────────────────────────

export function TestViewer({
  door,
  graph,
  profiles,
  operationVisibility,
  toolVisibility,
  thickness: thicknessProp,
  kerfs = [],
  textureUrl,
  color = '#B8834A',
}: TestViewerProps) {
  const [settings, setSettings] = useState<RakingSettings>(() => ({ ...DEFAULT_SETTINGS }));
  const thickness = thicknessProp ?? MATERIAL_THICKNESS;
  const doorW = door.DefaultW;
  const doorH = door.DefaultH;
  const maxDim = Math.max(doorW, doorH, thickness);
  const shadowScale = Math.max(doorW, doorH) * 3;
  const lightDist = maxDim * 2;

  const geometry = useCarvedGeometry(door, graph, profiles, operationVisibility, toolVisibility, thickness, kerfs);
  const texture = useTexture(textureUrl);
  const lightPos = rakingLightPosition(settings.angle, settings.elevation, lightDist);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f0f0f0' }}>
      <Canvas
        gl={{ logarithmicDepthBuffer: true }}
        camera={{
          position: [maxDim * 0.5, maxDim * 0.3, maxDim * 1.8],
          fov: 40,
          near: 1,
          far: 50000,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#ffffff']} />
        <CameraFit maxDim={maxDim} />

        {/* Low ambient so raking light does the heavy lifting */}
        <ambientLight intensity={0.2} />

        {/* Raking light — steep angle to door surface */}
        <directionalLight position={lightPos} intensity={settings.intensity} />

        {/* Gentle fill from opposite side to prevent pure black shadows */}
        <directionalLight
          position={rakingLightPosition(settings.angle + 180, 30, lightDist)}
          intensity={settings.intensity * 0.15}
        />

        {/* Door mesh — exact same material as main viewer */}
        <mesh geometry={geometry}>
          <meshStandardMaterial
            color={texture ? '#ffffff' : color}
            map={texture ?? undefined}
            roughness={0.7}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Contact Shadows */}
        {settings.shadowsOn && (
          <ContactShadows
            position={[0, -doorH / 2 - 1, 0]}
            opacity={settings.shadowOpacity}
            scale={shadowScale}
            blur={2}
            far={doorH}
            resolution={512}
            color="#000000"
          />
        )}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={100}
          maxDistance={10000}
        />
      </Canvas>

      {/* Slider panel */}
      <SliderPanel settings={settings} onChange={setSettings} />
    </div>
  );
}
